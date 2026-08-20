/**
 * AudioRenderer — renders a ComposedSection to real PCM (Float32Array).
 *
 * F22 requirement: the system must GENERATE → RENDER REAL PCM → ANALYZE →
 * DIAGNOSE → CHANGE → RE-RENDER. This module is the RENDER step.
 *
 * The renderer:
 *   1. Takes a ComposedSection + per-voice recipes.
 *   2. Walks the bars, scheduling kick/bass/lead/hat events.
 *   3. Renders each voice sample-by-sample using the DSP primitives.
 *   4. Mixes all voices into a mono Float32Array (stereo later).
 *   5. Returns the PCM buffer for the AudioCritic to analyze.
 */

import type { ComposedSection } from '../composition-engine.ts'
import { type BassRecipe, BassVoice } from './bass-voice.ts'
import { type KickRecipe, KickVoice } from './kick-voice.ts'
import { LeadVoice } from './lead-voice.ts'
import { type SoundFamily, getRecipeForFamily } from './lead-voice.ts'

export interface RenderConfig {
  sampleRate: number
  /** BPM for the section. */
  bpm: number
  /** Kick recipe. */
  kickRecipe: KickRecipe
  /** Bass recipe. */
  bassRecipe: BassRecipe
  /** Lead recipe (or sound family to derive one). */
  leadFamily: SoundFamily
  /** Master gain 0..1. */
  masterGain: number
  /** Hat gain 0..1. */
  hatGain: number
  /** Mix bus: kick gain. */
  kickGain: number
  /** Mix bus: bass gain. */
  bassGain: number
  /** Mix bus: lead gain. */
  leadGain: number
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  sampleRate: 44100,
  bpm: 145,
  kickRecipe: {
    pitchStart: 150,
    pitchEnd: 50,
    pitchDropTime: 0.025,
    bodyDecay: 0.12,
    subDecay: 0.15,
    clickAmount: 0.7,
    clickBrightness: 0.8,
    transientDecay: 0.004,
    bodyHarmonics: 0.35,
    saturation: 0.4,
    gain: 0.9,
  },
  bassRecipe: {
    sub: { type: 'sine', mix: 0.6, octaveOffset: 0, detuneCents: 0, cutoffHz: 200, resonance: 0 },
    mid: { type: 'saw', mix: 0.4, octaveOffset: 0, detuneCents: 0, cutoffHz: 700, resonance: 0.2 },
    character: null,
    attack: 0.003,
    decay: 0.06,
    sustain: 0.0,
    release: 0.03,
    saturation: 0.3,
    gain: 0.8,
  },
  leadFamily: 'PSY_ACID',
  masterGain: 0.8,
  hatGain: 0.15,
  kickGain: 0.9,
  bassGain: 0.7,
  leadGain: 0.5,
}

export interface RenderResult {
  /** Mono PCM buffer. */
  pcm: Float32Array
  /** Sample rate. */
  sampleRate: number
  /** Duration in seconds. */
  durationSec: number
  /** Number of bars rendered. */
  bars: number
}

/**
 * Render a ComposedSection to PCM.
 *
 * The renderer creates one KickVoice, one BassVoice, and one LeadVoice, and
 * triggers them at the appropriate sample positions based on the bar/step
 * grid. Each voice is processed sample-by-sample and summed into the output
 * buffer.
 */
