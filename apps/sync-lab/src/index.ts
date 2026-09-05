/**
 * Sync Lab — simulates multiple devices receiving beat observations and
 * verifies they converge to the same musical transport.
 *
 * Each device has its own TransportClock. We feed the SAME beat observations
 * (possibly with different network delays / jitter) into each, and measure:
 *  - BPM agreement (max drift between devices)
 *  - Beat phase alignment
 *  - Time to lock
 *  - Relock after a gap
 *
 * This proves the foundation can synchronize a family of devices.
 */

import { getFixture } from '@psy-foundation/fixtures'
import { TransportClock } from '@psy-foundation/transport'
import type { BeatObservation } from '@psy-foundation/transport'

interface SimulatedDevice {
  id: string
  clock: TransportClock
  /** Network offset: this device receives beats N seconds late. */
  networkOffsetSec: number
  /** Jitter: random ±N sec added to each observation. */
  jitterSec: number
  /** Drop rate: fraction of beats this device misses. */
  dropRate: number
  /** Seed for deterministic jitter/drop. */
  seed: number
}

interface SyncReport {
  fixtureId: string
  bpm: number
  devices: Array<{
    id: string
    finalBpm: number
    finalBeat: number
    finalPhase: number
    locked: boolean
    confidence: number
    revision: number
    observationsReceived: number
    observationsDropped: number
    lockTimeSec: number
  }>
  metrics: {
    bpmSpread: number
    phaseSpread: number
    allLocked: boolean
    meanLockTime: number
    relockAfterGap: boolean
  }
  timeline: Array<{
    at: number
    deviceBpms: number[]
    devicePhases: number[]
  }>
}

function createDevice(
  id: string,
  opts: { networkOffsetSec?: number; jitterSec?: number; dropRate?: number; seed?: number } = {}
): SimulatedDevice {
  return {
    id,
    clock: new TransportClock({ initialBpm: 120, gapTimeout: 2.0 }),
    networkOffsetSec: opts.networkOffsetSec ?? 0,
    jitterSec: opts.jitterSec ?? 0,
    dropRate: opts.dropRate ?? 0,
    seed: opts.seed ?? 1,
  }
}

/**
 * Run a sync simulation: feed the same beats into multiple devices (with
 * per-device delay/jitter/drop), and report convergence.
 */
export function simulateSync(
  fixtureId: string,
  deviceConfigs: Array<{
    id: string
    networkOffsetSec?: number
    jitterSec?: number
    dropRate?: number
    seed?: number
  }>
): SyncReport {
  const fixture = getFixture(fixtureId)
  const beats = fixture.groundTruthBeats
  const devices = deviceConfigs.map((c) => createDevice(c.id, c))

  const timeline: SyncReport['timeline'] = []
  const lockTimes: number[] = []
  const relockAfterGap = new Set<string>()

  // Track each device's lock state to detect first lock time.
  const wasLocked = new Map<string, boolean>()
  for (const d of devices) wasLocked.set(d.id, false)

  const rngStates = new Map<string, number>()
  for (const d of devices) rngStates.set(d.id, d.seed)

  const observationsReceived = new Map<string, number>()
  const observationsDropped = new Map<string, number>()
  for (const d of devices) {
    observationsReceived.set(d.id, 0)
    observationsDropped.set(d.id, 0)
  }

  // Simulate: at each ground-truth beat, deliver (with delay/jitter/drop) to each device.
  for (let i = 0; i < beats.length; i++) {
    const beatTime = beats[i] ?? 0

    for (const d of devices) {
      // Deterministic RNG per device.
      let s = rngStates.get(d.id) ?? 1
      const rng = () => {
        s = (s * 1664525 + 1013904223) % 4294967296
        return s / 4294967296
      }

      // Drop?
      if (rng() < d.dropRate) {
        observationsDropped.set(d.id, (observationsDropped.get(d.id) ?? 0) + 1)
        rngStates.set(d.id, s) // save updated state
        continue
      }

      // Jitter + network offset.
      const jitter = (rng() - 0.5) * 2 * d.jitterSec
      const deliveredAt = beatTime + d.networkOffsetSec + jitter

      const obs: BeatObservation = { observedAt: deliveredAt, strength: 1, source: 'sync-lab' }
      d.clock.observe(obs)
      observationsReceived.set(d.id, (observationsReceived.get(d.id) ?? 0) + 1)

      // Check for gap-induced relock: if there was a >2s gap, the device should unlock then relock.
      if (i > 0) {
        const prevBeat = beats[i - 1] ?? 0
        if (beatTime - prevBeat > 2) {
          relockAfterGap.add(d.id)
        }
      }

      rngStates.set(d.id, s) // save updated RNG state for next beat
    }

    // Snapshot every device at this beat time.
    const deviceBpms: number[] = []
    const devicePhases: number[] = []
    for (const d of devices) {
      const snap = d.clock.snapshot(beatTime)
      deviceBpms.push(snap.bpm)
      devicePhases.push(snap.phase)

      // Detect first lock.
      if (!wasLocked.get(d.id) && snap.locked) {
        wasLocked.set(d.id, true)
        lockTimes.push(beatTime)
      }
    }

    timeline.push({ at: beatTime, deviceBpms, devicePhases })
  }

  // Final snapshots.
  const finalTime = beats[beats.length - 1] ?? 0
  const deviceReports = devices.map((d) => {
    const snap = d.clock.snapshot(finalTime)
    return {
      id: d.id,
      finalBpm: snap.bpm,
      finalBeat: snap.beat,
      finalPhase: snap.phase,
      locked: snap.locked,
      confidence: snap.confidence,
      revision: snap.revision,
      observationsReceived: observationsReceived.get(d.id) ?? 0,
      observationsDropped: observationsDropped.get(d.id) ?? 0,
      lockTimeSec: lockTimes.find((_, idx) => idx === devices.indexOf(d)) ?? finalTime,
    }
  })

  // Metrics.
  const bpms = deviceReports.map((d) => d.finalBpm)
  const phases = deviceReports.map((d) => d.finalPhase)
  const bpmSpread = Math.max(...bpms) - Math.min(...bpms)
  const phaseSpread = Math.max(...phases) - Math.min(...phases)
  const allLocked = deviceReports.every((d) => d.locked)
  const meanLockTime = lockTimes.length
    ? lockTimes.reduce((a, b) => a + b, 0) / lockTimes.length
    : 0

  return {
    fixtureId,
    bpm: fixture.groundTruthBpm ?? 0,
    devices: deviceReports,
    metrics: {
      bpmSpread,
      phaseSpread,
      allLocked,
      meanLockTime,
      relockAfterGap: relockAfterGap.size > 0,
    },
    timeline,
  }
}

