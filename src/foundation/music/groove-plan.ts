/**
 * GroovePlan: the first-class groove scaffold.
 *
 * The GroovePlan is the FIRST thing generated when composing a section. It
 * defines the kick skeleton, the bass-kick relationship, the accent grid,
 * the hat/percussion behaviour, the syncopation budget, the swing amount,
 * and the fill locations. Every other part (bass, lead, hats, arrangement)
 * composes AGAINST the groove — they read its kick steps and accent grid so
 * the parts interlock instead of colliding.
 *
 * A GroovePlan is built from a {@link MusicalContext} and a seed. The
 * context's `style` field is consulted via {@link getStyleGrammar} to pick
 * the kick pattern, syncopation budget, and swing that fit the style.
 */

import type { MusicalContext } from './musical-context.ts'
import { Rng } from './rng.ts'
import { type KickPatternKind, type StyleGrammar, getStyleGrammar } from './style-grammar.ts'

export type HatStyle = 'OFFBEAT' | 'DRIVING' | 'SPARSE' | 'NONE'
export type BassKickAlignment = 'LOCKED' | 'COMPLEMENTARY' | 'INDEPENDENT'

export interface GroovePlan {
  /** Primary subdivision: 1=quarter, 2=eighth, 4=sixteenth, 3=triplet. */
  subdivision: number
  /** Kick skeleton: which 16th-step positions have kicks. */
  kickSteps: number[]
  /** How the bass should align with the kick. */
  bassKickAlignment: BassKickAlignment
  /** Accent grid: which steps are strong beats. */
  accentSteps: number[]
  /** Hat/percussion step positions. */
  hatSteps: number[]
  /** Hat behaviour. */
  hatStyle: HatStyle
  /** Syncopation budget 0..1 — how much syncopation is allowed. */
  syncopationBudget: number
  /** Swing amount 0..1. */
  swing: number
  /** Fill locations (bar indices where fills occur). */
  fillBars: number[]
  /** Density 0..1. */
  density: number
  /** Steps per bar (16 by default for a 16th-note grid). */
  stepsPerBar: number
  // ── F20 SHARED POCKET ──
  /** Pulse in steps (typically 4 = quarter note in a 16-step bar). */
  pulse: number
  /** Per-step accent strength 0..1 (length = stepsPerBar). The pocket grid. */
  accent: number[]
  /** Per-step microtiming offset in step fractions (length = stepsPerBar). */
  microtiming: number[]
  /** Steps where the bass should accent (length = stepsPerBar, 0..1 per step). */
  bassAccentMap: number[]
  /** Steps where ghost notes are welcome (length = stepsPerBar, 0..1 per step). */
  ghostMap: number[]
  /** Kick onset map (length = stepsPerBar, 0..1 per step). Same info as kickSteps but in pocket form. */
  kickMap: number[]
}

export interface BuildGrooveOptions {
  context: MusicalContext
  seed: number
  bars: number
  /** Optional explicit grammar; defaults to context.style lookup. */
  grammar?: StyleGrammar
}

/**
 * Resolve the kick step positions for a given kick pattern on a 16-step bar.
 *
 *  - FOUR_ON_FLOOR: kicks on every quarter (steps 0, 4, 8, 12) — the
 *    psytrance staple.
 *  - PSY_KICK: kicks on beats 1 and 3 (steps 0, 8) — a sparser feel that
 *    leaves room for offbeat bass and texture.
 *  - BROKEN: kicks on a syncopated grid (steps 0, 3, 6, 10) — the acid /
 *    breakbeat feel.
 *  - SPARSE: a single kick on beat 1 (step 0) — for intros and breakdowns.
 */
export function kickStepsForPattern(pattern: KickPatternKind, stepsPerBar: number): number[] {
  const beat = Math.max(1, Math.round(stepsPerBar / 4))
  switch (pattern) {
    case 'FOUR_ON_FLOOR':
      return [0, beat, beat * 2, beat * 3]
    case 'PSY_KICK':
      return [0, beat * 2]
    case 'BROKEN':
      return [0, Math.round(beat * 0.75), Math.round(beat * 1.5), Math.round(beat * 2.5)]
    case 'SPARSE':
      return [0]
    default:
      return [0, beat, beat * 2, beat * 3]
  }
}

