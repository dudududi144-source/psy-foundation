/**
 * BassVocabulary — generation-behavior modes for the bass, NOT step arrays.
 *
 * F21 requirement: bass vocabulary must alter the GENERATION PROCEDURE, not
 * just pick a boolean array. Each mode changes HOW composeBassPlan decides
 * onsets, degrees, durations, and register:
 *
 *   ROLLING     → repeated rhythmic cell + controlled degree movement (root-fifth-root)
 *   SYNCOPATED  → accent displacement + anticipation (off-beat onsets)
 *   MELODIC     → degree contour following the phrase arc
 *   ACID        → repeated pitch centers + chromatic approach behavior
 *   SPARSE      → deliberate silence + longer durations
 *   TENSION     → register expansion + unstable harmonic targets
 *
 * The CompositionEngine reads the active vocabulary and dispatches to the
 * matching generation function. Each function returns BassPlanNote[].
 */

import type { GroovePlan } from './groove-plan.ts'
import type { Rng } from './rng.ts'
import { type Scale, degreeToMidi, scalePcs } from './scales.ts'
import type { BassPlanNote } from './voice-plans.ts'
import type { KickPlan } from './voice-plans.ts'

export interface BassVocabularyContext {
  bar: number
  groove: GroovePlan
  kickPlan: KickPlan
  chordTones: number[]
  tonic: number
  scaleName: string
  scale: Scale
  isLast: boolean
  isAnticipationBar: boolean
  rng: Rng
  /** Max interval width (semitones) — from the learned identity. */
  intervalWidth: number
  /** Syncopation level 0..1 — from the learned identity. */
  syncopation: number
  /** Preferred bass register octave (MIDI octave). */
  bassOctave: number
  /** Tension level 0..1 — drives register expansion. */
  tension: number
}

const BASS_FUNCTIONS: BassPlanNote['function'][] = ['ROOT', 'THIRD', 'FIFTH', 'SEVENTH', 'OCTAVE']

function degreeToBassNote(
  degree: number,
  ctx: BassVocabularyContext
): { midi: number; fn: BassPlanNote['function'] } {
  const midi = degreeToMidi(ctx.tonic, ctx.scale, degree, ctx.bassOctave)
  return { midi, fn: BASS_FUNCTIONS[degree] ?? 'PASSING' }
}

function clampBass(midi: number): number {
  let m = midi
  while (m < 36) m += 12
  while (m > 59) m -= 12
  return m
}

function dedupe(notes: BassPlanNote[]): BassPlanNote[] {
  notes.sort((a, b) => a.step - b.step)
  const out: BassPlanNote[] = []
  for (const n of notes) {
    if (!out.some((d) => d.step === n.step)) out.push(n)
  }
  return out
}

/**
 * ROLLING — repeated rhythmic cell + controlled degree movement.
 *
 * The bass plays a repeating 2- or 3-step cell (e.g., root on beat, fifth on
 * the off, root on next beat) with controlled degree movement. This is the
 * classic psytrance rolling bass — it fills the spaces between kicks with
 * short, tight notes that lock to the kick.
 */
export function rollingBass(ctx: BassVocabularyContext): BassPlanNote[] {
  const notes: BassPlanNote[] = []
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave)
  const fifthMidi = degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave)
  const octaveMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave + 1)

  // Beat 1: ALWAYS ROOT (LOCKED invariant).
  notes.push({ midi: rootMidi, step: 0, durationSteps: 1, function: 'ROOT', isAnticipation: false })

  // Rolling cell: root on each kick step, fifth or octave on the off-beat.
  const kickSet = new Set(ctx.kickPlan.onsets)
  for (const step of ctx.kickPlan.onsets) {
    if (step === 0) continue
    // On kick steps: ROOT (locked).
    notes.push({ midi: rootMidi, step, durationSteps: 1, function: 'ROOT', isAnticipation: false })
    // Off-beat after each kick: fifth or octave (the "rolling" fill).
    const offStep = step + 2
    if (offStep < ctx.groove.stepsPerBar && !kickSet.has(offStep)) {
      if (ctx.rng.next() < 0.6) {
        notes.push({
          midi: fifthMidi,
          step: offStep,
          durationSteps: 1,
          function: 'FIFTH',
          isAnticipation: false,
        })
      } else {
        notes.push({
          midi: octaveMidi,
          step: offStep,
          durationSteps: 1,
          function: 'OCTAVE',
          isAnticipation: false,
        })
      }
    }
  }

  // Cadence on last bar.
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2
    const filtered = notes.filter((n) => n.step < lastStep)
    notes.length = 0
    notes.push(...filtered)
    notes.push({
      midi: fifthMidi,
      step: lastStep,
      durationSteps: 1,
      function: 'CADENCE',
      isAnticipation: false,
    })
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: 'CADENCE',
      isAnticipation: false,
    })
  }

  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })))
}

