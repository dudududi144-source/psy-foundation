/**
 * Metering — RMS and peak measurement.
 *
 * Sample-by-sample. Keeps a rolling window for RMS.
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

/**
 * LUFS approximation — K-weighted loudness (simplified).
 * Not a full ITU-R BS.1770 implementation, but a useful approximation.
 */
export class LufsMeter {
  private readonly preFilter: BiquadFilter
  private readonly rlbFilter: BiquadFilter
  private readonly window: Float32Array
  private pos = 0
  private filled = 0
  private sumSq = 0

  constructor(sampleRate: number, windowMs = 400) {
    // Pre-filter (high-shelf for head acoustics).
    this.preFilter = new BiquadFilter(sampleRate, 'highpass', 38, 0.5)
    // RLB filter (high-pass for low frequencies).
    this.rlbFilter = new BiquadFilter(sampleRate, 'highpass', 150, 0.5)
    const size = Math.floor((windowMs / 1000) * sampleRate)
    this.window = new Float32Array(size)
  }

  process(x: number): number {
    // K-weighting: pre-filter then RLB.
    const weighted = this.rlbFilter.process(this.preFilter.process(x))
    const sq = weighted * weighted
    const old = this.window[this.pos] ?? 0
    this.sumSq -= old
    this.window[this.pos] = sq
    this.sumSq += sq
    this.pos = (this.pos + 1) % this.window.length
    if (this.filled < this.window.length) this.filled += 1
    if (this.sumSq <= 0 || this.filled === 0) return -70
    // LUFS = -0.691 + 10*log10(mean square).
    return -0.691 + 10 * Math.log10(this.sumSq / this.filled)
  }

  reset(): void {
    this.window.fill(0)
    this.pos = 0
    this.filled = 0
    this.sumSq = 0
    this.preFilter.reset()
    this.rlbFilter.reset()
  }
}

// Re-export BiquadFilter for the LufsMeter dependency.
import { BiquadFilter } from './filters.ts'
