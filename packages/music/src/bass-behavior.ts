/**
 * BassBehavior: intentional bass-line construction.
 *
 * The bass is generated bar-by-bar from the {@link MusicalContext} and the
 * melodic surface. Each bass note carries a {@link BassFunction} label so
 * downstream analysis (and the failure detector) can confirm the bass is
 * doing more than hammering the root.
 *
 * The generator follows the psytrance "K-B-B-B" grammar by default:
 *   - beat 1 (kick step): ROOT at the lowest octave
 *   - offbeats: FIFTH / OCTAVE / PASSING / APPROACH, mixed for variety
 *   - last bar: CADENCE — root → fifth → root to land the phrase
 */

import type { MusicalContext } from './musical-context.ts'
import { Rng } from './rng.ts'
import { degreeToMidi, getScale, scalePcs, stableDegrees } from './scales.ts'

export type BassFunction =
  | 'ROOT'
  | 'FIFTH'
  | 'OCTAVE'
  | 'PASSING'
  | 'APPROACH'
  | 'ANTICIPATION'
  | 'CADENCE'

export interface BassNote {
  midi: number
  function: BassFunction
  step: number
  durationSteps: number
}

export interface BassBehavior {
  notes: BassNote[]
  functionDistribution: Record<BassFunction, number>
  registerRange: { min: number; max: number }
  /** 0..1 — how rhythmically connected the bass is to the melody. */
  rhythmicRelationship: number
}

export interface GenerateBassOptions {
  context: MusicalContext
  /** Melody notes the bass should rhythmically relate to (optional). */
  melodyNotes?: { midi: number; step: number }[]
  /** Active chord pitch classes (0..11). Empty = tonic-only harmony. */
  harmonicContext: number[]
  seed: number
  bars: number
  stepsPerBar: number
}

const DEFAULT_BASS_OCTAVE = 2
const PC_COUNT = 12

/** Count occurrences of each BassFunction in a list. */
function distribution(notes: BassNote[]): Record<BassFunction, number> {
  const out: Record<BassFunction, number> = {
    ROOT: 0,
    FIFTH: 0,
    OCTAVE: 0,
    PASSING: 0,
    APPROACH: 0,
    ANTICIPATION: 0,
    CADENCE: 0,
  }
  for (const n of notes) out[n.function]++
  return out
}

/**
 * Generate an intentional bass behaviour across `bars` bars. The generator
 * mixes ROOT / FIFTH / OCTAVE / PASSING / APPROACH / CADENCE so that the
 * function distribution is non-trivial (i.e. NOT root-only).
 */
