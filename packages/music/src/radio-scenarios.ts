/**
 * Deterministic radio scenarios for testing the adaptation layer.
 *
 * Each scenario is a frozen {@link RadioMusicalContext} representing a
 * recognisable radio situation:
 *
 *   - SPARSE      — radio barely playing; foundation adds groove + identity.
 *   - BASS_HEAVY  — strong radio bass; foundation reduces bass, shifts up.
 *   - MELODY_HEAVY— strong radio lead; foundation uses counter / response.
 *   - FULL_DENSE  — radio playing everything; foundation reduces / abstains.
 *   - BREAKDOWN   — radio breakdown; foundation reduces kick/bass, exposes motif.
 *   - ABSENT      — radio analyser unavailable; composition continues internally.
 *
 * Scenarios are deliberately musically distinct so the adaptation layer's
 * response can be asserted on without flakiness.
 */

import type { RadioMusicalContext } from './radio-context.ts'
import { RADIO_ABSENT, createRadioContext } from './radio-context.ts'

export interface RadioScenario {
  name: string
  description: string
  context: RadioMusicalContext
}

/**
 * All built-in scenarios. Names are stable identifiers (used in tests and
 * reports). `ABSENT` re-uses the {@link RADIO_ABSENT} sentinel.
 */
export const RADIO_SCENARIOS: Record<string, RadioScenario> = {
  // SCENARIO A — SPARSE
  // Low energy, low density, low occupancy everywhere.
  // Expected: foundation adds groove + identity.
  SPARSE: {
    name: 'SPARSE',
    description:
      'Low energy, low density, low occupancy everywhere. Foundation adds groove + identity.',
    context: createRadioContext({
      bpm: 138,
      bpmConfidence: 0.55,
      key: 4,
      scale: 'phrygian-dominant',
      keyConfidence: 0.6,
      energy: 0.25,
      density: 0.2,
      energyConfidence: 0.65,
      kickOccupancy: 0.1,
      bassOccupancy: 0.15,
      percussionOccupancy: 0.1,
      leadOccupancy: 0.1,
      harmonicOccupancy: 0.2,
      pitchVocabulary: [4, 7, 0],
      rhythmicVocabulary: [0],
      grooveSignature: 'sparse-kick-only',
      syncopation: 0.15,
      style: 'full-on',
      styleConfidence: 0.5,
      phrasePosition: 0.5,
      sectionLikelihood: 'INTRO',
      confidence: 0.6,
      timestamp: 0,
      available: true,
    }),
  },

  // SCENARIO B — BASS HEAVY
  // High bass occupancy, strong low-end, moderate lead.
  // Expected: foundation reduces bass competition, shifts to upper roles.
  BASS_HEAVY: {
    name: 'BASS_HEAVY',
    description:
      'High bass occupancy, strong low-end, moderate lead. Foundation reduces bass, shifts to upper roles.',
    context: createRadioContext({
      bpm: 145,
      bpmConfidence: 0.85,
      key: 4,
      scale: 'phrygian-dominant',
      keyConfidence: 0.8,
      energy: 0.7,
      density: 0.6,
      energyConfidence: 0.8,
      kickOccupancy: 0.5,
      bassOccupancy: 0.85,
      percussionOccupancy: 0.4,
      leadOccupancy: 0.45,
      harmonicOccupancy: 0.3,
      pitchVocabulary: [4, 0, 7, 3],
      rhythmicVocabulary: [0, 4, 8, 12],
      grooveSignature: 'four-on-floor-bass',
      syncopation: 0.3,
      style: 'full-on',
      styleConfidence: 0.75,
      phrasePosition: 0.5,
      sectionLikelihood: 'GROOVE',
      confidence: 0.8,
      timestamp: 32,
      available: true,
    }),
  },

  // SCENARIO C — MELODY HEAVY
  // High lead occupancy, moderate bass, moderate energy.
  // Expected: foundation uses counter / response / space.
  MELODY_HEAVY: {
    name: 'MELODY_HEAVY',
    description:
      'High lead occupancy, moderate bass, moderate energy. Foundation uses counter / response / space.',
    context: createRadioContext({
      bpm: 142,
      bpmConfidence: 0.8,
      key: 7,
      scale: 'minor',
      keyConfidence: 0.75,
      energy: 0.6,
      density: 0.55,
      energyConfidence: 0.75,
      kickOccupancy: 0.5,
      bassOccupancy: 0.5,
      percussionOccupancy: 0.4,
      leadOccupancy: 0.85,
      harmonicOccupancy: 0.4,
      pitchVocabulary: [7, 9, 12, 5],
      rhythmicVocabulary: [0, 2, 4, 6, 8],
      grooveSignature: 'melodic-fwd',
      syncopation: 0.4,
      style: 'progressive',
      styleConfidence: 0.7,
      phrasePosition: 0.6,
      sectionLikelihood: 'DEVELOPMENT',
      confidence: 0.78,
      timestamp: 64,
      available: true,
    }),
  },

  // SCENARIO D — FULL / DENSE
  // High everything, high energy.
  // Expected: foundation reduces layers, may abstain.
  FULL_DENSE: {
    name: 'FULL_DENSE',
    description: 'High everything, high energy. Foundation reduces layers, may abstain.',
    context: createRadioContext({
      bpm: 148,
      bpmConfidence: 0.9,
      key: 4,
      scale: 'phrygian-dominant',
      keyConfidence: 0.88,
      energy: 0.92,
      density: 0.85,
      energyConfidence: 0.88,
      kickOccupancy: 0.85,
      bassOccupancy: 0.8,
      percussionOccupancy: 0.75,
      leadOccupancy: 0.8,
      harmonicOccupancy: 0.7,
      pitchVocabulary: [4, 0, 7, 3, 8],
      rhythmicVocabulary: [0, 2, 4, 6, 8, 10, 12, 14],
      grooveSignature: 'full-on-dense',
      syncopation: 0.45,
      style: 'full-on',
      styleConfidence: 0.85,
      phrasePosition: 0.7,
      sectionLikelihood: 'PEAK',
      confidence: 0.85,
      timestamp: 96,
      available: true,
    }),
  },

  // SCENARIO E — BREAKDOWN
  // Low kick, low bass, low percussion, medium harmony, low energy.
  // Expected: foundation reduces kick/bass, exposes motif, increases texture.
  BREAKDOWN: {
    name: 'BREAKDOWN',
    description:
      'Low kick, low bass, low percussion, medium harmony, low energy. Foundation reduces kick/bass, exposes motif, increases texture.',
    context: createRadioContext({
      bpm: 140,
      bpmConfidence: 0.75,
      key: 4,
      scale: 'phrygian',
      keyConfidence: 0.7,
      energy: 0.3,
      density: 0.3,
      energyConfidence: 0.75,
      kickOccupancy: 0.1,
      bassOccupancy: 0.15,
      percussionOccupancy: 0.15,
      leadOccupancy: 0.4,
      harmonicOccupancy: 0.55,
      pitchVocabulary: [4, 7, 0, 3],
      rhythmicVocabulary: [0, 8],
      grooveSignature: 'breakdown-pad',
      syncopation: 0.1,
      style: 'dark',
      styleConfidence: 0.65,
      phrasePosition: 0.3,
      sectionLikelihood: 'BREAK',
      confidence: 0.72,
      timestamp: 128,
      available: true,
    }),
  },

  // RADIO ABSENT
  // available=false, all confidence=0.
  // Expected: composition continues in internal mode.
  ABSENT: {
    name: 'ABSENT',
    description:
      'Radio analyser unavailable. Composition continues in internal mode (NEUTRAL intent).',
    context: RADIO_ABSENT,
  },
}

/** List of all scenario names (stable order). */
export const RADIO_SCENARIO_NAMES: string[] = [
  'SPARSE',
  'BASS_HEAVY',
  'MELODY_HEAVY',
  'FULL_DENSE',
  'BREAKDOWN',
  'ABSENT',
]

/** Get a scenario by name (throws if unknown). */
export function getRadioScenario(name: string): RadioScenario {
  const s = RADIO_SCENARIOS[name]
  if (!s) throw new Error(`Unknown radio scenario: ${name}`)
  return s
}

/**
 * Build a deterministic radio sequence (one context per bar) for a scenario.
 * The radio context is held constant across the section — for tests that
 * need variation, callers can splice in additional contexts.
 */
export function scenarioRadioSequence(scenarioName: string, bars: number): RadioMusicalContext[] {
  const scenario = getRadioScenario(scenarioName)
  const out: RadioMusicalContext[] = []
  for (let bar = 0; bar < bars; bar++) {
    out.push({
      ...scenario.context,
      timestamp: bar * 4, // ~4 seconds per bar
      phrasePosition: (bar % 8) / 8,
    })
  }
  return out
}
