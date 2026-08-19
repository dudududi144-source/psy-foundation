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

import { CompositionEngine, createIdentityA } from '@psy-foundation/music'
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
// 16 plans covering: 3 high-end, 2 low-mid, 2 lead, 2 kick, 2 stereo, 4 combined.
// (Plus an implicit polish/failure-driven pass after the planned iterations.)

const ITERATION_PLANS: Array<{ name: string; overrides: Partial<RenderConfig> }> = [
  // 0: baseline (control)
  { name: 'baseline', overrides: {} },
  // 1-3: HIGH-END BOOST (target HIGH_END_TOO_WEAK)
  { name: 'high-end-1', overrides: { hatGain: 1.5, openHatGain: 0.7, leadCutoff: 6000, shakerGain: 1.6 } },
  { name: 'high-end-2', overrides: { hatGain: 1.7, leadCutoff: 7000, leadGain: 1.3, shakerGain: 1.8 } },
  { name: 'high-end-3', overrides: { hatGain: 1.8, leadCutoff: 7500, leadGain: 1.4, shakerGain: 1.9, subBassGain: 0.7 } },
  // 4-5: LOW-MID REDUCTION (target LOW_MID_MUD)
  { name: 'low-mid-1', overrides: { bassGain: 0.8, subBassGain: 0.6, padGain: 0.7 } },
  { name: 'low-mid-2', overrides: { bassGain: 0.7, subBassGain: 0.5, padGain: 0.6, duckAmount: 0.85 } },
  // 6-7: LEAD BOOST (target LEAD_TOO_STATIC / WEAK_MOTIF_IDENTITY)
  { name: 'lead-1', overrides: { leadGain: 1.4, leadCutoff: 6500, leadResonance: 0.6 } },
  { name: 'lead-2', overrides: { leadGain: 1.5, leadCutoff: 7000, leadResonance: 0.7 } },
  // 8-9: KICK TIGHTENING (target WEAK_PUNCH / KICK_TRANSIENT_MASKED)
  { name: 'kick-1', overrides: { kickDecay: 0.08, duckAmount: 0.85 } },
  { name: 'kick-2', overrides: { kickDecay: 0.07, duckAmount: 0.9, bassGain: 0.85 } },
  // 10-11: STEREO WIDENING (target stereo contrast)
  { name: 'stereo-1', overrides: { stereoWidth: 1.6 } },
  { name: 'stereo-2', overrides: { stereoWidth: 1.7, hatGain: 1.4, leadGain: 1.2 } },
  // 12-15: COMBINED (target multiple failure codes)
  { name: 'combined-1', overrides: { hatGain: 1.5, leadCutoff: 6000, shakerGain: 1.6, bassGain: 0.8, subBassGain: 0.6, leadGain: 1.3 } },
  { name: 'combined-2', overrides: { hatGain: 1.6, leadCutoff: 6500, shakerGain: 1.8, bassGain: 0.75, subBassGain: 0.5, leadGain: 1.4, kickDecay: 0.08, duckAmount: 0.85, stereoWidth: 1.5 } },
  { name: 'combined-3', overrides: { hatGain: 1.7, leadCutoff: 7000, shakerGain: 1.9, bassGain: 0.7, subBassGain: 0.5, leadGain: 1.5, kickDecay: 0.07, duckAmount: 0.9, stereoWidth: 1.6 } },
  { name: 'combined-4', overrides: { hatGain: 1.8, leadCutoff: 7500, shakerGain: 2.0, bassGain: 0.7, subBassGain: 0.4, leadGain: 1.6, kickDecay: 0.07, duckAmount: 0.95, stereoWidth: 1.7, leadResonance: 0.7 } },
]

// ── Failure-driven corrections ──
// After the baseline, apply targeted corrections based on which failures are present.
// The `strength` multiplier (default 1.0) scales the correction depth — used by
// the second adaptive pass (1.3× stronger corrections).

