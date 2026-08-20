import type { BeatObservation, TransportClockOptions } from './types.ts'

export interface BeatEstimateResult {
  bpm: number
  intervalSec: number
  folded: 'none' | 'half' | 'double'
  changed: boolean
}

export class BeatEstimator {
  private bpm: number
  private lastObservedAt: number | null = null
  private readonly minBpm: number
  private readonly maxBpm: number
  private readonly smoothing: number
  private readonly octaveTol: number

  constructor(
    opts: Required<
      Pick<
        TransportClockOptions,
        'initialBpm' | 'minBpm' | 'maxBpm' | 'tempoSmoothing' | 'octaveFoldTolerance'
      >
    >
  ) {
    this.bpm = opts.initialBpm
    this.minBpm = opts.minBpm
    this.maxBpm = opts.maxBpm
    this.smoothing = opts.tempoSmoothing
    this.octaveTol = opts.octaveFoldTolerance
  }

  get currentBpm(): number {
    return this.bpm
  }

  reset(initialBpm: number): void {
    this.bpm = initialBpm
    this.lastObservedAt = null
  }

  ingest(obs: BeatObservation): BeatEstimateResult | null {
    if (this.lastObservedAt === null) {
      this.lastObservedAt = obs.observedAt
      return null
    }

    let intervalSec = obs.observedAt - this.lastObservedAt
    this.lastObservedAt = obs.observedAt

    if (!(intervalSec > 0)) return null

    const expected = 60 / this.bpm
    let folded: BeatEstimateResult['folded'] = 'none'
    const halfRatio = intervalSec / (expected * 2)
    const doubleRatio = expected / 2 / intervalSec
    if (Math.abs(halfRatio - 1) <= this.octaveTol && halfRatio > 0) {
      intervalSec /= 2
      folded = 'half'
    } else if (Math.abs(doubleRatio - 1) <= this.octaveTol && doubleRatio > 0) {
      intervalSec *= 2
      folded = 'double'
    }

    const minInterval = 60 / this.maxBpm
    const maxInterval = 60 / this.minBpm
    const clamped = Math.min(maxInterval, Math.max(minInterval, intervalSec))

    const observedBpm = 60 / clamped
    const prevBpm = this.bpm
    this.bpm = prevBpm + (observedBpm - prevBpm) * this.smoothing

    const changed = Math.abs(this.bpm - prevBpm) > 0.1
    return { bpm: this.bpm, intervalSec: clamped, folded, changed }
  }
}
