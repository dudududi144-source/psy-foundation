/**
 * Reference Lab — research tool for analyzing audio signals.
 *
 * Feed it an audio signal (or a fixture id) and it produces a full analysis
 * report: BPM, beat grid, phase, confidence, key candidates, energy, spectral
 * features, role occupancy, section boundaries.
 *
 * This is a research tool, not a product. It exists to prove the analysis
 * pipeline works end-to-end on real-ish audio.
 */

import { Analyzer } from '@psy-foundation/analysis'
import type { AnalyzerFrame } from '@psy-foundation/analysis'
import { corpus, getFixture } from '@psy-foundation/fixtures'
import type { Fixture } from '@psy-foundation/fixtures'

interface AnalysisReport {
  fixtureId: string
  anomaly: string
  durationSec: number
  onsets: { at: number; strength: number }[]
  tempo: {
    bpm: number
    confidence: number
    phase: number
    topCandidates: { bpm: number; score: number }[]
  }
  key: {
    dominantPc: number
    dominantName: string
    strength: number
    chroma: number[]
  }
  energy: {
    rms: number
    peak: number
    class: string
  }
  features: {
    centroidHz: number
    flatness: number
    bassActivity: number
    highEnergy: number
  }
  sections: string[]
  sectionBoundaries: number[]
  roleOccupancy: { kick: number; bass: number; lead: number; hats: number }
  frameCount: number
}

/**
 * Analyze a fixture by id. Returns a full report.
 */
export function analyzeFixture(fixtureId: string): AnalysisReport {
  const fixture = getFixture(fixtureId)
  return analyzeSignal(
    fixture.signal,
    fixture.sampleRate,
    fixture.id,
    fixture.anomaly,
    fixture.durationSec
  )
}

/**
 * Analyze a raw audio signal. Returns a full report.
 */
function analyzeSignal(
  signal: Float32Array,
  sampleRate: number,
  fixtureId = 'custom',
  anomaly = 'unknown',
  durationSec = signal.length / sampleRate
): AnalysisReport {
  const analyzer = new Analyzer({ sampleRate, frameSize: 1024, hopSize: 512 })

  // Process the signal frame-by-frame to build feature history.
  const frameSize = 1024
  const hopSize = 512
  const frame = new Float32Array(frameSize)
  const frames: AnalyzerFrame[] = []

  for (let start = 0; start + frameSize <= signal.length; start += hopSize) {
    for (let i = 0; i < frameSize; i++) frame[i] = signal[start + i] ?? 0
    const f = analyzer.ingest(frame)
    frames.push(f)
  }

  // Run onset detection over the full signal.
  const onsets = analyzer.detectOnsetsIn(signal)

  // Tempo estimation (with sparse fix).
  const tempoResult = analyzer.estimateTempo()
  const musicalTempo = analyzer.musicalTempo()
  const bpm = musicalTempo?.bpm ?? tempoResult.best?.bpm ?? 0
  const confidence = musicalTempo?.score ?? tempoResult.best?.score ?? 0
  const phase = musicalTempo?.phase ?? tempoResult.best?.phase ?? 0

  // Key / chroma (use the latest chroma).
  const chromaVec = analyzer.latestChroma ?? new Float32Array(12)
  const dominant = analyzer.latestDominantPitchClass ?? { name: '?', pc: 0, strength: 0 }

  // Energy: derive from inference (bassRatio is a proxy for energy presence).
  const inferences = frames.map((f) => f.inference).filter((i) => i !== null) as NonNullable<
    (typeof frames)[0]['inference']
  >[]
  const energyClasses = inferences.map((i) => i.energy)
  const energyClass = energyClasses.length ? mostCommon(energyClasses) : 'silent'

  // Approximate RMS from flux (louder frames have higher flux on average).
  const fluxValues = frames.map((f) => f.flux)
  const avgRms = avgOf(fluxValues)
  const peak = fluxValues.length ? Math.max(...fluxValues) : 0

  // Features (averaged across frames via inference).
  const avgCentroid = avgOf(inferences.map((i) => i.brightness * 4000)) // brightness is normalized 0..1
  const avgFlatness = avgOf(inferences.map((i) => i.noisiness))
  const avgBass = avgOf(inferences.map((i) => i.bassRatio))
  const avgHigh = avgOf(inferences.map((i) => 1 - i.bassRatio)) // proxy

  // Sections.
  const sections = [...analyzer.sections]
  const sectionBoundaries = analyzer.sectionBoundaries

  // Role occupancy (from the latest inference).
  const inference = analyzer.latestInference
  const roleOccupancy = inference?.occupancy ?? { kick: 0, bass: 0, lead: 0, hats: 0 }

  return {
    fixtureId,
    anomaly,
    durationSec,
    onsets: onsets.map((o) => ({ at: o.at, strength: o.strength })),
    tempo: {
      bpm,
      confidence,
      phase,
      topCandidates: (tempoResult.top ?? [])
        .slice(0, 3)
        .map((h) => ({ bpm: h.bpm, score: h.score })),
    },
    key: {
      dominantPc: dominant.pc,
      dominantName: dominant.name,
      strength: dominant.strength,
      chroma: [...chromaVec],
    },
    energy: {
      rms: avgRms,
      peak,
      class: energyClass,
    },
    features: {
      centroidHz: avgCentroid,
      flatness: avgFlatness,
      bassActivity: avgBass,
      highEnergy: avgHigh,
    },
    sections,
    sectionBoundaries,
    roleOccupancy,
    frameCount: frames.length,
  }
}

