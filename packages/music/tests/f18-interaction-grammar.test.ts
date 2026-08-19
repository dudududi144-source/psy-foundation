/**
 * F18 reality tests — interaction grammar + multi-candidate + long-run evolution.
 */

import { describe, expect, test } from 'bun:test'
import {
  createEmptyInteractionGrammar,
  updateInteractionGrammar,
} from '../src/interaction-grammar.ts'
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

describe('F18: Interaction grammar learns kick↔bass', () => {
  test('bass on kick probability changes with observations', () => {
    const g1 = createEmptyInteractionGrammar()
    const g2 = updateInteractionGrammar(g1, {
      kickOnsets: [0, 4, 8, 12],
      bassOnsets: [0, 4, 8, 12],
      confidence: 0.9,
    })
    // After observation: bass always hits when kick hits → probability should increase
    expect(g2.kickBass.bassOnKickProb[0]).toBeGreaterThan(g1.kickBass.bassOnKickProb[0] ?? 0.5)
    expect(g2.confidence).toBeGreaterThan(0)
  })
})

describe('F18: Interaction grammar learns bass transitions', () => {
  test('bass degree transitions are recorded', () => {
    const g = createEmptyInteractionGrammar()
    const g2 = updateInteractionGrammar(g, {
      bassDegrees: [0, 4, 7, 0],
      confidence: 0.9,
    })
    expect(Object.keys(g2.bassTransitions.transitions).length).toBeGreaterThan(0)
    expect(g2.bassTransitions.transitions[0]).toBeDefined()
  })
})

describe('F18: Interaction grammar learns harmony↔lead', () => {
  test('lead interval preferences are recorded per harmonic root', () => {
    const g = createEmptyInteractionGrammar()
    const g2 = updateInteractionGrammar(g, {
      harmonicRoot: 4,
      leadIntervals: [3, 5, 7],
      confidence: 0.9,
    })
    expect(g2.harmonyLead.intervalPreferences[4]).toBeDefined()
    expect(Object.keys(g2.harmonyLead.intervalPreferences[4] ?? {}).length).toBeGreaterThan(0)
  })
})

describe('F18: Interaction grammar learns energy↔density', () => {
  test('density by energy bin is updated', () => {
    const g = createEmptyInteractionGrammar()
    const g2 = updateInteractionGrammar(g, {
      energy: 0.8,
      density: 0.9, // very different from default 0.5
      confidence: 0.95,
    })
    const bin = Math.min(9, Math.floor(0.8 * 10))
    expect(g2.energyDensity.densityByEnergy[bin]).not.toBeCloseTo(
      g.energyDensity.densityByEnergy[bin] ?? 0.5,
      5
    )
  })
})

describe('F18: Interaction grammar learns tension↔register', () => {
  test('register by tension bin is updated', () => {
    const g = createEmptyInteractionGrammar()
    const g2 = updateInteractionGrammar(g, {
      tension: 0.7,
      leadRegister: 80, // very different from default 67
      confidence: 0.95,
    })
    const bin = Math.min(9, Math.floor(0.7 * 10))
    expect(g2.tensionRegister.registerByTension[bin]).not.toBeCloseTo(
      g.tensionRegister.registerByTension[bin] ?? 67,
      5
    )
  })
})

describe('F18: Kernel stores interaction grammar', () => {
  test('getInteractionGrammar returns learned relationships', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 20; i++) {
      kernel.observe({
        kickOnsets: [0, 4, 8, 12],
        bassOnsets: [0, 4, 8, 12],
        bassDegrees: [0, 4, 7, 0],
        leadIntervals: [3, 5, 7],
        harmonicRoot: 4,
        energy: 0.7,
        density: 0.6,
        tension: 0.3,
        leadRegister: 67,
        confidence: 0.9,
      })
    }
    const ig = kernel.getInteractionGrammar()
    expect(ig.confidence).toBeGreaterThan(0)
    expect(Object.keys(ig.bassTransitions.transitions).length).toBeGreaterThan(0)
    expect(ig.harmonyLead.intervalPreferences[4]).toBeDefined()
  })
})

