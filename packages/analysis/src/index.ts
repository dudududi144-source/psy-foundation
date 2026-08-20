// DSP primitives
export { fft, hannWindow, magnitudeSpectrum, spectrum } from './dsp.ts'

// Spectral / time-domain features
export {
  bandEnergy,
  bassActivity,
  binToFreq,
  freqToBin,
  highEnergy,
  lowMidEnergy,
  rmsEnergy,
  spectralCentroid,
  spectralFlatness,
  spectralFlux,
  transientDensity,
  zeroCrossingRate,
} from './features.ts'

// Onset detection
export { detectOnsets } from './onset.ts'
export type { Onset, OnsetOptions } from './onset.ts'

// Pitch
export {
  NOTE_NAMES,
  chroma,
  detectPitch,
  dominantPitchClass,
  midiToName,
} from './pitch.ts'
export type { DominantPitchClass, PitchResult } from './pitch.ts'

// Tempo
export { estimateTempo, pickMusicalWinner } from './tempo.ts'
export type { TempoHypothesis, TempoOptions, TempoResult } from './tempo.ts'

// Musical inference
export {
  detectSectionBoundaries,
  inferMusical,
  refineTempoWithContext,
} from './inference.ts'
export type {
  EnergyClass,
  InferMusicalOptions,
  MusicalInference,
  RefineTempoOptions,
  RoleOccupancy,
  SectionLabel,
} from './inference.ts'

// Analyzer
export { Analyzer } from './analyzer.ts'
export type { AnalyzerFrame, AnalyzerOptions } from './analyzer.ts'
