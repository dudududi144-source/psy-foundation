import { optimizeRender } from './src/lib/psy4/auto-fixer'

console.log('Starting optimization (8 bars, 8 iterations)...')
const report = await optimizeRender(42, 8, 8, 0.75)
console.log(`\nOptimization complete in ${report.durationMs}ms`)
console.log(`Initial: ${report.initialScore.toFixed(4)}`)
console.log(`Final:   ${report.finalScore.toFixed(4)}`)
console.log(`Improvement: ${report.improvement.toFixed(4)}`)
console.log(`Verdict: ${report.verdict}`)
console.log(`Best iteration: ${report.bestIteration}`)
console.log('\nIterations:')
for (const it of report.iterations) {
  console.log(`  [${it.iteration}] ${it.configName.padEnd(16)} score=${it.score.toFixed(4)} Δ=${it.improvement >= 0 ? '+' : ''}${it.improvement.toFixed(4)} failures=${it.failures.length}`)
  for (const f of it.failures) console.log(`       ${f.code}: ${f.severity.toFixed(3)}`)
}
console.log('\nBest config:')
console.log(JSON.stringify(report.bestConfig, null, 2))
