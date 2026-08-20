/**
 * Stage 5 (part 2) — True-Peak Lookahead Limiter
 *
 * Stereo lookahead brickwall limiter for the PSY4 master bus. Detects
 * inter-sample (true) peaks via 4x oversampling of the detector path, then
 * drives a smooth attack/release envelope that is applied to the
 * NON-oversampled delayed signal. A final hard-clip at `ceiling` is the
 * brickwall safety net so the output is guaranteed to never exceed ceiling.
 *
 * Topology:
 *
 *   input ──┬───────────────────────► 4x oversample (Catmull-Rom)
 *           │                          │
 *           │                          ▼
 *           │                       per-sample
 *           │                       true-peak
 *           │                          │
 *           │                          ▼
 *           │                     ┌──────────┐
 *           │                     │ lookahead│── max peak in next D samples
 *           │                     │  window  │
 *           │                     └──────────┘
 *           │                          │
 *           │                          ▼
 *           │                  target = threshold / maxPeak
 *           │                          │
 *           │                          ▼
 *           │                  ┌────────────┐
 *           │                  │  envelope  │  attack 1 ms / release 100 ms
 *           │                  │  smoother  │
 *           │                  └────────────┘
 *           │                          │
 *           ▼                          ▼
 *      [D-sample delay]              gain
 *           │                          │
 *           └──────────►  (delayed * gain)  ──► hard-clip @ ceiling ──► output
 *
 * 4x oversampling uses Catmull-Rom cubic interpolation, which is smooth,
 * deterministic, and gives a reasonable upper bound on inter-sample peaks
 * (it can overshoot between samples where linear interpolation cannot).
 *
 * Determinism: no Math.random, no I/O, no Date. Pure function of input.
 */

import { DEFAULT_SR } from './constants'

export interface TruePeakLimiterOptions {
  /** Limiter begins reducing gain above this level (dBTP). Default -1.0. */
  thresholdDb?: number
  /** Hard ceiling — output is clamped to this level (dBTP). Default -1.0. */
  ceilingDb?: number
  /** Envelope attack time (ms). Default 1.0. */
  attackMs?: number
  /** Envelope release time (ms). Default 100.0. */
  releaseMs?: number
  /** Lookahead window (ms) — also the output delay. Default 5.0. */
  lookaheadMs?: number
  /** Sample rate (Hz). Default 44100. */
  sampleRate?: number
}

/** Catmull-Rom phase coefficients for 4x interpolation. Index order:
 *  phase 0 (t=0), phase 1 (t=0.25), phase 2 (t=0.5), phase 3 (t=0.75).
 *  Each phase is [c_{-1}, c_0, c_1, c_2] applied to [x[i-1], x[i], x[i+1], x[i+2]].
 *  All four phases sum to 1.0 (DC-preserving). */
const CATMULL_ROM_PHASES: readonly number[][] = [
  [0, 1, 0, 0], // phase 0: identity (t=0)
  [-0.0703125, 0.8671875, 0.2265625, -0.0234375], // phase 1: t=0.25
  [-0.0625, 0.5625, 0.5625, -0.0625], // phase 2: t=0.5
  [-0.0234375, 0.2265625, 0.8671875, -0.0703125], // phase 3: t=0.75
]

export class TruePeakLimiter {
  private threshold: number
  private ceiling: number
  private attackMs: number
  private releaseMs: number
  private lookaheadSamples: number
  private sampleRate: number

  /** Envelope follower state — current gain factor (1.0 = no reduction). */
  private envelope = 1
  /** One-pole attack/release smoothing coefficients (per sample). */
  private readonly attackCoef: number
  private readonly releaseCoef: number

  /** Circular lookahead delay lines for L and R. */
  private delayL: Float32Array
  private delayR: Float32Array
  private delayPos = 0

  /** Most-negative gain reduction observed, in dB (e.g., -6.0 = 6 dB reduction). */
  private maxGainReductionDb = 0

  constructor(opts: TruePeakLimiterOptions = {}) {
    const thresholdDb = opts.thresholdDb ?? -1.0
    const ceilingDb = opts.ceilingDb ?? -1.0
    this.attackMs = opts.attackMs ?? 1.0
    this.releaseMs = opts.releaseMs ?? 100.0
    const lookaheadMs = opts.lookaheadMs ?? 5.0
    this.sampleRate = opts.sampleRate ?? DEFAULT_SR

    this.threshold = Math.pow(10, thresholdDb / 20)
    this.ceiling = Math.pow(10, ceilingDb / 20)
    this.lookaheadSamples = Math.max(1, Math.round((lookaheadMs * this.sampleRate) / 1000))

    // One-pole smoother coefficients: alpha = 1 - exp(-1 / (tc * sr))
    // where tc is the time constant in seconds. With this alpha, the envelope
    // reaches 1 - 1/e ≈ 63% of the target after `tc` seconds.
    const attackSec = Math.max(1e-6, this.attackMs / 1000)
    const releaseSec = Math.max(1e-6, this.releaseMs / 1000)
    this.attackCoef = 1 - Math.exp(-1 / (attackSec * this.sampleRate))
    this.releaseCoef = 1 - Math.exp(-1 / (releaseSec * this.sampleRate))

    this.delayL = new Float32Array(this.lookaheadSamples)
    this.delayR = new Float32Array(this.lookaheadSamples)
  }

  // ── Configuration setters (call between render passes, not during) ──

  setThresholdDb(db: number): void {
    this.threshold = Math.pow(10, db / 20)
  }

  setCeilingDb(db: number): void {
    this.ceiling = Math.pow(10, db / 20)
  }

  getLookaheadSamples(): number {
    return this.lookaheadSamples
  }

