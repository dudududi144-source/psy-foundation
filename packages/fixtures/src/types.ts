export type Anomaly =
  | 'perfect'
  | 'jitter'
  | 'tempo-ramp'
  | 'tempo-jump'
  | 'missing-beat'
  | 'false-kick'
  | 'half-time'
  | 'double-time'
  | 'gap-500ms'
  | 'gap-2s'
  | 'sparse'
  | 'dense-bass'
  | 'lead-heavy'
  | 'breakdown'
  | 'melody'
  | 'sixteenth-grid'
  | 'white-noise'

export interface Fixture {
  id: string
  name: string
  anomaly: Anomaly
  sampleRate: number
  durationSec: number
  signal: Float32Array
  groundTruthBeats: number[]
  groundTruthBpm: number | null
  description: string
  /** GAP-F1: exact MIDI pitches of the melody notes, in time order. */
  groundTruthPitches?: number[]
  /** GAP-F2: exact timestamps (seconds) of every 16th-note position in the grid. */
  groundTruthSixteenths?: number[]
  /** GAP-F3: declared spectral character, measurable from `signal`. */
  groundTruthSpectrum?: { kind: 'white' | 'pink'; centroidHz: number }
}
