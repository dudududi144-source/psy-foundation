/**
 * Runtime proof tests — proves Foundation Transport works with a
 * continuously-advancing AudioContext-like clock.
 */

import { describe, expect, test } from 'bun:test'
import { Transport } from '@psy-foundation/transport'
import { SimulatedAudioContext, runRuntimeProofs } from '../src/index.ts'

describe('Runtime proof — all 10 tests', () => {
  const results = runRuntimeProofs()

  for (const result of results) {
    test(`${result.testName}`, () => {
      if (!result.passed) {
        console.error(`${result.testName} FAILED: ${result.evidence}`)
      }
      expect(result.passed).toBe(true)
    })
  }
})

describe('SimulatedAudioContext', () => {
  test('currentTime advances on each read', () => {
    const ctx = new SimulatedAudioContext({ startAt: 0, advancePerRead: 0.001 })
    const t1 = ctx.currentTime
    const t2 = ctx.currentTime
    expect(t2).toBeGreaterThan(t1)
  })

  test('now() returns a function that advances', () => {
    const ctx = new SimulatedAudioContext({ startAt: 100, advancePerRead: 0.001 })
    const now = ctx.now
    const t1 = now()
    const t2 = now()
    expect(t2).toBeGreaterThan(t1)
  })
})

describe('Transport with simulated AudioContext', () => {
  test('transport reads currentTime via nowFn', () => {
    const ctx = new SimulatedAudioContext()
    const transport = new Transport(ctx.now, { initialBpm: 145 })
    transport.start()
    const snap1 = transport.snapshot()
    // Read multiple times — time should advance
    for (let i = 0; i < 50; i++) transport.snapshot()
    const snap2 = transport.snapshot()
    expect(snap2.timestamp).toBeGreaterThan(snap1.timestamp)
  })

  test('continuous observation + snapshot loop', () => {
    const ctx = new SimulatedAudioContext({ advancePerRead: 0.0001 })
    const transport = new Transport(ctx.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 32; i++) {
      transport.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
      const snap = transport.snapshot()
      expect(snap.bpm).toBeGreaterThan(0)
      expect(Number.isFinite(snap.phase)).toBe(true)
    }
    expect(transport.snapshot().locked).toBe(true)
  })

  test('no NaN in any snapshot field', () => {
    const ctx = new SimulatedAudioContext()
    const transport = new Transport(ctx.now, { initialBpm: 145 })
    transport.start()
    for (let i = 0; i < 16; i++) {
      transport.observeBeat({ time: 1 + i * (60 / 145), confidence: 0.9, source: 'radio' })
    }
    const snap = transport.snapshot()
    expect(Number.isFinite(snap.bpm)).toBe(true)
    expect(Number.isFinite(snap.beatIndex)).toBe(true)
    expect(Number.isFinite(snap.phase)).toBe(true)
    expect(Number.isFinite(snap.confidence)).toBe(true)
    expect(Number.isFinite(snap.epoch)).toBe(true)
  })
})