/**
 * SYNCOPATED — accent displacement + anticipation.
 *
 * The bass plays off-beat onsets with anticipations. It does NOT lock to
 * every kick; instead it places notes on the "and" of beats and anticipates
 * the next kick. This creates a pushing, forward-motion feel.
 */
export function syncopatedBass(ctx: BassVocabularyContext): BassPlanNote[] {
  const notes: BassPlanNote[] = []
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave)
  const fifthMidi = degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave)
  const thirdMidi = degreeToMidi(ctx.tonic, ctx.scale, 2, ctx.bassOctave)
  const seventhMidi = degreeToMidi(ctx.tonic, ctx.scale, 6, ctx.bassOctave)
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4))
  const half = Math.max(1, Math.round(ctx.groove.stepsPerBar / 8))

  // Beat 1: ROOT (locked invariant).
  notes.push({ midi: rootMidi, step: 0, durationSteps: 2, function: 'ROOT', isAnticipation: false })

  // Anticipation: place a bass note 1 step BEFORE each kick (after beat 1).
  const kickSet = new Set(ctx.kickPlan.onsets)
  for (const step of ctx.kickPlan.onsets) {
    if (step === 0) continue
    const antStep = step - 1
    if (antStep > 0 && !kickSet.has(antStep) && !notes.some((n) => n.step === antStep)) {
      const pitch = ctx.rng.next() < 0.5 ? thirdMidi : fifthMidi
      notes.push({
        midi: pitch,
        step: antStep,
        durationSteps: 1,
        function: 'ANTICIPATION',
        isAnticipation: true,
      })
    }
    // On the kick: root or fifth.
    notes.push({ midi: rootMidi, step, durationSteps: 1, function: 'ROOT', isAnticipation: false })
  }

  // Off-beat syncopation: place notes on the "and" of beats 2 and 4.
  const syncopatedSteps = [beat + half, beat * 3 + half]
  for (const step of syncopatedSteps) {
    if (step >= ctx.groove.stepsPerBar) continue
    if (notes.some((n) => n.step === step)) continue
    if (ctx.rng.next() < 0.4 + ctx.syncopation * 0.4) {
      const useSeventh = ctx.rng.next() < 0.3
      notes.push({
        midi: useSeventh ? seventhMidi : fifthMidi,
        step,
        durationSteps: 1,
        function: useSeventh ? 'SEVENTH' : 'FIFTH',
        isAnticipation: false,
      })
    }
  }

  // Cadence on last bar.
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2
    const filtered = notes.filter((n) => n.step < lastStep)
    notes.length = 0
    notes.push(...filtered)
    notes.push({
      midi: fifthMidi,
      step: lastStep,
      durationSteps: 1,
      function: 'CADENCE',
      isAnticipation: false,
    })
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: 'CADENCE',
      isAnticipation: false,
    })
  }

  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })))
}

/**
 * MELODIC — degree contour following the phrase arc.
 *
 * The bass walks a melodic contour through scale degrees, targeting chord
 * tones at phrase boundaries. This is a more melodic, singing bass style.
 */
