/**
 * Stage 5 (part 1) — ITU-R BS.1770-4 LUFS Loudness Meter
 *
 * Pure offline LUFS measurement for the PSY4 master bus. Called once at the
 * end of the render to verify loudness targets (typically -14 LUFS for
 * streaming, -8 to -6 LUFS for club masters) and feed the limiter's
 * final-gain trim.
 *
 * Implements:
 *   1. K-weighting: stage 1 high-shelf "pre-filter" (+4 dB above ~1.7 kHz)
 *                   stage 2 high-pass "RLB" (cuts below ~38 Hz)
 *   2. 400 ms gating blocks, 75% overlap (100 ms hop)
 *   3. Two-stage gating: absolute -70 LUFS, then relative -10 LU
 *   4. Integrated / Momentary (400 ms) / Short-term (3000 ms) loudness
 *   5. True-peak (max |sample| in dB — the limiter does the 4x-oversampled
 *      measurement, this is the cheap sample-peak fallback)
 *   6. Simplified Loudness Range (LRA): 95th - 10th percentile of short-term
 *
 * Determinism: no Math.random, no I/O, no Date. Pure function of input.
 */

// ─── K-weighting filter ─────────────────────────────────────────────────────

/**
 * Two-stage cascaded biquad implementing the ITU-R BS.1770-4 K-weighting curve.
 *
 * ROAST-FIX-1: stage 1 (high shelf) and stage 2 (RLB high-pass) coefficients
 * are now computed from the RBJ Audio EQ Cookbook formulas. The previous
 * implementation used an ITU-style K-based formula where the stage-1 `b1`
 * term was transcribed incorrectly; that biased the K-weighting curve by
 * ~2 dB at 997 Hz and ~3.7 dB at the 1682 Hz corner, which translated to
 * ~2 LU error in the integrated LUFS reading (the worklog's open item).
 *
 * RBJ Audio EQ Cookbook (Robert Bristow-Johnson):
 *   high-shelf:  A = 10^(G/40),  w0 = 2π·f0/fs,  alpha = sin(w0)/(2·Q)
 *     b0 =  A·((A+1) + (A−1)·cos w0 + 2·√A·alpha)
 *     b1 = -2·A·((A−1) + (A+1)·cos w0)
 *     b2 =  A·((A+1) + (A−1)·cos w0 − 2·√A·alpha)
 *     a0 =      (A+1) − (A−1)·cos w0 + 2·√A·alpha
 *     a1 =  2·((A−1) − (A+1)·cos w0)
 *     a2 =      (A+1) − (A−1)·cos w0 − 2·√A·alpha
 *   high-pass:
 *     b0 =  (1+cos w0)/2,  b1 = -(1+cos w0),  b2 = (1+cos w0)/2
 *     a0 =  1 + alpha,     a1 = -2·cos w0,   a2 = 1 − alpha
 *
 * Stage 1 — "pre-filter" high shelf:
 *   f0 = 1681.974450955533 Hz, G = 3.999843853973347 dB, Q = 0.7071752369554196
 *
 * Stage 2 — "RLB" high-pass:
 *   f0 = 38.13547087602444 Hz, Q = 0.5003270373238773
 *
 * Each stage uses Direct Form II Transposed (numerically robust for audio).
 * Difference equation per stage:
 *   y[n] = b0·x[n] + z1
 *   z1   = b1·x[n] - a1·y[n] + z2
 *   z2   = b2·x[n] - a2·y[n]
 */
class KWeightFilter {
  // Stage 1 (pre-filter) coefficients
  private readonly s1_b0: number
  private readonly s1_b1: number
  private readonly s1_b2: number
  private readonly s1_a1: number
  private readonly s1_a2: number
  private s1_z1 = 0
  private s1_z2 = 0

  // Stage 2 (RLB) coefficients
  private readonly s2_b0: number
  private readonly s2_b1: number
  private readonly s2_b2: number
  private readonly s2_a1: number
  private readonly s2_a2: number
  private s2_z1 = 0
  private s2_z2 = 0

  constructor(sampleRate: number) {
    // ── Stage 1: pre-filter (high shelf) — RBJ Audio EQ Cookbook ──
    const f0a = 1681.974450955533
    const Ga = 3.999843853973347
    const Qa = 0.7071752369554196
    const Aa = 10 ** (Ga / 40)
    const w0a = (2 * Math.PI * f0a) / sampleRate
    const cosA = Math.cos(w0a)
    const sinA = Math.sin(w0a)
    const alphaA = sinA / (2 * Qa)
    const sqrtAa = Math.sqrt(Aa)
    const a0a = Aa + 1 - (Aa - 1) * cosA + 2 * sqrtAa * alphaA
    this.s1_b0 = (Aa * (Aa + 1 + (Aa - 1) * cosA + 2 * sqrtAa * alphaA)) / a0a
    this.s1_b1 = (-2 * Aa * (Aa - 1 + (Aa + 1) * cosA)) / a0a
    this.s1_b2 = (Aa * (Aa + 1 + (Aa - 1) * cosA - 2 * sqrtAa * alphaA)) / a0a
    this.s1_a1 = (2 * (Aa - 1 - (Aa + 1) * cosA)) / a0a
    this.s1_a2 = (Aa + 1 - (Aa - 1) * cosA - 2 * sqrtAa * alphaA) / a0a

    // ── Stage 2: RLB (high-pass) — RBJ Audio EQ Cookbook ──
    const f0b = 38.13547087602444
    const Qb = 0.5003270373238773
    const w0b = (2 * Math.PI * f0b) / sampleRate
    const cosB = Math.cos(w0b)
    const sinB = Math.sin(w0b)
    const alphaB = sinB / (2 * Qb)
    const a0b = 1 + alphaB
    this.s2_b0 = (1 + cosB) / 2 / a0b
    this.s2_b1 = -(1 + cosB) / a0b
    this.s2_b2 = (1 + cosB) / 2 / a0b
    this.s2_a1 = (-2 * cosB) / a0b
    this.s2_a2 = (1 - alphaB) / a0b
  }

