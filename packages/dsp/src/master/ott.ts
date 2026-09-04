/**
 * OTT — Over The Top upward+downward multiband expander.
 *
 * Moved from `apps/web/src/lib/psy4/ott.ts` into `@psy-foundation/dsp`
 * (DECISIONS_V3 D1) so the web app, the worklet and any future consumer share
 * ONE implementation.
 *
 * D2 (DECISIONS_V3): `sampleRate` is REQUIRED in `OTTOptions` — the old
 * `DEFAULT_SR = 44100` fallback made "forgot to pass SR" a silent mistuned
 * processor instead of a compile error.
 *
 * D3 (DECISIONS_V3 — BUG FIX DURING THE MOVE): the previous implementation
 * shared ONE `BandExpander` per band across L and R (old ott.ts:186-192), so
 * the R sidechain corrupted the L envelope (and vice versa) — on any signal
 * with different per-channel dynamics the two channels cross-modulated each
 * other's expansion gain. The fix: 3 bands × 2 channels of INDEPENDENT
 * envelope followers. This intentionally changes OTT output on asymmetric
 * stereo material; `master-parity.test.ts` locks the fix in (the pre-fix
 * behavior is preserved as the `ottLegacy` fixture).
 *
 * The signature processor of modern psytrance/EDM. Splits the signal into
 * 3 bands (low/mid/high), then applies BOTH:
 *   - Downward expansion: reduces loud signals above threshold
 *   - Upward expansion: boosts quiet signals below threshold
 *
 * This creates the aggressive "pumping" and "in-your-face" sound that
 * defines psytrance leads, pads, and bass.
 *
 * Inspired by Xfer OTT (free plugin used on virtually every EDM track).
 *
 * Topology (per channel, independent):
 *   input → LR4 split (200Hz, 2000Hz) → 3 bands
 *     low  → BandExpander → low_out
 *     mid  → BandExpander → mid_out
 *     high → BandExpander → high_out
 *   low_out + mid_out + high_out → output
 *
 * Determinism: no Math.random, no I/O. Pure function of input.
 */

import { LR4Crossover } from './multiband'

export interface OTTOptions {
  /** Low/mid crossover frequency (Hz). Default 200. */
  lowCrossoverHz?: number
  /** Mid/high crossover frequency (Hz). Default 2000. */
  midCrossoverHz?: number
  /** Sample rate (Hz). REQUIRED (DECISIONS_V3 D2) — no silent 44100 default. */
  sampleRate: number
  /** Depth: 0 = bypass, 1 = full OTT effect. Default 1.0. */
  depth?: number
  /** Upward expansion gain (dB). Default 6 (moderate OTT). */
  upwardGainDb?: number
  /** Downward expansion gain (dB). Default -6. */
  downwardGainDb?: number
  /** Threshold for expansion (dBFS). Default -18. */
  thresholdDb?: number
  /** Attack time (ms). Default 1 (fast). */
  attackMs?: number
  /** Release time (ms). Default 100. */
  releaseMs?: number
}

/** Per-band upward+downward expander. */
class BandExpander {
  private threshold: number // linear amplitude
  private upwardGain: number // linear (e.g., 2.0 = +6dB)
  private downwardGain: number // linear (e.g., 0.5 = -6dB)
  private depth: number
  private env: number // envelope follower
  private attackCoef: number
  private releaseCoef: number

  constructor(opts: {
    thresholdDb: number
    upwardGainDb: number
    downwardGainDb: number
    depth: number
    attackMs: number
    releaseMs: number
    sampleRate: number
  }) {
    this.threshold = 10 ** (opts.thresholdDb / 20)
    this.upwardGain = 10 ** (opts.upwardGainDb / 20)
    this.downwardGain = 10 ** (opts.downwardGainDb / 20)
    this.depth = opts.depth
    this.env = 0

    const attackSec = Math.max(1e-6, opts.attackMs / 1000)
    const releaseSec = Math.max(1e-6, opts.releaseMs / 1000)
    this.attackCoef = 1 - Math.exp(-1 / (attackSec * opts.sampleRate))
    this.releaseCoef = 1 - Math.exp(-1 / (releaseSec * opts.sampleRate))
  }

  process(x: number): number {
    const abs = Math.abs(x)
    // Envelope follower
    const coef = abs > this.env ? this.attackCoef : this.releaseCoef
    this.env += (abs - this.env) * coef

    // Compute expansion gain
    let gain = 1
    if (this.env > this.threshold) {
      // Signal above threshold → downward expansion
      const over = this.env / this.threshold
      gain = this.downwardGain ** Math.log2(over)
    } else if (this.env > 1e-6) {
      // Phase F fix: removed noise gate (threshold * 0.1) — all non-silent signals get upward expansion
      const under = this.threshold / Math.max(this.env, 1e-6)
      // Phase F fix: removed * 0.5 — full-strength upward expansion (was half-strength)
      gain = this.upwardGain ** Math.log2(under)
    }

    // Roast-fix: clamp gain to ±40 dB (0.01..100). Without this, extreme
    // params or very quiet input bands can produce gain up to 60000+, which
    // the limiter catches but is wasteful. ±40 dB is high enough to not
    // affect normal renders but low enough to prevent pathological output.
    gain = Math.max(0.01, Math.min(100, gain))

    // Blend between dry (depth=0) and wet (depth=1)
    const wetGain = 1 + (gain - 1) * this.depth
    return x * wetGain
  }

