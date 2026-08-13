/**
 * StyleGrammar: a real style grammar (not just parameters).
 *
 * A {@link StyleGrammar} captures the *musical* identity of a style across
 * groove (subdivision, kick pattern, syncopation), harmony (preferred scales,
 * chord change rate, tension preference), melody (tessitura, max leap,
 * density, motif recurrence target), and arrangement (phrase/section length,
 * contrast level, development style). The grammar is the FIRST input the
 * composer consults — every downstream choice (groove shape, bass alignment,
 * lead tessitura, motif recurrence rate) derives from it.
 *
 * Four grammars are defined: `full-on`, `progressive`, `dark`, `acid`. They
 * are intentionally musically distinct — different kick patterns, different
 * tessituras, different development styles, different motif recurrence
 * targets. Calling {@link applyStyleToContext} bakes a grammar's preferences
 * into a {@link MusicalContext} so the existing substrate modules can read
 * them.
 */

import type { MusicalContext } from './musical-context.ts'

export type KickPatternKind = 'FOUR_ON_FLOOR' | 'PSY_KICK' | 'BROKEN' | 'SPARSE'
export type BassAlignment = 'LOCKED' | 'COMPLEMENTARY'
export type DevelopmentStyle = 'GRADUAL' | 'SUDDEN' | 'LINEAR'

export interface StyleGrammar {
  name: string
  // ----- Groove -----
  /** Primary subdivision: 1=quarter, 2=eighth, 4=sixteenth, 3=triplet. */
  subdivision: number
  /** Kick skeleton shape. */
  kickPattern: KickPatternKind
  /** How the bass relates to the kick. */
  bassAlignment: BassAlignment
  /** Syncopation budget 0..1. */
  syncopationBudget: number
  /** Swing amount 0..1. */
  swing: number
  // ----- Harmony -----
  /** Scale names preferred by this style (most preferred first). */
  preferredScales: string[]
  /** Chord changes per bar. */
  chordChangeRate: number
  /** Tension preference 0..1. */
  tensionPreference: number
  // ----- Melody -----
  /** Tessitura center as a MIDI note. */
  tessituraCenter: number
  /** Maximum interval between consecutive lead notes (semitones). */
  maxLeap: number
  /** Target note density (notes per bar). */
  densityTarget: number
  /** Target motif recurrence 0..1. */
  motifRecurrenceTarget: number
  // ----- Arrangement -----
  /** Phrase length in bars. */
  phraseLength: number
  /** Section length in bars. */
  sectionLength: number
  /** Contrast level between adjacent sections 0..1. */
  contrastLevel: number
  // ----- Behaviour -----
  /** How the style develops over time. */
  developmentStyle: DevelopmentStyle
  /** Cadence strength 0..1. */
  cadenceStrength: number
}

/**
 * Four style grammars. Each is musically distinct — they differ in kick
 * pattern, bass alignment, syncopation, tessitura, max leap, density, motif
 * recurrence target, and development style. The composer reads these to
 * shape every layer.
 */
