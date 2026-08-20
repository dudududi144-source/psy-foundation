/**
 * HarmonicClassifier: classify MIDI notes against a tonal + chordal context.
 *
 * Each note is assigned a {@link NoteHarmonicFunction}:
 *  - CHORD_TONE          — note's pitch class is in the active chord
 *  - STABLE_SCALE_TONE   — note is the root, 3rd, or 5th of the scale
 *                          (and not already a chord tone)
 *  - PASSING_TONE        — non-stable scale tone that moves by step
 *  - TENSION             — non-stable, non-chord, non-passing (e.g. leaps
 *                          or out-of-scale colour tones)
 *  - RESOLUTION          — a stable tone that immediately follows a tension
 *                          or passing tone in a sequence
 *
 * The classifier is intentionally cheap (no DSP, no machine learning): it
 * answers "does this note belong, and how?" against a static tonal frame.
 */

import { type Scale, getScale, scalePcs, stableDegrees } from './scales.ts'

export type NoteHarmonicFunction =
  | 'CHORD_TONE'
  | 'STABLE_SCALE_TONE'
  | 'PASSING_TONE'
  | 'TENSION'
  | 'RESOLUTION'

export interface HarmonicAnalysis {
  /** MIDI note that was classified. */
  note: number
  function: NoteHarmonicFunction
  isChordTone: boolean
  isScaleTone: boolean
  /** Chord tone or stable scale tone (root / 3rd / 5th of the scale). */
  isStable: boolean
  /** Non-chord, non-stable. */
  isTension: boolean
  /** If this is a tension that resolves, the MIDI note it resolves to. */
  resolvesTo?: number
}

export interface HarmonicClassifierOptions {
  /** Tonic pitch class 0..11. */
  tonic: number
  /** Scale name (matches {@link Scale.name} or one of its aliases). */
  scaleName: string
  /** Optional active chord pitch classes (0..11 each). */
  chord?: number[]
}

const PC_COUNT = 12

function pcOf(midi: number): number {
  return ((midi % PC_COUNT) + PC_COUNT) % PC_COUNT
}

/** Pitch-class distance along the circle, in [0, 6]. */
function pcDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % PC_COUNT
  return Math.min(d, PC_COUNT - d)
}

export class HarmonicClassifier {
  private readonly tonic: number
  private readonly scaleName: string
  private readonly scale: Scale | null
  private readonly chordPcs: Set<number>
  private readonly scalePcs: Set<number>
  private readonly stablePcs: Set<number>

  constructor(opts: HarmonicClassifierOptions) {
    this.tonic = opts.tonic
    this.scaleName = opts.scaleName
    this.scale = getScale(opts.scaleName)
    this.chordPcs = new Set(opts.chord ?? [])
    this.scalePcs = new Set(this.scale ? scalePcs(this.tonic, this.scale) : [])
    this.stablePcs = new Set(this.computeStablePcs())
  }

  /** Classify a single MIDI note against the static tonal frame. */
  classify(note: number): HarmonicAnalysis {
    const pc = pcOf(note)
    const isChordTone = this.chordPcs.has(pc)
    const isScaleTone = this.scalePcs.has(pc)
    const isStable = this.stablePcs.has(pc) || isChordTone
    const isTension = !isChordTone && !isStable

    let func: NoteHarmonicFunction
    if (isChordTone) {
      func = 'CHORD_TONE'
    } else if (isStable) {
      func = 'STABLE_SCALE_TONE'
    } else if (isScaleTone) {
      // Non-stable scale tone: default to PASSING_TONE — sequence analysis
      // may later upgrade adjacent RESOLUTION labels.
      func = 'PASSING_TONE'
    } else {
      func = 'TENSION'
    }

    return {
      note,
      function: func,
      isChordTone,
      isScaleTone,
      isStable,
      isTension,
    }
  }

  /**
   * Classify a sequence of MIDI notes. Notes that follow a tension / passing
   * tone and are themselves stable are re-labelled RESOLUTION, and the
   * preceding tension's `resolvesTo` is set to this note's MIDI value.
   */
  classifySequence(notes: number[]): HarmonicAnalysis[] {
    const out = notes.map((n) => this.classify(n))
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1]
      const cur = out[i]
      if (!prev) continue
      if (!cur) continue
      const prevTense = prev.isTension || prev.function === 'PASSING_TONE'
      // Resolutions must move by step (≤ 2 semitones) — large leaps out of
      // tension are not authentic resolutions.
      const movesByStep = Math.abs(cur.note - prev.note) <= 2
      if (prevTense && cur.isStable && movesByStep) {
        cur.function = 'RESOLUTION'
        prev.resolvesTo = cur.note
      }
    }
    return out
  }

  /** Active chord pitch classes (0..11). */
  getChordTones(): number[] {
    return Array.from(this.chordPcs).sort((a, b) => a - b)
  }

  /** Stable scale tones (root + closest-to-fifth degree), 0..11. */
  getStableTones(): number[] {
    return Array.from(this.stablePcs).sort((a, b) => a - b)
  }

  /** Scale tones that are not stable (i.e. available for tension / passing). */
  getTensionTones(): number[] {
    const out: number[] = []
    for (const pc of this.scalePcs) {
      if (!this.stablePcs.has(pc)) out.push(pc)
    }
    return out.sort((a, b) => a - b)
  }

  /**
   * Compute the stable pitch-class set: root, 3rd, and 5th of the scale
   * (degrees 0, 2, 4 for 7-note scales). For shorter scales, includes root
   * and the degree closest to a perfect fifth. Always includes the tonic.
   */
  private computeStablePcs(): number[] {
    if (!this.scale) return [this.tonic % PC_COUNT]
    const pcs = scalePcs(this.tonic, this.scale)
    const intervals = this.scale.intervals
    const out = new Set<number>()
    // Root (degree 0).
    out.add(pcs[0] ?? this.tonic % PC_COUNT)
    // 3rd (degree 2) — only if the scale has at least 3 degrees.
    if (intervals.length >= 3) {
      out.add(pcs[2] ?? 0)
    }
    // 5th (degree 4) — only if the scale has at least 5 degrees; otherwise
    // use the degree closest to a perfect fifth (interval class 7).
    if (intervals.length >= 5) {
      out.add(pcs[4] ?? 0)
    } else {
      const stable = stableDegrees(this.scale)
      for (const d of stable) {
        out.add(pcs[d % pcs.length] ?? 0)
      }
    }
    // Always include the tonic explicitly.
    out.add(this.tonic % PC_COUNT)
    return Array.from(out).sort((a, b) => a - b)
  }
}

/**
 * Standalone helper: how strongly does `note` belong to `contextPcs`?
 * Returns 1 for an exact match, decaying linearly to 0 at distance 6
 * (the tritone) on the circle of fifths-equivalent pitch-class distance.
 */
export function pitchClassMembership(note: number, contextPcs: number[]): number {
  if (contextPcs.length === 0) return 0.5
  const pc = pcOf(note)
  let best = 6
  for (const cpc of contextPcs) {
    const d = pcDistance(pc, cpc)
    if (d < best) best = d
  }
  return 1 - best / 6
}
