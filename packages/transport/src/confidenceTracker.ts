import type { TransportClockOptions } from './types.ts'

const RING = 8

export class ConfidenceTracker {
  private confidence = 0
  private intervals: number[] = []
  private lastObservedAt: number | null = null
  private readonly gainPerObs: number
  private readonly decayPerSec: number

  constructor(
    opts: Required<Pick<TransportClockOptions, 'confidenceGainPerObs' | 'confidenceDecayPerSec'>>
  ) {
    this.gainPerObs = opts.confidenceGainPerObs
    this.decayPerSec = opts.confidenceDecayPerSec
  }

  get current(): number {
    return this.confidence
  }

  reset(): void {
    this.confidence = 0
    this.intervals = []
    this.lastObservedAt = null
  }

  decay(now: number): void {
    if (this.lastObservedAt !== null) {
      const dt = Math.max(0, now - this.lastObservedAt)
      this.confidence = Math.max(0, this.confidence - this.decayPerSec * dt)
    }
  }

  onObservation(
    observedAt: number,
    intervalSec: number | null,
    relocked: boolean,
    folded: 'none' | 'half' | 'double'
  ): void {
    let consistency = 1
    if (intervalSec !== null) {
      this.intervals.push(intervalSec)
      if (this.intervals.length > RING) this.intervals.shift()
      if (this.intervals.length >= 2) {
        const mean = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length
        if (mean > 1e-9) {
          let varSum = 0
          for (const v of this.intervals) varSum += (v - mean) * (v - mean)
          const stddev = Math.sqrt(varSum / this.intervals.length)
          const normJitter = Math.min(1, stddev / mean / 0.5)
          consistency = 1 - normJitter
        }
      }
    }

    this.confidence = Math.min(1, this.confidence + this.gainPerObs * consistency)
    if (relocked) this.confidence *= 0.6
    if (folded !== 'none') this.confidence *= 0.85
    this.lastObservedAt = observedAt
  }
}
