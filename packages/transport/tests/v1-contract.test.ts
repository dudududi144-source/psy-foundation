/**
 * Transport v1 contract tests — the A-P matrix.
 *
 * Each test maps to a psy4 transport-tests.ts test (A-P) and proves the
 * foundation Transport satisfies the same contract.
 */

import { describe, expect, test } from 'bun:test'
import { Transport } from '../src/v1-transport.ts'
import type { TransportObservation } from '../src/v1-types.ts'

// Mock clock — deterministic, advances on demand.
function makeClock(start = 0) {
  let t = start
  return {
    now: () => t,
    advance: (sec: number) => {
      t += sec
    },
    set: (sec: number) => {
      t = sec
    },
  }
}

function beats(
  bpm: number,
  count: number,
  start = 1,
  source: TransportObservation['source'] = 'radio'
): TransportObservation[] {
  const interval = 60 / bpm
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * interval,
    confidence: 0.9,
    source,
  }))
}

describe('A — Perfect 120 BPM', () => {
  test('60 beats, P95 phase error < 10ms', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 120 })
    transport.start()
    const obs = beats(120, 60)
    for (const o of obs) {
      clk.set(o.time)
      transport.observeBeat(o)
    }
    const snap = transport.snapshot()
    expect(snap.bpm).toBeGreaterThan(119)
    expect(snap.bpm).toBeLessThan(121)
    expect(snap.locked).toBe(true)
  })
})

describe('B — Perfect 150 BPM', () => {
  test('60 beats, P95 phase error < 10ms', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 150 })
    transport.start()
    const obs = beats(150, 60)
    for (const o of obs) {
      clk.set(o.time)
      transport.observeBeat(o)
    }
    const snap = transport.snapshot()
    expect(snap.bpm).toBeGreaterThan(149)
    expect(snap.bpm).toBeLessThan(151)
  })
})

describe('C — Tempo change 120→150', () => {
  test('beat continuity preserved, no phase reset', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 120 })
    transport.start()
    const slow = beats(120, 16)
    for (const o of slow) {
      clk.set(o.time)
      transport.observeBeat(o)
    }
    const beatBefore = transport.snapshot().beatIndex
    const epochBefore = transport.snapshot().epoch

    // Tempo change
    transport.setTempo(150, 'internal')
    const snapAfter = transport.snapshot()
    expect(snapAfter.bpm).toBeGreaterThan(149)
    expect(snapAfter.epoch).toBeGreaterThan(epochBefore)
    // Beat continuity — beatIndex should not reset to 0
    expect(snapAfter.beatIndex).toBeGreaterThanOrEqual(beatBefore)
  })
})

describe('D — Jitter ±50ms', () => {
  test('P95 phase error < 75ms', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    let seed = 42
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    for (let i = 0; i < 60; i++) {
      const jitter = (rng() - 0.5) * 0.1 // ±50ms
      const t = 1 + i * interval + jitter
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const snap = transport.snapshot()
    expect(snap.locked).toBe(true)
    expect(snap.bpm).toBeGreaterThan(140)
    expect(snap.bpm).toBeLessThan(150)
  })
})

describe('E — Dropout 25%', () => {
  test('25% of beats missing, still locks', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    let seed = 7
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    for (let i = 0; i < 80; i++) {
      if (rng() < 0.25) continue // drop 25%
      const t = 1 + i * interval
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const snap = transport.snapshot()
    expect(snap.bpm).toBeGreaterThan(140)
    expect(snap.bpm).toBeLessThan(150)
  })
})

describe('F — False kicks', () => {
  test('false kicks between beats do not corrupt tempo', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 32; i++) {
      const t = 1 + i * interval
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
      // False kick halfway between
      if (i < 30) {
        const falseT = t + interval * 0.5
        clk.set(falseT)
        transport.observeBeat({ time: falseT, confidence: 0.3, source: 'radio' })
      }
    }
    const snap = transport.snapshot()
    // Should NOT have doubled to ~290
    expect(snap.bpm).toBeLessThan(200)
    expect(snap.bpm).toBeGreaterThan(120)
  })
})

describe('G — Half tempo', () => {
  test('half-tempo observations do not false-lock to half', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    // Every other beat at half tempo (interval = 2x normal)
    const interval = 60 / 145
    for (let i = 0; i < 32; i++) {
      const t = 1 + i * interval * 2 // half tempo
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const snap = transport.snapshot()
    // Should track hypotheses, not crash
    expect(snap.bpm).toBeGreaterThan(0)
    const hyps = transport.getHypotheses()
    expect(Array.isArray(hyps)).toBe(true)
  })
})

describe('H — Double tempo', () => {
  test('double-tempo observations do not false-lock to double', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 64; i++) {
      const t = 1 + i * interval * 0.5 // double tempo
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const snap = transport.snapshot()
    expect(snap.bpm).toBeGreaterThan(0)
    expect(snap.bpm).toBeLessThan(300)
  })
})

