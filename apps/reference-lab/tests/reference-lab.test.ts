import { describe, expect, test } from 'bun:test'
import { analyzeAllFixtures, analyzeFixture, formatReport } from '../src/index.ts'

describe('reference-lab', () => {
  test('analyzeFixture returns a complete report', () => {
    const report = analyzeFixture('perfect-150')
    expect(report.fixtureId).toBe('perfect-150')
    expect(report.tempo.bpm).toBeGreaterThan(140)
    expect(report.tempo.bpm).toBeLessThan(160)
    expect(report.onsets.length).toBeGreaterThan(10)
    expect(report.key.chroma.length).toBe(12)
    expect(report.frameCount).toBeGreaterThan(0)
  })

  test('formatReport produces readable output', () => {
    const report = analyzeFixture('perfect-150')
    const text = formatReport(report)
    expect(text).toContain('Reference Lab')
    expect(text).toContain('Tempo')
    expect(text).toContain('BPM')
    expect(text).toContain('Key')
    expect(text).toContain('Energy')
  })

  test('analyzeAllFixtures returns 17 reports (corpus grew: GAP-F1..F3)', () => {
    const reports = analyzeAllFixtures()
    expect(reports.length).toBe(17)
    for (const r of reports) {
      expect(r.tempo.bpm).toBeGreaterThanOrEqual(0)
      expect(r.frameCount).toBeGreaterThan(0)
    }
  }, 30000)

  test('sparse fixture estimates 150 (not 75)', () => {
    const report = analyzeFixture('sparse')
    expect(report.tempo.bpm).toBeGreaterThan(130)
    expect(report.tempo.bpm).toBeLessThan(170)
  })

  test('breakdown recovers tempo', () => {
    const report = analyzeFixture('breakdown')
    expect(report.tempo.bpm).toBeGreaterThan(125)
    expect(report.tempo.bpm).toBeLessThan(155)
  })
})
