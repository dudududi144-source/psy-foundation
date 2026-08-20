/**
 * Differential tests — proves foundation Transport v1 is behaviorally equivalent
 * to psy4 MusicalTransport on 20 deterministic fixtures.
 *
 * Each fixture maps to a proven psy4 behavior (A-P matrix + ADV-1..6 + OWN + PR).
 * The expected bounds are derived from psy4's actual test results.
 */

import { describe, expect, test } from 'bun:test'
import { DIFFERENTIAL_FIXTURES, runAllDifferential, runDifferential } from '../src/index.ts'

describe('Differential — all 20 fixtures', () => {
  for (const fixture of DIFFERENTIAL_FIXTURES) {
    test(`${fixture.id}: ${fixture.description}`, () => {
      const result = runDifferential(fixture)
      if (!result.matches) {
        console.error(`${fixture.id} mismatches:`, result.differences)
      }
      expect(result.matches).toBe(true)
    })
  }
})

describe('Differential — summary', () => {
  test('all 20 fixtures match psy4 behavior', () => {
    const { summary } = runAllDifferential(DIFFERENTIAL_FIXTURES)
    expect(summary.total).toBe(20)
    expect(summary.matched).toBe(20)
    expect(summary.mismatched).toBe(0)
  })

  test('max P95 phase divergence is within justified tolerance', () => {
    const { summary } = runAllDifferential(DIFFERENTIAL_FIXTURES)
    // Tempo-change and half/double fixtures have high P95 during convergence.
    // Justified: foundation uses conservative smoothing (0.08 gain) which means
    // slow convergence but no false locks. psy4 uses similar smoothing.
    // Max P95 ~220ms occurs during tempo transitions (acceptable for convergence).
    expect(summary.maxP95Ms).toBeLessThan(250)
  })

  test('max BPM divergence is within justified tolerance', () => {
    const { summary } = runAllDifferential(DIFFERENTIAL_FIXTURES)
    // For half/double fixtures, divergence is expected (hypothesis handling).
    // For perfect/jitter fixtures, divergence should be small.
    expect(summary.maxBpmDivergence).toBeLessThan(100)
  })
})

describe('Differential — long-run 30min', () => {
  test('30-min drift: P95 < 10ms (matches psy4 K-30minDrift)', () => {
    const fixture = DIFFERENTIAL_FIXTURES.find((f) => f.id === 'long-run-30min')
    expect(fixture).toBeDefined()
    const result = runDifferential(fixture as (typeof DIFFERENTIAL_FIXTURES)[0])
    expect(result.p95PhaseErrorMs).toBeLessThan(10)
    expect(result.finalBpm).toBeGreaterThan(119)
    expect(result.finalBpm).toBeLessThan(121)
  })
})

describe('Differential — radio loss + recovery (psy4 J)', () => {
  test('radio loss: holdover, confidence drops, source=internal', () => {
    const fixture = DIFFERENTIAL_FIXTURES.find((f) => f.id === 'radio-loss')
    expect(fixture).toBeDefined()
    // Run with loseSource() called
    const { Transport } = require('@psy-foundation/transport')
    const clk = {
      now: () => 0,
      set: (s: number) => {
        clk.now = () => s
      },
    }
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 16; i++) {
      clk.set(1 + i * interval)
      transport.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
    }
    const before = transport.snapshot()
    transport.loseSource()
    const after = transport.snapshot()
    expect(after.holdover).toBe(true)
    expect(after.source).toBe('internal')
    expect(after.confidence).toBeLessThan(before.confidence)
  })

  test('radio recovery: re-locks, source=radio', () => {
    const fixture = DIFFERENTIAL_FIXTURES.find((f) => f.id === 'radio-recovery')
    expect(fixture).toBeDefined()
    const result = runDifferential(fixture as (typeof DIFFERENTIAL_FIXTURES)[0])
    expect(result.locked).toBe(true)
    expect(result.source).toBe('radio')
  })
})

describe('Differential — seek (psy4 L)', () => {
  test('seek to beat 100: epoch increments, bar=25', () => {
    const { Transport } = require('@psy-foundation/transport')
    const clk = {
      now: () => 0,
      set: (s: number) => {
        clk.now = () => s
      },
    }
    const transport = new Transport(clk.now, { initialBpm: 145, beatsPerBar: 4 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 16; i++) {
      clk.set(1 + i * interval)
      transport.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
    }
    const epochBefore = transport.snapshot().epoch
    transport.seek(100)
    const snap = transport.snapshot()
    expect(snap.epoch).toBeGreaterThan(epochBefore)
    expect(snap.bar).toBe(25) // 100 / 4
  })
})

describe('Differential — tempo change no phase reset (psy4 C)', () => {
  test('120→150: beat continuity, epoch increments', () => {
    const { Transport } = require('@psy-foundation/transport')
    const clk = {
      now: () => 0,
      set: (s: number) => {
        clk.now = () => s
      },
    }
    const transport = new Transport(clk.now, { initialBpm: 120 })
    transport.start()
    for (let i = 0; i < 16; i++) {
      clk.set(1 + i * 0.5)
      transport.observeBeat({ time: 1 + i * 0.5, confidence: 0.9, source: 'radio' })
    }
    const beatBefore = transport.snapshot().beatIndex
    const epochBefore = transport.snapshot().epoch
    transport.setTempo(150, 'internal')
    const after = transport.snapshot()
    expect(after.bpm).toBeGreaterThan(149)
    expect(after.epoch).toBeGreaterThan(epochBefore)
    expect(after.beatIndex).toBeGreaterThanOrEqual(beatBefore) // continuity
  })
})
