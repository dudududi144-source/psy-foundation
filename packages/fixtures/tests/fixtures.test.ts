import { describe, expect, test } from 'bun:test'
import { binToFreq, spectrum } from '../../analysis/src/index.ts'
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
  genMelodyPentatonic,
  genMissingBeat,
  genPerfect150,
  genRhythm16thGrid,
  genSparse,
  genTempoJump,
  genTempoRamp,
  genWhiteNoise,
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
  test('corpus has exactly 17 fixtures with unique ids (14 rhythmic + GAP-F1..F3 specials)', () => {
    expect(corpus.length).toBe(17)
    const ids = corpus.map((f) => f.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(17)
  })

  test('every fixture signal length equals ceil(durationSec * sampleRate)', () => {
    for (const f of corpus) {
      const expected = Math.ceil(f.durationSec * f.sampleRate)
      expect(f.signal.length).toBe(expected)
    }
  })

  test('every fixture groundTruthBeats are monotonically increasing and within [0, durationSec]', () => {
    for (const f of corpus) {
      // White noise carries no beats (honest ground truth: there is no beat).
      if (f.anomaly === 'white-noise') {
        expect(f.groundTruthBeats.length).toBe(0)
        continue
      }
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

describe('GAP-F1..F3 special fixtures (PLAN_V3 3.5)', () => {
  test('GAP-F1 melody fixture provides ground-truth pitches on a steady grid', () => {
    const f = getFixture('melody-pentatonic')
    expect(f.groundTruthPitches).toBeDefined()
    expect(f.groundTruthPitches!.length).toBe(8)
    // Ascending A minor pentatonic.
    expect(f.groundTruthPitches).toEqual([57, 60, 62, 64, 67, 69, 72, 76])
    // One note per beat: onsets match the quarter grid.
    expect(f.groundTruthBeats.length).toBe(f.groundTruthPitches!.length)
    const interval = f.groundTruthBeats[1]! - f.groundTruthBeats[0]!
    expect(Math.abs(interval - 0.5)).toBeLessThan(1e-9) // 120 BPM
    // The signal is not silent.
    let peak = 0
    for (const v of f.signal) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(0.1)
  })

  test('GAP-F2 rhythm fixture provides ground-truth 16th-note grid (exact spacing)', () => {
    const f = getFixture('rhythm-16th-grid')
    expect(f.groundTruthSixteenths).toBeDefined()
    const grid = f.groundTruthSixteenths!
    expect(grid.length).toBe(8 * 4) // two bars of 4/4
    const sixteenthSec = 60 / 120 / 4
    for (let i = 0; i < grid.length; i++) {
      expect(Math.abs(grid[i]! - i * sixteenthSec)).toBeLessThan(1e-9)
    }
    // Kick beats are a subset of the grid.
    for (const b of f.groundTruthBeats) {
      expect(grid.some((g) => Math.abs(g - b) < 1e-9)).toBe(true)
    }
  })

  test('GAP-F3 noise fixture has KNOWN spectral content (measured, not trusted)', () => {
    const f = getFixture('noise-white-2s')
    expect(f.groundTruthSpectrum?.kind).toBe('white')
    // Measure: white noise → flat magnitude spectrum (spectral flatness ≈ 1)
    // and centroid near Nyquist/2. Compute over the full 2s via 4096-sample
    // frames and average.
    const N = 4096
    const flatnessValues: number[] = []
    const centroids: number[] = []
    for (let offset = 0; offset + N <= f.signal.length; offset += N) {
      const frame = f.signal.slice(offset, offset + N)
      const spec = spectrum(frame)
      let logSum = 0
      let linearSum = 0
      let num = 0
      let den = 0
      for (let bin = 1; bin < spec.length; bin++) {
        const m = Math.max(spec[bin]!, 1e-12)
        logSum += Math.log(m)
        linearSum += m
        num += binToFreq(bin, f.sampleRate, N) * m
        den += m
      }
      flatnessValues.push(Math.exp(logSum / (spec.length - 1)) / (linearSum / (spec.length - 1)))
      centroids.push(num / den)
    }
    const meanFlatness = flatnessValues.reduce((a, b) => a + b, 0) / flatnessValues.length
    const meanCentroid = centroids.reduce((a, b) => a + b, 0) / centroids.length
    expect(meanFlatness).toBeGreaterThan(0.4) // white noise ≈ 1; tonal ≈ 0
    expect(Math.abs(meanCentroid - f.groundTruthSpectrum!.centroidHz)).toBeLessThan(2000)
  })

  test('special fixtures are deterministic (byte-identical on regeneration)', () => {
    for (const gen of [genMelodyPentatonic, genRhythm16thGrid, genWhiteNoise]) {
      const a = gen()
      const b = gen()
      expect(a.signal.length).toBe(b.signal.length)
      for (let i = 0; i < a.signal.length; i++) {
        expect(a.signal[i]).toBe(b.signal[i])
      }
    }
  })
})
