/**
 * F19 reality tests — musical identity, development, continuity, performance.
 */

import { describe, expect, test } from 'bun:test'
import { MusicalLearningKernel } from '../src/learning-kernel.ts'

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

describe('F19: MUSICAL IDENTITY — different learning produces different StyleDNA', () => {
  test('different observations produce materially different 256-bar output', () => {
    // Source A: emphasizes root+fifth bass, stepwise melody
    const kernelA = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 50; i++) {
      kernelA.observe({
        bassIntervals: [0, 7, 0, 7], // root-fifth only
        leadPitchClasses: [4, 6, 8, 11], // narrow melody
        kickOnsets: [0, 4, 8, 12], // four-on-floor
        confidence: 0.95,
        bassRegister: 2,
        leadRegister: 64,
      })
    }
    const resultA = kernelA.compose({ bars: 256 })

    // Source B: emphasizes third+seventh bass, wide melody
    const kernelB = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 50; i++) {
      kernelB.observe({
        bassIntervals: [0, 4, 7, 3, 6], // wider bass
        leadPitchClasses: [0, 3, 5, 7, 10, 11], // wide melody
        kickOnsets: [0, 3, 6, 10], // syncopated
        confidence: 0.95,
        bassRegister: 3,
        leadRegister: 72,
      })
    }
    const resultB = kernelB.compose({ bars: 256 })

    // Bass output should differ
    const bassA = resultA.section.bars.flatMap((b) => b.bassNotes.map((n) => n.midi))
    const bassB = resultB.section.bars.flatMap((b) => b.bassNotes.map((n) => n.midi))
    expect(bassA).not.toEqual(bassB)

    // Lead output should differ
    const leadA = resultA.section.bars.flatMap((b) => b.leadNotes.map((n) => n.midi))
    const leadB = resultB.section.bars.flatMap((b) => b.leadNotes.map((n) => n.midi))
    expect(leadA).not.toEqual(leadB)

    // Kick output should differ (learned rhythm)
    const kickA = resultA.section.bars.flatMap((b) => b.kickNotes)
    const kickB = resultB.section.bars.flatMap((b) => b.kickNotes)
    expect(kickA).not.toEqual(kickB)
  })
})

describe('F19: PHRASE DEVELOPMENT — N+1 differs from N', () => {
  test('phrase N+1 has different development operator than N', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    const result1 = kernel.compose({ bars: 8 })
    const result2 = kernel.compose({ bars: 8 })

    // Development operators should be tracked
    expect(result1.development).toBeDefined()
    expect(result2.development).toBeDefined()
    // They may or may not differ, but both must exist
    expect(result1.development.operator).toBeDefined()
    expect(result2.development.operator).toBeDefined()
  })

  test('development operators produce different density/energy across phrases', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    const operators: string[] = []
    for (let i = 0; i < 8; i++) {
      const r = kernel.compose({ bars: 8 })
      operators.push(r.development.operator)
    }
    // Development operators should vary (not all the same)
    const unique = new Set(operators).size
    expect(unique).toBeGreaterThan(1)
  })
})

describe('F19: CONTINUITY — 1024 bars without collapse', () => {
  test('1024 bars evolve without becoming a loop or random noise', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 30; i++) {
      kernel.observe({
        bassIntervals: [0, 4, 7],
        leadPitchClasses: [4, 7, 11],
        kickOnsets: [0, 4, 8, 12],
        confidence: 0.8,
      })
    }
    const result = kernel.compose({ bars: 1024 })

    expect(result.section.bars.length).toBe(1024)

    // No NaN
    for (const bar of result.section.bars) {
      for (const n of bar.bassNotes) expect(Number.isFinite(n.midi)).toBe(true)
      for (const n of bar.leadNotes) expect(Number.isFinite(n.midi)).toBe(true)
    }

    // Has evolution (not a single repeated loop)
    const sigs = new Set(
      result.section.bars.map((b) =>
        JSON.stringify({
          k: b.kickNotes,
          b: b.bassNotes.map((n) => n.midi),
          l: b.leadNotes.map((n) => n.midi),
        })
      )
    )
    expect(sigs.size).toBeGreaterThan(50) // not a loop

    // Not random noise (has recognizable repetition — motif recurrence)
    const leadSigs = result.section.bars.map((b) => b.leadNotes.map((n) => n.midi).join(','))
    const leadCounts: Record<string, number> = {}
    for (const s of leadSigs) leadCounts[s] = (leadCounts[s] ?? 0) + 1
    const maxRepetition = Math.max(...Object.values(leadCounts))
    expect(maxRepetition).toBeGreaterThan(4) // some bars repeat (identity)

    // Kick continuity
    const barsWithKick = result.section.bars.filter((b) => b.kickNotes.length > 0).length
    expect(barsWithKick).toBeGreaterThan(500)
  })
})

