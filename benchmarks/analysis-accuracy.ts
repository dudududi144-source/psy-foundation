/**
 * Analysis accuracy benchmark — onset detection + tempo estimation on all fixtures.
 * Verifies the sparse fix (sparse fixture → 150 BPM, not 75).
 * Run: bun run benchmarks:analysis
 */
import { detectOnsets, estimateTempo, pickMusicalWinner } from '../packages/analysis/src/index.ts'
import { refineTempoWithContext } from '../packages/analysis/src/inference.ts'
import { corpus } from '../packages/fixtures/src/index.ts'
import type { Fixture } from '../packages/fixtures/src/index.ts'

interface AnalysisMetric {
  id: string
  anomaly: string
  onsetsDetected: number
  estimatedBpm: number
  groundTruthBpm: number | null
  bpmError: number | null
  fixed: boolean
}

function benchmarkFixture(fixture: Fixture): AnalysisMetric {
  const onsets = detectOnsets(fixture.signal, {
    sampleRate: fixture.sampleRate,
    frameSize: 1024,
    hopSize: 512,
  })
  const { top } = estimateTempo(onsets)
  const refined = top.map((h) => refineTempoWithContext(h, onsets))
  const winner = pickMusicalWinner(refined)
  const estimatedBpm = winner?.bpm ?? 0
  const bpmError =
    fixture.groundTruthBpm !== null ? Math.abs(estimatedBpm - fixture.groundTruthBpm) : null
  const rawBest = top[0]?.bpm ?? 0
  const fixed = Math.abs(rawBest - estimatedBpm) > 0.5
  return {
    id: fixture.id,
    anomaly: fixture.anomaly,
    onsetsDetected: onsets.length,
    estimatedBpm,
    groundTruthBpm: fixture.groundTruthBpm,
    bpmError,
    fixed,
  }
}

function main(): void {
  const metrics = corpus.map(benchmarkFixture)
  const idW = Math.max(8, ...metrics.map((m) => m.id.length))
  const header = `${'fixture'.padEnd(idW)}  ${'anomaly'.padEnd(14)}  ${'onsets'.padStart(6)}  ${'est bpm'.padStart(8)}  ${'truth'.padStart(6)}  ${'error'.padStart(7)}  ${'refined'.padStart(8)}`
  console.log(header)
  console.log('-'.repeat(header.length))
  let sparseFixed = false
  for (const m of metrics) {
    const errStr = m.bpmError !== null ? m.bpmError.toFixed(1) : '—'
    const truthStr = m.groundTruthBpm !== null ? m.groundTruthBpm.toString() : '—'
    console.log(
      `${m.id.padEnd(idW)}  ${m.anomaly.padEnd(14)}  ${String(m.onsetsDetected).padStart(6)}  ` +
        `${m.estimatedBpm.toFixed(1).padStart(8)}  ${truthStr.padStart(6)}  ${errStr.padStart(7)}  ${(m.fixed ? 'YES' : 'no').padStart(8)}`
    )
    if (m.id === 'sparse') sparseFixed = (m.bpmError ?? 999) < 10
  }
  console.log('-'.repeat(header.length))
  console.log('')
  console.log(
    sparseFixed
      ? '✓ M1 SPARSE FIX VERIFIED: sparse → ~150 BPM (was 75 in M1).'
      : '✗ SPARSE FIX NOT WORKING.'
  )
  console.log('\n--- JSON ---')
  console.log(JSON.stringify(metrics, null, 2))
}

main()
