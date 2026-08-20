import { describe, expect, test } from 'bun:test'
import { emptyTrack, schedule, step } from '../src/index.ts'
import type { MusicalPlan } from '../src/index.ts'

function kickTrack() {
  const t = emptyTrack('kick', 'kick', 36, 16, 0.5)
  for (const i of [0, 4, 8, 12]) t.steps[i] = step({ on: true, vel: 1 })
  return t
}
function bassTrack() {
  const t = emptyTrack('bass', 'bass', 43, 16, 0.25)
  for (const i of [2, 6, 10, 14]) t.steps[i] = step({ on: true, vel: 0.8 })
  return t
}
function plan(barCount = 1): MusicalPlan {
  return { tracks: [kickTrack(), bassTrack()], fromBar: 0, barCount }
}
const opts = { originAudioTime: 0, bpm: 150, beatsPerBar: 4 }

describe('schedule — basic', () => {
  test('emits one event per active step', () => {
    expect(schedule(plan(), opts)).toHaveLength(8)
  })
  test('events are sorted by audio time', () => {
    const evs = schedule(plan(), opts)
    for (let i = 1; i < evs.length; i++) expect(evs[i].at).toBeGreaterThanOrEqual(evs[i - 1].at)
  })
  test('kick lands on beat 0', () => {
    const evs = schedule(plan(), opts)
    const firstKick = evs.find((e) => e.type === 'note' && e.channel === 'kick')
    expect(firstKick).toBeDefined()
    const kick = firstKick as { at: number }
    expect(kick.at).toBeCloseTo(0, 6)
  })
  test('bass lands on beat 0.5', () => {
    const evs = schedule(plan(), opts)
    const firstBass = evs.find((e) => e.type === 'note' && e.channel === 'bass')
    expect(firstBass).toBeDefined()
    const bass = firstBass as { at: number }
    expect(bass.at).toBeCloseTo(0.2, 6)
  })
})

describe('schedule — determinism', () => {
  test('same inputs → identical outputs', () => {
    expect(schedule(plan(), opts)).toEqual(schedule(plan(), opts))
  })
  test('different seed → different humanize', () => {
    const a = schedule(plan(), { ...opts, humanizeSec: 0.01, seed: 1 })
    const b = schedule(plan(), { ...opts, humanizeSec: 0.01, seed: 2 })
    expect(a.some((e, i) => e.at !== b[i].at)).toBe(true)
  })
  test('same seed → identical humanize', () => {
    const o = { ...opts, humanizeSec: 0.02, seed: 42 }
    expect(schedule(plan(), o)).toEqual(schedule(plan(), o))
  })
})

describe('schedule — swing', () => {
  test('swing delays odd steps', () => {
    const t = emptyTrack('hat', 'hat', 42, 16, 0.1)
    for (let i = 0; i < 16; i++) t.steps[i] = step({ on: true })
    const p: MusicalPlan = { tracks: [t], fromBar: 0, barCount: 1 }
    const straight = schedule(p, { ...opts, swing: 0 })
    const swung = schedule(p, { ...opts, swing: 0.25 })
    for (let i = 0; i < 16; i += 2) expect(straight[i].at).toBeCloseTo(swung[i].at, 6)
    for (let i = 1; i < 16; i += 2) expect(swung[i].at).toBeGreaterThan(straight[i].at)
  })
})

describe('schedule — probability', () => {
  test('prob=0 → no events', () => {
    const t = emptyTrack('lead', 'lead', 60, 4, 0.5)
    t.steps[0] = step({ on: true, prob: 0 })
    expect(schedule({ tracks: [t], fromBar: 0, barCount: 1 }, opts)).toHaveLength(0)
  })
  test('prob=1 → all events', () => {
    const t = emptyTrack('lead', 'lead', 60, 4, 0.5)
    t.steps[0] = step({ on: true, prob: 1 })
    expect(schedule({ tracks: [t], fromBar: 0, barCount: 1 }, opts)).toHaveLength(1)
  })
  test('prob is deterministic given seed', () => {
    const t = emptyTrack('lead', 'lead', 60, 16, 0.5)
    for (let i = 0; i < 16; i++) t.steps[i] = step({ on: true, prob: 0.5 })
    const p: MusicalPlan = { tracks: [t], fromBar: 0, barCount: 1 }
    const o = { ...opts, seed: 7 }
    expect(schedule(p, o)).toEqual(schedule(p, o))
  })
})

describe('schedule — multi-bar', () => {
  test('schedules across multiple bars', () => {
    const evs = schedule(plan(4), opts)
    expect(evs).toHaveLength(32)
    expect(evs[0].at).toBeCloseTo(0, 6)
  })
  test('fromBar offset shifts all events', () => {
    const p: MusicalPlan = { tracks: [kickTrack()], fromBar: 2, barCount: 1 }
    const evs = schedule(p, opts)
    const secPerBar = (60 / 150) * 4
    expect(evs[0].at).toBeCloseTo(2 * secPerBar, 6)
  })
})

describe('schedule — per-step locks', () => {
  test('emits param events for step.lock', () => {
    const t = emptyTrack('bass', 'bass', 43, 4, 0.5)
    t.steps[0] = step({ on: true, lock: { cutoff: 0.9 } })
    const evs = schedule({ tracks: [t], fromBar: 0, barCount: 1 }, opts)
    expect(evs).toHaveLength(2)
    const param = evs.find((e) => e.type === 'param')
    expect(param).toBeDefined()
  })
})

describe('schedule — edge cases', () => {
  test('empty plan → empty events', () => {
    expect(schedule({ tracks: [], fromBar: 0, barCount: 1 }, opts)).toHaveLength(0)
  })
  test('track with no active steps → no events', () => {
    const t = emptyTrack('silent', 'silent', 60, 16, 0.5)
    expect(schedule({ tracks: [t], fromBar: 0, barCount: 1 }, opts)).toHaveLength(0)
  })
  test('barCount=0 → empty', () => {
    expect(schedule({ tracks: [kickTrack()], fromBar: 0, barCount: 0 }, opts)).toHaveLength(0)
  })
})