function applyFailureCorrections(
  base: RenderConfig,
  failures: Array<{ code: string; severity: number }>,
  strength: number = 1.0
): Partial<RenderConfig> {
  const overrides: Partial<RenderConfig> = {}
  for (const f of failures) {
    // Severity-scaled correction depth — more severe failures get stronger corrections.
    const s = Math.max(0.5, Math.min(1.5, 1.0 + f.severity * 0.5)) * strength
    switch (f.code) {
      case 'HIGH_END_TOO_WEAK':
        overrides.hatGain = Math.min(2.5, (overrides.hatGain ?? base.hatGain) * (1 + 0.3 * s))
        overrides.leadCutoff = Math.min(9000, (overrides.leadCutoff ?? base.leadCutoff) * (1 + 0.2 * s))
        overrides.shakerGain = Math.min(2.5, (overrides.shakerGain ?? base.shakerGain) * (1 + 0.3 * s))
        break
      case 'LEAD_MASKING_BASS':
        overrides.bassGain = Math.max(0.4, (overrides.bassGain ?? base.bassGain) * (1 - 0.15 * s))
        overrides.leadGain = Math.min(2.5, (overrides.leadGain ?? base.leadGain) * (1 + 0.15 * s))
        break
      case 'KICK_BASS_PHASE_RISK':
        overrides.duckAmount = Math.min(0.97, (overrides.duckAmount ?? base.duckAmount) + 0.1 * s)
        overrides.kickDecay = Math.max(0.04, (overrides.kickDecay ?? base.kickDecay) * (1 - 0.15 * s))
        break
      case 'LOW_MID_MUD':
        overrides.bassGain = Math.max(0.4, (overrides.bassGain ?? base.bassGain) * (1 - 0.15 * s))
        overrides.subBassGain = Math.max(0.3, (overrides.subBassGain ?? base.subBassGain) * (1 - 0.2 * s))
        overrides.padGain = Math.max(0.3, (overrides.padGain ?? base.padGain) * (1 - 0.2 * s))
        break
      case 'WEAK_PUNCH':
        overrides.kickDecay = Math.max(0.04, (overrides.kickDecay ?? base.kickDecay) * (1 - 0.15 * s))
        break
      case 'KICK_TRANSIENT_MASKED':
        // Kick transient is masked by bass decay overlap — tighten both
        // kick (sharper click) and bass (shorter decay) to clear space.
        overrides.kickDecay = Math.max(0.04, (overrides.kickDecay ?? base.kickDecay) * (1 - 0.2 * s))
        overrides.bassDecay = Math.max(0.03, (overrides.bassDecay ?? base.bassDecay) * (1 - 0.15 * s))
        overrides.duckAmount = Math.min(0.97, (overrides.duckAmount ?? base.duckAmount) + 0.08 * s)
        break
      case 'LEAD_TOO_STATIC':
        overrides.leadCutoff = Math.min(9000, (overrides.leadCutoff ?? base.leadCutoff) * (1 + 0.15 * s))
        overrides.leadResonance = Math.min(0.95, (overrides.leadResonance ?? base.leadResonance) + 0.1 * s)
        break
      case 'WEAK_MOTIF_IDENTITY':
        overrides.leadGain = Math.min(2.5, (overrides.leadGain ?? base.leadGain) * (1 + 0.2 * s))
        break
      case 'RHYTHMIC_PATTERN_TOO_UNIFORM':
        overrides.shakerGain = Math.min(2.5, (overrides.shakerGain ?? base.shakerGain) * (1 + 0.2 * s))
        overrides.hatGain = Math.min(2.5, (overrides.hatGain ?? base.hatGain) * (1 + 0.15 * s))
        break
      case 'NO_TIMBRAL_MOVEMENT':
        overrides.leadCutoff = Math.min(9000, (overrides.leadCutoff ?? base.leadCutoff) * (1 + 0.25 * s))
        overrides.leadResonance = Math.min(0.95, (overrides.leadResonance ?? base.leadResonance) + 0.15 * s)
        overrides.leadGain = Math.min(2.5, (overrides.leadGain ?? base.leadGain) * (1 + 0.1 * s))
        break
      case 'BASS_DECAY_TOO_LONG':
        overrides.bassDecay = Math.max(0.03, (overrides.bassDecay ?? base.bassDecay) * (1 - 0.2 * s))
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
  maxIterations: number = 16,
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

  // First failure-driven adaptive pass: apply corrections based on the best so far
  let nextIterIdx = numIterations
  if (bestScore < targetScore && maxIterations > numIterations) {
    const failureCorrections = applyFailureCorrections(bestConfig, iterations[bestIteration]!.failures)
    const config = { ...bestConfig, ...failureCorrections }
    try {
      const result = await renderAndCritique(baseSeed, bars, config, useSamples)
      const improvement = result.score - bestScore
      iterations.push({
        iteration: nextIterIdx,
        configName: 'failure-driven',
        config,
        score: result.score,
        failures: result.failures,
        improvement,
      })
      if (result.score > bestScore) {
        bestScore = result.score
        bestConfig = { ...config }
        bestIteration = nextIterIdx
      }
    } catch {
      // skip
    }
    nextIterIdx++
  }

  // Second adaptive pass: 1.3× stronger corrections from the current best failures.
  // This is the "aggressive polish" pass — pushes the parameter changes harder
  // to squeeze out more score when the first pass converged short of target.
  if (bestScore < targetScore && maxIterations > nextIterIdx) {
    const strongerCorrections = applyFailureCorrections(
      bestConfig,
      iterations[bestIteration]!.failures,
      1.3 // 1.3× stronger than the first pass
    )
    const config = { ...bestConfig, ...strongerCorrections }
    try {
      const result = await renderAndCritique(baseSeed, bars, config, useSamples)
      const improvement = result.score - bestScore
      iterations.push({
        iteration: nextIterIdx,
        configName: 'failure-driven-strong',
        config,
        score: result.score,
        failures: result.failures,
        improvement,
      })
      if (result.score > bestScore) {
        bestScore = result.score
        bestConfig = { ...config }
        bestIteration = nextIterIdx
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
