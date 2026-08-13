/**
 * LearnedIdentity — two explicit musical identities that prove learning changes
 * the MUSICAL VOCABULARY, not just scalar parameters.
 *
 * F21 requirement: build two learned sources (A: narrow/rolling/sparse/
 * descending/stable; B: wide/syncopated/dense/ascending/aggressive) that
 * produce materially different music under the SAME seed, SAME tempo, SAME
 * section structure, and SAME bar count.
 *
 * The divergence must come from LearnedMusicalContext + InteractionGrammar —
 * NOT from different seeds or random strategy selection. Each identity
 * configures:
 *   - bass interval vocabulary (narrow vs wide)
 *   - bass rhythmic vocabulary (rolling vs syncopated)
 *   - lead interval vocabulary (narrow vs wide)
 *   - lead contour (descending vs ascending)
 *   - lead density (sparse vs dense)
 *   - rhythm syncopation (straight vs syncopated)
 *   - harmonic movement (stable vs mobile)
 *   - energy (controlled vs aggressive)
 *   - tension (low vs high)
 *   - timbre (dark/subby vs bright/aggressive)
 *
 * The CompositionEngine consumes these causally: the identity shapes WHICH
 * intervals the bass chooses, WHICH contour the lead designs, WHICH rhythmic
 * cells underpin the phrase, and WHICH harmonic targets are preferred.
 */

import type { InteractionGrammar } from './interaction-grammar.ts'
import { createEmptyInteractionGrammar } from './interaction-grammar.ts'
import type { LearnedMusicalContext } from './learned-context.ts'
import { createEmptyLearnedContext } from './learned-context.ts'

/** Bass vocabulary mode — alters the GENERATION PROCEDURE, not a step array. */
export type BassVocabulary =
  | 'ROLLING' // repeated rhythmic cell + controlled degree movement
  | 'SYNCOPATED' // accent displacement + anticipation
  | 'MELODIC' // degree contour + phrase targets
  | 'ACID' // repeated pitch centers + chromatic approach behavior
  | 'SPARSE' // deliberate silence + longer durations
  | 'TENSION' // register expansion + unstable harmonic targets

/** Lead contour preference — drives phrase-level melodic design. */
export type LeadContourVocabulary =
  | 'DESCENDING_NARROW' // sparse, falling, small intervals
  | 'ASCENDING_WIDE' // dense, rising, large intervals
  | 'ARCH_BALANCED' // rise-then-fall, medium intervals
  | 'WAVE_SYNCOPATED' // frequent direction changes, medium intervals

/**
 * A complete learned musical identity. This bundles a LearnedMusicalContext +
 * InteractionGrammar + explicit vocabulary labels that the CompositionEngine
 * reads causally during generation.
 */
export interface LearnedIdentity {
  /** Identity name. */
  name: string
  /** The learned context (statistical abstractions consumed by the engine). */
  learned: LearnedMusicalContext
  /** The interaction grammar (cross-voice relationships consumed causally). */
  grammar: InteractionGrammar
  /** Bass vocabulary mode — changes HOW the bass is generated. */
  bassVocabulary: BassVocabulary
  /** Lead contour vocabulary — changes HOW the lead phrase is designed. */
  leadVocabulary: LeadContourVocabulary
  /** Preferred interval width for bass (semitones, typical max). */
  bassIntervalWidth: number
  /** Preferred interval width for lead (semitones, typical max). */
  leadIntervalWidth: number
  /** Rhythmic syncopation level 0..1. */
  syncopation: number
  /** Harmonic mobility 0..1 (0 = stable root, 1 = frequent changes). */
  harmonicMobility: number
  /** Energy level 0..1. */
  energy: number
  /** Tension level 0..1. */
  tension: number
}

/**
 * SOURCE A — "narrow / rolling / sparse / descending / stable / controlled"
 *
 * Bass: narrow intervals (root-fifth-root), rolling vocabulary, short notes.
 * Lead: narrow intervals, sparse motifs, descending contour.
 * Rhythm: straight, low syncopation.
 * Harmony: stable, narrow movement.
 * Energy: controlled.
 * Timbre: dark, subby, warm.
 */