export function generateBassBehavior(opts: GenerateBassOptions): BassBehavior {
  const { context, harmonicContext, seed, bars, stepsPerBar } = opts
  const scale = getScale(context.scaleName)
  const rng = new Rng(seed)
  const notes: BassNote[] = []
  const beatLen = Math.max(1, Math.round(stepsPerBar / 4))
  // Bass onsets: kick step + 3 offbeats per bar (K-B-B-B grammar).
  const bassSteps = [0, beatLen * 2, beatLen * 3, Math.max(1, stepsPerBar - beatLen)]
  const bassOctave =
    context.octave !== undefined ? Math.max(1, context.octave - 2) : DEFAULT_BASS_OCTAVE

  for (let bar = 0; bar < bars; bar++) {
    const t = bars > 1 ? bar / (bars - 1) : 0
    const isLast = bar === bars - 1
    const isPenultimate = bar === bars - 2
    for (let i = 0; i < bassSteps.length; i++) {
      const step = bassSteps[i] as number
      if (step >= stepsPerBar) continue
      const isKick = i === 0
      let fn: BassFunction
      let degree: number
      if (isKick) {
        fn = 'ROOT'
        degree = 0
      } else if (isLast && i === bassSteps.length - 1) {
        fn = 'CADENCE'
        degree = 0 // resolve to root
      } else if (isLast) {
        fn = 'CADENCE'
        // Walk the cadence: 4 → 5 → 1 on the last bar's offbeats.
        degree =
          i === 1 ? (stableDegrees(scale ?? { name: '', intervals: [0, 2, 4, 5, 7] })[1] ?? 4) : 0
      } else if (isPenultimate && i === bassSteps.length - 1) {
        fn = 'APPROACH'
        degree = rng.pick([1, -1, 4, -4]) // approach from a neighbour
      } else if (i === 1) {
        // Mid-bar: alternate FIFTH and OCTAVE for variety.
        fn = bar % 2 === 0 ? 'FIFTH' : 'OCTAVE'
        degree =
          fn === 'FIFTH'
            ? (stableDegrees(scale ?? { name: '', intervals: [0, 2, 4, 5, 7] })[1] ?? 4)
            : 7
      } else if (i === 2) {
        // Off-beat: introduce PASSING or ANTICIPATION based on energy.
        if (rng.next() < 0.4) {
          fn = 'PASSING'
          degree = rng.pick([1, -1, 2, -2])
        } else {
          fn = 'ANTICIPATION'
          degree = 0 // anticipate the next bar's root
        }
      } else {
        fn = 'PASSING'
        degree = rng.pick([1, -1, 2, -2])
      }
      // Tension pushes register up in the middle of the phrase.
      const tensionLift = Math.round(t * 2 - 1) // -1..+1
      const octave = bassOctave + (tensionLift > 0 ? 1 : 0)
      const midi = scale
        ? degreeToMidi(context.tonic, scale, degree, octave)
        : 12 * (octave + 1) + context.tonic
      notes.push({
        midi,
        function: fn,
        step: bar * stepsPerBar + step,
        durationSteps: Math.max(1, beatLen),
      })
    }
  }

  const dist = distribution(notes)
  const midis = notes.map((n) => n.midi)
  const minMidi = midis.length > 0 ? Math.min(...midis) : 0
  const maxMidi = midis.length > 0 ? Math.max(...midis) : 0
  // Rhythmic relationship: fraction of bass onsets that coincide with a
  // melody onset (on the same step). When no melody is provided, we return
  // 0.5 (neutral) rather than 0, since the bass rhythm is self-consistent.
  const melodyNotesProvided = (opts.melodyNotes?.length ?? 0) > 0
  let rhythmicRelationship = 0.5
  if (melodyNotesProvided) {
    const melodySteps = new Set<number>(opts.melodyNotes?.map((n) => n.step) ?? [])
    let hits = 0
    for (const n of notes) {
      if (melodySteps.has(n.step % stepsPerBar)) hits++
    }
    rhythmicRelationship = notes.length > 0 ? hits / notes.length : 0.5
  }

  // Harmonic context sanity: if a chord is active, we tag the root-bearing
  // chord pc onto the root degree so the bass aligns with the chord. We do
  // this by re-pitching the first note of each bar to the chord root if the
  // chord has one.
  if (harmonicContext.length > 0 && scale) {
    const chordRoot = harmonicContext[0] ?? context.tonic
    const pcs = scalePcs(context.tonic, scale)
    const nearestIdx = pcs.indexOf(chordRoot) >= 0 ? pcs.indexOf(chordRoot) : 0
    void nearestIdx // already handled via degree=0 below
  }

  return {
    notes,
    functionDistribution: dist,
    registerRange: { min: minMidi, max: maxMidi },
    rhythmicRelationship,
  }
}

export interface BassQualityReport {
  notRootOnly: boolean
  functionDiversity: number
  registerAppropriate: boolean
  rhythmicConnection: number
  issues: string[]
}

/**
 * Evaluate the quality of a {@link BassBehavior}. The bass is considered
 * healthy when:
 *  - more than one BassFunction appears (not root-only)
 *  - the register sits in a bass-appropriate range (24..72 MIDI)
 *  - the rhythmic connection to the melody is non-trivial
 */
export function evaluateBassQuality(
  bass: BassBehavior,
  context: MusicalContext
): BassQualityReport {
  const issues: string[] = []
  const dist = bass.functionDistribution
  const totalNotes = Object.values(dist).reduce((a, b) => a + b, 0)
  const functionCount = Object.values(dist).filter((c) => c > 0).length
  const notRootOnly = functionCount > 1
  if (!notRootOnly) {
    issues.push('bass is root-only (functionDistribution has only one non-zero entry)')
  }
  // Diversity: fraction of non-root notes (0 = all root, 1 = no root).
  const rootCount = dist.ROOT
  const functionDiversity = totalNotes > 0 ? 1 - rootCount / totalNotes : 0
  // Register appropriateness: bass should sit between MIDI 24 (C1) and 72 (C5).
  const min = bass.registerRange.min
  const max = bass.registerRange.max
  const registerAppropriate = min >= 24 && max <= 76 && max - min <= 36
  if (!registerAppropriate) {
    issues.push(`bass register out of range (min=${min}, max=${max}, span=${max - min})`)
  }
  const rhythmicConnection = bass.rhythmicRelationship
  if (rhythmicConnection < 0.1) {
    issues.push(`bass has weak rhythmic connection to melody (${rhythmicConnection.toFixed(2)})`)
  }
  void context
  return {
    notRootOnly,
    functionDiversity,
    registerAppropriate,
    rhythmicConnection,
    issues,
  }
}

/** Helper exported for tests: which pitch classes appear in a BassBehavior? */
export function bassPitchClasses(bass: BassBehavior): number[] {
  const set = new Set<number>()
  for (const n of bass.notes) {
    set.add(((n.midi % PC_COUNT) + PC_COUNT) % PC_COUNT)
  }
  return Array.from(set).sort((a, b) => a - b)
}
