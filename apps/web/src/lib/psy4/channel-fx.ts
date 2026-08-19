/**
 * ChannelFX — per-channel stereo effects chain for the PSY4 audio renderer.
 *
 * Signal chain (sample-accurate, called once per sample in the render loop):
 *   monoIn → EQ (mono) → Delay (stereo) → Reverb (stereo) → Pan (stereo) → Width (stereo) → [L, R]
 *
 *   - EQ: two RBJ biquad shelf filters (low shelf + high shelf), Direct Form II Transposed.
 *   - Delay: ping-pong stereo with cross-feedback, circular buffers (Float32Array, max 2s).
 *   - Reverb: compact Schroeder-style (4 parallel comb filters + 2 series allpass per channel),
 *             tuned by decaySec and damping. Pseudo-stereo via slightly different allpass delays.
 *   - Pan: equal-power constant-power panning law.
 *   - Width: M/S-based stereo width with Haas-style right-channel delay.
 *
 * DETERMINISM: no Math.random() anywhere. All state initialized to zero.
 * Same input → same output, bit-for-bit.
 *
 * Sample rate is constant (default 44100) but parameterized to allow offline resampling.
 */

// ────────────────────────────────────────────────────────────────────────────
// Public configuration interface
// ────────────────────────────────────────────────────────────────────────────

export interface ChannelFXConfig {
  eq: {
    lowGainDb: number     // low shelf gain in dB
    lowFreqHz: number     // low shelf corner frequency
    highGainDb: number    // high shelf gain in dB
    highFreqHz: number    // high shelf corner frequency
    midGainDb?: number    // mid peaking gain (0 = off)
    midFreqHz?: number    // mid peak frequency
  }
  delay: {
    timeMs: number        // delay time in ms (0 = off)
    feedback: number      // 0..0.95
    mix: number           // 0..1 wet mix
    stereoOffsetMs: number // L vs R offset for stereo ping-pong
  }
  reverb: {
    roomSize: number      // 0..1
    decaySec: number      // 0.3..5.0
    damping: number       // 0..1 (high frequency absorption)
    mix: number           // 0..1 wet mix
  }
  pan: number             // -1 = full left, 0 = center, +1 = full right
  width: number           // 0 = mono, 1 = full stereo (applied via Haas/width)
}

// ────────────────────────────────────────────────────────────────────────────
// RBJ Biquad Shelf Filter (Direct Form II Transposed)
// ────────────────────────────────────────────────────────────────────────────
//
// Coefficients per the "Audio EQ Cookbook" by Robert Bristow-Johnson.
// Shelf gain is converted from dB → linear via A = 10^(dB/40) (square root of
// linear power gain, because the cookbook formulas square A internally).
// Slope S = 1.0 (standard 12 dB/oct shelf skirt).

class BiquadShelf {
  // Normalized coefficients (a0 divided out)
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  // DF II Transposed state
  private z1 = 0
  private z2 = 0

  constructor(
    kind: 'low' | 'high' | 'peak',
    freqHz: number,
    gainDb: number,
    sampleRate: number,
    slope: number = 1.0
  ) {
    this.setCoeffs(kind, freqHz, gainDb, sampleRate, slope)
  }