export function createIdentityA(): LearnedIdentity {
  const learned = createEmptyLearnedContext()
  // Bass: narrow intervals — root and fifth only.
  learned.bass.degreePreferences = { 0: 0.6, 4: 0.3, 2: 0.1 }
  learned.bass.register = 2
  learned.bass.kickRelationship = 'LOCKED'
  learned.bass.octaveBehavior = 0.1
  learned.bass.approachToneProfile = 0.1
  learned.bass.phraseEndingProfile = 0.3
  // Lead: narrow intervals, sparse, descending contour.
  learned.melody.contourProfile = [0.2, 0.6, 0.2] // [up, down, same] — mostly down
  learned.melody.intervalProfile = { 1: 0.3, 2: 0.3, 3: 0.2, 5: 0.1, 7: 0.1 }
  learned.melody.registerProfile = 64
  learned.melody.phraseLength = 8
  learned.melody.restProfile = 0.4 // sparse — lots of rests
  learned.melody.cadenceProfile = 0.8 // stable cadence
  learned.melody.scaleDegreePreferences = {
    0: 0.3,
    1: 0.15,
    2: 0.2,
    3: 0.1,
    4: 0.15,
    5: 0.05,
    6: 0.05,
  }
  learned.melody.motifBehavior = 'REUSE'
  learned.melody.callResponseProfile = 0.2
  // Rhythm: straight, low syncopation.
  learned.rhythm.subdivision = 4
  learned.rhythm.swing = 0
  learned.rhythm.syncopation = 0.15
  learned.rhythm.kickGrammar = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] // four-on-floor
  learned.rhythm.hatGrammar = [0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0] // offbeat
  learned.rhythm.bassRhythmGrammar = [1, 0, 0, 0, 0.6, 0, 0, 0, 1, 0, 0, 0, 0.6, 0, 0, 0] // rolling
  learned.rhythm.ghostProbability = 0.05
  learned.rhythm.accentProfile = [1, 0, 0, 0, 0.5, 0, 0, 0, 0.7, 0, 0, 0, 0.5, 0, 0, 0]
  // Harmony: stable, narrow movement.
  learned.harmony.key = 4
  learned.harmony.mode = 'phrygian-dominant'
  learned.harmony.tonalCenterConfidence = 0.9
  learned.harmony.pitchClassProfile = [
    0.3, 0.05, 0.1, 0.05, 0.25, 0.05, 0.1, 0.05, 0.2, 0.05, 0.1, 0.05,
  ]
  learned.harmony.harmonicRhythm = 0.125 // slow chord changes
  learned.harmony.rootMovement = [0, 0, 7, 0] // mostly static
  learned.harmony.intervalPreferences = { 3: 0.3, 5: 0.3, 7: 0.2, 2: 0.2 }
  // Arrangement: controlled energy.
  learned.arrangement.buildBehavior = 0.2
  learned.arrangement.dropBehavior = 0.2
  learned.arrangement.breakdownBehavior = 0.1
  learned.arrangement.energyCurve = [0.3, 0.4, 0.5, 0.45, 0.4, 0.35]
  learned.arrangement.densityCurve = [0.3, 0.4, 0.5, 0.45, 0.4, 0.35]
  // Timbre: dark, subby, warm.
  learned.timbre.brightness = 0.3
  learned.timbre.spectralCentroid = 1200
  learned.timbre.harmonicity = 0.7
  learned.timbre.noisiness = 0.1
  learned.timbre.transientCharacter = 0.3
  learned.timbre.attack = 0.005
  learned.timbre.decay = 0.4
  learned.timbre.sustain = 0.6
  learned.timbre.roughness = 0.2
  learned.timbre.subEnergy = 0.8
  learned.timbre.midEnergy = 0.4
  learned.timbre.highEnergy = 0.2
  learned.timbre.saturation = 0.3
  learned.timbre.confidence = 0.9
  // Meta.
  learned.meta.confidence = 0.9
  learned.meta.source = 'identity-A'
  learned.meta.fingerprint = 'narrow-rolling-sparse-descending-stable'

  // Interaction grammar: LOCKED kick-bass, narrow bass transitions, narrow lead intervals.
  const grammar = createEmptyInteractionGrammar()
  grammar.kickBass.bassOnKickProb = [1, 0, 0, 0, 0.9, 0, 0, 0, 1, 0, 0, 0, 0.9, 0, 0, 0]
  grammar.kickBass.bassOffKickProb = [0, 0, 0.05, 0, 0, 0, 0.05, 0, 0, 0, 0.05, 0, 0, 0, 0.05, 0]
  grammar.bassTransitions.transitions = {
    0: { 0: 0.5, 4: 0.35, 2: 0.15 },
    4: { 0: 0.6, 4: 0.2, 2: 0.2 },
    2: { 0: 0.4, 4: 0.35, 2: 0.25 },
  }
  grammar.harmonyLead.intervalPreferences = {
    4: { 3: 0.35, 5: 0.25, 7: 0.15, 2: 0.15, 1: 0.1 },
  }
  grammar.energyDensity.densityByEnergy = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65]
  grammar.tensionRegister.registerByTension = [60, 61, 62, 63, 64, 64, 65, 65, 66, 66]
  grammar.confidence = 0.9

  return {
    name: 'source-A',
    learned,
    grammar,
    bassVocabulary: 'ROLLING',
    leadVocabulary: 'DESCENDING_NARROW',
    bassIntervalWidth: 5, // root-fifth max
    leadIntervalWidth: 4, // small intervals
    syncopation: 0.15,
    harmonicMobility: 0.15,
    energy: 0.5,
    tension: 0.25,
  }
}

