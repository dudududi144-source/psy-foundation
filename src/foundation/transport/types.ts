export type AudioTime = number
export type ObservedBeatTime = number
export type EstimatedBeatTime = number
export type PredictedBeatTime = number

export interface BeatObservation {
  observedAt: AudioTime
  strength: number
  source?: string
}

export interface MusicalTransport {
  bpm: number
  beat: number
  bar: number
  beatsPerBar: number
  beatTime: EstimatedBeatTime
  barTime: number
  phase: number
  barPhase: number
  confidence: number
  locked: boolean
  revision: number
  origin: { audioTime: AudioTime; beatIndex: number; bpm: number }
  lastObservationAgo: number
  observationCount: number
}

export interface TransportClockOptions {
  beatsPerBar?: number
  initialBpm?: number
  minBpm?: number
  maxBpm?: number
  tempoSmoothing?: number
  phaseCorrectionRate?: number
  relockWindow?: number
  gapTimeout?: number
  confidenceDecayPerSec?: number
  confidenceGainPerObs?: number
  lockMinObservations?: number
  octaveFoldTolerance?: number
}