export function melodicBass(ctx: BassVocabularyContext): BassPlanNote[] {
  const notes: BassPlanNote[] = []
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4))
  const pcs = scalePcs(ctx.tonic, ctx.scale)

  // Degree contour: walk up the scale across the bar.
  const degreeContour = [0, 2, 4, 2] // root → third → fifth → third
  let degIdx = 0

  // Beat 1: ROOT.
  notes.push({
    midi: degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave),
    step: 0,
    durationSteps: 2,
    function: 'ROOT',
    isAnticipation: false,
  })

  // Walk the contour on each beat.
  for (let b = 1; b < 4; b++) {
    const step = b * beat
    if (step >= ctx.groove.stepsPerBar) continue
    const degree = degreeContour[degIdx % degreeContour.length] ?? 0
    degIdx++
    const { midi, fn } = degreeToBassNote(degree, ctx)
    notes.push({ midi, step, durationSteps: 2, function: fn, isAnticipation: false })
  }

  // Passing tone on the off-beat of beat 3.
  const passStep = beat * 2 + Math.max(1, Math.round(beat / 2))
  if (passStep < ctx.groove.stepsPerBar && !notes.some((n) => n.step === passStep)) {
    if (ctx.rng.next() < 0.4) {
      const passDegree = (degreeContour[degIdx % degreeContour.length] ?? 0) + 1
      const { midi } = degreeToBassNote(passDegree % pcs.length, ctx)
      notes.push({
        midi,
        step: passStep,
        durationSteps: 1,
        function: 'PASSING',
        isAnticipation: false,
      })
    }
  }

  // Cadence on last bar.
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2
    const filtered = notes.filter((n) => n.step < lastStep)
    notes.length = 0
    notes.push(...filtered)
    notes.push({
      midi: degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave),
      step: lastStep,
      durationSteps: 1,
      function: 'CADENCE',
      isAnticipation: false,
    })
    notes.push({
      midi: degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave),
      step: lastStep + 1,
      durationSteps: 2,
      function: 'CADENCE',
      isAnticipation: false,
    })
  }

  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })))
}

/**
 * ACID — repeated pitch centers + chromatic approach behavior.
 *
 * The bass repeats a pitch center (root or fifth) with chromatic approach
 * tones from a half-step below. This is the classic acid bassline feel.
 */
export function acidBass(ctx: BassVocabularyContext): BassPlanNote[] {
  const notes: BassPlanNote[] = []
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave)
  const fifthMidi = degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave)
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4))

  // Beat 1: ROOT.
  notes.push({ midi: rootMidi, step: 0, durationSteps: 1, function: 'ROOT', isAnticipation: false })

  // Repeated pitch center with chromatic approach.
  for (let b = 1; b < 4; b++) {
    const step = b * beat
    if (step >= ctx.groove.stepsPerBar) continue
    // Chromatic approach from below, 1 step before the beat.
    const approachStep = step - 1
    if (approachStep > 0 && !notes.some((n) => n.step === approachStep)) {
      notes.push({
        midi: clampBass(rootMidi - 1),
        step: approachStep,
        durationSteps: 1,
        function: 'APPROACH',
        isAnticipation: false,
      })
    }
    // Pitch center: root or fifth (alternating).
    const center = b % 2 === 0 ? fifthMidi : rootMidi
    notes.push({
      midi: center,
      step,
      durationSteps: 1,
      function: b % 2 === 0 ? 'FIFTH' : 'ROOT',
      isAnticipation: false,
    })
  }

  // Extra repeat on the off-beat of beat 4.
  const offStep = beat * 3 + Math.max(1, Math.round(beat / 2))
  if (offStep < ctx.groove.stepsPerBar && !notes.some((n) => n.step === offStep)) {
    if (ctx.rng.next() < 0.6) {
      notes.push({
        midi: clampBass(rootMidi - 1),
        step: offStep,
        durationSteps: 1,
        function: 'APPROACH',
        isAnticipation: false,
      })
    }
  }

  // Cadence on last bar.
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2
    const filtered = notes.filter((n) => n.step < lastStep)
    notes.length = 0
    notes.push(...filtered)
    notes.push({
      midi: fifthMidi,
      step: lastStep,
      durationSteps: 1,
      function: 'CADENCE',
      isAnticipation: false,
    })
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: 'CADENCE',
      isAnticipation: false,
    })
  }

  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })))
}

/**
 * SPARSE — deliberate silence + longer durations.
 *
 * The bass plays fewer notes with longer durations, leaving deliberate space.
 * Used in intros, breakdowns, and sparse sections.
 */
export function sparseBass(ctx: BassVocabularyContext): BassPlanNote[] {
  const notes: BassPlanNote[] = []
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave)
  const fifthMidi = degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave)
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4))

  // Beat 1: ROOT (long duration).
  notes.push({
    midi: rootMidi,
    step: 0,
    durationSteps: beat * 2,
    function: 'ROOT',
    isAnticipation: false,
  })

  // Beat 3: fifth (long duration) — only if not the last bar.
  if (!ctx.isLast) {
    const step = beat * 2
    if (step < ctx.groove.stepsPerBar) {
      notes.push({
        midi: fifthMidi,
        step,
        durationSteps: beat * 2,
        function: 'FIFTH',
        isAnticipation: false,
      })
    }
  }

  // Cadence on last bar.
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2
    const filtered = notes.filter((n) => n.step < lastStep)
    notes.length = 0
    notes.push(...filtered)
    notes.push({
      midi: fifthMidi,
      step: lastStep,
      durationSteps: 1,
      function: 'CADENCE',
      isAnticipation: false,
    })
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: 'CADENCE',
      isAnticipation: false,
    })
  }

  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })))
}

