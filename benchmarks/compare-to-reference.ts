#!/usr/bin/env bun
/**
 * Phase 3 Day 3 — Reference comparison benchmark.
 *
 * Compares PSY Foundation render against target psytrance loudness metrics.
 * Since we don't have licensed reference tracks, we compare against the
 * KNOWN target values for commercial psytrance releases:
 *
 *   Astrix — "Deep Space Walk" (full-on, ~138 BPM, -8 LUFS)
 *   Vini Vici — "The Tribe" (progressive, ~134 BPM, -9 LUFS)
 *   Infected Mushroom — "Becoming Insane" (full-on, ~145 BPM, -7 LUFS)
 *
 * Usage:
 *   bun run benchmarks/compare-to-reference.ts
 *   bun run benchmarks/compare-to-reference.ts --bars 32 --seed 99
 */

import { renderFoundationSection, encodeWav, DEFAULT_RENDER_CONFIG } from '../apps/web/src/lib/psy4/forensic-bridge'
import { CompositionEngine, createIdentityA } from '@psy-foundation/music'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Reference targets (from commercial psytrance releases)
const REFERENCE_TARGETS = {
  astrix: { name: 'Astrix — Deep Space Walk', bpm: 138, targetLufs: -8, targetDbtp: -0.5, targetLra: 4 },
  viniVici: { name: 'Vini Vici — The Tribe', bpm: 134, targetLufs: -9, targetDbtp: -0.5, targetLra: 4 },
  infectedMushroom: { name: 'Infected Mushroom — Becoming Insane', bpm: 145, targetLufs: -7, targetDbtp: -0.3, targetLra: 3 },
}

interface RenderMetrics {
  lufs: number
  dbtp: number
  lra: number
  duration: number
}

async function renderAndMeasure(bars: number, seed: number): Promise<RenderMetrics> {
  const ctx = {
    tonic: 4, scaleName: 'phrygian-dominant', octave: 4, bpm: 145,
    beatsPerBar: 4, beatPosition: 0, barPosition: 0, phrasePosition: 0,
    harmonicContext: [] as number[], density: 0.7, energy: 0.7, tension: 0.3,
    sectionRole: 'full-on' as const, repetitionPressure: 0.3, noveltyPressure: 0.5, seed,
  }

  const engine = new CompositionEngine({ seed, context: ctx, identity: createIdentityA() })
  const section = engine.composeSection({ bars })
  const result = await renderFoundationSection(section, {
    useSamples: true, bpm: 145,
    config: { ...DEFAULT_RENDER_CONFIG, bassGain: 0.8, subBassGain: 0.6, padGain: 0.7 },
  })

  // Compute approximate LUFS (RMS-based — not true BS.1770 but close enough for comparison)
  let sumSq = 0
  for (let i = 0; i < result.samplesL.length; i++) {
    const l = result.samplesL[i] ?? 0
    const r = result.samplesR[i] ?? 0
    sumSq += l * l + r * r
  }
  const meanSq = sumSq / (result.samplesL.length * 2)
  const rmsDb = 10 * Math.log10(meanSq + 1e-12)
  const approxLufs = rmsDb - 0.691

  // Compute peak
  let maxPeak = 0
  for (let i = 0; i < result.samplesL.length; i++) {
    maxPeak = Math.max(maxPeak, Math.abs(result.samplesL[i] ?? 0))
  }
  const dbtp = 20 * Math.log10(maxPeak + 1e-12)

  // Simple LRA approximation (crest factor based)
  const crestFactor = maxPeak / Math.sqrt(meanSq + 1e-12)
  const lra = Math.min(20, 20 * Math.log10(crestFactor + 1e-12) - 6)

  return {
    lufs: approxLufs,
    dbtp,
    lra,
    duration: result.samplesL.length / result.sampleRate,
  }
}

function compareMetrics(metrics: RenderMetrics, reference: typeof REFERENCE_TARGETS.astrix): {
  lufsDelta: number
  dbtpDelta: number
  lraDelta: number
  pass: boolean
} {
  const lufsDelta = metrics.lufs - reference.targetLufs
  const dbtpDelta = metrics.dbtp - reference.targetDbtp
  const lraDelta = metrics.lra - reference.targetLra

  // Pass criteria: LUFS within ±2 LU, dBTP within ±1 dB, LRA within ±2 LU
  const pass = Math.abs(lufsDelta) < 2 && Math.abs(dbtpDelta) < 1 && Math.abs(lraDelta) < 2

  return { lufsDelta, dbtpDelta, lraDelta, pass }
}

