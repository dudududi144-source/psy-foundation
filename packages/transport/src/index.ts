// v0 (legacy, pre-canonical) — DEPRECATED
export type {
  AudioTime,
  BeatObservation,
  EstimatedBeatTime,
  MusicalTransport,
  ObservedBeatTime,
  PredictedBeatTime,
  TransportClockOptions,
} from './types.ts'
export { TransportClock } from './transport.ts'
export { BeatEstimator } from './beatEstimator.ts'
export type { BeatEstimateResult } from './beatEstimator.ts'
export { PhaseCorrector } from './phaseCorrector.ts'
export type { PhaseCorrection } from './phaseCorrector.ts'
export { ConfidenceTracker } from './confidenceTracker.ts'

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
} from './v1-types.ts'
export { DEFAULT_TRANSPORT_CONFIG } from './v1-types.ts'
export { Transport } from './v1-transport.ts'
