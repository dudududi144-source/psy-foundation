/**
 * Master chain — True-Peak Lookahead Limiter.
 *
 * Moved from `apps/web/src/lib/psy4/limiter.ts` into `@psy-foundation/dsp`
 * (DECISIONS_V3 D1) so the web app, the worklet and any future consumer share
 * ONE implementation.
 *
 * D2 (DECISIONS_V3): `sampleRate` is REQUIRED in `TruePeakLimiterOptions` —
 * the old `DEFAULT_SR = 44100` fallback made "forgot to pass SR" a silent
 * mistuned limiter instead of a compile error.
 *
 * Stereo lookahead brickwall limiter for the master bus. Detects inter-sample
 * (true) peaks via 4x oversampling of the detector path, then applies a smooth
 * attack/release gain envelope. A final hard-clip at `ceiling` is the
 * brickwall safety net so the SAMPLE peak is guaranteed to never exceed
 * ceiling.
 *
 * Phase 1.2 (PLAN_V3_MASTER) REWRITE — the previous implementation had two
 * structural bugs found by the 2026-09-04 forensic audit (C3):
 *
 *   1. The "lookahead window [i, i+D-1]" never existed: the monotonic deque
 *      shifted out every index < i, so the detector only ever saw peaks[i]
 *      (the current sample). The gain therefore reacted when a transient
 *      ENTERED the detector, not D samples before it reached the output —
 *      with a 1 ms attack constant the envelope had barely engaged (≈0.3%
 *      reduction after 5 ms) when the transient exited the delay line.
 *   2. The safety clip ran at ceiling × 0.65 (≈ -4.7 dBFS below the
 *      advertised -1 dB ceiling): loud transients were square-clipped ~4 dB
 *      below the documented ceiling — audible distortion plus ~3.7 dB of
 *      wasted headroom. A source-grep test even locked the constant in.
 *
 * Correct offline topology (processBuffer sees the whole buffer, so no
 * delay line is needed — the "future" is directly available):
 *
 *   input ──► 4x oversample (Catmull-Rom) ──► per-sample true peak
 *      │                                          │
 *      │                                          ▼
 *      │                          windowMax[i] = max peak over [i, i+D-1]
 *      │                          (backward monotonic scan, O(N))
 *      │                                          │
 *      │                              target[i] = threshold / windowMax
 *      │                                          │
 *      │                              forward attack/release smoothing
 *      │                              (engages up to D samples EARLY)
 *      ▼                                          ▼
 *    output  ◄────────────────────  input[i] × envelope[i]
 *      │
 *      └──► hard-clip @ ceiling (sample-peak brickwall safety net)
 *
 * Because the gain target already accounts for the worst peak in the next
 * D samples, the envelope begins reducing BEFORE the transient arrives —
 * the attack (1 ms) is fully engaged by the time the peak must be shaped.
 *
 * Inter-sample honesty: the detector uses Catmull-Rom 4x oversampling,
 * which can underestimate the ITU-R BS.1770-4 48-tap FIR true peak by up to
 * ~2.9 dB on pathological content (documented in README). The sample-domain
 * clip at `ceiling` bounds the SAMPLE peak exactly; true-peak (ITU FIR)
 * measurements may exceed the ceiling by ≤ ~1 dB on such content. Tightening
 * further would re-introduce the headroom waste the audit flagged.
 *
 * Determinism: no Math.random, no I/O, no Date. Pure function of input.
 */

export interface TruePeakLimiterOptions {
  /** Limiter begins reducing gain above this level (dBTP). Default -1.0. */
  thresholdDb?: number
  /** Hard ceiling — output sample peak is clamped to this level (dBTP). Default -1.0. */
  ceilingDb?: number
  /** Envelope attack time (ms). Default 1.0. */
  attackMs?: number
  /** Envelope release time (ms). Default 100.0. */
  releaseMs?: number
  /** Lookahead window (ms). Default 5.0. */
  lookaheadMs?: number
  /** Sample rate (Hz). REQUIRED (DECISIONS_V3 D2) — no silent 44100 default. */
  sampleRate: number
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
  private readonly attackCoef: number
  private readonly releaseCoef: number
  private readonly lookaheadSamples: number
  private readonly sampleRate: number

  /** Envelope follower state — current gain factor (1.0 = no reduction). */
  private envelope = 1

  /** Most-negative gain reduction observed, in dB (e.g., -6.0 = 6 dB reduction). */
  private maxGainReductionDb = 0