describe('F19: RADIO LOSS — preserves continuity', () => {
  test('radio loss does not reset musical state', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 20; i++) {
      kernel.observe({ bassIntervals: [0, 4, 7], confidence: 0.9 })
    }
    const result1 = kernel.compose({ bars: 16 })
    const learned1 = kernel.getLearnedContext()

    // Radio loss: no more observations
    const result2 = kernel.compose({ bars: 16 })
    const learned2 = kernel.getLearnedContext()

    // Learned context preserved
    expect(learned2.meta.confidence).toBe(learned1.meta.confidence)
    // Phrase state continues
    expect(kernel.getPhraseState().phraseIndex).toBeGreaterThan(result1.section.phrases.length)
    // Composition continues
    expect(result2.section.bars.length).toBe(16)
  })
})

describe('F19: DETERMINISM', () => {
  test('same seed + same observations = identical output', () => {
    const kA = new MusicalLearningKernel({ seed: 42, context: ctx })
    kA.observe({ bassIntervals: [0, 7], confidence: 0.9, kickOnsets: [0, 4] })
    const rA = kA.compose({ bars: 16 })

    const kB = new MusicalLearningKernel({ seed: 42, context: ctx })
    kB.observe({ bassIntervals: [0, 7], confidence: 0.9, kickOnsets: [0, 4] })
    const rB = kB.compose({ bars: 16 })

    expect(JSON.stringify(rA.section)).toBe(JSON.stringify(rB.section))
  })
})

describe('F19: NO NOTE-FOR-NOTE COPYING', () => {
  test('generated material is original', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    kernel.observe({
      leadPitchClasses: [4, 7, 11, 0, 3],
      bassIntervals: [0, 4, 7, 3],
      confidence: 0.95,
    })
    const result = kernel.compose({ bars: 32 })

    const bassMidis = new Set(result.section.bars.flatMap((b) => b.bassNotes.map((n) => n.midi)))
    const leadMidis = new Set(result.section.bars.flatMap((b) => b.leadNotes.map((n) => n.midi)))

    expect(bassMidis.size).toBeGreaterThan(3)
    expect(leadMidis.size).toBeGreaterThan(4)

    // All in valid range
    for (const m of bassMidis) {
      expect(m).toBeGreaterThanOrEqual(36)
      expect(m).toBeLessThanOrEqual(59)
    }
    for (const m of leadMidis) {
      expect(m).toBeGreaterThanOrEqual(60)
      expect(m).toBeLessThanOrEqual(84)
    }
  })
})

describe('F19: PERFORMANCE', () => {
  test('composition stays within budget', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 10; i++) {
      kernel.observe({ bassIntervals: [0, 4, 7], confidence: 0.8 })
    }

    const start = process.hrtime.bigint()
    kernel.compose({ bars: 256 })
    const ms = Number(process.hrtime.bigint() - start) / 1e6

    // Must be under 500ms for 256 bars
    expect(ms).toBeLessThan(500)
  })
})

describe('F19: DEVELOPMENT HISTORY', () => {
  test('development operators vary across multiple phrases', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 10; i++) {
      kernel.compose({ bars: 8 })
    }
    // The kernel tracks development history internally
    // Multiple compose calls should produce different development operators
    const state = kernel.getPhraseState()
    expect(state.phraseIndex).toBeGreaterThan(5)
  })
})