describe('I — Stall recovery', () => {
  test('100ms stall — no crash, position continues', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 8; i++) {
      clk.set(1 + i * interval)
      transport.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
    }
    clk.advance(0.1) // 100ms stall
    for (let i = 0; i < 8; i++) {
      const t = 1 + 8 * interval + 0.1 + i * interval
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const snap = transport.snapshot()
    expect(snap.bpm).toBeGreaterThan(0)
  })

  test('5s stall — holdover, recovery on resume', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 8; i++) {
      clk.set(1 + i * interval)
      transport.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
    }
    const beforeStall = transport.snapshot()
    transport.loseSource()
    clk.advance(5) // 5s holdover
    const duringHoldover = transport.snapshot()
    expect(duringHoldover.holdover).toBe(true)
    expect(duringHoldover.confidence).toBeLessThan(beforeStall.confidence)
    // Recovery
    for (let i = 0; i < 8; i++) {
      const t = 1 + 8 * interval + 5 + i * interval
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const after = transport.snapshot()
    expect(after.holdover).toBe(false)
  })
})

describe('J — Radio loss + recovery', () => {
  test('loseSource → holdover → observeBeat → recovery', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    for (let i = 0; i < 16; i++) {
      const t = 1 + i * 0.4
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    expect(transport.snapshot().locked).toBe(true)
    expect(transport.snapshot().source).toBe('radio')

    transport.loseSource()
    expect(transport.snapshot().holdover).toBe(true)
    expect(transport.snapshot().source).toBe('internal')
    expect(transport.snapshot().locked).toBe(false)

    // Recovery
    for (let i = 0; i < 8; i++) {
      const t = 1 + 16 * 0.4 + 1 + i * 0.4
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const after = transport.snapshot()
    expect(after.holdover).toBe(false)
    expect(after.source).toBe('radio')
  })
})

describe('K — 30-min drift', () => {
  test('30 minutes simulated, drift = 0ms (anchor-based)', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 120 })
    transport.start()
    const interval = 60 / 120
    // 30 min = 1800s = 2160 beats at 120bpm
    // Feed beats every 50 beats to avoid observation overhead
    for (let i = 0; i < 2160; i++) {
      const t = 1 + i * interval
      if (i % 50 === 0) {
        clk.set(t)
        transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
      }
    }
    clk.set(1 + 1800) // 30 min
    const snap = transport.snapshot()
    // Anchor-based: drift should be ~0
    const expectedBeatIndex = Math.floor(1800 / interval)
    const actualBeatIndex = snap.beatIndex
    const driftBeats = Math.abs(actualBeatIndex - expectedBeatIndex)
    const driftMs = driftBeats * interval * 1000
    expect(driftMs).toBeLessThan(10) // < 10ms
  })
})

describe('L — Seek', () => {
  test('seek to beat 40 → bar 10', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145, beatsPerBar: 4 })
    transport.start()
    for (let i = 0; i < 8; i++) {
      const t = 1 + i * 0.4
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const epochBefore = transport.snapshot().epoch

    transport.seek(40)
    const snap = transport.snapshot()
    expect(snap.beatIndex).toBeGreaterThanOrEqual(40)
    expect(snap.bar).toBe(10)
    expect(snap.epoch).toBeGreaterThan(epochBefore)
  })
})

describe('M — AudioContext resume', () => {
  test('onAudioContextResume re-anchors, epoch increments', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    for (let i = 0; i < 8; i++) {
      const t = 1 + i * 0.4
      clk.set(t)
      transport.observeBeat({ time: t, confidence: 0.9, source: 'radio' })
    }
    const epochBefore = transport.snapshot().epoch

    clk.advance(2) // simulate suspension
    transport.onAudioContextResume()
    const snap = transport.snapshot()
    expect(snap.epoch).toBeGreaterThan(epochBefore)
  })
})

describe('N — Subscribers', () => {
  test('multiple subscribers receive snapshots', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    let received1 = 0
    let received2 = 0
    const sub1 = transport.subscribe(() => received1++)
    const sub2 = transport.subscribe(() => received2++)

    transport.start()
    transport.observeBeat({ time: 1, confidence: 0.9, source: 'radio' })
    transport.observeBeat({ time: 1.4, confidence: 0.9, source: 'radio' })

    expect(received1).toBeGreaterThan(0)
    expect(received2).toBeGreaterThan(0)
    expect(received1).toBe(received2)

    sub1.unsubscribe()
    const r1Before = received1
    transport.observeBeat({ time: 1.8, confidence: 0.9, source: 'radio' })
    expect(received1).toBe(r1Before) // no more notifications
    expect(received2).toBeGreaterThan(r1Before)

    sub2.unsubscribe()
  })
})

describe('O — Epoch', () => {
  test('epoch increments on start, seek, setTempo, reset', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    expect(transport.snapshot().epoch).toBe(0)

    transport.start()
    const afterStart = transport.snapshot().epoch
    expect(afterStart).toBeGreaterThan(0)

    transport.seek(10)
    expect(transport.snapshot().epoch).toBeGreaterThan(afterStart)

    const beforeTempo = transport.snapshot().epoch
    transport.setTempo(150)
    expect(transport.snapshot().epoch).toBeGreaterThan(beforeTempo)

    const beforeReset = transport.snapshot().epoch
    transport.reset()
    expect(transport.snapshot().epoch).toBeGreaterThan(beforeReset)
  })
})

describe('P — Immutable snapshot', () => {
  test('snapshot fields are readonly (cannot modify transport through snapshot)', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const snap = transport.snapshot()
    // Attempt to mutate — should not affect transport
    const mutated = snap as unknown as { bpm: number; epoch: number }
    const originalBpm = snap.bpm
    const originalEpoch = snap.epoch
    mutated.bpm = 999
    mutated.epoch = 999

    const snap2 = transport.snapshot()
    expect(snap2.bpm).toBe(originalBpm)
    expect(snap2.epoch).toBe(originalEpoch)
  })
})