  setCoeffs(
    kind: 'low' | 'high' | 'peak',
    freqHz: number,
    gainDb: number,
    sampleRate: number,
    slope: number = 1.0
  ): void {
    const A = Math.pow(10, gainDb / 40) // sqrt(linear gain)
    const w0 = (2 * Math.PI * freqHz) / sampleRate
    const cosw0 = Math.cos(w0)
    const sinw0 = Math.sin(w0)

    let b0: number, b1: number, b2: number
    let a0: number, a1: number, a2: number

    if (kind === 'peak') {
      // Peaking filter — RBJ cookbook, Q controls bandwidth
      const Q = slope
      const peakAlpha = sinw0 / (2 * Q)
      b0 = 1 + peakAlpha * A
      b1 = -2 * cosw0
      b2 = 1 - peakAlpha * A
      a0 = 1 + peakAlpha / A
      a1 = -2 * cosw0
      a2 = 1 - peakAlpha / A
    } else {
      // Shelf alpha (for low and high)
      const alpha = (sinw0 / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2)
      if (kind === 'low') {
      // Low shelf: boosts/cuts frequencies below freqHz
      b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha)
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw0)
      b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha)
      a0 = (A + 1) + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha
      a1 = -2 * ((A - 1) + (A + 1) * cosw0)
      a2 = (A + 1) + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha
    } else {
      // High shelf: boosts/cuts frequencies above freqHz
      b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha)
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw0)
      b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha)
      a0 = (A + 1) - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha
      a1 = 2 * ((A - 1) - (A + 1) * cosw0)
      a2 = (A + 1) - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha
    }
    } // end else (shelf)

    // Normalize by a0 so the filter is expressed with a0 = 1
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
  }

  /** Process one sample through the shelf filter. */
  process(x: number): number {
    // Direct Form II Transposed — best numerical accuracy for shelf filters
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

// ────────────────────────────────────────────────────────────────────────────
// Compact Schroeder Reverb (4 parallel combs + 2 series allpass per channel)
// ────────────────────────────────────────────────────────────────────────────
//
// Tuned by `roomSize` (scales comb delay lengths), `decaySec` (T60 → comb
// feedback), and `damping` (one-pole LP in the comb feedback path → high-freq
// absorption). Pseudo-stereo is achieved by running two slightly different
// allpass chains (different delay lengths) on the same mono comb sum.

class CompactReverb {
  // Base comb delay lengths (samples @ 44.1kHz), loosely Freeverb-derived.
  private static readonly COMB_BASE = [1116, 1188, 1277, 1356]
  // Allpass delay lengths for L and R — small differences create stereo width.
  private static readonly ALLPASS_L = [556, 341]
  private static readonly ALLPASS_R = [573, 311]

  private combBufs: Float32Array[]
  private combIdx: Int32Array
  private combLP: Float32Array  // one-pole damping LP state per comb
  private combFeedback: number
  private combDamping: number

  private apBufsL: Float32Array[]
  private apIdxL: Int32Array
  private apBufsR: Float32Array[]
  private apIdxR: Int32Array
  private readonly apFeedback = 0.5

  // Fixed input gain (Freeverb-style) — keeps the reverb from clipping on hot inputs.
  private readonly inputGain = 0.018

  constructor(roomSize: number, decaySec: number, damping: number, sampleRate: number) {
    // Scale comb delay lengths by roomSize: 0.5× at roomSize=0, 2.0× at roomSize=1.
    // (Even the smallest room needs some comb length to be a reverb at all.)
    const roomScale = 0.5 + Math.max(0, Math.min(1, roomSize)) * 1.5

    this.combBufs = []
    this.combIdx = new Int32Array(4)
    this.combLP = new Float32Array(4)

    let longestDelaySec = 0
    for (let i = 0; i < 4; i++) {
      const len = Math.max(8, Math.floor(CompactReverb.COMB_BASE[i] * roomScale))
      this.combBufs.push(new Float32Array(len))
      longestDelaySec = Math.max(longestDelaySec, len / sampleRate)
    }

    // Comb feedback from T60 = decaySec.
    // For a comb with delay D seconds and feedback g, the envelope decays by g
    // every D seconds. T60 = -3 * D / log10(g), so g = 10^(-3 * D / T60).
    // We use the LONGEST comb's delay to set the decay target so the slowest
    // decaying mode reaches -60 dB at decaySec. Shorter combs decay faster,
    // which is normal reverb behavior.
    const safeDecay = Math.max(0.05, decaySec)
    let g = Math.pow(10, (-3 * longestDelaySec) / safeDecay)
    // Clamp to a sane reverb range (avoid runaway feedback / dead reverb)
    g = Math.max(0.2, Math.min(0.99, g))
    this.combFeedback = g

    // Damping 0..1 → one-pole LP coefficient in comb feedback path.
    // Higher damping → more high-frequency absorption (softer, warmer reverb).
    this.combDamping = Math.max(0, Math.min(0.95, damping * 0.95))

    this.apBufsL = []
    this.apIdxL = new Int32Array(2)
    this.apBufsR = []
    this.apIdxR = new Int32Array(2)
    for (let i = 0; i < 2; i++) {
      this.apBufsL.push(new Float32Array(CompactReverb.ALLPASS_L[i]))
      this.apBufsR.push(new Float32Array(CompactReverb.ALLPASS_R[i]))
    }
  }

  /** Process one mono input sample → stereo [L, R] reverb tail. */
  process(input: number): [number, number] {
    // Guard against NaN/Infinity entering the feedback loops
    if (!isFinite(input)) return [0, 0]
    const inSample = input * this.inputGain

    // 4 parallel comb filters with damping LP in the feedback path
    let combSum = 0
    for (let i = 0; i < 4; i++) {
      const buf = this.combBufs[i]
      const idx = this.combIdx[i]
      const delayed = buf[idx]
      // One-pole damping LP on the delayed signal (absorbs highs over time)
      const lp = this.combLP[i]
      const damped = delayed + this.combDamping * (lp - delayed)
      this.combLP[i] = damped
      const out = inSample + damped * this.combFeedback
      buf[idx] = out
      this.combIdx[i] = (idx + 1) % buf.length
      combSum += out
    }
    combSum *= 0.25 // average the 4 comb outputs

    // Two series allpass for L channel
    let apL = combSum
    for (let i = 0; i < 2; i++) {
      const buf = this.apBufsL[i]
      const idx = this.apIdxL[i]
      const delayed = buf[idx]
      const out = -apL * this.apFeedback + delayed
      buf[idx] = apL + delayed * this.apFeedback
      this.apIdxL[i] = (idx + 1) % buf.length
      apL = out
    }

    // Two series allpass for R channel (different delays → stereo width)
    let apR = combSum
    for (let i = 0; i < 2; i++) {
      const buf = this.apBufsR[i]
      const idx = this.apIdxR[i]
      const delayed = buf[idx]
      const out = -apR * this.apFeedback + delayed
      buf[idx] = apR + delayed * this.apFeedback
      this.apIdxR[i] = (idx + 1) % buf.length
      apR = out
    }

    return [apL, apR]
  }

  reset(): void {
    for (const b of this.combBufs) b.fill(0)
    this.combIdx.fill(0)
    this.combLP.fill(0)
    for (const b of this.apBufsL) b.fill(0)
    for (const b of this.apBufsR) b.fill(0)
    this.apIdxL.fill(0)
    this.apIdxR.fill(0)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ChannelFX — the public class
// ────────────────────────────────────────────────────────────────────────────

export class ChannelFX {
  private readonly sampleRate: number

  // EQ
  private readonly lowShelf: BiquadShelf
  private readonly highShelf: BiquadShelf
  private readonly midPeak: BiquadShelf | null

  // Delay (ping-pong)
  private readonly delayBufSize: number
  private readonly delayBufL: Float32Array
  private readonly delayBufR: Float32Array
  private delayWriteIdx = 0
  private readonly delaySamplesL: number
  private readonly delaySamplesR: number
  private readonly delayFeedback: number
  private readonly delayMix: number
  private readonly delayEnabled: boolean

  // Reverb
  private readonly reverb: CompactReverb
  private readonly reverbMix: number

  // Pan (equal-power)
  private readonly panGainL: number
  private readonly panGainR: number

  // Width (Haas + M/S)
  private readonly widthDelaySamples: number
  private readonly widthSideGain: number   // 0..1.3 — kills side at width=0 → mono
  private readonly widthBuf: Float32Array
  private widthIdx = 0

  constructor(config: ChannelFXConfig, sampleRate: number = 44100) {
    this.sampleRate = sampleRate

    // ── EQ ────────────────────────────────────────────────────────────────
    this.lowShelf = new BiquadShelf('low', config.eq.lowFreqHz, config.eq.lowGainDb, sampleRate)
    this.highShelf = new BiquadShelf('high', config.eq.highFreqHz, config.eq.highGainDb, sampleRate)
    // Mid peak filter (optional — for 3-4kHz "boxiness" cut)
    if (config.eq.midGainDb && config.eq.midGainDb !== 0 && config.eq.midFreqHz) {
      this.midPeak = new BiquadShelf('peak', config.eq.midFreqHz, config.eq.midGainDb, sampleRate, 1.5)
    } else {
      this.midPeak = null
    }

    // ── Delay ─────────────────────────────────────────────────────────────
    // Max 2 seconds = 88200 samples @ 44.1kHz. Covers any musical delay time
    // up to a half-note dotted at 145 BPM (~413ms) with plenty of headroom.
    this.delayBufSize = Math.floor(sampleRate * 2)
    this.delayBufL = new Float32Array(this.delayBufSize)
    this.delayBufR = new Float32Array(this.delayBufSize)
    this.delayFeedback = Math.max(0, Math.min(0.95, config.delay.feedback))
    this.delayMix = Math.max(0, Math.min(1, config.delay.mix))
    // Skip delay entirely if no time or no mix — saves CPU and avoids 1-sample
    // noise from running a disabled delay line.
    this.delayEnabled = config.delay.timeMs > 0 && this.delayMix > 0
    this.delaySamplesL = Math.max(1, Math.floor((config.delay.timeMs / 1000) * sampleRate))
    this.delaySamplesR = Math.max(
      1,
      Math.floor(((config.delay.timeMs + config.delay.stereoOffsetMs) / 1000) * sampleRate)
    )

    // ── Reverb ────────────────────────────────────────────────────────────
    this.reverb = new CompactReverb(
      config.reverb.roomSize,
      config.reverb.decaySec,
      config.reverb.damping,
      sampleRate
    )
    this.reverbMix = Math.max(0, Math.min(1, config.reverb.mix))

    // ── Pan (equal-power) ─────────────────────────────────────────────────
    // pan = -1 → angle 0       → L=cos(0)=1,  R=sin(0)=0   (L only)
    // pan =  0 → angle PI/4    → L=R=0.707                (center, equal power)
    // pan = +1 → angle PI/2    → L=cos(PI/2)=0, R=sin(PI/2)=1 (R only)
    const panClamped = Math.max(-1, Math.min(1, config.pan))
    const panAngle = ((panClamped + 1) * Math.PI) / 4
    this.panGainL = Math.cos(panAngle)
    this.panGainR = Math.sin(panAngle)

    // ── Width (Haas + M/S) ────────────────────────────────────────────────
    // width = 0 → no Haas delay, sideGain = 0 → output mono (L = R = mid).
    // width = 1 → 662-sample (~15ms) Haas delay on R, sideGain = 1.3 (slight
    //             side boost for the "Haas/width" stereo enhancement).
    const w = Math.max(0, Math.min(1, config.width))
    this.widthDelaySamples = Math.floor(w * 662)
    this.widthSideGain = w * 1.3
    this.widthBuf = new Float32Array(Math.max(1, this.widthDelaySamples))
  }

  /**
   * Process one mono input sample through the full chain → stereo [L, R].
   *
   * CRITICAL: this is sample-by-sample. Each call returns exactly one [L, R]
   * pair. Do NOT call it with a buffer.
   */
  process(monoIn: number): [number, number] {
    if (!isFinite(monoIn)) monoIn = 0

    // 1) EQ (mono) — low shelf then high shelf
    let sig = this.lowShelf.process(monoIn)
    if (this.midPeak) sig = this.midPeak.process(sig)
    sig = this.highShelf.process(sig)

    // 2) Delay (creates stereo via ping-pong)
    let dryL = sig
    let dryR = sig
    if (this.delayEnabled) {
      // Read delayed samples from each buffer (circular, oldest sample at the
      // position `delayWriteIdx - delaySamples`).
      const readL =
        this.delayBufL[
          (this.delayWriteIdx - this.delaySamplesL + this.delayBufSize) % this.delayBufSize
        ]
      const readR =
        this.delayBufR[
          (this.delayWriteIdx - this.delaySamplesR + this.delayBufSize) % this.delayBufSize
        ]

      // Ping-pong cross-feedback: L's feedback feeds R's input and vice-versa.
      // This makes echoes bounce between the channels → stereo ping-pong effect.
      const writeL = sig + readR * this.delayFeedback
      const writeR = sig + readL * this.delayFeedback
      this.delayBufL[this.delayWriteIdx] = writeL
      this.delayBufR[this.delayWriteIdx] = writeR
      this.delayWriteIdx = (this.delayWriteIdx + 1) % this.delayBufSize

      // Wet/dry mix per channel
      dryL = sig * (1 - this.delayMix) + readL * this.delayMix
      dryR = sig * (1 - this.delayMix) + readR * this.delayMix
    }

    // 3) Reverb (stereo) — mono sum in, stereo out, wet/dry mix
    if (this.reverbMix > 0) {
      const reverbIn = (dryL + dryR) * 0.5
      const [wL, wR] = this.reverb.process(reverbIn)
      const wet = this.reverbMix
      const dry = 1 - wet
      dryL = dryL * dry + wL * wet
      dryR = dryR * dry + wR * wet
    }

    // 4) Pan (stereo) — equal-power gain per channel
    let L = dryL * this.panGainL
    let R = dryR * this.panGainR

    // 5) Width (stereo) — Haas delay on R + M/S side gain
    //
    // The M/S stage ALWAYS runs. At width=0, sideGain=0 → side=0 → L=R=mid (mono).
    // At width>0, the Haas delay creates inter-aural time difference, and the
    // side gain slightly boosts the difference signal for a wider image.
    if (this.widthDelaySamples > 0) {
      // Haas: delay the right channel by N samples
      const wDelayed = this.widthBuf[this.widthIdx]
      this.widthBuf[this.widthIdx] = R
      this.widthIdx = (this.widthIdx + 1) % this.widthBuf.length
      R = wDelayed
    }

    const mid = (L + R) * 0.5
    const side = (L - R) * 0.5 * this.widthSideGain
    L = mid + side
    R = mid - side

    return [L, R]
  }

  /** Clear all internal state (delay buffers, reverb, filter states). */
  reset(): void {
    this.lowShelf.reset()
    this.highShelf.reset()
    if (this.midPeak) this.midPeak.reset()
    this.delayBufL.fill(0)
    this.delayBufR.fill(0)
    this.delayWriteIdx = 0
    this.reverb.reset()
    this.widthBuf.fill(0)
    this.widthIdx = 0
  }
}