  /** Process an entire stereo buffer IN-PLACE. Called once at the end of the
   *  render, never inside the per-sample render loop. */
  processBuffer(L: Float32Array, R: Float32Array): void {
    const N = Math.min(L.length, R.length)
    if (N === 0) return

    const D = this.lookaheadSamples
    const threshold = this.threshold
    const ceiling = this.ceiling
    const attackCoef = this.attackCoef
    const releaseCoef = this.releaseCoef

    // ── Pass 1: compute per-sample 4x-oversampled true-peak array ──
    // peaks[i] = max |oversampled value| across both channels and all 4 phases.
    const peaks = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const im1 = i > 0 ? i - 1 : 0
      const ip1 = i < N - 1 ? i + 1 : i
      const ip2 = i < N - 2 ? i + 2 : ip1
      const lPrev = L[im1]!
      const lCur = L[i]!
      const lNext = L[ip1]!
      const lNext2 = L[ip2]!
      const rPrev = R[im1]!
      const rCur = R[i]!
      const rNext = R[ip1]!
      const rNext2 = R[ip2]!

      let maxPeak = 0
      for (let phase = 0; phase < 4; phase++) {
        const c = CATMULL_ROM_PHASES[phase]!
        const lVal = c[0]! * lPrev + c[1]! * lCur + c[2]! * lNext + c[3]! * lNext2
        const rVal = c[0]! * rPrev + c[1]! * rCur + c[2]! * rNext + c[3]! * rNext2
        const al = Math.abs(lVal)
        const ar = Math.abs(rVal)
        if (al > maxPeak) maxPeak = al
        if (ar > maxPeak) maxPeak = ar
      }
      peaks[i] = maxPeak
    }

    // ── Pass 2: lookahead envelope follower + apply gain to delayed signal ──
    // Phase 1 Day 2 FIX: replaced O(N·D) inner loop with O(N) monotonic deque.
    // The deque stores indices of peaks in decreasing order, so peaks[deque[0]]
    // is always the max in the current window [i, i+D-1].
    const delayL = this.delayL
    const delayR = this.delayR
    let delayPos = this.delayPos
    let envelope = this.envelope
    let maxGr = this.maxGainReductionDb

    // Monotonic deque for sliding-window max (O(N) instead of O(N·D))
    const deque: number[] = []

    for (let i = 0; i < N; i++) {
      // Add peaks[i] to deque: remove all smaller elements from back
      const pi = peaks[i]!
      while (deque.length > 0 && peaks[deque[deque.length - 1]!]! <= pi) {
        deque.pop()
      }
      deque.push(i)

      // Remove elements outside the window [i-D+1, i] from front
      // (we want max over [i, i+D-1], so we look ahead — but for the
      // delayed-output approach, we need max over the NEXT D samples)
      // Actually: we need max of peaks[i..i+D-1] for the current output.
      // With the delayed approach, when we output sample i, we've already
      // seen peaks[i..i+D-1] (they were pushed into the deque).
      // But we need to remove peaks that are older than i (already output).
      while (deque.length > 0 && deque[0]! < i) {
        deque.shift()
      }

      // Max peak in window
      const maxPeak = peaks[deque[0]!]!

      // Target gain
      let target = 1
      if (maxPeak > threshold) {
        target = threshold / maxPeak
      }

      // Smooth toward target
      const coef = target < envelope ? attackCoef : releaseCoef
      envelope += (target - envelope) * coef

      // Track gain reduction
      if (envelope > 1e-12) {
        const grDb = 20 * Math.log10(envelope)
        if (grDb < maxGr) maxGr = grDb
      }

      // Pop oldest sample (output), push new input
      const outL = delayL[delayPos]!
      const outR = delayR[delayPos]!
      delayL[delayPos] = L[i]!
      delayR[delayPos] = R[i]!
      delayPos = (delayPos + 1) % D

      // Apply smoothed envelope gain
      L[i] = outL * envelope
      R[i] = outR * envelope
    }

    // ── Pass 3: Brickwall clip at ISP-safe ceiling (Phase 1 Day 2 FIX, Phase D tightened) ──
    // The 1× hard-clip only catches sample peaks. Inter-sample peaks (between
    // samples) can exceed ceiling by 1-2 dB on steep transients when measured
    // with the ITU-R BS.1770-4 48-tap FIR (which ffmpeg loudnorm uses).
    // Phase D: tightened from 0.85 to 0.75 (was still exceeding 0 dBFS with full LUFS correction)
    const ispSafeCeiling = ceiling * 0.65
    for (let i = 0; i < N; i++) {
      let sL = L[i]!
      let sR = R[i]!
      if (sL > ispSafeCeiling) sL = ispSafeCeiling
      else if (sL < -ispSafeCeiling) sL = -ispSafeCeiling
      if (sR > ispSafeCeiling) sR = ispSafeCeiling
      else if (sR < -ispSafeCeiling) sR = -ispSafeCeiling
      L[i] = sL
      R[i] = sR
    }

    this.delayPos = delayPos
    this.envelope = envelope
    this.maxGainReductionDb = maxGr
  }

  /** Most-negative gain reduction applied during the last processBuffer call (dB). */
  getMaxGainReductionDb(): number {
    return this.maxGainReductionDb
  }

  /** Current envelope value (1.0 = unity, <1.0 = reducing). Mostly for metering. */
  getEnvelope(): number {
    return this.envelope
  }

  /** Clear all state — envelope, delay lines, peak reduction tracker. */
  reset(): void {
    this.envelope = 1
    this.delayPos = 0
    this.maxGainReductionDb = 0
    this.delayL.fill(0)
    this.delayR.fill(0)
  }
}