/**
 * Resolve the hat step positions for a given hat style on a 16-step bar.
 *
 *  - OFFBEAT: hats on the "and" of each beat (steps 2, 6, 10, 14).
 *  - DRIVING: 8th-note hats (steps 0, 2, 4, 6, 8, 10, 12, 14).
 *  - SPARSE: hats on beats 2 and 4 only (steps 4, 12).
 *  - NONE: no hats.
 */
export function hatStepsForStyle(style: HatStyle, stepsPerBar: number): number[] {
  const beat = Math.max(1, Math.round(stepsPerBar / 4))
  const half = Math.max(1, Math.round(stepsPerBar / 8))
  switch (style) {
    case 'OFFBEAT':
      return [half, beat + half, beat * 2 + half, beat * 3 + half]
    case 'DRIVING': {
      const out: number[] = []
      for (let s = 0; s < stepsPerBar; s += half) out.push(s)
      return out
    }
    case 'SPARSE':
      return [beat, beat * 3]
    case 'NONE':
      return []
    default:
      return [half, beat + half, beat * 2 + half, beat * 3 + half]
  }
}

/** Resolve the strong-beat accent grid (steps 0, beat, 2*beat, 3*beat). */
export function accentGrid(stepsPerBar: number): number[] {
  const beat = Math.max(1, Math.round(stepsPerBar / 4))
  return [0, beat, beat * 2, beat * 3]
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * Build a {@link GroovePlan} from a context and seed. The plan is the first
 * thing the composer generates — everything else composes against it.
 *
 * The plan's kick pattern, syncopation budget, swing, and density derive
 * from the context's style grammar (looked up via `context.sectionRole`
 * falling back to the default style). Fill bars land at phrase-end bars
 * (every 8 bars by default) so fills punctuate the phrase structure.
 */