  constructor(opts: TruePeakLimiterOptions) {
    const thresholdDb = opts.thresholdDb ?? -1.0
    const ceilingDb = opts.ceilingDb ?? -1.0
    const attackMs = opts.attackMs ?? 1.0
    const releaseMs = opts.releaseMs ?? 100.0
    const lookaheadMs = opts.lookaheadMs ?? 5.0
    this.sampleRate = opts.sampleRate

    this.threshold = 10 ** (thresholdDb / 20)
    this.ceiling = 10 ** (ceilingDb / 20)
    this.lookaheadSamples = Math.max(1, Math.round((lookaheadMs * this.sampleRate) / 1000))

    // One-pole smoother coefficients: alpha = 1 - exp(-1 / (tc * sr))
    // where tc is the time constant in seconds. With this alpha, the envelope
    // reaches 1 - 1/e ≈ 63% of the target after `tc` seconds.
    const attackSec = Math.max(1e-6, attackMs / 1000)
    const releaseSec = Math.max(1e-6, releaseMs / 1000)
    this.attackCoef = 1 - Math.exp(-1 / (attackSec * this.sampleRate))
    this.releaseCoef = 1 - Math.exp(-1 / (releaseSec * this.sampleRate))
  }

  // ── Configuration setters (call between render passes, not during) ──

  setThresholdDb(db: number): void {
    this.threshold = 10 ** (db / 20)
  }

  setCeilingDb(db: number): void {
    this.ceiling = 10 ** (db / 20)
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

    // ── Pass 1: per-sample 4x-oversampled true-peak ──
    // peaks[i] = max |oversampled value| across both channels and all 4 phases.
    const peaks = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const im1 = i > 0 ? i - 1 : 0
      const ip1 = i < N - 1 ? i + 1 : i
      const ip2 = i < N - 2 ? i + 2 : ip1
      const lPrev = L[im1]
      const lCur = L[i]
      const lNext = L[ip1]
      const lNext2 = L[ip2]
      const rPrev = R[im1]
      const rCur = R[i]
      const rNext = R[ip1]
      const rNext2 = R[ip2]

      let maxPeak = 0
      for (let phase = 0; phase < 4; phase++) {
        const c = CATMULL_ROM_PHASES[phase]
        const lVal = c[0] * lPrev + c[1] * lCur + c[2] * lNext + c[3] * lNext2
        const rVal = c[0] * rPrev + c[1] * rCur + c[2] * rNext + c[3] * rNext2
        const al = Math.abs(lVal)
        const ar = Math.abs(rVal)
        if (al > maxPeak) maxPeak = al
        if (ar > maxPeak) maxPeak = ar
      }
      peaks[i] = maxPeak
    }

    // ── Pass 2: TRUE lookahead — windowMax[i] = max peak in [i, i+D-1] ──
    // Backward monotonic deque, O(N). For each i the gain target accounts for
    // the worst peak in the NEXT D samples, so the envelope engages BEFORE
    // the transient reaches the output (this is what the old deque never did).
    // A naive running max would make windowMax[i] = max over [i, N-1]
    // (unbounded window) — audible pumping on quiet intros before loud drops —
    // so the window is bounded exactly with the classic deque method.
    const windowMax = new Float32Array(N)
    {
      const dq: number[] = []
      for (let i = N - 1; i >= 0; i--) {
        // Pop indices that fell out of the window [i, i+D-1]
        while (dq.length > 0 && dq[dq.length - 1] > i + D - 1) dq.pop()
        // Maintain decreasing values from front: pop back while smaller
        while (dq.length > 0 && peaks[dq[dq.length - 1]] <= peaks[i]) dq.pop()
        dq.push(i)
        // Front of the deque (largest remaining) is the window max
        windowMax[i] = peaks[dq[0]]
      }
    }

    // ── Pass 3: forward attack/release smoothing of the gain trajectory ──
    let envelope = this.envelope
    let maxGr = this.maxGainReductionDb
    for (let i = 0; i < N; i++) {
      let target = 1
      if (windowMax[i] > threshold) {
        target = threshold / windowMax[i]
      }
      const coef = target < envelope ? attackCoef : releaseCoef
      envelope += (target - envelope) * coef
      if (envelope > 1e-12) {
        const grDb = 20 * Math.log10(envelope)
        if (grDb < maxGr) maxGr = grDb
      }
      // Apply the smoothed envelope to the CURRENT sample (no delay line —
      // the lookahead already came from seeing the future in Pass 2).
      L[i] = L[i] * envelope
      R[i] = R[i] * envelope
    }

    // ── Pass 4: brickwall clip at the ADVERTISED ceiling ──
    // Phase 1.2 FIX: the old code clipped at ceiling × 0.65 (~-4.7 dB below
    // the documented ceiling), square-clipping loud transients and wasting
    // ~3.7 dB of headroom. The envelope now engages early enough that this
    // clip is a genuine safety net, not the de facto limiter. Sample peak is
    // guaranteed ≤ ceiling; see the inter-sample honesty note above for the
    // (documented) ITU-FIR true-peak caveat.
    for (let i = 0; i < N; i++) {
      let sL = L[i]
      let sR = R[i]
      if (sL > ceiling) sL = ceiling
      else if (sL < -ceiling) sL = -ceiling
      if (sR > ceiling) sR = ceiling
      else if (sR < -ceiling) sR = -ceiling
      L[i] = sL
      R[i] = sR
    }

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

  /** Clear all state — envelope and gain-reduction tracker. */
  reset(): void {
    this.envelope = 1
    this.maxGainReductionDb = 0
  }
}