function avgOf(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function mostCommon<T>(arr: T[]): T {
  const counts = new Map<T, number>()
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = arr[0] as T
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}

/**
 * Format a report for terminal display.
 */
export function formatReport(report: AnalysisReport): string {
  const lines: string[] = []
  lines.push(`═══ Reference Lab — ${report.fixtureId} ═══`)
  lines.push(
    `Anomaly: ${report.anomaly}  |  Duration: ${report.durationSec.toFixed(1)}s  |  Frames: ${report.frameCount}`
  )
  lines.push('')
  lines.push('── Tempo ──')
  lines.push(`  BPM:        ${report.tempo.bpm.toFixed(1)}`)
  lines.push(`  Confidence: ${(report.tempo.confidence * 100).toFixed(0)}%`)
  lines.push(`  Phase:      ${report.tempo.phase.toFixed(3)}`)
  if (report.tempo.topCandidates.length > 0) {
    lines.push('  Candidates:')
    for (const c of report.tempo.topCandidates) {
      lines.push(`    ${c.bpm.toFixed(1)} bpm (score ${c.score.toFixed(3)})`)
    }
  }
  lines.push('')
  lines.push('── Key ──')
  lines.push(
    `  Dominant:   ${report.key.dominantName} (pc ${report.key.dominantPc}, strength ${report.key.strength.toFixed(2)})`
  )
  lines.push(`  Chroma:     [${report.key.chroma.map((v) => v.toFixed(2)).join(', ')}]`)
  lines.push('')
  lines.push('── Energy ──')
  lines.push(`  RMS:        ${report.energy.rms.toFixed(4)}`)
  lines.push(`  Peak:       ${report.energy.peak.toFixed(4)}`)
  lines.push(`  Class:      ${report.energy.class}`)
  lines.push('')
  lines.push('── Spectral Features ──')
  lines.push(`  Centroid:   ${report.features.centroidHz.toFixed(0)} Hz`)
  lines.push(`  Flatness:   ${report.features.flatness.toFixed(3)}`)
  lines.push(`  Bass:       ${report.features.bassActivity.toFixed(2)}`)
  lines.push(`  High:       ${report.features.highEnergy.toFixed(2)}`)
  lines.push('')
  lines.push('── Role Occupancy ──')
  const ro = report.roleOccupancy
  lines.push(
    `  Kick: ${(ro.kick * 100).toFixed(0)}%  Bass: ${(ro.bass * 100).toFixed(0)}%  Lead: ${(ro.lead * 100).toFixed(0)}%  Hats: ${(ro.hats * 100).toFixed(0)}%`
  )
  lines.push('')
  lines.push('── Sections ──')
  lines.push(`  Sequence:   ${report.sections.join(' → ') || '(none)'}`)
  lines.push(`  Boundaries: ${report.sectionBoundaries.join(', ') || '(none)'}`)
  lines.push('')
  lines.push(`── Onsets (${report.onsets.length}) ──`)
  const first10 = report.onsets.slice(0, 10)
  for (const o of first10) {
    lines.push(`  ${o.at.toFixed(3)}s  strength ${o.strength.toFixed(2)}`)
  }
  if (report.onsets.length > 10) lines.push(`  ... and ${report.onsets.length - 10} more`)
  lines.push('═══════════════════════════════════════')
  return lines.join('\n')
}

/**
 * Analyze all fixtures and return a summary table.
 */
export function analyzeAllFixtures(): AnalysisReport[] {
  return corpus.map((f: Fixture) => analyzeFixture(f.id))
}

// CLI entry point.
if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.log('Usage: bun src/index.ts [fixture-id|all]')
    console.log('Available fixtures:')
    for (const f of corpus) console.log(`  ${f.id}  (${f.anomaly})`)
    process.exit(0)
  }
  if (args[0] === 'all') {
    const reports = analyzeAllFixtures()
    console.log('fixture          bpm    conf   key   energy  bass   kick%')
    console.log('─────────────────────────────────────────────────────────')
    for (const r of reports) {
      console.log(
        `${r.fixtureId.padEnd(16)} ${r.tempo.bpm.toFixed(1).padStart(5)}  ${(r.tempo.confidence * 100).toFixed(0).padStart(3)}%  ${r.key.dominantName.padEnd(4)}  ${r.energy.class.padEnd(7)} ${(r.features.bassActivity).toFixed(2)}   ${(r.roleOccupancy.kick * 100).toFixed(0)}%`
      )
    }
  } else {
    const report = analyzeFixture(args[0] as string)
    console.log(formatReport(report))
  }
}