/**
 * SOURCE B — "wide / syncopated / dense / ascending / mobile / aggressive"
 *
 * Bass: wider intervals, syncopated vocabulary, more variation.
 * Lead: wide intervals, denser motifs, ascending contour.
 * Rhythm: syncopated.
 * Harmony: more movement.
 * Energy: aggressive.
 * Timbre: bright, aggressive, saturated.
 */
export function createIdentityB(): LearnedIdentity {
  const learned = createEmptyLearnedContext()
  // Bass: wider intervals — root, third, fifth, seventh, octave.
  learned.bass.degreePreferences = { 0: 0.25, 2: 0.2, 4: 0.2, 6: 0.15, 7: 0.1, 3: 0.1 }
  learned.bass.register = 2
  learned.bass.kickRelationship = 'COMPLEMENTARY'
  learned.bass.octaveBehavior = 0.4
  learned.bass.approachToneProfile = 0.4
  learned.bass.phraseEndingProfile = 0.5
  // Lead: wide intervals, dense, ascending contour.
  learned.melody.contourProfile = [0.6, 0.2, 0.2] // mostly up
  learned.melody.intervalProfile = { 3: 0.15, 5: 0.2, 7: 0.25, 10: 0.15, 12: 0.1, 2: 0.15 }
  learned.melody.registerProfile = 72
  learned.melody.phraseLength = 8
  learned.melody.restProfile = 0.15 // dense — few rests
  learned.melody.cadenceProfile = 0.4 // tension → release
  learned.melody.scaleDegreePreferences = {
    0: 0.15,
    1: 0.1,
    2: 0.15,
    3: 0.15,
    4: 0.15,
    5: 0.15,
    6: 0.15,
  }
  learned.melody.motifBehavior = 'VARY'
  learned.melody.callResponseProfile = 0.6
  // Rhythm: syncopated.
  learned.rhythm.subdivision = 4
  learned.rhythm.swing = 0.12
  learned.rhythm.syncopation = 0.65
  learned.rhythm.kickGrammar = [1, 0, 0, 0.3, 0, 0, 0.3, 0, 1, 0, 0, 0.3, 0, 0, 0.3, 0] // broken
  learned.rhythm.hatGrammar = [0.3, 0, 0.5, 0, 0.3, 0, 0.5, 0, 0.3, 0, 0.5, 0, 0.3, 0, 0.5, 0] // driving
  learned.rhythm.bassRhythmGrammar = [
    0.8, 0, 0.4, 0, 0.3, 0, 0.5, 0, 0.8, 0, 0.4, 0, 0.3, 0, 0.5, 0.3,
  ] // syncopated
  learned.rhythm.ghostProbability = 0.25
  learned.rhythm.accentProfile = [1, 0, 0.3, 0, 0.5, 0, 0.3, 0, 0.7, 0, 0.3, 0, 0.5, 0, 0.3, 0.5]
  // Harmony: more movement.
  learned.harmony.key = 4
  learned.harmony.mode = 'phrygian-dominant'
  learned.harmony.tonalCenterConfidence = 0.7
  learned.harmony.pitchClassProfile = [
    0.2, 0.1, 0.15, 0.1, 0.2, 0.1, 0.15, 0.1, 0.15, 0.1, 0.15, 0.1,
  ]
  learned.harmony.harmonicRhythm = 0.5 // fast chord changes
  learned.harmony.rootMovement = [0, 5, 7, 3, 0, 5] // mobile
  learned.harmony.intervalPreferences = { 3: 0.2, 5: 0.2, 7: 0.25, 10: 0.15, 2: 0.1, 12: 0.1 }
  // Arrangement: aggressive energy.
  learned.arrangement.buildBehavior = 0.6
  learned.arrangement.dropBehavior = 0.5
  learned.arrangement.breakdownBehavior = 0.3
  learned.arrangement.energyCurve = [0.4, 0.6, 0.8, 0.9, 0.85, 0.7]
  learned.arrangement.densityCurve = [0.4, 0.6, 0.8, 0.9, 0.85, 0.7]
  // Timbre: bright, aggressive, saturated.
  learned.timbre.brightness = 0.8
  learned.timbre.spectralCentroid = 4500
  learned.timbre.harmonicity = 0.3
  learned.timbre.noisiness = 0.4
  learned.timbre.transientCharacter = 0.8
  learned.timbre.attack = 0.001
  learned.timbre.decay = 0.2
  learned.timbre.sustain = 0.4
  learned.timbre.roughness = 0.6
  learned.timbre.subEnergy = 0.5
  learned.timbre.midEnergy = 0.7
  learned.timbre.highEnergy = 0.8
  learned.timbre.saturation = 0.7
  learned.timbre.confidence = 0.9
  // Meta.
  learned.meta.confidence = 0.9
  learned.meta.source = 'identity-B'
  learned.meta.fingerprint = 'wide-syncopated-dense-ascending-aggressive'

  // Interaction grammar: COMPLEMENTARY kick-bass, wide bass transitions, wide lead intervals.
  const grammar = createEmptyInteractionGrammar()
  grammar.kickBass.bassOnKickProb = [
    0.7, 0, 0.3, 0, 0.4, 0, 0.3, 0, 0.7, 0, 0.3, 0, 0.4, 0, 0.3, 0.2,
  ]
  grammar.kickBass.bassOffKickProb = [
    0, 0.2, 0.1, 0.3, 0.1, 0.2, 0.1, 0.3, 0, 0.2, 0.1, 0.3, 0.1, 0.2, 0.1, 0.3,
  ]
  grammar.bassTransitions.transitions = {
    0: { 0: 0.2, 4: 0.25, 2: 0.2, 6: 0.15, 3: 0.1, 7: 0.1 },
    4: { 0: 0.25, 4: 0.15, 2: 0.2, 6: 0.2, 3: 0.1, 7: 0.1 },
    2: { 0: 0.2, 4: 0.25, 2: 0.15, 6: 0.2, 3: 0.1, 7: 0.1 },
    6: { 0: 0.2, 4: 0.2, 2: 0.2, 6: 0.15, 3: 0.15, 7: 0.1 },
  }
  grammar.harmonyLead.intervalPreferences = {
    4: { 7: 0.3, 5: 0.2, 10: 0.2, 3: 0.15, 12: 0.1, 2: 0.05 },
  }
  grammar.energyDensity.densityByEnergy = [0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
  grammar.tensionRegister.registerByTension = [64, 66, 68, 70, 72, 74, 76, 78, 80, 82]
  grammar.confidence = 0.9

  return {
    name: 'source-B',
    learned,
    grammar,
    bassVocabulary: 'SYNCOPATED',
    leadVocabulary: 'ASCENDING_WIDE',
    bassIntervalWidth: 10, // root-seventh max
    leadIntervalWidth: 10, // large intervals
    syncopation: 0.65,
    harmonicMobility: 0.65,
    energy: 0.8,
    tension: 0.65,
  }
}

/** A neutral identity (untrained) — for baseline comparison. */
export function createNeutralIdentity(): LearnedIdentity {
  const learned = createEmptyLearnedContext()
  const grammar = createEmptyInteractionGrammar()
  return {
    name: 'neutral',
    learned,
    grammar,
    bassVocabulary: 'ROLLING',
    leadVocabulary: 'ARCH_BALANCED',
    bassIntervalWidth: 7,
    leadIntervalWidth: 7,
    syncopation: 0.3,
    harmonicMobility: 0.3,
    energy: 0.5,
    tension: 0.3,
  }
}
