import { describe, expect, test } from 'bun:test'
import {
  corpus,
  genBreakdown,
  genDenseBass,
  genDoubleTime,
  genFalseKick,
  genGap2s,
  genGap500ms,
  genHalfTime,
  genJitter150,
  genLeadHeavy,
  genMissingBeat,
  genPerfect150,
  genSparse,
  genTempoJump,
  genTempoRamp,
  getFixture,
} from '../src/index.ts'

const ALL_GENERATORS = [
  genPerfect150,
  genJitter150,
  genTempoRamp,
  genTempoJump,
  genMissingBeat,
  genFalseKick,
  genHalfTime,
  genDoubleTime,
  genGap500ms,
  genGap2s,
  genSparse,
  genDenseBass,
  genLeadHeavy,
  genBreakdown,
]

function intervals(beats: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < beats.length; i++) out.push(beats[i] - beats[i - 1])
  return out
}

describe('fixtures corpus', () => {
  test('corpus has exactly 14 fixtures with unique ids', () => {
    expect(corpus.length).toBe(14)
    const ids = corpus.map((f) => f.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(14)
  })

  test('every fixture signal length equals ceil(durationSec * sampleRate)', () => {
    for (const f of corpus) {
      const expected = Math.ceil(f.durationSec * f.sampleRate)
      expect(f.signal.length).toBe(expected)
    }
  })

  test('every fixture groundTruthBeats are monotonically increasing and within [0, durationSec]', () => {
    for (const f of corpus) {
      expect(f.groundTruthBeats.length).toBeGreaterThan(0)
      for (let i = 0; i < f.groundTruthBeats.length; i++) {
        const b = f.groundTruthBeats[i]
        if (b === undefined) throw new Error(`undefined beat at index ${i} in ${f.id}`)
        expect(b).toBeGreaterThanOrEqual(0)
        expect(b).toBeLessThanOrEqual(f.durationSec)
        if (i > 0) {
          const prev = f.groundTruthBeats[i - 1]
          if (prev === undefined) throw new Error(`undefined prev beat at index ${i} in ${f.id}`)
          expect(b).toBeGreaterThan(prev)
        }
      }
    }
  })

  test('perfect-150 inter-beat intervals all within 1ms of 60/150', () => {
    const f = getFixture('perfect-150')
    const expected = 60 / 150
    const ivs = intervals(f.groundTruthBeats)
    for (const iv of ivs) {
      expect(Math.abs(iv - expected)).toBeLessThan(0.001)
    }
  })

  test('missing-beat has exactly one interval ~2x the others', () => {
    const f = getFixture('missing-beat')
    const ivs = intervals(f.groundTruthBeats)
    const base = 60 / 150 // 0.4
    const doubled = base * 2 // 0.8
    const nearDouble = ivs.filter((iv) => Math.abs(iv - doubled) < 0.01)
    const nearBase = ivs.filter((iv) => Math.abs(iv - base) < 0.01)
    expect(nearDouble.length).toBe(1)
    expect(nearBase.length).toBe(ivs.length - 1)
  })

  test('tempo-ramp intervals are strictly decreasing', () => {
    const f = getFixture('tempo-ramp')
    const ivs = intervals(f.groundTruthBeats)
    for (let i = 1; i < ivs.length; i++) {
      expect(ivs[i]).toBeLessThan(ivs[i - 1])
    }
  })

  test('tempo-jump has exactly one discontinuous interval change', () => {
    const f = getFixture('tempo-jump')
    const ivs = intervals(f.groundTruthBeats)
    let discontinuities = 0
    for (let i = 1; i < ivs.length; i++) {
      const diff = Math.abs(ivs[i] - ivs[i - 1])
      if (diff > 0.005) discontinuities++
    }
    expect(discontinuities).toBe(1)
  })

  test('breakdown has a gap in beats during the breakdown bars', () => {
    const f = getFixture('breakdown')
    const ivs = intervals(f.groundTruthBeats)
    const base = 60 / 140 // ~0.4286
    const maxInterval = Math.max(...ivs)
    expect(maxInterval).toBeGreaterThan(base * 5)
  })

  test('determinism: any generator called twice yields byte-identical signals', () => {
    for (const gen of ALL_GENERATORS) {
      const a = gen()
      const b = gen()
      expect(a.signal.length).toBe(b.signal.length)
      let mismatch = 0
      for (let i = 0; i < a.signal.length; i++) {
        if (a.signal[i] !== b.signal[i]) mismatch++
      }
      expect(mismatch).toBe(0)
    }
  })

  test('getFixture returns fixture for known id and throws for unknown', () => {
    const f = getFixture('perfect-150')
    expect(f.id).toBe('perfect-150')
    expect(() => getFixture('nonexistent')).toThrow()
  })
})