describe('F18: Serialization includes interaction grammar', () => {
  test('serialize + restore preserves interaction grammar', () => {
    const kernelA = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 10; i++) {
      kernelA.observe({
        kickOnsets: [0, 4, 8, 12],
        bassOnsets: [0, 4],
        bassDegrees: [0, 4, 7],
        confidence: 0.9,
      })
    }
    const json = kernelA.serializeLearning()
    const kernelB = new MusicalLearningKernel({ seed: 42, context: ctx })
    kernelB.restoreLearning(json)

    const igA = kernelA.getInteractionGrammar()
    const igB = kernelB.getInteractionGrammar()
    expect(igB.confidence).toBe(igA.confidence)
    expect(Object.keys(igB.bassTransitions.transitions).length).toBe(
      Object.keys(igA.bassTransitions.transitions).length
    )
  })
})

describe('F18: 512-bar evolution', () => {
  test('512 bars without collapse', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 20; i++) {
      kernel.observe({
        bassIntervals: [0, 4, 7],
        leadPitchClasses: [4, 7, 11],
        kickOnsets: [0, 4, 8, 12],
        bassDegrees: [0, 4, 7],
        leadIntervals: [3, 5],
        harmonicRoot: 4,
        energy: 0.7,
        density: 0.6,
        tension: 0.3,
        leadRegister: 67,
        confidence: 0.8,
      })
    }
    const result = kernel.compose({ bars: 512 })
    expect(result.section.bars.length).toBe(512)
    // No NaN
    for (const bar of result.section.bars) {
      for (const n of bar.bassNotes) expect(Number.isFinite(n.midi)).toBe(true)
      for (const n of bar.leadNotes) expect(Number.isFinite(n.midi)).toBe(true)
    }
    // Has evolution
    const sigs = new Set(result.section.bars.map((b) => JSON.stringify(b.leadNotes)))
    expect(sigs.size).toBeGreaterThan(20)
    // Kick continuity
    const barsWithKick = result.section.bars.filter((b) => b.kickNotes.length > 0).length
    expect(barsWithKick).toBeGreaterThan(256)
  })
})

describe('F18: Radio loss does not reset state', () => {
  test('composition continues after observation stops', () => {
    const kernel = new MusicalLearningKernel({ seed: 42, context: ctx })
    for (let i = 0; i < 20; i++) {
      kernel.observe({ bassIntervals: [0, 4, 7], confidence: 0.9 })
    }
    const _result1 = kernel.compose({ bars: 16 })
    const state1 = kernel.getPhraseState()

    // No more observations (radio loss)
    const result2 = kernel.compose({ bars: 16 })
    const state2 = kernel.getPhraseState()

    // State should continue (not reset)
    expect(state2.phraseIndex).toBeGreaterThan(state1.phraseIndex)
    expect(result2.section.bars.length).toBe(16)
    // Learned context should be preserved
    expect(kernel.getLearnedContext().meta.confidence).toBeGreaterThan(0)
  })
})

describe('F18: Determinism with interaction grammar', () => {
  test('same seed + same observations = identical output', () => {
    const kA = new MusicalLearningKernel({ seed: 42, context: ctx })
    kA.observe({ kickOnsets: [0, 4], bassOnsets: [0, 4], bassDegrees: [0, 4], confidence: 0.9 })
    const rA = kA.compose({ bars: 16 })

    const kB = new MusicalLearningKernel({ seed: 42, context: ctx })
    kB.observe({ kickOnsets: [0, 4], bassOnsets: [0, 4], bassDegrees: [0, 4], confidence: 0.9 })
    const rB = kB.compose({ bars: 16 })

    expect(JSON.stringify(rA.section)).toBe(JSON.stringify(rB.section))
  })
})
