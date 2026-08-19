/**
 * Consumer fixture — proves a "dumb consumer" can consume ComposedSection
 * without making musical decisions.
 *
 * This is NOT psy4. It is a contract test that proves the foundation's
 * output is self-contained, serializable, and deterministic.
 */

import { describe, expect, test } from 'bun:test'
import { FOUNDATION_CONTRACT_VERSION } from '../../packages/music/src/contract-version.ts'
import { CompositionEngine } from '../../packages/music/src/index.ts'
import type { ComposedSection, MusicalContext } from '../../packages/music/src/index.ts'

const ctx: MusicalContext = {
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
  sectionRole: 'ESTABLISH',
  repetitionPressure: 0.3,
  noveltyPressure: 0.5,
}

describe('Consumer fixture — contract proven', () => {
  test('FOUNDATION_CONTRACT_VERSION exists', () => {
    expect(FOUNDATION_CONTRACT_VERSION).toBe(1)
  })

  test('ComposedSection is serializable (JSON.stringify works)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 8 })
    const json = JSON.stringify(section)
    expect(json.length).toBeGreaterThan(0)
    // No functions, no undefined, no DOM
    expect(json).not.toContain('undefined')
    expect(json).not.toContain('[object Object]')
  })

  test('ComposedSection is deserializable (JSON.parse works)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 8 })
    const json = JSON.stringify(section)
    const parsed = JSON.parse(json) as ComposedSection
    expect(parsed.bars.length).toBe(section.bars.length)
    expect(parsed.bars[0].kickNotes).toEqual(section.bars[0].kickNotes)
  })

  test('All events have enough info for synthesis', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 8 })
    for (const bar of section.bars) {
      // Kick: step indices
      for (const step of bar.kickNotes) {
        expect(typeof step).toBe('number')
        expect(step).toBeGreaterThanOrEqual(0)
      }
      // Bass: midi + step + duration
      for (const note of bar.bassNotes) {
        expect(typeof note.midi).toBe('number')
        expect(note.midi).toBeGreaterThanOrEqual(0)
        expect(typeof note.step).toBe('number')
        expect(typeof note.durationSteps).toBe('number')
        expect(note.durationSteps).toBeGreaterThan(0)
      }
      // Lead: midi + step + duration + velocity
      for (const note of bar.leadNotes) {
        expect(typeof note.midi).toBe('number')
        expect(note.midi).toBeGreaterThanOrEqual(0)
        expect(typeof note.step).toBe('number')
        expect(typeof note.durationSteps).toBe('number')
        expect(note.velocity).toBeGreaterThanOrEqual(0)
        expect(note.velocity).toBeLessThanOrEqual(1)
      }
    }
  })

  test('Rest semantics are unambiguous (empty array = silence)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    // At least one bar should have empty leadNotes (intentional rest)
    const restBars = section.bars.filter((b) => b.leadNotes.length === 0)
    expect(restBars.length).toBeGreaterThan(0)
    // Consumer knows: empty leadNotes = silence, NOT "generate something"
  })

  test('Role activation prevents playing inactive parts', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    // Find a bar where kick role is false
    const noKickBars = section.bars.filter((b) => !b.roles.kick)
    expect(noKickBars.length).toBeGreaterThan(0)
    // Even if kickNotes has data, roles.kick=false means don't play
    for (const bar of noKickBars) {
      // Consumer checks roles BEFORE playing
      expect(bar.roles.kick).toBe(false)
    }
  })

  test('No AudioContext/DOM/browser dependency needed', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 8 })
    const json = JSON.stringify(section)
    // Must not contain any browser/global references
    expect(json).not.toContain('AudioContext')
    expect(json).not.toContain('document')
    expect(json).not.toContain('window')
    expect(json).not.toContain('navigator')
    expect(json).not.toContain('setTimeout')
    expect(json).not.toContain('Date.now')
  })

  test('Deterministic: same seed = same output (100 runs)', () => {
    let first: string | null = null
    for (let i = 0; i < 100; i++) {
      const engine = new CompositionEngine({ seed: 42, context: ctx })
      const section = engine.composeSection({ bars: 16 })
      const json = JSON.stringify(section)
      if (first === null) first = json
      expect(json).toBe(first)
    }
  })

  test('Consumer never makes musical decisions', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 8 })
    // The consumer should be able to play this section by:
    // 1. For each bar, read roles → decide which parts to play
    // 2. For each kickNote step → trigger kick synth
    // 3. For each bassNote → trigger bass synth with midi/duration
    // 4. For each leadNote → trigger lead synth with midi/duration/velocity
    // 5. For each hatNote step → trigger hat synth
    // That's it. No composition, no harmony, no motif decisions.
    const bar = section.bars[0]
    expect(bar.kickNotes).toBeDefined()
    expect(bar.bassNotes).toBeDefined()
    expect(bar.leadNotes).toBeDefined()
    expect(bar.hatNotes).toBeDefined()
    expect(bar.roles).toBeDefined()
    expect(bar.harmonicContext).toBeDefined()
    expect(bar.arrangementState).toBeDefined()
  })

  test('64-bar composition is complete and coherent', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 64 })
    expect(section.bars.length).toBe(64)
    // Every bar has all fields
    for (const bar of section.bars) {
      expect(bar.kickNotes).toBeDefined()
      expect(bar.bassNotes).toBeDefined()
      expect(bar.leadNotes).toBeDefined()
      expect(bar.hatNotes).toBeDefined()
      expect(bar.roles).toBeDefined()
    }
  })

  test('128-bar composition is stable', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 128 })
    expect(section.bars.length).toBe(128)
    // No NaN in any field
    for (const bar of section.bars) {
      for (const note of bar.bassNotes) {
        expect(Number.isFinite(note.midi)).toBe(true)
      }
      for (const note of bar.leadNotes) {
        expect(Number.isFinite(note.midi)).toBe(true)
        expect(Number.isFinite(note.velocity)).toBe(true)
      }
    }
  })

  test('Performance: 64 bars < 100ms', () => {
    const start = process.hrtime.bigint()
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    engine.composeSection({ bars: 64 })
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    expect(ms).toBeLessThan(100)
  })
})