/**
 * TENSION — register expansion + unstable harmonic targets.
 *
 * The bass expands into a higher register and targets unstable tones
 * (seventh, second) to build tension. Used before drops and climaxes.
 */
export function tensionBass(ctx: BassVocabularyContext): BassPlanNote[] {
  const notes: BassPlanNote[] = []
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave)
  const seventhMidi = degreeToMidi(ctx.tonic, ctx.scale, 6, ctx.bassOctave)
  const secondMidi = degreeToMidi(ctx.tonic, ctx.scale, 1, ctx.bassOctave)
  const octaveMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave + 1)
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4))

  // Beat 1: ROOT (locked).
  notes.push({ midi: rootMidi, step: 0, durationSteps: 1, function: 'ROOT', isAnticipation: false })

  // Unstable targets on beats 2 and 3: seventh or second.
  for (let b = 1; b < 3; b++) {
    const step = b * beat
    if (step >= ctx.groove.stepsPerBar) continue
    const useSeventh = ctx.rng.next() < 0.5
    notes.push({
      midi: useSeventh ? seventhMidi : secondMidi,
      step,
      durationSteps: 1,
      function: useSeventh ? 'SEVENTH' : 'PASSING',
      isAnticipation: false,
    })
  }

  // Register expansion: octave jump on beat 4.
  const expStep = beat * 3
  if (expStep < ctx.groove.stepsPerBar) {
    notes.push({
      midi: octaveMidi,
      step: expStep,
      durationSteps: 1,
      function: 'OCTAVE',
      isAnticipation: false,
    })
  }

  // Cadence on last bar — resolve to root.
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2
    const filtered = notes.filter((n) => n.step < lastStep)
    notes.length = 0
    notes.push(...filtered)
    notes.push({
      midi: degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave),
      step: lastStep,
      durationSteps: 1,
      function: 'CADENCE',
      isAnticipation: false,
    })
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: 'CADENCE',
      isAnticipation: false,
    })
  }

  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })))
}

/**
 * Dispatch bass generation to the vocabulary mode. Each mode alters the
 * GENERATION PROCEDURE — this is NOT a step-array lookup.
 */
export function generateBassByVocabulary(
  vocabulary: import('./learned-identity.ts').BassVocabulary,
  ctx: BassVocabularyContext
): BassPlanNote[] {
  switch (vocabulary) {
    case 'ROLLING':
      return rollingBass(ctx)
    case 'SYNCOPATED':
      return syncopatedBass(ctx)
    case 'MELODIC':
      return melodicBass(ctx)
    case 'ACID':
      return acidBass(ctx)
    case 'SPARSE':
      return sparseBass(ctx)
    case 'TENSION':
      return tensionBass(ctx)
    default:
      return rollingBass(ctx)
  }
}

/**
 * Phase 2 Day 3: 16th rolling bass mode.
 *
 * Plays root on EVERY 16th step (16 notes per bar in 4/4).
 * This is the darkpsy/forest signature — dense, driving, relentless.
 *
 * Optional: alternates between root and fifth on every other 16th for
 * more movement (controlled by `alternating` flag).
 */
export function rollingBass16th(ctx: BassVocabularyContext, alternating = false): BassPlanNote[] {
  const notes: BassPlanNote[] = []
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave)
  const fifthMidi = degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave)

  const stepsPerBar = ctx.groove.stepsPerBar
  for (let step = 0; step < stepsPerBar; step++) {
    // Every 16th step gets a note
    const isEvenStep = step % 2 === 0
    const midi = alternating && !isEvenStep ? fifthMidi : rootMidi
    notes.push({
      midi,
      step,
      durationSteps: 1,
      function: step === 0 ? 'ROOT' : 'ROLL',
      isAnticipation: false,
    })
  }

  // Cadence on last bar
  if (ctx.isLast) {
    const lastStep = stepsPerBar - 2
    const filtered = notes.filter((n) => n.step < lastStep)
    notes.length = 0
    notes.push(...filtered)
    notes.push({
      midi: rootMidi,
      step: lastStep,
      durationSteps: 2,
      function: 'CADENCE',
      isAnticipation: false,
    })
  }

  return notes
}