export function buildGroovePlan(opts: BuildGrooveOptions): GroovePlan {
  const { context, seed, bars } = opts
  const grammar = opts.grammar ?? getStyleGrammar(context.sectionRole || 'full-on')
  const rng = new Rng(seed)
  const stepsPerBar = 16

  const kickSteps = kickStepsForPattern(grammar.kickPattern, stepsPerBar)
  // Accent grid: beats 1-4 of the bar.
  const accents = accentGrid(stepsPerBar)
  // Hat style: choose based on grammar's syncopation budget and density.
  // High syncopation + high density → DRIVING; low syncopation → OFFBEAT;
  // very low density → SPARSE; style can override.
  let hatStyle: HatStyle
  if (grammar.kickPattern === 'PSY_KICK') {
    hatStyle = 'SPARSE'
  } else if (grammar.syncopationBudget > 0.6) {
    hatStyle = 'DRIVING'
  } else if (grammar.syncopationBudget < 0.25) {
    hatStyle = 'OFFBEAT'
  } else {
    hatStyle = 'OFFBEAT'
  }
  // Small random chance to bump hat style for variety, but stay deterministic.
  if (rng.next() < 0.15 && hatStyle === 'OFFBEAT') hatStyle = 'SPARSE'
  const hatSteps = hatStepsForStyle(hatStyle, stepsPerBar)

  // Bass-kick alignment: read from grammar. The grammar's LOCKED/COMPLEMENTARY
  // is mapped to the GroovePlan's three-way enum (INDEPENDENT is reserved for
  // texture-only sections, never produced here).
  const bassKickAlignment: BassKickAlignment =
    grammar.bassAlignment === 'LOCKED' ? 'LOCKED' : 'COMPLEMENTARY'

  // Fill bars: every phraseLength bars, on the last bar of the phrase.
  const phraseLength = grammar.phraseLength
  const fillBars: number[] = []
  for (let bar = phraseLength - 1; bar < bars; bar += phraseLength) {
    fillBars.push(bar)
  }

  // Density: scale the grammar's densityTarget into a 0..1 fraction, then
  // apply a small deterministic jitter from the rng.
  const baseDensity = clamp01(grammar.densityTarget / 16)
  const density = clamp01(baseDensity + rng.range(-0.03, 0.03))

  // Syncopation: grammar's budget, jittered slightly.
  const syncopationBudget = clamp01(grammar.syncopationBudget + rng.range(-0.02, 0.02))
  const swing = clamp01(grammar.swing)

  // ── F20 SHARED POCKET FIELDS ──
  // Beat step interval (quarter note in a 16-step bar = 4).
  const beat = Math.max(1, Math.round(stepsPerBar / 4))
  // Per-step accent grid: strong beats get 1.0, offbeats get syncopation-scaled value.
  const accent: number[] = new Array(stepsPerBar).fill(0)
  for (const s of accents) accent[s] = 1.0
  // Offbeat accents scaled by syncopation budget.
  const half = Math.max(1, Math.round(stepsPerBar / 8))
  for (let s = half; s < stepsPerBar; s += half) {
    if (accent[s] === 0) accent[s] = 0.3 + syncopationBudget * 0.4
  }

  // Microtiming: swing shifts odd 8th notes late. Represented as step fractions.
  const microtiming: number[] = new Array(stepsPerBar).fill(0)
  if (swing > 0) {
    for (let s = 0; s < stepsPerBar; s++) {
      // Odd 8th positions (s % (half*2) === half) get a late microtiming.
      if (s % (half * 2) === half) microtiming[s] = swing * 0.15
    }
  }

  // Kick onset map (pocket form of kickSteps).
  const kickMap: number[] = new Array(stepsPerBar).fill(0)
  for (const s of kickSteps) kickMap[s] = 1.0

  // Bass accent map: bass accents fall on kick steps in LOCKED mode, on
  // complementary offbeats otherwise.
  const bassAccentMap: number[] = new Array(stepsPerBar).fill(0)
  if (bassKickAlignment === 'LOCKED') {
    for (const s of kickSteps) bassAccentMap[s] = 1.0
  } else {
    const complementary = [half, beat + half, beat * 2 + half, beat * 3 + half]
    for (const s of complementary) {
      if (s < stepsPerBar) bassAccentMap[s] = 0.8
    }
  }

  // Ghost-note map: ghost notes sit on weak subdivisions, scaled by syncopation.
  const ghostMap: number[] = new Array(stepsPerBar).fill(0)
  for (let s = 0; s < stepsPerBar; s++) {
    if (accent[s] === 0 && kickMap[s] === 0) {
      ghostMap[s] = syncopationBudget * 0.3
    }
  }

  // Pulse: quarter note in steps.
  const pulse = beat

  return {
    subdivision: grammar.subdivision,
    kickSteps,
    bassKickAlignment,
    accentSteps: accents,
    hatSteps,
    hatStyle,
    syncopationBudget,
    swing,
    fillBars,
    density,
    stepsPerBar,
    // F20 shared pocket.
    pulse,
    accent,
    microtiming,
    bassAccentMap,
    ghostMap,
    kickMap,
  }
}

/** Check if a step is a kick step. */
export function isKickStep(groove: GroovePlan, step: number): boolean {
  const wrapped = ((step % groove.stepsPerBar) + groove.stepsPerBar) % groove.stepsPerBar
  return groove.kickSteps.includes(wrapped)
}

/** Check if a step is an accent step. */
export function isAccentStep(groove: GroovePlan, step: number): boolean {
  const wrapped = ((step % groove.stepsPerBar) + groove.stepsPerBar) % groove.stepsPerBar
  return groove.accentSteps.includes(wrapped)
}

/** Check if a bar is a fill bar. */
export function isFillBar(groove: GroovePlan, bar: number): boolean {
  return groove.fillBars.includes(bar)
}
