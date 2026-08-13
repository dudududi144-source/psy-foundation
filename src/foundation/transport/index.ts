// v0 (legacy, pre-canonical) — DEPRECATED
export type {
  AudioTime,
  BeatObservation,
  EstimatedBeatTime,
  MusicalTransport,
  ObservedBeatTime,
  PredictedBeatTime,
  TransportClockOptions,
} from './types'
export { TransportClock } from './transport'
export { BeatEstimator } from './beatEstimator'
export type { BeatEstimateResult } from './beatEstimator'
export { PhaseCorrector } from './phaseCorrector'
export type { PhaseCorrection } from './phaseCorrector'
export { ConfidenceTracker } from './confidenceTracker'

// v1 (canonical candidate) — see audit/TRANSPORT_CANONICAL_DESIGN.md
export type {
  TransportConfig,
  TransportGrid,
  TransportListener,
  TransportObservation,
  TransportSnapshot,
  TransportSource,
  TransportSubscription,
  TempoHypothesis,
} from './v1-types'
export { DEFAULT_TRANSPORT_CONFIG } from './v1-types'
export { Transport } from './v1-transport'
