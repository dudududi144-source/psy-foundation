/**
 * AudioQualityIterator — the listen → diagnose → fix → re-render loop.
 *
 * F22 requirement: the system must GENERATE → RENDER REAL PCM → ANALYZE →
 * DIAGNOSE → CHANGE → RE-RENDER → A/B. At least 3 real iterations.
 *
 * This module implements that loop. Each iteration:
 *   1. Renders the section to PCM with the current config.
 *   2. Critiques the PCM with AudioCritic.
 *   3. Reads the failures and applies corrections to the config.
 *   4. Re-renders and compares.
 *
 * The corrections are REAL parameter changes — shorter bass decay, higher
 * click brightness, more filter envelope, etc. The AudioCritic's correctionHint
 * drives the specific parameter adjustments.
 */

import type { ComposedSection } from '../composition-engine.ts'
import { type AudioCritique, critiqueAudio } from './audio-critic.ts'
import { DEFAULT_RENDER_CONFIG, type RenderConfig, renderSection } from './audio-renderer.ts'

export interface IterationResult {
  iteration: number
  pcm: Float32Array
  critique: AudioCritique
  config: RenderConfig
  correctionsApplied: string[]
}

export interface AudioQualityReport {
  iterations: IterationResult[]
  finalScore: number
  initialScore: number
  improvement: number
  verdict: 'PASS' | 'FAIL'
}

/**
 * Run the audio quality iteration loop. Each iteration renders, critiques,
 * and applies corrections. Returns the full history so the A/B can be
 * inspected.
 */
export function runAudioQualityLoop(
  section: ComposedSection,
  config: RenderConfig = DEFAULT_RENDER_CONFIG,
  maxIterations = 4
): AudioQualityReport {
  const iterations: IterationResult[] = []
  let currentConfig = { ...config }

  for (let i = 0; i < maxIterations; i++) {
    // ── RENDER ──
    const result = renderSection(section, currentConfig)

    // ── ANALYZE ──
    const critique = critiqueAudio(
      result.pcm,
      result.sampleRate,
      currentConfig.bpm,
      section.groove.stepsPerBar
    )

    // ── DIAGNOSE + CORRECT ──
    const corrections: string[] = []
    if (i < maxIterations - 1) {
      // Apply corrections for the next iteration.
      const corrected = applyCorrections(currentConfig, critique)
      corrections.push(...corrected.corrections)
      currentConfig = corrected.config
    }

    iterations.push({
      iteration: i,
      pcm: result.pcm,
      critique,
      config: { ...currentConfig },
      correctionsApplied: corrections,
    })

    // Early exit if no failures.
    if (critique.failures.length === 0 && i > 0) break
  }

  const initialScore = iterations[0]?.critique.overallScore ?? 0
  const finalScore = iterations[iterations.length - 1]?.critique.overallScore ?? 0
  const improvement = finalScore - initialScore

  return {
    iterations,
    initialScore,
    finalScore,
    improvement,
    verdict: finalScore > 0.5 ? 'PASS' : 'FAIL',
  }
}

/**
 * Apply corrections based on the critique's failures. Each failure maps to
 * a specific parameter change in the RenderConfig.
 */
