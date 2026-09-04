/**
 * Master chain — 3-band multiband compressor with Linkwitz-Riley 4th-order
 * crossovers. Moved from `apps/web/src/lib/psy4/multiband.ts` into
 * `@psy-foundation/dsp` (DECISIONS_V3 D1) so the web app, the worklet and any
 * future consumer share ONE implementation.
 *
 * D2 (DECISIONS_V3): `sampleRate` is REQUIRED in `MultibandCompressorOptions`
 * — the old `DEFAULT_SR = 44100` fallback made "forgot to pass SR" a silent
 * mistuned master chain instead of a compile error.
 *
 * Splits a stereo signal into low / mid / high bands using LR4 crossovers
 * (24 dB/oct, phase-matched at the crossover so the band magnitudes sum to
 * unity), compresses each band independently with a feed-forward peak
 * detector and time-constant-smoothed gain envelope, then recombines.
 *
 * DETERMINISM: No Math.random(). All filter/envelope state initializes to 0.
 * ISOMORPHIC: Pure TypeScript — runs in Node/Bun and in the browser.
 *
 * Signal flow per channel:
 *
 *   input ──► xover1 (low crossover, 200 Hz) ──┬─► low  ──► compLow ──┐
 *                                              │                       │
 *                                              └─► rest ──► xover2 (mid crossover, 2000 Hz) ──┬─► mid  ──► compMid ──┤
 *                                                                                                     └─► high ──► compHigh ─┘
 *                                                                                                                           │
 *                                                                                                              sum ──► out
 *
 * Each LR4 branch is a cascade of two identical 2nd-order Butterworth sections
 * (Q = 1/√2). Because the LP and HP paths have identical group delay, their
 * magnitudes sum to unity across the spectrum — no spectral notch at the
 * crossover, unlike naive LP+HP pairs.
 */

const TWO_PI = Math.PI * 2

// Butterworth Q = 1/√2 ≈ 0.70710678. The standard value for a maximally-flat
// 2nd-order section. Two cascaded Butterworths yield an LR4 (24 dB/oct) crossover.
const BUTTERWORTH_Q = Math.SQRT1_2

// ─── RBJ Biquad Section (Direct Form II Transposed) ────────────────────────
//
// Cookbook coefficients from the RBJ audio EQ cookbook. We only need LP and HP
// here, but the same DF2T structure generalizes to any biquad.

export type BiquadType = 'lp' | 'hp'

export class BiquadSection {
  private b0 = 0
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private z1 = 0
  private z2 = 0

  constructor(type: BiquadType, freq: number, Q: number, sampleRate: number) {
    const w0 = (TWO_PI * freq) / sampleRate
    const cosw0 = Math.cos(w0)
    const sinw0 = Math.sin(w0)
    const alpha = sinw0 / (2 * Q)

    let b0: number
    let b1: number
    let b2: number
    if (type === 'lp') {
      const c = 1 - cosw0
      b0 = c / 2
      b1 = c
      b2 = c / 2
    } else {
      // hp
      const c = 1 + cosw0
      b0 = c / 2
      b1 = -c
      b2 = c / 2
    }
    const a0 = 1 + alpha
    const a1 = -2 * cosw0
    const a2 = 1 - alpha

    // Normalize by a0 so the runtime filter uses only 5 multiplies per sample.
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
  }

  /** Direct Form II Transposed: numerically well-conditioned for audio. */
  process(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }

  reset(): void {
    this.z1 = 0
    this.z2 = 0
  }
}

// ─── Linkwitz-Riley 4th-order crossover (24 dB/oct) ────────────────────────

export class LR4Crossover {
  private lp1: BiquadSection
  private lp2: BiquadSection
  private hp1: BiquadSection
  private hp2: BiquadSection

  constructor(crossoverFreq: number, sampleRate: number) {
    this.lp1 = new BiquadSection('lp', crossoverFreq, BUTTERWORTH_Q, sampleRate)
    this.lp2 = new BiquadSection('lp', crossoverFreq, BUTTERWORTH_Q, sampleRate)
    this.hp1 = new BiquadSection('hp', crossoverFreq, BUTTERWORTH_Q, sampleRate)
    this.hp2 = new BiquadSection('hp', crossoverFreq, BUTTERWORTH_Q, sampleRate)
  }

  /**
   * Returns [lowOut, highOut] — phase-matched, sum to unity magnitude across
   * the spectrum. The LP path is two cascaded Butterworth LP sections; the HP
   * path is two cascaded Butterworth HP sections. Both are 4th order, so they
   * have identical group delay and cancel exactly at the crossover.
   */
  process(input: number): [number, number] {
    const lp = this.lp2.process(this.lp1.process(input))
    const hp = this.hp2.process(this.hp1.process(input))
    return [lp, hp]
  }

