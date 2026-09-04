/**
 * Phase 2 (task 5-b, D8.1) — the anti-gaming lock.
 *
 * Behavior tests proving the de-gamed AudioCritic metrics RESPOND to the
 * features they claim to measure. Every test is deterministic (seeded Rng —
 * never Math.random). These fail if anyone reintroduces constants, floors,
 * or bucketed returns:
 *   stereoContrast  — mono vs hard-panned content
 *   melodicClarity  — scale-locked melody vs chromatic random walk
 *   motifIdentity   — repeated motif vs fully random sequence
 *   callResponse    — second half echoes the first vs unrelated material
 */
import { describe, expect, test } from 'bun:test'
import { type CriticNoteEvent, critiqueAudio } from '../src/audio/audio-critic.ts'
import { Rng } from '../src/rng.ts'

const SR = 44100
const BPM = 145
const STEPS_PER_BAR = 16

/** One second of 440Hz sine — the carrier the metrics are computed over. */
function sineBuffer(): Float32Array {
  const buf = new Float32Array(SR)
  for (let i = 0; i < SR; i++) buf[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR)
  return buf
}

/** C-minor-pentatonic scale-locked melody: 4 notes per bar, tonic on downbeats. */
function scaleLockedMelody(bars: number): CriticNoteEvent[] {
  const scalePcs = [0, 3, 5, 7, 10]
  const notes: CriticNoteEvent[] = []
  for (let bar = 0; bar < bars; bar++) {
    const cell = [0, 1, 2, 4] // pentatonic degrees; degree 4 wraps to the octave-ish color
    for (let s = 0; s < 4; s++) {
      const pc = scalePcs[cell[s] as number] as number
      notes.push({
        pitchMidi: 60 + pc + (s === 3 && bar % 2 === 1 ? 12 : 0),
        startStep: bar * STEPS_PER_BAR + s * 3,
        velocity: 0.7,
      })
    }
  }
  return notes
}

/** Chromatic random walk: uniform pitches over ~2.5 octaves (all 12 classes). */
function randomWalkMelody(noteCount: number, seed: number): CriticNoteEvent[] {
  const rng = new Rng(seed)
  const notes: CriticNoteEvent[] = []
  for (let i = 0; i < noteCount; i++) {
    notes.push({
      pitchMidi: 48 + rng.int(0, 29), // spans all 12 pitch classes
      startStep: i * 2,
      velocity: 0.7,
    })
  }
  return notes
}

describe('Phase 2 responsiveness — stereoContrast (was hardcoded 0.5)', () => {
  test('mono (L === R) measures near 0', () => {
    const buf = sineBuffer()
    const c = critiqueAudio(buf, SR, BPM, STEPS_PER_BAR, {
      stereo: { left: buf, right: buf },
    })
    expect(c.mix.stereoContrast).not.toBeNull()
    expect(c.mix.stereoContrast as number).toBeLessThan(0.05)
  })

  test('hard-panned content measures significantly higher', () => {
    const left = sineBuffer()
    const right = new Float32Array(left.length) // silence in R → fully panned
    const c = critiqueAudio(left, SR, BPM, STEPS_PER_BAR, {
      stereo: { left, right },
    })
    expect(c.mix.stereoContrast as number).toBeGreaterThan(0.9)
  })

  test('without stereo input the metric is honestly null (no constant substitute)', () => {
    const c = critiqueAudio(sineBuffer(), SR, BPM, STEPS_PER_BAR)
    expect(c.mix.stereoContrast).toBeNull()
    // overallScore must stay a finite number in [0,1] (null excluded, not zeroed)
    expect(Number.isFinite(c.overallScore)).toBe(true)
    expect(c.overallScore).toBeGreaterThanOrEqual(0)
    expect(c.overallScore).toBeLessThanOrEqual(1)
  })
})

