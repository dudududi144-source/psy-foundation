/**
 * Auto-Fixer v2 — closed-loop DSP optimization for PSY4 Stage 9.
 *
 * Pipeline: render → critique → diagnose → vary DSP parameters → re-render.
 *
 * The bridge now accepts a RenderConfig with tunable voice/mix parameters.
 * The auto-fixer varies these to maximize the AudioCritic score, targeting
 * specific failure codes with targeted corrections.
 *
 * DETERMINISM: No Math.random. Same seed → same optimization path.
 */

import { CompositionEngine, createIdentityA } from '../../foundation/music'
import { renderFoundationSection, DEFAULT_RENDER_CONFIG } from './forensic-bridge'
import type { RenderConfig } from './forensic-bridge'
import { critiqueAudio } from './audio-critic'

const BPM = 145
const STEPS_PER_BAR = 16

export interface OptimizationIteration {
  iteration: number
  configName: string
  config: RenderConfig
  score: number
  failures: Array<{ code: string; severity: number }>
  improvement: number
}

export interface OptimizationReport {
  iterations: OptimizationIteration[]
  initialScore: number
  finalScore: number
  improvement: number
  bestConfig: RenderConfig
  bestIteration: number
  verdict: 'PASS' | 'FAIL' | 'PARTIAL'
  durationMs: number
}

// ── Iteration plans: each varies specific DSP parameters ──

const ITERATION_PLANS: Array<{ name: string; overrides: Partial<RenderConfig> }> = [
  { name: 'baseline', overrides: {} },
  { name: 'boost-high-end', overrides: { hatGain: 1.5, openHatGain: 0.7, leadCutoff: 6000, shakerGain: 1.6 } },
  { name: 'reduce-low-mid', overrides: { bassGain: 0.8, subBassGain: 0.6, padGain: 0.7 } },
  { name: 'boost-lead', overrides: { leadGain: 1.4, leadCutoff: 6500, leadResonance: 0.6 } },
  { name: 'tighter-kick', overrides: { kickDecay: 0.08, duckAmount: 0.85 } },
  { name: 'wider-stereo', overrides: { stereoWidth: 1.6 } },
  { name: 'combined-1', overrides: { hatGain: 1.5, leadCutoff: 6000, shakerGain: 1.6, bassGain: 0.8, subBassGain: 0.6, leadGain: 1.3 } },
  { name: 'combined-2', overrides: { hatGain: 1.6, leadCutoff: 6500, shakerGain: 1.8, bassGain: 0.75, subBassGain: 0.5, leadGain: 1.4, kickDecay: 0.08, duckAmount: 0.85, stereoWidth: 1.5 } },
]

// ── Failure-driven corrections ──
// After the baseline, apply targeted corrections based on which failures are present.

function applyFailureCorrections(
  base: RenderConfig,
  failures: Array<{ code: string; severity: number }>
): Partial<RenderConfig> {
  const overrides: Partial<RenderConfig> = {}
  for (const f of failures) {
    switch (f.code) {
      case 'HIGH_END_TOO_WEAK':
        overrides.hatGain = Math.min(2.0, (overrides.hatGain ?? base.hatGain) * 1.3)
        overrides.leadCutoff = Math.min(8000, (overrides.leadCutoff ?? base.leadCutoff) * 1.2)
        overrides.shakerGain = Math.min(2.0, (overrides.shakerGain ?? base.shakerGain) * 1.3)
        break
      case 'LEAD_MASKING_BASS':
        overrides.bassGain = Math.max(0.5, (overrides.bassGain ?? base.bassGain) * 0.85)
        overrides.leadGain = Math.min(2.0, (overrides.leadGain ?? base.leadGain) * 1.15)
        break
      case 'KICK_BASS_PHASE_RISK':
        overrides.duckAmount = Math.min(0.95, (overrides.duckAmount ?? base.duckAmount) + 0.1)
        overrides.kickDecay = Math.max(0.05, (overrides.kickDecay ?? base.kickDecay) * 0.85)
        break
      case 'LOW_MID_MUD':
        overrides.bassGain = Math.max(0.5, (overrides.bassGain ?? base.bassGain) * 0.85)
        overrides.subBassGain = Math.max(0.3, (overrides.subBassGain ?? base.subBassGain) * 0.8)
        overrides.padGain = Math.max(0.3, (overrides.padGain ?? base.padGain) * 0.8)
        break
      case 'WEAK_PUNCH':
        overrides.kickDecay = Math.max(0.05, (overrides.kickDecay ?? base.kickDecay) * 0.85)
        break
      case 'LEAD_TOO_STATIC':
        overrides.leadCutoff = Math.min(8000, (overrides.leadCutoff ?? base.leadCutoff) * 1.15)
        overrides.leadResonance = Math.min(0.9, (overrides.leadResonance ?? base.leadResonance) + 0.1)
        break
      case 'WEAK_MOTIF_IDENTITY':
        overrides.leadGain = Math.min(2.0, (overrides.leadGain ?? base.leadGain) * 1.2)
        break
      case 'RHYTHMIC_PATTERN_TOO_UNIFORM':
        overrides.shakerGain = Math.min(2.0, (overrides.shakerGain ?? base.shakerGain) * 1.2)
        overrides.hatGain = Math.min(2.0, (overrides.hatGain ?? base.hatGain) * 1.15)
        break
      case 'NO_TIMBRAL_MOVEMENT':
        overrides.leadCutoff = Math.min(8000, (overrides.leadCutoff ?? base.leadCutoff) * 1.25)
        overrides.leadResonance = Math.min(0.9, (overrides.leadResonance ?? base.leadResonance) + 0.15)
        overrides.leadGain = Math.min(2.0, (overrides.leadGain ?? base.leadGain) * 1.1)
        break
    }
  }
  return overrides
}