  reset(): void {
    this.lp1.reset()
    this.lp2.reset()
    this.hp1.reset()
    this.hp2.reset()
  }
}

// ─── Single-band compressor (feed-forward peak detector + smooth envelope) ─

export interface BandCompressorOptions {
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  makeupDb: number
  sampleRate: number
}

export class BandCompressor {
  private threshold: number // linear amplitude
  private ratio: number
  private makeupGain: number // linear
  private attackCoeff: number
  private releaseCoeff: number
  private envFollower = 0
  private lastGainReductionLinear = 1 // 1 = no reduction
  private readonly sampleRate: number

  constructor(opts: BandCompressorOptions) {
    this.threshold = 10 ** (opts.thresholdDb / 20)
    this.ratio = Math.max(1, opts.ratio)
    this.makeupGain = 10 ** (opts.makeupDb / 20)
    this.sampleRate = opts.sampleRate

    // One-pole smoothing coefficients derived from analog time constants:
    //   coeff = 1 - exp(-1 / (timeSeconds * sampleRate))
    // For attackMs=10 @ 44.1k, this gives ~0.226 — fast but not instantaneous.
    const attackSamples = Math.max(1e-6, opts.attackMs * 0.001 * opts.sampleRate)
    const releaseSamples = Math.max(1e-6, opts.releaseMs * 0.001 * opts.sampleRate)
    this.attackCoeff = 1 - Math.exp(-1 / attackSamples)
    this.releaseCoeff = 1 - Math.exp(-1 / releaseSamples)
  }

  process(input: number): number {
    // 1. Peak detect (rectify)
    const rect = Math.abs(input)
    // 2. Smooth envelope follower — attack on rising edges, release on falling.
    const coeff = rect > this.envFollower ? this.attackCoeff : this.releaseCoeff
    this.envFollower += (rect - this.envFollower) * coeff

    // 3. Gain reduction. At ratio=1, exponent=0 ⇒ gr=1 (no compression).
    //    At ratio=∞, exponent=1 ⇒ gr = threshold/env (hard limit / brick-wall).
    //    For finite R: gr = (threshold/env)^(1 - 1/R).
    let gr = 1
    const env = this.envFollower
    if (env > this.threshold) {
      const exponent = 1 - 1 / this.ratio
      gr = (this.threshold / env) ** exponent
    }
    this.lastGainReductionLinear = gr

    // 4. Apply gain reduction * makeup
    return input * gr * this.makeupGain
  }

  /** Most recent linear gain reduction (1 = none, 0.5 = -6 dB, 0 = -∞ dB). */
  getLastGainReductionLinear(): number {
    return this.lastGainReductionLinear
  }

  reset(): void {
    this.envFollower = 0
    this.lastGainReductionLinear = 1
  }
}

// ─── 3-band multiband compressor ───────────────────────────────────────────

export interface BandDynamicsSettings {
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  makeupDb: number
}

export interface MultibandCompressorOptions {
  /** Sample rate (Hz). REQUIRED (DECISIONS_V3 D2) — no silent 44100 default. */
  sampleRate: number
  lowCrossoverHz?: number // default 200
  midCrossoverHz?: number // default 2000
  lowSettings?: Partial<BandDynamicsSettings>
  midSettings?: Partial<BandDynamicsSettings>
  highSettings?: Partial<BandDynamicsSettings>
}

// Psytrance mastering defaults (per the Stage 6 spec).
const DEFAULT_LOW_SETTINGS: BandDynamicsSettings = {
  thresholdDb: -18,
  ratio: 3.0,
  attackMs: 10,
  releaseMs: 100,
  makeupDb: 2,
}
const DEFAULT_MID_SETTINGS: BandDynamicsSettings = {
  thresholdDb: -22,
  ratio: 2.5,
  attackMs: 15,
  releaseMs: 120,
  makeupDb: 1,
}
const DEFAULT_HIGH_SETTINGS: BandDynamicsSettings = {
  thresholdDb: -20,
  ratio: 2.0,
  attackMs: 5,
  releaseMs: 80,
  makeupDb: 1,
}

export class MultibandCompressor {
  // Per-channel filter instances (4 crossovers per channel = 8 total) so stereo
  // integrity is maintained — never share filter state between L and R.
  private lowXoverL: LR4Crossover
  private midXoverL: LR4Crossover
  private lowXoverR: LR4Crossover
  private midXoverR: LR4Crossover

  private compLowL: BandCompressor
  private compMidL: BandCompressor
  private compHighL: BandCompressor
  private compLowR: BandCompressor
  private compMidR: BandCompressor
  private compHighR: BandCompressor

  // Peak gain reduction observed during the most recent processBuffer call.
  // Reported as a non-negative dB magnitude (0 dB = no reduction, 6 dB = -6 dB).
  private lowGainReductionDb = 0
  private midGainReductionDb = 0
  private highGainReductionDb = 0

