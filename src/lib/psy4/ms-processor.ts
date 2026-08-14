/**
 * Stage 4 — M/S Stereo Widener
 *
 * Mid/Side processing for the PSY4 master bus. Runs ONCE at the end of the
 * render (not in the per-sample render loop) to widen or narrow the stereo
 * image while exposing a mono-compatibility metric so the caller can back off
 * before phase issues appear.
 *
 * M/S theory:
 *   M = (L + R) / 2     // "Mid"   — mono sum, what survives mono fold-down
 *   S = (L - R) / 2     // "Side"  — stereo difference, disappears in mono
 *   L' = M + width * S
 *   R' = M - width * S
 *
 * Width semantics:
 *   0.0 = pure mono (S killed)
 *   1.0 = original (unchanged)
 *   1.3 = +30% wider (typical master bus sweetener)
 *   2.0 = extra wide (side content doubled; watch mono compat)
 *
 * Determinism: no Math.random, no Date, no I/O. Pure function of input.
 */

export class StereoWidener {
  private width: number
  // Accumulated energy for mono-compatibility metric.
  // monoSumEnergy  += (L + R)^2   — energy that survives mono fold-down
  // stereoSumEnergy += (L - R)^2  — energy that disappears in mono
  // Ratio mono / (mono + side) == 1.0 for pure mono, 0.0 for fully out-of-phase.
  private monoSumEnergy = 0
  private stereoSumEnergy = 0

  constructor(width: number = 1.3) {
    this.width = width
  }

  /** Set the width factor. 0 = mono, 1 = original, 1.3 = +30% wider, 2 = extra wide. */
  setWidth(w: number): void {
    this.width = w
  }

  /** Read back the current width factor. */
  getWidth(): number {
    return this.width
  }

  /**
   * Process an entire stereo buffer IN-PLACE. Called once at the end of the
   * render — never inside the per-sample render loop.
   *
   * Side effects:
   *   - L[i] and R[i] are overwritten with the widened samples.
   *   - Mono-compatibility energy accumulators are updated using the INPUT
   *     (pre-widening) signal, so the metric reflects the source material's
   *     mono safety rather than the post-widened version.
   */
  processBuffer(L: Float32Array, R: Float32Array): void {
    const n = Math.min(L.length, R.length)
    const w = this.width
    for (let i = 0; i < n; i++) {
      const l = L[i]!
      const r = R[i]!

      // Accumulate INPUT mono/side energy (pre-widen) for mono-compat metric.
      const sum = l + r
      const diff = l - r
      this.monoSumEnergy += sum * sum
      this.stereoSumEnergy += diff * diff

      // M/S widen.
      const mid = sum * 0.5
      const side = diff * 0.5
      L[i] = mid + w * side
      R[i] = mid - w * side
    }
  }

  /**
   * Mono compatibility ratio in [0, 1].
   *   ratio = sum((L+R)^2) / (sum((L+R)^2) + sum((L-R)^2))
   *       = sum(mid^2) / (sum(mid^2) + sum(side^2))   (factor-of-4 cancels)
   *
   * Interpretation:
   *   > 0.85  good mono compatibility
   *   0.5-0.85  borderline
   *   < 0.5  phase risk — fold-down will lose energy / cancel
   *   0.0  fully out-of-phase (L = -R), mono fold-down = silence
   *
   * Returns 1.0 if the buffer was silent (no energy accumulated).
   */
  getMonoCompatibility(): number {
    const total = this.monoSumEnergy + this.stereoSumEnergy
    if (total < 1e-12) return 1
    return this.monoSumEnergy / total
  }

  /**
   * Static pure-function stereo width metric:
   *   mean(|L - R|) / mean(|L + R|), clamped to [0, 2].
   *
   *   L = R      → 0   (pure mono, no side content)
   *   L = -R     → 2   (pure side, no mono content, clamped from +∞)
   *   uncorrelated → ~1 (mixed)
   *
   * The clamp at 2 handles the divide-by-zero case when L = -R exactly.
   * Deterministic, no instance state, no allocations beyond the loop locals.
   */
  static measureWidth(L: Float32Array, R: Float32Array): number {
    const n = Math.min(L.length, R.length)
    if (n === 0) return 0
    let sumDiff = 0
    let sumSum = 0
    for (let i = 0; i < n; i++) {
      sumDiff += Math.abs(L[i]! - R[i]!)
      sumSum += Math.abs(L[i]! + R[i]!)
    }
    if (sumSum < 1e-12) return 2 // out-of-phase → max width
    const ratio = sumDiff / sumSum
    return Math.min(ratio, 2)
  }

  /** Clear the energy accumulators. Call between independent render passes. */
  reset(): void {
    this.monoSumEnergy = 0
    this.stereoSumEnergy = 0
  }
}