describe('Phase 2 responsiveness — melodicClarity (was centroid buckets 0.7/0.4/0.2)', () => {
  test('scale-locked melody scores clearly higher than a chromatic random walk', () => {
    const locked = scaleLockedMelody(8)
    const walk = randomWalkMelody(32, 4242)
    const cLocked = critiqueAudio(sineBuffer(), SR, BPM, STEPS_PER_BAR, { notes: locked })
    const cWalk = critiqueAudio(sineBuffer(), SR, BPM, STEPS_PER_BAR, { notes: walk })
    const a = cLocked.lead.melodicClarity
    const b = cWalk.lead.melodicClarity
    expect(a).toBeGreaterThan(0.4) // scale-locked material is clear
    expect(b).toBeLessThan(0.2) // chromatic randomness is not
    expect(a - b).toBeGreaterThan(0.2) // clear separation, not noise
  })
})

describe('Phase 2 responsiveness — motifIdentity (was uniformity × 1.5)', () => {
  test('a sequence containing a repeated motif scores clearly higher than a fully random one', () => {
    // 4-note cell repeated in every bar (identical pitch-class + in-bar step).
    const cellPcs = [0, 3, 5, 7]
    const cellSteps = [0, 2, 4, 6]
    const repeated: CriticNoteEvent[] = []
    for (let bar = 0; bar < 8; bar++) {
      for (let i = 0; i < 4; i++) {
        repeated.push({
          pitchMidi: 60 + (cellPcs[i] as number),
          startStep: bar * STEPS_PER_BAR + (cellSteps[i] as number),
          velocity: 0.7,
        })
      }
    }
    // Fully random: random pitch AND random in-bar step per note.
    const rng = new Rng(777)
    const randomNotes: CriticNoteEvent[] = []
    for (let bar = 0; bar < 8; bar++) {
      for (let i = 0; i < 4; i++) {
        randomNotes.push({
          pitchMidi: 48 + rng.int(0, 29),
          startStep: bar * STEPS_PER_BAR + rng.int(0, STEPS_PER_BAR - 1),
          velocity: 0.7,
        })
      }
    }
    const cRepeated = critiqueAudio(sineBuffer(), SR, BPM, STEPS_PER_BAR, { notes: repeated })
    const cRandom = critiqueAudio(sineBuffer(), SR, BPM, STEPS_PER_BAR, { notes: randomNotes })
    const a = cRepeated.musicality.motifIdentity
    const b = cRandom.musicality.motifIdentity
    expect(a).toBeGreaterThan(0.5) // the motif returns every bar
    expect(b).toBeLessThan(0.2) // through-random has no identity
    expect(a - b).toBeGreaterThan(0.3)
  })
})

describe('Phase 2 responsiveness — callResponse (was corr × 2 + 0.3 floor)', () => {
  test('a second phrase that echoes the first scores clearly higher than unrelated material', () => {
    // Call (first 4 bars): 8 notes. Response (last 4 bars): the SAME rhythm,
    // the SAME pitches, the SAME velocities — an echo.
    const callPcs = [0, 3, 5, 7, 10, 7, 5, 3]
    const echoed: CriticNoteEvent[] = []
    for (let half = 0; half < 2; half++) {
      for (let i = 0; i < 8; i++) {
        echoed.push({
          pitchMidi: 60 + (callPcs[i] as number),
          startStep: half * 4 * STEPS_PER_BAR + i * 2,
          velocity: 0.5 + (i % 3) * 0.2,
        })
      }
    }
    // Unrelated: independent random rhythm, pitches and velocities per note.
    const rng = new Rng(9001)
    const unrelated: CriticNoteEvent[] = []
    for (let i = 0; i < 16; i++) {
      unrelated.push({
        pitchMidi: 48 + rng.int(0, 29),
        startStep: Math.floor(i / 2) * STEPS_PER_BAR + rng.int(0, STEPS_PER_BAR - 1),
        velocity: rng.range(0.2, 1),
      })
    }
    const cEcho = critiqueAudio(sineBuffer(), SR, BPM, STEPS_PER_BAR, { notes: echoed })
    const cUnrelated = critiqueAudio(sineBuffer(), SR, BPM, STEPS_PER_BAR, { notes: unrelated })
    const a = cEcho.musicality.callResponse
    const b = cUnrelated.musicality.callResponse
    expect(a).toBeGreaterThan(0.7) // the response echoes the call
    expect(b).toBeLessThan(0.3) // no echo relationship (was floored at 0.3!)
    expect(a - b).toBeGreaterThan(0.4)
  })
})
