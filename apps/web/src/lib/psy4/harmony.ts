/**
 * Harmony Engine — ported from PSYSTAR (src/domain/harmony.ts)
 *
 * Provides scale/chord knowledge for the PSY family.
 * 7 scales, 7 chord types, diatonic chord generation, progression building.
 *
 * This is a pure-math module: no audio, no state, no side effects.
 * Deterministic: same input → same output.
 */

export type ScaleType =
  | 'major'
  | 'naturalMinor'
  | 'pentatonicMajor'
  | 'pentatonicMinor'
  | 'dorian'
  | 'phrygian'
  | 'phrygianDominant'
  | 'mixolydian'

export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
}

export type ChordType = 'maj' | 'min' | 'dim' | 'aug' | 'maj7' | 'min7' | 'dom7' | 'sus4' | 'power'

export const CHORD_INTERVALS: Record<ChordType, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  sus4: [0, 5, 7],
  power: [0, 7],
}

export interface Chord {
  root: number // MIDI note
  type: ChordType
  notes: number[] // MIDI notes
  name: string // e.g. "Am7"
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToNoteName(midi: number): string {
  const clamped = Math.max(0, Math.min(127, Math.floor(midi)))
  return NOTE_NAMES[clamped % 12]!
}

export function buildScale(rootMidi: number, scaleType: ScaleType): number[] {
  const intervals = SCALE_INTERVALS[scaleType]
  return intervals.map((i) => rootMidi + i)
}

export function buildScaleSpanning(
  rootMidi: number,
  scaleType: ScaleType,
  octaves: number
): number[] {
  const notes: number[] = []
  const span = Math.max(1, Math.floor(octaves))
  for (let o = 0; o < span; o++) {
    const base = rootMidi + o * 12
    const intervals = SCALE_INTERVALS[scaleType]
    for (const i of intervals) notes.push(base + i)
  }
  return notes
}

export function buildChord(rootMidi: number, chordType: ChordType): number[] {
  return CHORD_INTERVALS[chordType].map((i) => rootMidi + i)
}

export function buildChordNamed(rootMidi: number, chordType: ChordType): Chord {
  const notes = buildChord(rootMidi, chordType)
  const rootName = midiToNoteName(rootMidi)
  const typeSuffix: Record<ChordType, string> = {
    maj: '',
    min: 'm',
    dim: 'dim',
    aug: 'aug',
    maj7: 'maj7',
    min7: 'm7',
    dom7: '7',
    sus4: 'sus4',
    power: '5',
  }
  return { root: rootMidi, type: chordType, notes, name: rootName + typeSuffix[chordType] }
}

/**
 * Diatonic chord: build chord from scale degree in a given scale.
 * degree 0 = I, 1 = II, 2 = III, etc.
 */
export function diatonicChord(rootMidi: number, scaleType: ScaleType, degree: number): Chord {
  const scale = buildScale(rootMidi, scaleType)
  const deg = degree % scale.length
  const chordRoot = scale[deg]!

  // Determine chord quality from intervals
  const third = scale[(deg + 2) % scale.length]! - chordRoot
  const fifth = scale[(deg + 4) % scale.length]! - chordRoot
  const seventh = scale[(deg + 6) % scale.length]! - chordRoot

  // Normalize intervals to 0-11
  const normThird = ((third % 12) + 12) % 12
  const normFifth = ((fifth % 12) + 12) % 12
  const normSeventh = ((seventh % 12) + 12) % 12

  let type: ChordType
  if (normThird === 4 && normFifth === 7 && normSeventh === 11) type = 'maj7'
  else if (normThird === 3 && normFifth === 7 && normSeventh === 10) type = 'min7'
  else if (normThird === 3 && normFifth === 6) type = 'dim'
  else if (normThird === 3 && normFifth === 7) type = 'min'
  else type = 'maj'

  return buildChordNamed(chordRoot, type)
}

/**
 * Build a chord progression from degree sequence.
 * e.g. [0, 5, 3, 4] → I-vi-IV-V (classic pop)
 */
export function buildProgression(
  rootMidi: number,
  scaleType: ScaleType,
  degrees: number[]
): Chord[] {
  return degrees.map((deg) => diatonicChord(rootMidi, scaleType, deg))
}

/**
 * Common psytrance progressions.
 */
export const PSYTRANCE_PROGRESSIONS: Record<string, number[]> = {
  hypnotic: [0, 0, 0, 0], // I-I-I-I (drone)
  dark: [0, 1, 0, 1], // I-II-I-II (Phrygian)
  uplifting: [0, 5, 3, 4], // I-vi-IV-V
  epic: [0, 3, 5, 4], // I-IV-vi-V
  classic: [0, 4, 5, 3], // I-V-vi-IV
  minor: [0, 5, 3, 4], // i-VI-III-VII (minor)
  'psy-dominant': [0, 1, 0, 6], // I-II-I-VII (Phrygian dominant)
}

/**
 * Convert MIDI note to frequency.
 */
export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/**
 * Convert frequency to MIDI note.
 */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
}

/**
 * Get the closest note in a scale to a given MIDI note.
 */
export function snapToScale(midi: number, scale: number[]): number {
  if (scale.length === 0) return midi
  let closest = scale[0]!
  let minDist = Math.abs(midi - closest)
  for (const n of scale) {
    const dist = Math.abs(midi - n)
    if (dist < minDist) {
      minDist = dist
      closest = n
    }
  }
  return closest
}
