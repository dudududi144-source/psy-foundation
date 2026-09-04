/**
 * Metering — RMS and peak measurement.
 *
 * Sample-by-sample. Keeps a rolling window for RMS.
 *
 * DECISIONS_V3 D5: the fake `LufsMeter` ("K-weighted approximation" that was
 * neither K-weighted — no +4 dB shelf — nor gated) has been DELETED. The real
 * ITU-R BS.1770-4 meter (`measureLUFS`, `lufsToGainOffset`, `LUFSResult`)
 * lives in `./master/loudness.ts` and is exported from the package index.
 */

/**
 * RMS meter with a rolling window.
 */
export class RmsMeter {
  private readonly window: Float32Array
  private pos = 0
  private filled = 0
  private sumSq = 0

  constructor(windowSize: number) {
    this.window = new Float32Array(windowSize)
  }

  process(x: number): number {
    const old = this.window[this.pos] ?? 0
    this.sumSq -= old * old
    this.window[this.pos] = x
    this.sumSq += x * x
    this.pos = (this.pos + 1) % this.window.length
    if (this.filled < this.window.length) this.filled += 1
    return Math.sqrt(this.sumSq / this.filled)
  }

  reset(): void {
    this.window.fill(0)
    this.pos = 0
    this.filled = 0
    this.sumSq = 0
  }
}

/**
 * Peak meter — tracks the maximum absolute sample, with hold-and-decay.
 */
export class PeakMeter {
  private peak = 0
  private holdSamples: number
  private holdCount = 0
  private decayPerSample: number

  constructor(opts: { sampleRate: number; holdMs?: number; decayDbPerSec?: number }) {
    this.holdSamples = Math.floor(((opts.holdMs ?? 50) / 1000) * opts.sampleRate)
    const dbPerSec = opts.decayDbPerSec ?? 20
    // Convert dB/sec to linear decay per sample.
    this.decayPerSample = 10 ** (-dbPerSec / 20 / opts.sampleRate)
  }

  process(x: number): number {
    const abs = Math.abs(x)
    if (abs >= this.peak) {
      this.peak = abs
      this.holdCount = this.holdSamples
    } else if (this.holdCount > 0) {
      this.holdCount -= 1
    } else {
      this.peak *= this.decayPerSample
    }
    return this.peak
  }

  reset(): void {
    this.peak = 0
    this.holdCount = 0
  }

  get current(): number {
    return this.peak
  }
}