function applyCorrections(
  config: RenderConfig,
  critique: AudioCritique
): { config: RenderConfig; corrections: string[] } {
  const newConfig: RenderConfig = {
    ...config,
    kickRecipe: { ...config.kickRecipe },
    bassRecipe: { ...config.bassRecipe },
  }
  const corrections: string[] = []

  for (const failure of critique.failures) {
    switch (failure.code) {
      case 'BASS_DECAY_TOO_LONG': {
        const newDecay = Math.max(0.03, newConfig.bassRecipe.decay * 0.7)
        const newRelease = Math.max(0.02, newConfig.bassRecipe.release * 0.7)
        newConfig.bassRecipe = {
          ...newConfig.bassRecipe,
          decay: newDecay,
          release: newRelease,
          sustain: 0,
        }
        // Also shorten kick body + sub decay — the kick tail often causes the
        // "bass decay overlap" metric to stay high because the kick's low
        // frequency tail rings into the next onset.
        const newSubDecay = Math.max(0.04, newConfig.kickRecipe.subDecay * 0.6)
        const newBodyDecay = Math.max(0.05, newConfig.kickRecipe.bodyDecay * 0.65)
        newConfig.kickRecipe = {
          ...newConfig.kickRecipe,
          subDecay: newSubDecay,
          bodyDecay: newBodyDecay,
        }
        corrections.push(
          `BASS_DECAY_TOO_LONG: shortened bass decay ${config.bassRecipe.decay.toFixed(3)}→${newDecay.toFixed(3)}, kick bodyDecay ${config.kickRecipe.bodyDecay.toFixed(3)}→${newBodyDecay.toFixed(3)}, kick subDecay ${config.kickRecipe.subDecay.toFixed(3)}→${newSubDecay.toFixed(3)}`
        )
        break
      }
      case 'KICK_TRANSIENT_MASKED': {
        const newClick = Math.min(1, newConfig.kickRecipe.clickAmount + 0.15)
        const newBrightness = Math.min(1, newConfig.kickRecipe.clickBrightness + 0.15)
        const newTransient = Math.max(0.002, newConfig.kickRecipe.transientDecay * 0.7)
        newConfig.kickRecipe = {
          ...newConfig.kickRecipe,
          clickAmount: newClick,
          clickBrightness: newBrightness,
          transientDecay: newTransient,
        }
        // Also shorten bass decay more to leave space.
        const newDecay = Math.max(0.03, newConfig.bassRecipe.decay * 0.8)
        newConfig.bassRecipe = { ...newConfig.bassRecipe, decay: newDecay }
        corrections.push(
          `KICK_TRANSIENT_MASKED: raised click ${newClick.toFixed(2)}, brightness ${newBrightness.toFixed(2)}, shortened bass decay to ${newDecay.toFixed(3)}`
        )
        break
      }
      case 'WEAK_PUNCH': {
        const newBodyDecay = Math.max(0.08, newConfig.kickRecipe.bodyDecay * 0.8)
        const newPitchDrop = Math.max(0.015, newConfig.kickRecipe.pitchDropTime * 0.7)
        newConfig.kickRecipe = {
          ...newConfig.kickRecipe,
          bodyDecay: newBodyDecay,
          pitchDropTime: newPitchDrop,
        }
        corrections.push(
          `WEAK_PUNCH: shortened body decay ${newBodyDecay.toFixed(3)}, pitch drop ${newPitchDrop.toFixed(4)}`
        )
        break
      }
      case 'LOW_MID_MUD': {
        const newCutoff = Math.max(400, newConfig.bassRecipe.mid.cutoffHz * 0.7)
        newConfig.bassRecipe = {
          ...newConfig.bassRecipe,
          mid: { ...newConfig.bassRecipe.mid, cutoffHz: newCutoff },
        }
        corrections.push(`LOW_MID_MUD: lowered mid bass cutoff ${newCutoff.toFixed(0)}Hz`)
        break
      }
      case 'NO_TIMBRAL_MOVEMENT': {
        // Increase filter envelope and FM on lead by switching to a more dynamic family.
        newConfig.leadFamily = 'PSY_ACID'
        corrections.push(
          'NO_TIMBRAL_MOVEMENT: switched lead to PSY_ACID family for more filter movement'
        )
        break
      }
      case 'LEAD_TOO_BRIGHT': {
        // Lower the master lead gain and switch to a darker family.
        newConfig.leadGain = Math.max(0.2, config.leadGain * 0.8)
        newConfig.leadFamily = 'ATMOSPHERIC'
        corrections.push(
          `LEAD_TOO_BRIGHT: lowered lead gain ${newConfig.leadGain.toFixed(2)}, switched to ATMOSPHERIC`
        )
        break
      }
      case 'HIGH_END_TOO_WEAK': {
        newConfig.hatGain = Math.min(0.4, config.hatGain * 1.5)
        newConfig.leadGain = Math.min(0.7, config.leadGain * 1.2)
        corrections.push(
          `HIGH_END_TOO_WEAK: raised hat gain ${newConfig.hatGain.toFixed(2)}, lead gain ${newConfig.leadGain.toFixed(2)}`
        )
        break
      }
      case 'RHYTHMIC_PATTERN_TOO_UNIFORM': {
        // This is a composition-level issue; for now, adjust gain to create dynamic variation.
        newConfig.kickGain = Math.min(1, config.kickGain * 1.1)
        corrections.push('RHYTHMIC_PATTERN_TOO_UNIFORM: raised kick gain for more dynamic emphasis')
        break
      }
      case 'KICK_BASS_PHASE_RISK': {
        const newKickEnd = Math.max(40, newConfig.kickRecipe.pitchEnd - 5)
        const newBassSubCutoff = Math.min(300, newConfig.bassRecipe.sub.cutoffHz + 50)
        newConfig.kickRecipe = { ...newConfig.kickRecipe, pitchEnd: newKickEnd }
        newConfig.bassRecipe = {
          ...newConfig.bassRecipe,
          sub: { ...newConfig.bassRecipe.sub, cutoffHz: newBassSubCutoff },
        }
        corrections.push(
          `KICK_BASS_PHASE_RISK: lowered kick pitch end ${newKickEnd}Hz, raised bass sub cutoff ${newBassSubCutoff}Hz`
        )
        break
      }
      case 'LEAD_TOO_STATIC': {
        newConfig.leadFamily = 'PSY_ACID'
        corrections.push('LEAD_TOO_STATIC: switched lead to PSY_ACID for more articulation')
        break
      }
      case 'LEAD_MASKING_BASS': {
        // Raise lead gain relative to bass, or lower bass mid.
        const newBassMidCutoff = Math.max(400, newConfig.bassRecipe.mid.cutoffHz * 0.8)
        newConfig.bassRecipe = {
          ...newConfig.bassRecipe,
          mid: { ...newConfig.bassRecipe.mid, cutoffHz: newBassMidCutoff },
        }
        corrections.push(
          `LEAD_MASKING_BASS: lowered bass mid cutoff to ${newBassMidCutoff}Hz to reduce masking`
        )
        break
      }
      case 'WEAK_MOTIF_IDENTITY': {
        // This is a composition-level issue; no direct synth fix.
        corrections.push(
          'WEAK_MOTIF_IDENTITY: composition-level issue — reduce variation in future generations'
        )
        break
      }
    }
  }

  return { config: newConfig, corrections }
}

