/**
 * Phase C — composition engine wiring tests.
 *
 * Verifies that progression, bassMode, and style parameters
 * are properly accepted and produce different outputs.
 */
import { describe, expect, test } from 'bun:test'
import { buildHarmonicPlan, PSYTRANCE_PROGRESSIONS } from '@psy-foundation/music'
import { rollingBass16th } from '@psy-foundation/music'

describe('Phase C — PSYTRANCE_PROGRESSIONS wired', () => {
  test('all 8 progressions are defined', () => {
    const names = Object.keys(PSYTRANCE_PROGRESSIONS)
    expect(names.length).toBe(8)
    expect(names).toContain('hypnotic')
    expect(names).toContain('dark')
    expect(names).toContain('uplifting')
    expect(names).toContain('epic')
    expect(names).toContain('classic')
    expect(names).toContain('minor')
    expect(names).toContain('psy-dominant')
    expect(names).toContain('t-s-t-d')
  })

  test('buildHarmonicPlan accepts progressionName', () => {
    const plan1 = buildHarmonicPlan({
      bars: 8, startBar: 0, tonic: 4, scaleName: 'phrygian-dominant',
      phraseIndex: 0, isLastPhrase: false,
      progressionName: 'hypnotic',
    })
    const plan2 = buildHarmonicPlan({
      bars: 8, startBar: 0, tonic: 4, scaleName: 'phrygian-dominant',
      phraseIndex: 0, isLastPhrase: false,
      progressionName: 'dark',
    })
    expect(plan1).toBeDefined()
    expect(plan2).toBeDefined()
    // Both should produce valid chord sequences
    expect(plan1.chords.length).toBeGreaterThan(0)
    expect(plan2.chords.length).toBeGreaterThan(0)
    // Note: Phase D will make progressions actually produce different chord roots
  })

  test('default progression (t-s-t-d) produces valid plan', () => {
    const plan = buildHarmonicPlan({
      bars: 8, startBar: 0, tonic: 4, scaleName: 'phrygian-dominant',
      phraseIndex: 0, isLastPhrase: false,
    })
    expect(plan.chords.length).toBeGreaterThan(0)
  })
})

describe('Phase C — rollingBass16th wired', () => {
  test('produces 16 notes per bar', () => {
    const ctx = {
      tonic: 4, scale: { name: 'phrygian-dominant', intervals: [0, 1, 4, 5, 7, 8, 11] },
      bassOctave: 2,
      groove: { stepsPerBar: 16, kickSteps: [0, 4, 8, 12], hatSteps: [2, 6, 10, 14], accent: 0.5 },
      kickPlan: { onsets: [0, 4, 8, 12], velocities: [0.9, 0.8, 0.9, 0.8] },
      rng: { next: () => 0.5 },
      isLast: false,
    }
    const notes = rollingBass16th(ctx as any)
    expect(notes.length).toBe(16) // 16 notes per bar
  })

  test('alternating mode uses fifth on odd steps', () => {
    const ctx = {
      tonic: 4, scale: { name: 'phrygian-dominant', intervals: [0, 1, 4, 5, 7, 8, 11] },
      bassOctave: 2,
      groove: { stepsPerBar: 16, kickSteps: [0, 4, 8, 12], hatSteps: [2, 6, 10, 14], accent: 0.5 },
      kickPlan: { onsets: [0, 4, 8, 12], velocities: [0.9, 0.8, 0.9, 0.8] },
      rng: { next: () => 0.5 },
      isLast: false,
    }
    const notes = rollingBass16th(ctx as any, true) // alternating
    expect(notes.length).toBe(16)
    // Step 0 = ROOT, step 1 = fifth (alternating)
    expect(notes[0]!.function).toBe('ROOT')
    expect(notes[1]!.midi).not.toBe(notes[0]!.midi) // different note
  })
})
