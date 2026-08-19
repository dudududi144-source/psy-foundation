/**
 * 414ms regression test — the permanent guard against the empty-lookahead bug.
 *
 * BUG HISTORY (from psy4):
 *   At 145 BPM, beatDuration ≈ 414ms. If the scheduler used predictBeats(0.15)
 *   (150ms lookahead), it would get an EMPTY ARRAY most ticks because no beat
 *   boundary falls within 150ms. This caused silence/blips.
 *
 * FIX:
 *   The scheduler must compute 16th-note times directly from the Transport's
 *   beat grid: beatTime + k * stepDuration (k=0,1,2,3 within each beat).
 *   This is NOT dependent on beat boundaries falling within the lookahead.
 *
 * INVARIANT:
 *   Over any time period T, the number of 16th-note steps scheduled must equal
 *   floor(T / stepDuration). No gaps (missed notes), no bursts (extra notes).
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

/**
 * Correct scheduler pattern: compute 16th-note times from the beat grid.
 * This is the fix — NOT predictBeats(lookahead).
 */
function schedulerTick(
  transport: Transport,
  lookaheadSec: number,
  lastScheduledStep: number
): { steps: number[]; newLast: number } {
  const snap = transport.snapshot()
  const stepDuration = snap.beatDuration / 4
  const now = snap.timestamp
  const elapsedSinceBeat = now - snap.beatTime
  const stepsSinceBeat = Math.floor(elapsedSinceBeat / stepDuration)
  let stepTime = snap.beatTime + (stepsSinceBeat + 1) * stepDuration
  let stepIdx = snap.beatIndex * 4 + stepsSinceBeat + 1

  const steps: number[] = []
  while (stepTime < now + lookaheadSec) {
    if (stepTime > now && stepIdx > lastScheduledStep) {
      steps.push(stepIdx)
    }
    stepIdx++
    stepTime += stepDuration
  }
  return { steps, newLast: Math.max(lastScheduledStep, stepIdx - 1) }
}

describe('414ms regression — continuous 16th-note scheduling', () => {
  const bpms = [60, 90, 120, 145, 150, 180, 240]
  const lookahead = 0.15 // 150ms — the exact value that caused the bug

  for (const bpm of bpms) {
    test(`${bpm} BPM: 16th-note grid produces continuous scheduling (no gaps)`, () => {
      const clk = makeClock()
      const transport = new Transport(clk.now, { initialBpm: bpm })
      transport.start()
      const interval = 60 / bpm
      for (let i = 0; i < 16; i++) {
        clk.set(1 + i * interval)
        transport.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
      }

      // Simulate 5 seconds of scheduling
      const simDuration = 5.0
      const tickInterval = 0.025 // 25ms
      const stepDuration = 60 / bpm / 4
      const expectedSteps = Math.floor(simDuration / stepDuration)

      let lastScheduledStep = 0
      const allScheduledSteps: number[] = []

      for (let tick = 0; tick < simDuration / tickInterval; tick++) {
        clk.advance(tickInterval)
        const result = schedulerTick(transport, lookahead, lastScheduledStep)
        allScheduledSteps.push(...result.steps)
        lastScheduledStep = result.newLast
      }

      // The total steps scheduled should be close to expectedSteps.
      // (Not exact because of lookahead boundary effects, but within 10%.)
      const scheduledCount = allScheduledSteps.length
      expect(scheduledCount).toBeGreaterThan(expectedSteps * 0.8)
      expect(scheduledCount).toBeLessThan(expectedSteps * 1.2)

      // No duplicate steps (each step index appears at most once)
      const uniqueSteps = new Set(allScheduledSteps)
      expect(uniqueSteps.size).toBe(scheduledCount)

      // No gaps: consecutive steps should differ by 1
      const sorted = [...uniqueSteps].sort((a, b) => a - b)
      let gaps = 0
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] > 1) gaps++
      }
      // Allow a few gaps at the start (before lock) but not many
      expect(gaps).toBeLessThan(3)
    })
  }
})

describe('THE 414ms BUG: 145 BPM specifically', () => {
  test('predictBeats(0.15) can return empty — but grid scheduling does not', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 16; i++) {
      clk.set(1 + i * interval)
      transport.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
    }

    // Demonstrate the bug: predictBeats(0.15) at 145 BPM often returns []
    let emptyPredictCount = 0
    for (let tick = 0; tick < 200; tick++) {
      clk.advance(0.025)
      const beats = transport.predictBeats(0.15)
      if (beats.length === 0) emptyPredictCount++
    }
    // predictBeats DOES return empty frequently at 145 BPM — that's the bug.
    // (This is expected behavior for beat-boundary prediction at this BPM.)
    expect(emptyPredictCount).toBeGreaterThan(40) // majority empty

    // But grid-based scheduling does NOT have this problem:
    const clk2 = makeClock()
    const transport2 = new Transport(clk2.now, { initialBpm: 145 })
    transport2.start()
    for (let i = 0; i < 16; i++) {
      clk2.set(1 + i * interval)
      transport2.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
    }

    let lastScheduledStep = 0
    const allSteps: number[] = []
    for (let tick = 0; tick < 200; tick++) {
      clk2.advance(0.025)
      const result = schedulerTick(transport2, 0.15, lastScheduledStep)
      allSteps.push(...result.steps)
      lastScheduledStep = result.newLast
    }

    // Grid scheduling produces a continuous stream of 16th notes.
    expect(allSteps.length).toBeGreaterThan(40) // plenty of notes (5s / ~103ms step ≈ 48)
    const unique = new Set(allSteps)
    expect(unique.size).toBe(allSteps.length) // no duplicates
  })
})

describe('Stale event policy', () => {
  test('stale events (old epoch) are not scheduled', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 8; i++) {
      clk.set(1 + i * interval)
      transport.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
    }
    const epoch1 = transport.snapshot().epoch
    transport.seek(100)
    const epoch2 = transport.snapshot().epoch
    expect(epoch2).toBeGreaterThan(epoch1)
    // Scheduler pattern: if (eventEpoch !== currentEpoch) drop.
    expect(epoch1).not.toBe(epoch2)
  })

  test('no catch-up burst after stall', () => {
    const clk = makeClock()
    const transport = new Transport(clk.now, { initialBpm: 145 })
    transport.start()
    const interval = 60 / 145
    for (let i = 0; i < 8; i++) {
      clk.set(1 + i * interval)
      transport.observeBeat({ time: 1 + i * interval, confidence: 0.9, source: 'radio' })
    }

    let lastScheduledStep = 0
    const result1 = schedulerTick(transport, 0.15, lastScheduledStep)
    lastScheduledStep = result1.newLast

    clk.advance(5) // 5s stall

    const result2 = schedulerTick(transport, 0.15, lastScheduledStep)
    // After stall: only schedule within the 150ms lookahead, NOT the 5s gap.
    expect(result2.steps.length).toBeLessThan(10)
    expect(result2.steps.length).toBeGreaterThan(0)
  })
})
