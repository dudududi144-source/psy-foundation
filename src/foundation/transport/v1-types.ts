/**
 * Transport v1 types — the canonical contract.
 *
 * See audit/TRANSPORT_CANONICAL_DESIGN.md for the full behavior specification.
 * Every type here is readonly (immutable) where consumers are involved.
 */

/** The source driving the transport's tempo. */
export type TransportSource = 'internal' | 'radio' | 'external' | 'manual'

/**
 * A beat observation from any source (radio analysis, manual tap, external sync).
 * Timestamps MUST be in the audio-context time domain (seconds).
 */
export interface TransportObservation {
  /** Audio-context time of the detected beat. */
  readonly time: number
  /** 0..1 — confidence in THIS observation (not loudness). */
  readonly confidence: number
  /** Where this observation came from. */
  readonly source: TransportSource
}

/**
 * Immutable snapshot of transport state. The ONLY way consumers read state.
 * All fields are readonly — consumers cannot modify transport through a snapshot.
 */
export interface TransportSnapshot {
  /** Audio-context time when this snapshot was taken. */
  readonly timestamp: number
  /** Current BPM. */
  readonly bpm: number
  /** 0..1 — tempo confidence. */
  readonly confidence: number
  /** True if locked to a stable tempo. */
  readonly locked: boolean
  /** Audio-context time of the most recent beat boundary. */
  readonly beatTime: number
  /** Audio-context time of the most recent bar boundary. */
  readonly barTime: number
  /** Beat index within the current bar (0..beatsPerBar-1). */
  readonly beat: number
  /** Global bar index. */
  readonly bar: number
  /** Global beat index (monotonically increasing). */
  readonly beatIndex: number
  /** 0..1 — phase within the current beat. */
  readonly phase: number
  /** 0..1 — phase within the current bar. */
  readonly barPhase: number
  /** What source is driving the transport. */
  readonly source: TransportSource
  /** Increments on every disruption (start/stop/seek/setTempo/reset/resume/re-anchor). */
  readonly epoch: number
  /** Number of beats per bar (usually 4). */
  readonly beatsPerBar: number
  /** Duration of one beat in seconds (= 60 / bpm). */
  readonly beatDuration: number
  /** Predicted audio-context time of the next beat boundary. */
  readonly nextBeatTime: number
  /** True if in holdover mode (source lost, running on last known BPM). */
  readonly holdover: boolean
}

/** Transport configuration. All fields readonly. */
export interface TransportConfig {
  readonly initialBpm: number
  readonly beatsPerBar: number
  readonly minBpm: number
  readonly maxBpm: number
  readonly lockThreshold: number
  readonly minObservationsForLock: number
  readonly holdoverHalfLifeSec: number
  readonly reanchorThresholdSec: number
}

export const DEFAULT_TRANSPORT_CONFIG: TransportConfig = {
  initialBpm: 145,
  beatsPerBar: 4,
  minBpm: 60,
  maxBpm: 200,
  lockThreshold: 0.5,
  minObservationsForLock: 8,
  holdoverHalfLifeSec: 10,
  reanchorThresholdSec: 0.05,
}

/** A tempo hypothesis for half/double ambiguity tracking. */
export interface TempoHypothesis {
  readonly bpm: number
  readonly confidence: number
  readonly evidence: number
}

/** Subscription returned by Transport.subscribe(). */
export interface TransportSubscription {
  unsubscribe(): void
}

/** Listener type for transport subscriptions. */
export type TransportListener = (snap: TransportSnapshot) => void

/** Result of gridAt() — position at a given audio time. */
export interface TransportGrid {
  readonly beatIndex: number
  readonly phase: number
  readonly bar: number
  readonly beat: number
}
