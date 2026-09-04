import { describe, expect, test } from 'bun:test'
import {
  benchmarkLearning,
  benchmarkMusic,
  benchmarkRuntime,
  benchmarkTiming,
  formatFullReport,
  runFullBenchmark,
} from '../src/index.ts'

describe('benchmark-lab — timing', () => {
  test('perfect-150 has low phase error', () => {
    const t = benchmarkTiming('perfect-150')
    expect(t.medianPhaseErrorMs).toBeLessThan(10)
    expect(t.meanPhaseErrorMs).toBeLessThan(20)
  })

  test('lock time is reasonable', () => {
    const t = benchmarkTiming('perfect-150')
    expect(t.lockTimeSec).toBeGreaterThanOrEqual(0)
    expect(t.lockTimeSec).toBeLessThan(10)
  })

  test('drift per minute is small for stable fixtures', () => {
    const t = benchmarkTiming('perfect-150')
    expect(t.driftPerMin).toBeLessThan(5)
  })

  test('relock time is measured for gap fixtures', () => {
    const t = benchmarkTiming('gap-2s')
    expect(t.relockTimeSec).toBeGreaterThanOrEqual(0)
  })
})

describe('benchmark-lab — runtime', () => {
  test('transport snapshot is fast (<10μs)', () => {
    const r = benchmarkRuntime()
    expect(r.transportProcessNs).toBeLessThan(10000)
  })

  test('scheduler is fast (<1ms)', () => {
    const r = benchmarkRuntime()
    expect(r.schedulerProcessNs).toBeLessThan(1000000)
  })

  test('DSP osc is very fast (<1μs)', () => {
    const r = benchmarkRuntime()
    expect(r.dspOscNs).toBeLessThan(1000)
  })

  test('heap per voice is positive', () => {
    const r = benchmarkRuntime()
    expect(r.heapBytesPerVoice).toBeGreaterThan(0)
  })
})

describe('benchmark-lab — music', () => {
  test('generates multiple variations', () => {
    const m = benchmarkMusic()
    expect(m.variationCount).toBeGreaterThan(1)
  })

  test('motif diversity is high (variations differ)', () => {
    const m = benchmarkMusic()
    expect(m.motifDiversity).toBeGreaterThan(0.3)
  })

  test('harmonic conflicts are zero (in-scale generation)', () => {
    const m = benchmarkMusic()
    expect(m.harmonicConflicts).toBe(0)
  })
})

describe('benchmark-lab — learning', () => {
  test('records experiences', () => {
    const l = benchmarkLearning()
    expect(l.totalExperiences).toBeGreaterThan(10)
  })

  test('best action reward > worst action reward', () => {
    const l = benchmarkLearning()
    expect(l.bestActionReward).toBeGreaterThanOrEqual(l.worstActionReward)
  })

  test('regret is non-negative', () => {
    const l = benchmarkLearning()
    expect(l.regret).toBeGreaterThanOrEqual(0)
  })

  test('retrieval quality is measurable', () => {
    const l = benchmarkLearning()
    expect(l.retrievalQuality).toBeGreaterThanOrEqual(0)
    expect(l.retrievalQuality).toBeLessThanOrEqual(1)
  })
})

describe('benchmark-lab — full report', () => {
  test('runFullBenchmark returns all categories', () => {
    const report = runFullBenchmark()
    expect(report.timing.length).toBe(17)
    expect(report.runtime).toBeDefined()
    expect(report.music).toBeDefined()
    expect(report.learning).toBeDefined()
  })

  test('formatFullReport produces readable output', () => {
    const report = runFullBenchmark()
    const text = formatFullReport(report)
    expect(text).toContain('BENCHMARK LAB')
    expect(text).toContain('TIMING')
    expect(text).toContain('RUNTIME')
    expect(text).toContain('MUSIC')
    expect(text).toContain('LEARNING')
  })
})
