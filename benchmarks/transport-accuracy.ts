import { corpus } from '../packages/fixtures/src/index.ts'
import type { Fixture } from '../packages/fixtures/src/index.ts'
/**
 * Transport accuracy benchmark — phase error mean/median/P95 across all fixtures.
 * Run: bun run benchmarks:transport
 */
import { TransportClock } from '../packages/transport/src/index.ts'

interface FixtureMetrics {
  id: string
  anomaly: string
  samples: number
  meanMs: number
  medianMs: number
  p95Ms: number
  maxMs: number
  bpmError: number | null
  lockRate: number
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo] ?? 0
  const frac = pos - lo
  return (sorted[lo] ?? 0) * (1 - frac) + (sorted[hi] ?? 0) * frac
}

function benchmarkFixture(fixture: Fixture): FixtureMetrics {
  const beats = fixture.groundTruthBeats
  const clock = new TransportClock({ initialBpm: 130 })
  const errorsMs: number[] = []
  let lockedCount = 0
  let measured = 0
  const warmup = Math.min(4, beats.length)
  for (let i = 0; i < warmup; i++) clock.observe({ observedAt: beats[i] ?? 0, strength: 1 })

  for (let i = warmup; i < beats.length; i++) {
    const t = beats[i]
    if (t === undefined) continue
    const snap = clock.snapshot(t)
    if (snap.locked) lockedCount += 1
    measured += 1
    const secPerBeat = 60 / snap.bpm
    const predicted = clock.predict(t)
    const nearest = Math.round(predicted)
    const phaseErrorBeats = Math.abs(predicted - nearest)
    errorsMs.push(phaseErrorBeats * secPerBeat * 1000)
    clock.observe({ observedAt: t, strength: 1 })
  }

  errorsMs.sort((a, b) => a - b)
  const sum = errorsMs.reduce((a, b) => a + b, 0)
  const mean = errorsMs.length ? sum / errorsMs.length : 0
  let bpmError: number | null = null
  if (fixture.groundTruthBpm !== null) {
    const finalSnap = clock.snapshot(beats[beats.length - 1] ?? 0)
    bpmError = Math.abs(finalSnap.bpm - fixture.groundTruthBpm)
  }
  return {
    id: fixture.id,
    anomaly: fixture.anomaly,
    samples: measured,
    meanMs: mean,
    medianMs: quantile(errorsMs, 0.5),
    p95Ms: quantile(errorsMs, 0.95),
    maxMs: errorsMs[errorsMs.length - 1] ?? 0,
    bpmError,
    lockRate: measured ? lockedCount / measured : 0,
  }
}

function main(): void {
  const metrics = corpus.map(benchmarkFixture)
  const idW = Math.max(8, ...metrics.map((m) => m.id.length))
  const header = `${'fixture'.padEnd(idW)}  ${'anomaly'.padEnd(14)}  ${'n'.padStart(4)}  ${'mean'.padStart(7)}  ${'median'.padStart(7)}  ${'p95'.padStart(7)}  ${'bpmΔ'.padStart(8)}  ${'lock%'.padStart(5)}`
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const m of metrics) {
    console.log(
      `${m.id.padEnd(idW)}  ${m.anomaly.padEnd(14)}  ${String(m.samples).padStart(4)}  ` +
        `${m.meanMs.toFixed(2).padStart(7)}  ${m.medianMs.toFixed(2).padStart(7)}  ${m.p95Ms.toFixed(2).padStart(7)}  ` +
        `${(m.bpmError ?? '-').toString().padStart(8)}  ${(m.lockRate * 100).toFixed(0).padStart(5)}`
    )
  }
  console.log('-'.repeat(header.length))
  console.log('\n--- JSON ---')
  console.log(JSON.stringify(metrics, null, 2))
}

main()