export const STYLE_GRAMMARS: Record<string, StyleGrammar> = {
  // Full-on psytrance: dense, driving, high tessitura, locked bass.
  'full-on': {
    name: 'full-on',
    subdivision: 4,
    kickPattern: 'FOUR_ON_FLOOR',
    bassAlignment: 'LOCKED',
    syncopationBudget: 0.7,
    swing: 0,
    preferredScales: ['phrygian-dominant', 'phrygian'],
    chordChangeRate: 0.25,
    tensionPreference: 0.45,
    tessituraCenter: 67, // G4
    maxLeap: 7,
    densityTarget: 8,
    motifRecurrenceTarget: 0.55,
    phraseLength: 8,
    sectionLength: 64,
    contrastLevel: 0.6,
    developmentStyle: 'LINEAR',
    cadenceStrength: 0.7,
  },
  // Progressive: gradual development, complementary bass, medium density.
  progressive: {
    name: 'progressive',
    subdivision: 4,
    kickPattern: 'FOUR_ON_FLOOR',
    bassAlignment: 'COMPLEMENTARY',
    syncopationBudget: 0.25,
    swing: 0.05,
    preferredScales: ['minor', 'dorian'],
    chordChangeRate: 0.5,
    tensionPreference: 0.3,
    tessituraCenter: 64, // E4
    maxLeap: 5,
    densityTarget: 5,
    motifRecurrenceTarget: 0.65,
    phraseLength: 8,
    sectionLength: 64,
    contrastLevel: 0.4,
    developmentStyle: 'GRADUAL',
    cadenceStrength: 0.8,
  },
  // Dark: sparse psy kick, low density, low tessitura, high tension.
  dark: {
    name: 'dark',
    subdivision: 4,
    kickPattern: 'PSY_KICK',
    bassAlignment: 'LOCKED',
    syncopationBudget: 0.2,
    swing: 0,
    preferredScales: ['phrygian', 'locrian'],
    chordChangeRate: 0.125,
    tensionPreference: 0.7,
    tessituraCenter: 60, // C4
    maxLeap: 5,
    densityTarget: 3,
    motifRecurrenceTarget: 0.75,
    phraseLength: 8,
    sectionLength: 64,
    contrastLevel: 0.3,
    developmentStyle: 'SUDDEN',
    cadenceStrength: 0.5,
  },
  // Acid: broken kick, complementary bass, high syncopation, high recurrence.
  acid: {
    name: 'acid',
    subdivision: 4,
    kickPattern: 'BROKEN',
    bassAlignment: 'COMPLEMENTARY',
    syncopationBudget: 0.65,
    swing: 0.12,
    preferredScales: ['minor', 'blues'],
    chordChangeRate: 0.5,
    tensionPreference: 0.55,
    tessituraCenter: 65, // F4
    maxLeap: 4,
    densityTarget: 5,
    motifRecurrenceTarget: 0.8,
    phraseLength: 8,
    sectionLength: 64,
    contrastLevel: 0.5,
    developmentStyle: 'SUDDEN',
    cadenceStrength: 0.6,
  },
}

/** Default style if an unknown name is requested. */
export const DEFAULT_STYLE = 'full-on'

/** Look up a style grammar by name. Falls back to {@link DEFAULT_STYLE}. */
export function getStyleGrammar(styleName: string): StyleGrammar {
  return STYLE_GRAMMARS[styleName] ?? STYLE_GRAMMARS[DEFAULT_STYLE]
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * Apply a style grammar to a {@link MusicalContext}. The returned context
 * has the grammar's preferred scale, tension, density, and energy baked in
 * so the existing substrate modules (phrase-planner, bass-behavior, etc.)
 * can read the style without each one re-deriving it.
 */
export function applyStyleToContext(
  context: MusicalContext,
  grammar: StyleGrammar
): MusicalContext {
  const preferredScale = grammar.preferredScales[0] ?? context.scaleName
  // Density: convert "notes per bar" target to a 0..1 fraction. A 16-step bar
  // with `densityTarget` notes has density = densityTarget / 16, capped so we
  // never collapse into a saturated bar.
  const densityFraction = clamp01(grammar.densityTarget / 16)
  const energyFraction = clamp01(densityFraction + 0.1)
  return {
    ...context,
    scaleName: preferredScale,
    tension: grammar.tensionPreference,
    density: densityFraction,
    energy: energyFraction,
    // Style pressure: high motif recurrence target → low novelty pressure.
    noveltyPressure: clamp01(1 - grammar.motifRecurrenceTarget),
    repetitionPressure: grammar.motifRecurrenceTarget,
  }
}

/** List all registered style names. */
export function listStyleNames(): string[] {
  return Object.keys(STYLE_GRAMMARS)
}
