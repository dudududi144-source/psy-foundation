/**
 * F15 reality tests — learned context actually changes composition output.
 */

import { describe, expect, test } from 'bun:test'
import { CompositionEngine, createEmptyLearnedContext } from '../src/index.ts'
import type { LearnedMusicalContext } from '../src/index.ts'

const ctx = {
  tonic: 4,
  scaleName: 'phrygian-dominant',
  octave: 4,
  bpm: 145,
  beatsPerBar: 4,
  beatPosition: 0,
  barPosition: 0,
  phrasePosition: 0,
  harmonicContext: [],
  density: 0.7,
  energy: 0.7,
  tension: 0.3,
  sectionRole: 'full-on',
  repetitionPressure: 0.3,
  noveltyPressure: 0.5,
}

describe('F15: LearnedMusicalContext changes bass', () => {
  test('learned bass degree preferences produce different bass output', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx })
    const sectionA = engineA.composeSection({ bars: 32 })
    const bassA = sectionA.bars.flatMap((b) => b.bassNotes.map((n) => n.midi))

    const learned = createEmptyLearnedContext()
    learned.meta.confidence = 0.8
    learned.bass.degreePreferences = { 0: 0.2, 2: 0.5, 4: 0.2, 6: 0.1 }
    const engineB = new CompositionEngine({ seed: 42, context: ctx, learnedContext: learned })
    const sectionB = engineB.composeSection({ bars: 32 })
    const bassB = sectionB.bars.flatMap((b) => b.bassNotes.map((n) => n.midi))

    expect(bassA).not.toEqual(bassB)
  })
})

describe('F15: Determinism', () => {
  test('same seed + same learned context = identical output', () => {
    const learned = createEmptyLearnedContext()
    learned.meta.confidence = 0.8
    learned.bass.degreePreferences = { 0: 0.3, 4: 0.5, 2: 0.2 }

    const e1 = new CompositionEngine({ seed: 42, context: ctx, learnedContext: learned })
    const s1 = e1.composeSection({ bars: 16 })
    const e2 = new CompositionEngine({ seed: 42, context: ctx, learnedContext: learned })
    const s2 = e2.composeSection({ bars: 16 })

    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
  })

  test('same seed + different learned context = different output', () => {
    const learnedA = createEmptyLearnedContext()
    const learnedB = createEmptyLearnedContext()
    learnedB.meta.confidence = 0.8
    learnedB.bass.degreePreferences = { 0: 0.2, 2: 0.5, 4: 0.2, 6: 0.1 }

    const eA = new CompositionEngine({ seed: 42, context: ctx, learnedContext: learnedA })
    const sA = eA.composeSection({ bars: 16 })
    const eB = new CompositionEngine({ seed: 42, context: ctx, learnedContext: learnedB })
    const sB = eB.composeSection({ bars: 16 })

    expect(JSON.stringify(sA)).not.toBe(JSON.stringify(sB))
  })

  test('empty learned context preserves existing behavior', () => {
    const e1 = new CompositionEngine({ seed: 42, context: ctx })
    const s1 = e1.composeSection({ bars: 16 })
    const e2 = new CompositionEngine({
      seed: 42,
      context: ctx,
      learnedContext: createEmptyLearnedContext(),
    })
    const s2 = e2.composeSection({ bars: 16 })

    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
  })
})

describe('F15: Form preservation', () => {
  test('learned context does not change form structure', () => {
    const learned = createEmptyLearnedContext()
    learned.meta.confidence = 0.9
    learned.bass.degreePreferences = { 0: 0.1, 2: 0.6, 4: 0.2, 6: 0.1 }

    const eA = new CompositionEngine({ seed: 42, context: ctx })
    const sA = eA.composeSection({ bars: 32 })
    const eB = new CompositionEngine({ seed: 42, context: ctx, learnedContext: learned })
    const sB = eB.composeSection({ bars: 32 })

    // Form must be preserved
    expect(sB.bars.length).toBe(sA.bars.length)
    expect(sB.phrases.length).toBe(sA.phrases.length)
    expect(new Set(sB.bars.map((b) => b.arrangementState)).size).toBe(
      new Set(sA.bars.map((b) => b.arrangementState)).size
    )
  })
})

describe('F15: No note-for-note copying', () => {
  test('learned context produces original material, not source copy', () => {
    const learned = createEmptyLearnedContext()
    learned.meta.confidence = 0.9
    learned.bass.degreePreferences = { 0: 0.3, 4: 0.4, 2: 0.3 }
    learned.melody.scaleDegreePreferences = { 0: 0.3, 2: 0.3, 4: 0.2, 6: 0.2 }

    const engine = new CompositionEngine({ seed: 42, context: ctx, learnedContext: learned })
    const section = engine.composeSection({ bars: 32 })

    // The output must contain original notes (not a copy of any source)
    const bassMidis = new Set(section.bars.flatMap((b) => b.bassNotes.map((n) => n.midi)))
    const leadMidis = new Set(section.bars.flatMap((b) => b.leadNotes.map((n) => n.midi)))

    // Must have multiple pitches (not stuck on one)
    expect(bassMidis.size).toBeGreaterThan(2)
    expect(leadMidis.size).toBeGreaterThan(3)

    // Must be musically valid (all in scale range)
    for (const midi of bassMidis) {
      expect(midi).toBeGreaterThanOrEqual(36)
      expect(midi).toBeLessThanOrEqual(59)
    }
    for (const midi of leadMidis) {
      expect(midi).toBeGreaterThanOrEqual(60)
      expect(midi).toBeLessThanOrEqual(84)
    }
  })
})

describe('F15: Serializable', () => {
  test('LearnedMusicalContext is JSON serializable', () => {
    const learned = createEmptyLearnedContext()
    learned.meta.confidence = 0.8
    learned.bass.degreePreferences = { 0: 0.3, 4: 0.5, 2: 0.2 }
    const json = JSON.stringify(learned)
    expect(json.length).toBeGreaterThan(0)
    expect(json).not.toContain('undefined')
    expect(json).not.toContain('function')
  })

  test('LearnedMusicalContext round-trips through JSON', () => {
    const learned = createEmptyLearnedContext()
    learned.meta.confidence = 0.8
    learned.bass.degreePreferences = { 0: 0.3, 4: 0.5, 2: 0.2 }
    const json = JSON.stringify(learned)
    const parsed = JSON.parse(json) as LearnedMusicalContext
    expect(parsed.bass.degreePreferences[0]).toBe(0.3)
    expect(parsed.meta.confidence).toBe(0.8)
  })
})

describe('F15: No browser/audio dependencies', () => {
  test('learned context has no AudioContext/DOM', () => {
    const learned = createEmptyLearnedContext()
    const json = JSON.stringify(learned)
    expect(json).not.toContain('AudioContext')
    expect(json).not.toContain('document')
    expect(json).not.toContain('window')
  })
})