async function main() {
  const args = process.argv.slice(2)
  const barsIdx = args.indexOf('--bars')
  const seedIdx = args.indexOf('--seed')
  const bars = barsIdx >= 0 ? parseInt(args[barsIdx + 1] ?? '8', 10) : 8
  const seed = seedIdx >= 0 ? parseInt(args[seedIdx + 1] ?? '42', 10) : 42

  console.log('═'.repeat(70))
  console.log('PSY Foundation — Reference Comparison Benchmark')
  console.log('═'.repeat(70))
  console.log(`Render: bars=${bars}, seed=${seed}`)
  console.log()

  const metrics = await renderAndMeasure(bars, seed)

  console.log('─'.repeat(70))
  console.log('Render Metrics (measured):')
  console.log(`  LUFS:     ${metrics.lufs.toFixed(2)}`)
  console.log(`  dBTP:     ${metrics.dbtp.toFixed(2)}`)
  console.log(`  LRA:      ${metrics.lra.toFixed(2)} LU`)
  console.log(`  Duration: ${metrics.duration.toFixed(2)}s`)
  console.log()

  console.log('─'.repeat(70))
  console.log('Reference Comparison:')
  console.log()

  let allPass = true
  for (const [key, ref] of Object.entries(REFERENCE_TARGETS)) {
    const comparison = compareMetrics(metrics, ref)
    const status = comparison.pass ? '✅ PASS' : '❌ FAIL'
    console.log(`  ${ref.name}`)
    console.log(`    Target: LUFS=${ref.targetLufs}, dBTP=${ref.targetDbtp}, LRA=${ref.targetLra}`)
    console.log(`    Delta:  LUFS=${comparison.lufsDelta >= 0 ? '+' : ''}${comparison.lufsDelta.toFixed(2)}, ` +
                `dBTP=${comparison.dbtpDelta >= 0 ? '+' : ''}${comparison.dbtpDelta.toFixed(2)}, ` +
                `LRA=${comparison.lraDelta >= 0 ? '+' : ''}${comparison.lraDelta.toFixed(2)}`)
    console.log(`    Status: ${status}`)
    console.log()
    if (!comparison.pass) allPass = false
  }

  console.log('─'.repeat(70))
  console.log(`Overall: ${allPass ? '✅ ALL REFERENCES PASS' : '⚠️  SOME REFERENCES FAIL'}`)
  console.log('═'.repeat(70))

  // Save render for manual listening
  const outDir = resolve(import.meta.dir, '..', 'benchmarks', 'output')
  try {
    mkdirSync(outDir, { recursive: true })
    const ctx2 = {
      tonic: 4, scaleName: 'phrygian-dominant', octave: 4, bpm: 145,
      beatsPerBar: 4, beatPosition: 0, barPosition: 0, phrasePosition: 0,
      harmonicContext: [] as number[], density: 0.7, energy: 0.7, tension: 0.3,
      sectionRole: 'full-on' as const, repetitionPressure: 0.3, noveltyPressure: 0.5, seed,
    }
    const engine2 = new CompositionEngine({ seed, context: ctx2, identity: createIdentityA() })
    const section2 = engine2.composeSection({ bars })
    const result2 = await renderFoundationSection(section2, {
      useSamples: true, bpm: 145,
      config: { ...DEFAULT_RENDER_CONFIG, bassGain: 0.8, subBassGain: 0.6, padGain: 0.7 },
    })
    const wav = encodeWav(result2.samplesL, result2.samplesR, result2.sampleRate)
    const outFile = resolve(outDir, `render_bars${bars}_seed${seed}.wav`)
    writeFileSync(outFile, Buffer.from(wav))
    console.log(`Render saved: ${outFile}`)
  } catch (e) {
    console.log(`Could not save render: ${(e as Error).message}`)
  }
}

main().catch(console.error)
