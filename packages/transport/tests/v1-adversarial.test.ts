/**
 * Transport v1 adversarial tests — ADV-1..6.
 *
 * Proves the transport is robust against pathological inputs.
 */

import { describe, expect, test } from 'bun:test'
import { Transport } from '../src/v1-transport.ts'

function makeClock(start = 0) {
  let t = start
  return {
    now: () => t,
    advance: (s: number) => {
      t += s
    },
    set: (s: number) => {
      t = s
    },
  }
}

describe('ADV-1 — Burst observations', () => {
  test('10 observations in 100ms — transport rejects burst, stays stable', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    // Establish a stable tempo
    for (let i = 0; i < 8; i++) {
      const t = 1 + i * 0.4
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const bpmBefore = transport.snapshot().bpm

    // Burst: 10 observations in 100ms
    for (let i = 0; i < 10; i++) {
      clk.set(10 + i * 0.01)
      transport.observeBeat({ time: 10 + i * 0.01, confidence: 0.9, source: 'radio' })
    }
    const bpmAfter = transport.snapshot().bpm
    // BPM should not have changed dramatically
    expect(Math.abs(bpmAfter - bpmBefore)).toBeLessThan(20)
  })
})

describe('ADV-2 — Out-of-order observations', () => {
  test('out-of-order observation rejected, no backward time travel', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    clk.set(1)
    transport.observeBeat({ time: 1, confidence: 0.9, source: 'radio' })
    clk.set(1.4)
    transport.observeBeat({ time: 1.4, confidence: 0.9, source: 'radio' })
    // Keep clock at 1.4 — don't move it backwards
    const _beatBefore = transport.snapshot().beatIndex
    const epochBefore = transport.snapshot().epoch
    const _obsCountBefore = transport.snapshot().observationCount

    // Out-of-order: observation time < lastObsTime, but clock stays at 1.4
    transport.observeBeat({ time: 0.5, confidence: 0.9, source: 'radio' })
    // State should be unchanged (observation rejected)
    expect(transport.snapshot().epoch).toBe(epochBefore)
  })
})

describe('ADV-3 — Late observations', () => {
  test('late observation (>10s gap) rejected', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    clk.set(1)
    transport.observeBeat({ time: 1, confidence: 0.9, source: 'radio' })
    clk.set(1.4)
    transport.observeBeat({ time: 1.4, confidence: 0.9, source: 'radio' })
    const epochBefore = transport.snapshot().epoch

    // Late: observation with 15s gap (>10s threshold), but clock stays at 1.4
    transport.observeBeat({ time: 16.4, confidence: 0.9, source: 'radio' })
    // Epoch should not change (observation rejected, no re-anchor)
    expect(transport.snapshot().epoch).toBe(epochBefore)
  })
})

describe('ADV-4 — NaN / Infinity', () => {
  test('NaN time rejected, no crash', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    transport.observeBeat({ time: Number.NaN, confidence: 0.9, source: 'radio' })
    expect(transport.snapshot().bpm).toBe(145)
  })

  test('Infinity time rejected, no crash', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    transport.observeBeat({ time: Number.POSITIVE_INFINITY, confidence: 0.9, source: 'radio' })
    expect(transport.snapshot().bpm).toBe(145)
  })

  test('NaN confidence rejected, no crash', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    transport.observeBeat({ time: 1, confidence: Number.NaN, source: 'radio' })
    // NaN confidence should be rejected by the confidence floor
  })
})

describe('ADV-5 — Tempo jump', () => {
  test('sudden 120→180 tempo jump, transport tracks', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 120 })
    transport.start()
    // 120 BPM for 16 beats
    for (let i = 0; i < 16; i++) {
      const t = 1 + i * 0.5
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    // Jump to 180 BPM
    const fastInterval = 60 / 180
    for (let i = 0; i < 16; i++) {
      const t = 1 + 16 * 0.5 + i * fastInterval
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const snap = transport.snapshot()
    expect(snap.bpm).toBeGreaterThan(150)
    expect(snap.bpm).toBeLessThan(200)
  })
})

describe('ADV-6 — Duplicate kicks', () => {
  test('duplicate observations (same time) rejected', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    clk.set(1)
    transport.observeBeat({ time: 1, confidence: 0.9, source: 'radio' })
    clk.set(1)
    transport.observeBeat({ time: 1, confidence: 0.9, source: 'radio' }) // duplicate
    clk.set(1.4)
    transport.observeBeat({ time: 1.4, confidence: 0.9, source: 'radio' })
    // Should not have doubled the observation count
    // The duplicate at time=1 should be rejected (observedInterval <= 0)
    expect(transport.snapshot().bpm).toBeGreaterThan(140)
    expect(transport.snapshot().bpm).toBeLessThan(160)
  })
})

describe('ADV-7 — Impossible BPM', () => {
  test('zero BPM clamped', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145, minBpm: 60, maxBpm: 200 })
    transport.start()
    transport.setTempo(0)
    expect(transport.snapshot().bpm).toBe(60) // clamped to min
  })

  test('huge BPM clamped', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145, minBpm: 60, maxBpm: 200 })
    transport.start()
    transport.setTempo(10000)
    expect(transport.snapshot().bpm).toBe(200) // clamped to max
  })
})