  reset(): void {
    this.env = 0
  }
}

export class OTT {
  private lowXoverL: LR4Crossover
  private midXoverL: LR4Crossover
  private lowXoverR: LR4Crossover
  private midXoverR: LR4Crossover

  // D3 FIX: independent expanders per band AND per channel (3 bands × L/R).
  // The old code had 3 shared expanders; R's sidechain corrupted L's gain.
  private lowExpanderL: BandExpander
  private midExpanderL: BandExpander
  private highExpanderL: BandExpander
  private lowExpanderR: BandExpander
  private midExpanderR: BandExpander
  private highExpanderR: BandExpander

  private depth: number
  private enabled: boolean

  constructor(opts: OTTOptions) {
    const sr = opts.sampleRate
    const lowHz = opts.lowCrossoverHz ?? 200
    const midHz = opts.midCrossoverHz ?? 2000
    // Roast-fix: clamp depth to [0, 1] and gains to ±12 dB. Without clamping,
    // depth=10 or upwardGainDb=20 produces output up to 685 billion — the
    // limiter downstream catches it, but it's better to fail safely. The
    // default depth=1.0 is the standard OTT setting; anything >1 is a bug
    // in the caller. Gain ±12 dB is the practical max for musical use.
    const depth = Math.max(0, Math.min(1, opts.depth ?? 1.0))
    const upwardDb = Math.max(0, Math.min(12, opts.upwardGainDb ?? 6))
    const downwardDb = Math.max(-12, Math.min(0, opts.downwardGainDb ?? -6))
    const thresholdDb = opts.thresholdDb ?? -18
    const attackMs = opts.attackMs ?? 1
    const releaseMs = opts.releaseMs ?? 100

    this.depth = depth
    this.enabled = depth > 0.001

    this.lowXoverL = new LR4Crossover(lowHz, sr)
    this.midXoverL = new LR4Crossover(midHz, sr)
    this.lowXoverR = new LR4Crossover(lowHz, sr)
    this.midXoverR = new LR4Crossover(midHz, sr)

    const expanderOpts = {
      thresholdDb,
      upwardGainDb: upwardDb,
      downwardGainDb: downwardDb,
      depth,
      attackMs,
      releaseMs,
      sampleRate: sr,
    }

    // Slightly different settings per band for musicality. Each channel gets
    // its own follower set (D3).
    this.lowExpanderL = new BandExpander(expanderOpts)
    this.midExpanderL = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 0.8 })
    this.highExpanderL = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 1.2 })
    this.lowExpanderR = new BandExpander(expanderOpts)
    this.midExpanderR = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 0.8 })
    this.highExpanderR = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 1.2 })
  }

  /** Process stereo buffer IN-PLACE. Each channel has fully independent
   *  crossovers and expanders to preserve the stereo image (D3). Phase F fix:
   *  removed unconditional makeup gain. */
  processBuffer(L: Float32Array, R: Float32Array): void {
    if (!this.enabled) return
    const N = Math.min(L.length, R.length)
    // Phase F fix: removed unconditional makeup gain (was 1.0 + depth * 0.5).
    // Upward expansion naturally compensates for downward compression.

    for (let i = 0; i < N; i++) {
      const xL = L[i]
      const xR = R[i]

      // Split into 3 bands (L channel)
      const [lowL, restL] = this.lowXoverL.process(xL)
      const [midL, highL] = this.midXoverL.process(restL)

      // Split into 3 bands (R channel)
      const [lowR, restR] = this.lowXoverR.process(xR)
      const [midR, highR] = this.midXoverR.process(restR)

      // Expand each band — per-channel followers (D3): L's gain is computed
      // from L's envelope only, R's from R's only.
      const lowOutL = this.lowExpanderL.process(lowL)
      const midOutL = this.midExpanderL.process(midL)
      const highOutL = this.highExpanderL.process(highL)

      const lowOutR = this.lowExpanderR.process(lowR)
      const midOutR = this.midExpanderR.process(midR)
      const highOutR = this.highExpanderR.process(highR)

      // Recombine (no makeup — upward expansion compensates)
      L[i] = lowOutL + midOutL + highOutL
      R[i] = lowOutR + midOutR + highOutR
    }
  }

  reset(): void {
    this.lowXoverL.reset()
    this.midXoverL.reset()
    this.lowXoverR.reset()
    this.midXoverR.reset()
    this.lowExpanderL.reset()
    this.midExpanderL.reset()
    this.highExpanderL.reset()
    this.lowExpanderR.reset()
    this.midExpanderR.reset()
    this.highExpanderR.reset()
  }
}