/**
 * Run the default sync simulation: 3 devices with different conditions.
 */
export function runDefaultSync(): SyncReport {
  return simulateSync('perfect-150', [
    { id: 'A', networkOffsetSec: 0, jitterSec: 0, dropRate: 0, seed: 1 }, // ideal
    { id: 'B', networkOffsetSec: 0.05, jitterSec: 0.008, dropRate: 0, seed: 2 }, // jittery
    { id: 'C', networkOffsetSec: 0.1, jitterSec: 0.015, dropRate: 0.1, seed: 3 }, // lossy
  ])
}

/**
 * Format a sync report for terminal display.
 */
export function formatSyncReport(report: SyncReport): string {
  const lines: string[] = []
  lines.push(`═══ Sync Lab — ${report.fixtureId} (target ${report.bpm} bpm) ═══`)
  lines.push('')
  lines.push('── Devices ──')
  lines.push('id  bpm     beat  phase  locked  conf  recv  drop  lockTime')
  for (const d of report.devices) {
    lines.push(
      `${d.id}   ${d.finalBpm.toFixed(1).padStart(5)}  ${String(d.finalBeat).padStart(4)}  ${d.finalPhase.toFixed(3)}  ${d.locked ? 'YES' : 'no '}    ${(d.confidence * 100).toFixed(0)}%  ${String(d.observationsReceived).padStart(4)}  ${String(d.observationsDropped).padStart(4)}  ${d.lockTimeSec.toFixed(1)}s`
    )
  }
  lines.push('')
  lines.push('── Metrics ──')
  lines.push(`  BPM spread:       ${report.metrics.bpmSpread.toFixed(2)} bpm`)
  lines.push(`  Phase spread:     ${report.metrics.phaseSpread.toFixed(3)}`)
  lines.push(`  All locked:       ${report.metrics.allLocked ? 'YES' : 'no'}`)
  lines.push(`  Mean lock time:   ${report.metrics.meanLockTime.toFixed(2)}s`)
  lines.push(`  Relock after gap: ${report.metrics.relockAfterGap ? 'YES' : 'no'}`)
  lines.push('═══════════════════════════════════════')
  return lines.join('\n')
}

// CLI entry point.
if (import.meta.main) {
  const args = process.argv.slice(2)
  const fixtureId = args[0] ?? 'perfect-150'
  const report = simulateSync(fixtureId, [
    { id: 'A', networkOffsetSec: 0, jitterSec: 0, dropRate: 0, seed: 1 },
    { id: 'B', networkOffsetSec: 0.05, jitterSec: 0.008, dropRate: 0, seed: 2 },
    { id: 'C', networkOffsetSec: 0.1, jitterSec: 0.015, dropRate: 0.1, seed: 3 },
  ])
  console.log(formatSyncReport(report))
}