// ── Composition context (same as API routes) ──

function buildContext() {
  return {
    tonic: 4,
    scaleName: 'phrygian-dominant',
    octave: 4,
    bpm: BPM,
    beatsPerBar: 4,
    beatPosition: 0,
    barPosition: 0,
    phrasePosition: 0,
    harmonicContext: [],
    density: 0.7,
    energy: 0.7,
    tension: 0.3,
    sectionRole: 'full-on',
    repetitionPressure: 0.3,
    noveltyPressure: 0.5,
  }
}

async function renderAndCritique(
  seed: number,
  bars: number,
  config: RenderConfig,
  useSamples: boolean
): Promise<{ score: number; failures: Array<{ code: string; severity: number }> }> {
  const engine = new CompositionEngine({ seed, context: buildContext(), identity: createIdentityA() })
  const section = engine.composeSection({ bars })
  const result = await renderFoundationSection(section, { useSamples, bpm: BPM, config })
  const mono = new Float32Array(result.samplesL.length)
  for (let i = 0; i < mono.length; i++) {
    mono[i] = ((result.samplesL[i] ?? 0) + (result.samplesR[i] ?? 0)) * 0.5
  }
  const critique = critiqueAudio(mono, result.sampleRate, BPM, STEPS_PER_BAR)
  return {
    score: critique.overallScore,
    failures: critique.failures.map(f => ({ code: f.code, severity: f.severity })),
  }
}

export async function optimizeRender(
  baseSeed: number,
  bars: number,
  maxIterations: number = 8,
  targetScore: number = 0.75
): Promise<OptimizationReport> {
  const t0 = Date.now()
  const iterations: OptimizationIteration[] = []
  const useSamples = true

  // Iteration 0: baseline
  const baselineConfig = { ...DEFAULT_RENDER_CONFIG }
  const baselineResult = await renderAndCritique(baseSeed, bars, baselineConfig, useSamples)
  iterations.push({
    iteration: 0,
    configName: 'baseline',
    config: baselineConfig,
    score: baselineResult.score,
    failures: baselineResult.failures,
    improvement: 0,
  })

  let bestScore = baselineResult.score
  let bestConfig = { ...baselineConfig }
  let bestIteration = 0

  // Subsequent iterations: try each plan, keep the best
  const numIterations = Math.min(maxIterations, ITERATION_PLANS.length)
  for (let it = 1; it < numIterations; it++) {
    const plan = ITERATION_PLANS[it]!
    // If this is a "combined" plan, merge with failure-driven corrections from the best so far
    let overrides = { ...plan.overrides }
    if (plan.name.startsWith('combined')) {
      const failureCorrections = applyFailureCorrections(bestConfig, iterations[bestIteration]!.failures)
      overrides = { ...overrides, ...failureCorrections }
    }
    const config = { ...DEFAULT_RENDER_CONFIG, ...overrides }
    try {
      const result = await renderAndCritique(baseSeed, bars, config, useSamples)
      const improvement = result.score - bestScore
      iterations.push({
        iteration: it,
        configName: plan.name,
        config,
        score: result.score,
        failures: result.failures,
        improvement,
      })
      if (result.score > bestScore) {
        bestScore = result.score
        bestConfig = { ...config }
        bestIteration = it
      }
    } catch (e) {
      iterations.push({
        iteration: it,
        configName: plan.name,
        config,
        score: 0,
        failures: [],
        improvement: -bestScore,
      })
    }
  }

  // If we haven't reached the target, try one more failure-driven iteration
  if (bestScore < targetScore && maxIterations > numIterations) {
    const failureCorrections = applyFailureCorrections(bestConfig, iterations[bestIteration]!.failures)
    const config = { ...bestConfig, ...failureCorrections }
    try {
      const result = await renderAndCritique(baseSeed, bars, config, useSamples)
      const improvement = result.score - bestScore
      iterations.push({
        iteration: numIterations,
        configName: 'failure-driven',
        config,
        score: result.score,
        failures: result.failures,
        improvement,
      })
      if (result.score > bestScore) {
        bestScore = result.score
        bestConfig = { ...config }
        bestIteration = numIterations
      }
    } catch {
      // skip
    }
  }

  const durationMs = Date.now() - t0
  const verdict: 'PASS' | 'FAIL' | 'PARTIAL' =
    bestScore >= targetScore ? 'PASS' : bestScore >= targetScore - 0.1 ? 'PARTIAL' : 'FAIL'

  return {
    iterations,
    initialScore: iterations[0]!.score,
    finalScore: bestScore,
    improvement: bestScore - iterations[0]!.score,
    bestConfig,
    bestIteration,
    verdict,
    durationMs,
  }
}