export function renderSection(
  section: ComposedSection,
  config: RenderConfig = DEFAULT_RENDER_CONFIG
): RenderResult {
  const { sampleRate, bpm } = config
  const stepsPerBar = section.groove.stepsPerBar
  const secondsPerStep = 60 / bpm / (stepsPerBar / 4) // 16-step bar → 16th notes
  const samplesPerStep = Math.ceil(secondsPerStep * sampleRate)
  const samplesPerBar = samplesPerStep * stepsPerBar
  const totalSamples = samplesPerBar * section.bars.length
  const pcm = new Float32Array(totalSamples)

  // Create voices.
  const kick = new KickVoice(sampleRate, config.kickRecipe)
  const bass = new BassVoice(sampleRate, config.bassRecipe)
  const leadRecipe = getRecipeForFamily(config.leadFamily)
  const lead = new LeadVoice(sampleRate, leadRecipe)

  for (const bar of section.bars) {
    const barStartSample = bar.barIndex * samplesPerBar

    // ── Kick events ──
    for (const step of bar.kickNotes) {
      const onsetSample = barStartSample + step * samplesPerStep
      if (onsetSample < totalSamples) {
        triggerVoiceAt(kick, onsetSample, 36, 0.9, pcm, sampleRate, config.kickGain)
      }
    }

    // ── Bass events ──
    for (const note of bar.bassNotes) {
      const onsetSample = barStartSample + note.step * samplesPerStep
      const durationSamples = note.durationSteps * samplesPerStep
      if (onsetSample < totalSamples) {
        triggerBassVoice(
          bass,
          onsetSample,
          durationSamples,
          note.midi,
          0.8,
          pcm,
          sampleRate,
          config.bassGain
        )
      }
    }

    // ── Lead events ──
    for (const note of bar.leadNotes) {
      const onsetSample = barStartSample + note.step * samplesPerStep
      const durationSamples = note.durationSteps * samplesPerStep
      if (onsetSample < totalSamples) {
        triggerLeadVoice(
          lead,
          onsetSample,
          durationSamples,
          note.midi,
          note.velocity,
          pcm,
          sampleRate,
          config.leadGain
        )
      }
    }

    // ── Hat events (simple noise burst) ──
    for (const step of bar.hatNotes) {
      const onsetSample = barStartSample + step * samplesPerStep
      if (onsetSample < totalSamples) {
        renderHat(pcm, onsetSample, samplesPerStep, config.hatGain)
      }
    }
  }

  // ── Master gain + soft clip ──
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.max(-1, Math.min(1, (pcm[i] ?? 0) * config.masterGain))
  }

  return {
    pcm,
    sampleRate,
    durationSec: totalSamples / sampleRate,
    bars: section.bars.length,
  }
}

/**
 * Trigger a kick voice at a specific sample position and render it into the buffer.
 */
function triggerVoiceAt(
  voice: KickVoice,
  onsetSample: number,
  note: number,
  velocity: number,
  pcm: Float32Array,
  _sampleRate: number,
  gain: number
): void {
  voice.noteOn(note, velocity)
  let pos = onsetSample
  while (voice.isActive && pos < pcm.length) {
    const sample = voice.process() * gain
    pcm[pos] = (pcm[pos] ?? 0) + sample
    pos++
  }
}

/**
 * Trigger a bass voice with a specific duration (noteOff after duration).
 */
function triggerBassVoice(
  voice: BassVoice,
  onsetSample: number,
  durationSamples: number,
  note: number,
  velocity: number,
  pcm: Float32Array,
  _sampleRate: number,
  gain: number
): void {
  voice.noteOn(note, velocity)
  const noteOffSample = onsetSample + durationSamples
  let pos = onsetSample
  while (voice.isActive && pos < pcm.length) {
    if (pos === noteOffSample) {
      voice.noteOff()
    }
    const sample = voice.process() * gain
    pcm[pos] = (pcm[pos] ?? 0) + sample
    pos++
  }
}

/**
 * Trigger a lead voice with a specific duration.
 */
function triggerLeadVoice(
  voice: LeadVoice,
  onsetSample: number,
  durationSamples: number,
  note: number,
  velocity: number,
  pcm: Float32Array,
  _sampleRate: number,
  gain: number
): void {
  voice.noteOn(note, velocity)
  const noteOffSample = onsetSample + durationSamples
  let pos = onsetSample
  while (voice.isActive && pos < pcm.length) {
    if (pos === noteOffSample) {
      voice.noteOff()
    }
    const sample = voice.process() * gain
    pcm[pos] = (pcm[pos] ?? 0) + sample
    pos++
  }
}

/**
 * Render a simple hat (filtered noise burst) at a specific position.
 */
function renderHat(
  pcm: Float32Array,
  onsetSample: number,
  samplesPerStep: number,
  gain: number
): void {
  const hatLength = Math.floor(samplesPerStep * 0.3) // short hat
  let hpState = 0
  const hpAlpha = 0.95 // high-pass coefficient
  for (let i = 0; i < hatLength && onsetSample + i < pcm.length; i++) {
    const noise = Math.random() * 2 - 1
    // Simple one-pole high-pass for crispness.
    hpState = hpAlpha * (hpState + noise)
    const env = Math.exp(-i / (hatLength * 0.3))
    const sample = hpState * env * gain
    const pos = onsetSample + i
    pcm[pos] = (pcm[pos] ?? 0) + sample
  }
}
