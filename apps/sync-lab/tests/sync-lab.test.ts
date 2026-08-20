import { describe, expect, test } from 'bun:test'
import { formatSyncReport, runDefaultSync, simulateSync } from '../src/index.ts'

describe('sync-lab', () => {
  test('default sync: 3 devices converge', () => {
    const report = runDefaultSync()
    expect(report.devices).toHaveLength(3)
    // All devices should converge near 150 bpm.
    for (const d of report.devices) {
      expect(d.finalBpm).toBeGreaterThan(140)
      expect(d.finalBpm).toBeLessThan(160)
    }
  })

  test('BPM spread is small for perfect fixture', () => {
    const report = runDefaultSync()
    expect(report.metrics.bpmSpread).toBeLessThan(5)
  })

  test('all devices lock on perfect fixture', () => {
    const report = runDefaultSync()
    expect(report.metrics.allLocked).toBe(true)
  })

  test('formatSyncReport produces readable output', () => {
    const report = runDefaultSync()
    const text = formatSyncReport(report)
    expect(text).toContain('Sync Lab')
    expect(text).toContain('Devices')
    expect(text).toContain('Metrics')
    expect(text).toContain('BPM spread')
  })

  test('device with drop rate still converges', () => {
    const report = simulateSync('perfect-150', [{ id: 'lossy', dropRate: 0.15, seed: 5 }])
    expect(report.devices[0].finalBpm).toBeGreaterThan(135)
    expect(report.devices[0].finalBpm).toBeLessThan(165)
    expect(report.devices[0].observationsDropped).toBeGreaterThan(0)
  })

  test('timeline records snapshots at each beat', () => {
    const report = simulateSync('perfect-150', [{ id: 'A' }, { id: 'B' }])
    expect(report.timeline.length).toBeGreaterThan(10)
    expect(report.timeline[0].deviceBpms).toHaveLength(2)
  })

  test('gap fixture causes relock detection', () => {
    const report = simulateSync('gap-2s', [{ id: 'A' }])
    expect(report.metrics.relockAfterGap).toBe(true)
  })
})