  /** Run one sample through both biquad stages. */
  process(x: number): number {
    // Stage 1 (DF-II Transposed)
    const y1 = this.s1_b0 * x + this.s1_z1
    this.s1_z1 = this.s1_b1 * x - this.s1_a1 * y1 + this.s1_z2
    this.s1_z2 = this.s1_b2 * x - this.s1_a2 * y1

    // Stage 2 (DF-II Transposed)
    const y2 = this.s2_b0 * y1 + this.s2_z1
    this.s2_z1 = this.s2_b1 * y1 - this.s2_a1 * y2 + this.s2_z2
    this.s2_z2 = this.s2_b2 * y1 - this.s2_a2 * y2

    return y2
  }

  reset(): void {
    this.s1_z1 = 0
    this.s1_z2 = 0
    this.s2_z1 = 0
    this.s2_z2 = 0
  }
}

// ─── LUFS result ────────────────────────────────────────────────────────────

export interface LUFSResult {
  /** Two-stage gated integrated loudness over the whole buffer (LUFS). */
  integratedLUFS: number
  /** Maximum 400 ms momentary loudness (LUFS). */
  momentaryLUFS: number
  /** Maximum 3000 ms short-term loudness (LUFS). */
  shortTermLUFS: number
  /** Sample-peak in dBFS (max |sample| → 20·log10). Not true-peak. */
  truePeakDb: number
  /** Simplified loudness range: 95th - 10th percentile of short-term blocks (LU). */
  rangeLU: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SILENCE_LUFS = -70
const RELATIVE_GATE_OFFSET_LU = -10
const ABSOLUTE_GATE_LUFS = -70

/** Convert a mean-square value to LUFS: -0.691 + 10·log10(z). */
function meanSquareToLUFS(z: number): number {
  if (z < 1e-12) return SILENCE_LUFS
  return -0.691 + 10 * Math.log10(z)
}

/**
 * Compute block mean-squares with overlapping rectangular windows.
 *
 * Per ITU-R BS.1770-4: z (per block) = sum_i w_i · z_i  where w_i = 1.0 for
 * L/R channels and z_i is the mean square of channel i over the block. For
 * stereo that's (sum(L²) + sum(R²)) / blockSize.
 *
 * Returns an array of { z, lufs } for each block.
 */
function computeBlocks(
  wL: Float32Array,
  wR: Float32Array,
  N: number,
  blockSize: number,
  hopSize: number
): Array<{ z: number; lufs: number }> {
  const out: Array<{ z: number; lufs: number }> = []
  if (blockSize <= 0 || hopSize <= 0) return out
  for (let start = 0; start + blockSize <= N; start += hopSize) {
    let sumSq = 0
    for (let i = 0; i < blockSize; i++) {
      const idx = start + i
      const l = wL[idx]!
      const r = wR[idx]!
      sumSq += l * l + r * r
    }
    const z = sumSq / blockSize
    out.push({ z, lufs: meanSquareToLUFS(z) })
  }
  return out
}

/** Percentile of a sorted-ascending array (linear interpolation). */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return SILENCE_LUFS
  if (sortedAsc.length === 1) return sortedAsc[0]!
  const idx = (p / 100) * (sortedAsc.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]!
  const frac = idx - lo
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Measure LUFS loudness of a stereo buffer per ITU-R BS.1770-4.
 *
 * Algorithm:
 *   1. K-weight both channels (cascaded biquads).
 *   2. Compute 400 ms block mean-squares with 100 ms hop (75% overlap).
 *   3. Integrated: gate at -70 LUFS (absolute), then at (mean - 10) LU
 *      (relative). Mean of surviving blocks → integrated LUFS.
 *   4. Momentary: max of 400 ms block LUFS values.
 *   5. Short-term: max of 3000 ms block LUFS values (same gating convention
 *      but with the longer window).
 *   6. truePeakDb: 20·log10(max |sample|) — sample peak, NOT 4x-oversampled
 *      true peak. The TruePeakLimiter module handles the oversampled version.
 *   7. rangeLU: 95th - 10th percentile of short-term block LUFS values.
 *
 * Edge cases:
 *   - Empty or all-silent input → all loudness fields return -70 LUFS,
 *     rangeLU = 0, truePeakDb = -70.
 *
 * Deterministic. No Math.random, no I/O.
 */
export function measureLUFS(L: Float32Array, R: Float32Array, sampleRate: number): LUFSResult {
  const N = Math.min(L.length, R.length)

  // Edge case: empty buffer.
  if (N === 0) {
    return {
      integratedLUFS: SILENCE_LUFS,
      momentaryLUFS: SILENCE_LUFS,
      shortTermLUFS: SILENCE_LUFS,
      truePeakDb: SILENCE_LUFS,
      rangeLU: 0,
    }
  }

  // K-weight both channels and find sample-peak in one pass.
  const filterL = new KWeightFilter(sampleRate)
  const filterR = new KWeightFilter(sampleRate)
  const wL = new Float32Array(N)
  const wR = new Float32Array(N)
  let maxAbs = 0
  for (let i = 0; i < N; i++) {
    const l = L[i]!
    const r = R[i]!
    wL[i] = filterL.process(l)
    wR[i] = filterR.process(r)
    const al = Math.abs(l)
    const ar = Math.abs(r)
    if (al > maxAbs) maxAbs = al
    if (ar > maxAbs) maxAbs = ar
  }
  const truePeakDb = maxAbs > 0 ? 20 * Math.log10(maxAbs) : SILENCE_LUFS

  // Block geometry. 400 ms momentary, 3000 ms short-term, 100 ms hop.
  const momentaryBlockSize = Math.floor(0.4 * sampleRate)
  const shortTermBlockSize = Math.floor(3.0 * sampleRate)
  const hopSize = Math.floor(0.1 * sampleRate)

  // Compute 400 ms and 3000 ms block lists.
  const mBlocks = computeBlocks(wL, wR, N, momentaryBlockSize, Math.max(1, hopSize))
  const sBlocks = computeBlocks(wL, wR, N, shortTermBlockSize, Math.max(1, hopSize))

  // ── Momentary = max 400 ms block LUFS ──
  let momentaryLUFS = SILENCE_LUFS
  for (const b of mBlocks) {
    if (b.lufs > momentaryLUFS) momentaryLUFS = b.lufs
  }

  // ── Short-term = max 3000 ms block LUFS ──
  let shortTermLUFS = SILENCE_LUFS
  for (const b of sBlocks) {
    if (b.lufs > shortTermLUFS) shortTermLUFS = b.lufs
  }

  // ── Integrated = two-stage gated mean of 400 ms blocks ──
  let integratedLUFS = SILENCE_LUFS
  if (mBlocks.length > 0) {
    // Stage A: absolute gate at -70 LUFS.
    const absGated = mBlocks.filter((b) => b.lufs > ABSOLUTE_GATE_LUFS)
    if (absGated.length > 0) {
      // Mean of surviving blocks (in linear z domain, then convert back).
      let zSum = 0
      for (const b of absGated) zSum += b.z
      const zMeanA = zSum / absGated.length
      const meanLUFS = meanSquareToLUFS(zMeanA)

      // Stage B: relative gate at max(-70, mean - 10) LUFS.
      const relGateLUFS = Math.max(ABSOLUTE_GATE_LUFS, meanLUFS + RELATIVE_GATE_OFFSET_LU)
      const relGated = absGated.filter((b) => b.lufs > relGateLUFS)
      if (relGated.length > 0) {
        let zSum2 = 0
        for (const b of relGated) zSum2 += b.z
        const zMeanB = zSum2 / relGated.length
        integratedLUFS = meanSquareToLUFS(zMeanB)
      } else {
        // No blocks survive the relative gate — fall back to absolute-gated mean.
        integratedLUFS = meanLUFS
      }
    }
    // Else: silence, integratedLUFS stays at -70.
  }

  // ── Loudness Range (simplified): 95th - 10th percentile of short-term ──
  let rangeLU = 0
  if (sBlocks.length > 0) {
    const lufsValues = sBlocks
      .filter((b) => b.lufs > ABSOLUTE_GATE_LUFS)
      .map((b) => b.lufs)
      .sort((a, b) => a - b)
    if (lufsValues.length >= 2) {
      const p95 = percentile(lufsValues, 95)
      const p10 = percentile(lufsValues, 10)
      rangeLU = p95 - p10
      if (rangeLU < 0) rangeLU = 0
    }
  }

  return {
    integratedLUFS,
    momentaryLUFS,
    shortTermLUFS,
    truePeakDb,
    rangeLU,
  }
}

// ─── Gain helper ────────────────────────────────────────────────────────────

/**
 * Linear gain factor needed to move `currentLUFS` to `targetLUFS`.
 *
 *   gain = 10^((target - current) / 20)
 *
 * Example: current = -10 LUFS, target = -14 LUFS → gain = 10^(-4/20) = 0.631
 * (i.e., attenuate by ~4 dB).
 *
 * Deterministic.
 */
export function lufsToGainOffset(currentLUFS: number, targetLUFS: number): number {
  return 10 ** ((targetLUFS - currentLUFS) / 20)
}
