/**
 * OTT — Over The Top upward+downward multiband expander.
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
 * Topology:
 *   input → LR4 split (200Hz, 2000Hz) → 3 bands
 *     low  → BandExpander → low_out
 *     mid  → BandExpander → mid_out
 *     high → BandExpander → high_out
 *   low_out + mid_out + high_out → output
 *
 * Determinism: no Math.random, no I/O. Pure function of input.
 */

import { DEFAULT_SR } from './constants'
import { LR4Crossover } from './multiband'

export interface OTTOptions {
  /** Low/mid crossover frequency (Hz). Default 200. */
  lowCrossoverHz?: number
  /** Mid/high crossover frequency (Hz). Default 2000. */
  midCrossoverHz?: number
  /** Sample rate (Hz). Default 44100. */
  sampleRate?: number
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
  private lowExpander: BandExpander
  private midExpander: BandExpander
  private highExpander: BandExpander
  private depth: number
  private enabled: boolean

  constructor(opts: OTTOptions = {}) {
    const sr = opts.sampleRate ?? DEFAULT_SR
    const lowHz = opts.lowCrossoverHz ?? 200
    const midHz = opts.midCrossoverHz ?? 2000
    const depth = opts.depth ?? 1.0
    const upwardDb = opts.upwardGainDb ?? 6
    const downwardDb = opts.downwardGainDb ?? -6
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

    // Slightly different settings per band for musicality
    this.lowExpander = new BandExpander(expanderOpts)
    this.midExpander = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 0.8 })
    this.highExpander = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 1.2 })
  }

  /** Process stereo buffer IN-PLACE. Each channel processed independently
   *  to preserve stereo image. Phase F fix: removed unconditional makeup gain. */
  processBuffer(L: Float32Array, R: Float32Array): void {
    if (!this.enabled) return
    const N = Math.min(L.length, R.length)
    // Phase F fix: removed unconditional makeup gain (was 1.0 + depth * 0.5).
    // Upward expansion naturally compensates for downward compression.

    for (let i = 0; i < N; i++) {
      const xL = L[i]!
      const xR = R[i]!

      // Split into 3 bands (L channel)
      const [lowL, restL] = this.lowXoverL.process(xL)
      const [midL, highL] = this.midXoverL.process(restL)

      // Split into 3 bands (R channel)
      const [lowR, restR] = this.lowXoverR.process(xR)
      const [midR, highR] = this.midXoverR.process(restR)

      // Expand each band (L and R processed independently)
      const lowOutL = this.lowExpander.process(lowL)
      const midOutL = this.midExpander.process(midL)
      const highOutL = this.highExpander.process(highL)

      const lowOutR = this.lowExpander.process(lowR)
      const midOutR = this.midExpander.process(midR)
      const highOutR = this.highExpander.process(highR)

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
    this.lowExpander.reset()
    this.midExpander.reset()
    this.highExpander.reset()
  }
}