/**
 * Compare two PCM buffers and return a diff summary.
 */
export function comparePCM(
  a: Float32Array,
  b: Float32Array
): {
  rmsDifference: number
  spectralDifference: number
  energyDifference: number
} {
  const minLen = Math.min(a.length, b.length)
  let rmsDiff = 0
  let energyDiff = 0
  for (let i = 0; i < minLen; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    rmsDiff += diff * diff
    energyDiff += Math.abs(Math.abs(a[i] ?? 0) - Math.abs(b[i] ?? 0))
  }
  rmsDiff = Math.sqrt(rmsDiff / minLen)
  energyDiff /= minLen

  // Spectral difference (simplified).
  const fftSize = 256
  const specA = computeSimpleSpectrum(a.slice(0, Math.min(a.length, fftSize)), 64)
  const specB = computeSimpleSpectrum(b.slice(0, Math.min(b.length, fftSize)), 64)
  let specDiff = 0
  for (let i = 0; i < specA.length; i++) {
    specDiff += Math.abs((specA[i] ?? 0) - (specB[i] ?? 0))
  }
  specDiff /= specA.length

  return { rmsDifference: rmsDiff, spectralDifference: specDiff, energyDifference: energyDiff }
}

function computeSimpleSpectrum(frame: Float32Array, numBins: number): number[] {
  const N = frame.length
  const spectrum = new Array(numBins).fill(0)
  for (let k = 0; k < numBins; k++) {
    let real = 0
    let imag = 0
    const freq = k / N
    for (let n = 0; n < N; n++) {
      const angle = -2 * Math.PI * freq * n
      real += (frame[n] ?? 0) * Math.cos(angle)
      imag += (frame[n] ?? 0) * Math.sin(angle)
    }
    spectrum[k] = Math.sqrt(real * real + imag * imag) / N
  }
  return spectrum
}