  private readonly sampleRate: number

  constructor(opts: MultibandCompressorOptions) {
    const sampleRate = opts.sampleRate
    const lowXoverHz = opts.lowCrossoverHz ?? 200
    const midXoverHz = opts.midCrossoverHz ?? 2000
    this.sampleRate = sampleRate

    this.lowXoverL = new LR4Crossover(lowXoverHz, sampleRate)
    this.midXoverL = new LR4Crossover(midXoverHz, sampleRate)
    this.lowXoverR = new LR4Crossover(lowXoverHz, sampleRate)
    this.midXoverR = new LR4Crossover(midXoverHz, sampleRate)

    const lowSettings: BandDynamicsSettings = {
      ...DEFAULT_LOW_SETTINGS,
      ...opts.lowSettings,
    }
    const midSettings: BandDynamicsSettings = {
      ...DEFAULT_MID_SETTINGS,
      ...opts.midSettings,
    }
    const highSettings: BandDynamicsSettings = {
      ...DEFAULT_HIGH_SETTINGS,
      ...opts.highSettings,
    }

    const mk = (s: BandDynamicsSettings) => new BandCompressor({ ...s, sampleRate })
    this.compLowL = mk(lowSettings)
    this.compMidL = mk(midSettings)
    this.compHighL = mk(highSettings)
    this.compLowR = mk(lowSettings)
    this.compMidR = mk(midSettings)
    this.compHighR = mk(highSettings)
  }

  /**
   * Process an entire stereo buffer in-place. L and R must be the same length.
   *
   * Peak gain-reduction meters are reset at the start of each call, so the
   * getters report the peak reduction measured across this buffer.
   */
  processBuffer(L: Float32Array, R: Float32Array): void {
    const n = Math.min(L.length, R.length)

    // Track minimum linear gr (i.e. maximum dB reduction) across both channels.
    let minGrLow = 1
    let minGrMid = 1
    let minGrHigh = 1

    for (let i = 0; i < n; i++) {
      const xL = L[i]
      const xR = R[i]

      // Band-split per channel.
      const [lowL, restL] = this.lowXoverL.process(xL)
      const [midL, highL] = this.midXoverL.process(restL)
      const [lowR, restR] = this.lowXoverR.process(xR)
      const [midR, highR] = this.midXoverR.process(restR)

      // Compress each band independently.
      const lowOutL = this.compLowL.process(lowL)
      const midOutL = this.compMidL.process(midL)
      const highOutL = this.compHighL.process(highL)
      const lowOutR = this.compLowR.process(lowR)
      const midOutR = this.compMidR.process(midR)
      const highOutR = this.compHighR.process(highR)

      // Recombine — bands sum to unity magnitude (LR4 phase coherence).
      L[i] = lowOutL + midOutL + highOutL
      R[i] = lowOutR + midOutR + highOutR

      // Track peak GR across both channels.
      const grLowL = this.compLowL.getLastGainReductionLinear()
      const grLowR = this.compLowR.getLastGainReductionLinear()
      const grMidL = this.compMidL.getLastGainReductionLinear()
      const grMidR = this.compMidR.getLastGainReductionLinear()
      const grHighL = this.compHighL.getLastGainReductionLinear()
      const grHighR = this.compHighR.getLastGainReductionLinear()
      if (grLowL < minGrLow) minGrLow = grLowL
      if (grLowR < minGrLow) minGrLow = grLowR
      if (grMidL < minGrMid) minGrMid = grMidL
      if (grMidR < minGrMid) minGrMid = grMidR
      if (grHighL < minGrHigh) minGrHigh = grHighL
      if (grHighR < minGrHigh) minGrHigh = grHighR
    }

    // Convert min linear gr to positive dB magnitude (0 dB = no reduction).
    this.lowGainReductionDb = minGrLow > 0 ? -20 * Math.log10(minGrLow) : 0
    this.midGainReductionDb = minGrMid > 0 ? -20 * Math.log10(minGrMid) : 0
    this.highGainReductionDb = minGrHigh > 0 ? -20 * Math.log10(minGrHigh) : 0
  }

  getLowGainReductionDb(): number {
    return this.lowGainReductionDb
  }
  getMidGainReductionDb(): number {
    return this.midGainReductionDb
  }
  getHighGainReductionDb(): number {
    return this.highGainReductionDb
  }

  reset(): void {
    this.lowXoverL.reset()
    this.midXoverL.reset()
    this.lowXoverR.reset()
    this.midXoverR.reset()
    this.compLowL.reset()
    this.compMidL.reset()
    this.compHighL.reset()
    this.compLowR.reset()
    this.compMidR.reset()
    this.compHighR.reset()
    this.lowGainReductionDb = 0
    this.midGainReductionDb = 0
    this.highGainReductionDb = 0
  }
}
