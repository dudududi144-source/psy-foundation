/**
 * Utilities — DC blocker, saturation, stereo processing.
 *
 * All are sample-by-sample processors unless noted.
 */

/**
 * DC blocker — removes DC offset (rumble at 0 Hz).
 * Standard one-pole high-pass at very low cutoff (~20 Hz).
 */
export class DcBlocker {
  private prevX = 0
  private prevY = 0
  private readonly r: number

  constructor(sampleRate: number, cutoffHz = 20) {
    // R = 1 - 2*pi*fc/sr
    this.r = 1 - (2 * Math.PI * cutoffHz) / sampleRate
  }

  process(x: number): number {
    const y = x - this.prevX + this.r * this.prevY
    this.prevX = x
    this.prevY = y
    return y
  }

  reset(): void {
    this.prevX = 0
    this.prevY = 0
  }
}

/** Tanh saturation — soft clipping. Drive > 1 = more saturation. */
export function tanhSaturation(x: number, drive: number): number {
  return Math.tanh(x * drive)
}

/** Soft clip — smooth waveshaper that approaches ±1 asymptotically. Musical. */
export function softClip(x: number, drive: number): number {
  const d = x * drive
  return d / (1 + Math.abs(d))
}

/** Hard clip — brute-force limiting. */
export function hardClip(x: number, threshold = 1): number {
  return Math.max(-threshold, Math.min(threshold, x))
}

/**
 * Stereo processor — applies a function to L and R channels independently,
 * or with cross-talk for width control.
 */
export function processStereo<_L, _R>(
  left: Float32Array,
  right: Float32Array,
  fn: (l: number, r: number, i: number) => [number, number]
): void {
  const n = Math.min(left.length, right.length)
  for (let i = 0; i < n; i++) {
    const [l, r] = fn(left[i] ?? 0, right[i] ?? 0, i)
    left[i] = l
    right[i] = r
  }
}

/**
 * Stereo width — widens or narrows the stereo image.
 * width=0 = mono, width=1 = original, width=2 = super-wide (mid/side emphasis).
 */
export function applyWidth(left: Float32Array, right: Float32Array, width: number): void {
  processStereo(left, right, (l, r) => {
    const mid = (l + r) / 2
    const side = (l - r) / 2
    return [mid + side * width, mid - side * width]
  })
}
