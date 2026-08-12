/**
 * RadioMusicalContext: evidence about what the radio is playing.
 *
 * The radio is EVIDENCE, not AUTHORITY. The foundation's own composition
 * identity (style grammar, motif memory, arrangement plan) always wins.
 * The radio context only ADAPTS that identity — it never overrides it.
 *
 * A {@link RadioMusicalContext} carries:
 *   - Tempo / key / scale estimates (with per-field confidence).
 *   - Energy / density estimates.
 *   - Per-role occupancy (how much kick / bass / lead / percussion / harmony
 *     is already present in the radio).
 *   - Vocabulary (pitch classes + rhythmic step positions with activity).
 *   - Groove fingerprint + syncopation estimate.
 *   - Style estimate + position within the radio's phrase / section.
 *   - Overall confidence and a `available` flag (sentinel: RADIO_ABSENT).
 *
 * When radio analysis is unavailable, callers pass {@link RADIO_ABSENT}; the
 * adaptation layer then returns a NEUTRAL intent that preserves the base
 * composition.
 */

export interface RadioMusicalContext {
  // ----- Tempo -----
  /** Estimated BPM. */
  bpm: number
  /** 0..1 — analysis confidence on the BPM estimate. */
  bpmConfidence: number

  // ----- Key / harmony -----
  /** Estimated root pitch class (0-11). */
  key: number
  /** Estimated scale name (e.g. 'minor', 'phrygian'). */
  scale: string
  /** 0..1 — analysis confidence on the key/scale estimate. */
  keyConfidence: number

  // ----- Energy / density -----
  /** 0..1 — perceived energy of the radio. */
  energy: number
  /** 0..1 — perceived note/event density of the radio. */
  density: number
  /** 0..1 — analysis confidence on the energy/density estimate. */
  energyConfidence: number

  // ----- Role occupancy (0..1 — how much of each role is already present) -----
  kickOccupancy: number
  bassOccupancy: number
  percussionOccupancy: number
  leadOccupancy: number
  harmonicOccupancy: number

  // ----- Vocabulary -----
  /** Pitch classes detected in the radio (0-11). */
  pitchVocabulary: number[]
  /** Step positions (within a 16-step bar) where rhythmic activity is present. */
  rhythmicVocabulary: number[]

  // ----- Groove -----
  /** Fingerprint string of the radio groove. */
  grooveSignature: string
  /** 0..1 — syncopation amount. */
  syncopation: number

  // ----- Style -----
  /** Estimated style name (e.g. 'full-on', 'progressive'). */
  style: string
  /** 0..1 — analysis confidence on the style estimate. */
  styleConfidence: number

  // ----- Position -----
  /** 0..1 — position within the radio's current phrase. */
  phrasePosition: number
  /** Best-guess section label ('INTRO' | 'DROP' | 'BREAK' | ...). */
  sectionLikelihood: string

  // ----- Meta -----
  /** 0..1 — overall analysis confidence. */
  confidence: number
  /** Audio time (seconds or samples — caller's choice). */
  timestamp: number
  /** Is radio present at all? False → use {@link RADIO_ABSENT}. */
  available: boolean
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function clampOccupancy(v: number): number {
  return clamp01(v)
}

/**
 * Build a {@link RadioMusicalContext} from a partial, applying sensible
 * defaults. All confidence values default to 0.5 (uncertain) and all
 * occupancy values default to 0 (nothing present) so a caller can pass only
 * the fields the radio analyser actually knows about.
 */
export function createRadioContext(
  partial: Partial<RadioMusicalContext> = {}
): RadioMusicalContext {
  const defaults: RadioMusicalContext = {
    bpm: 145,
    bpmConfidence: 0.5,
    key: 4,
    scale: 'phrygian-dominant',
    keyConfidence: 0.5,
    energy: 0.5,
    density: 0.5,
    energyConfidence: 0.5,
    kickOccupancy: 0,
    bassOccupancy: 0,
    percussionOccupancy: 0,
    leadOccupancy: 0,
    harmonicOccupancy: 0,
    pitchVocabulary: [],
    rhythmicVocabulary: [],
    grooveSignature: '',
    syncopation: 0.3,
    style: 'full-on',
    styleConfidence: 0.5,
    phrasePosition: 0,
    sectionLikelihood: 'GROOVE',
    confidence: 0.5,
    timestamp: 0,
    available: true,
  }
  const merged: RadioMusicalContext = { ...defaults, ...partial }
  // Clamp occupancy + confidence fields so callers can't accidentally
  // smuggle in out-of-range values.
  merged.bpmConfidence = clamp01(merged.bpmConfidence)
  merged.keyConfidence = clamp01(merged.keyConfidence)
  merged.energyConfidence = clamp01(merged.energyConfidence)
  merged.energy = clamp01(merged.energy)
  merged.density = clamp01(merged.density)
  merged.kickOccupancy = clampOccupancy(merged.kickOccupancy)
  merged.bassOccupancy = clampOccupancy(merged.bassOccupancy)
  merged.percussionOccupancy = clampOccupancy(merged.percussionOccupancy)
  merged.leadOccupancy = clampOccupancy(merged.leadOccupancy)
  merged.harmonicOccupancy = clampOccupancy(merged.harmonicOccupancy)
  merged.syncopation = clamp01(merged.syncopation)
  merged.styleConfidence = clamp01(merged.styleConfidence)
  merged.phrasePosition = clamp01(merged.phrasePosition)
  merged.confidence = clamp01(merged.confidence)
  return merged
}

/**
 * Sentinel returned when the radio analyser is unavailable. All confidence
 * fields are 0 and `available` is false. Passing this to the adaptation
 * layer produces a NEUTRAL intent that preserves the base composition.
 */
export const RADIO_ABSENT: RadioMusicalContext = createRadioContext({
  bpm: 0,
  bpmConfidence: 0,
  key: 0,
  scale: '',
  keyConfidence: 0,
  energy: 0,
  density: 0,
  energyConfidence: 0,
  kickOccupancy: 0,
  bassOccupancy: 0,
  percussionOccupancy: 0,
  leadOccupancy: 0,
  harmonicOccupancy: 0,
  pitchVocabulary: [],
  rhythmicVocabulary: [],
  grooveSignature: '',
  syncopation: 0,
  style: '',
  styleConfidence: 0,
  phrasePosition: 0,
  sectionLikelihood: 'UNKNOWN',
  confidence: 0,
  timestamp: 0,
  available: false,
})

/** Convenience: is this context the RADIO_ABSENT sentinel? */
export function isRadioAbsent(radio: RadioMusicalContext): boolean {
  return !radio.available || radio.confidence === 0
}
