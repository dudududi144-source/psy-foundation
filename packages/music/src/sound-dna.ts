/**
 * SoundDNA → SynthRecipe → VoiceArchitecture — the bridge from learned timbre
 * to a REAL synthesis graph.
 *
 * F21 requirement: different SoundDNA must produce genuinely different voice
 * architectures — not just a cutoff change. The recipe must differ in:
 *   - oscillator type (sine/saw/square/triangle/FM)
 *   - layer count (1-3)
 *   - filter topology (one-pole LP, biquad LP/HP/BP, Moog ladder)
 *   - envelope (attack/decay/sustain/release)
 *   - saturation (none/tanh/soft-clip/hard-clip)
 *   - modulation (LFO target + depth)
 *   - stereo behavior (width, ping-pong)
 *
 * The VoiceArchitecture is a serializable description PSY4 can render into a
 * DSP graph using the existing PolyBlepOsc / MoogLadder / Adsr / saturation
 * primitives from @psy-foundation/dsp.
 */

import type { TimbreProfile } from './learned-context.ts'

/** Oscillator type — drives the sonic character. */
export type OscillatorType = 'sine' | 'saw' | 'square' | 'triangle' | 'fm'

/** Filter topology — drives the tonal shape. */
export type FilterTopology =
  | 'one-pole-lp'
  | 'biquad-lp'
  | 'biquad-hp'
  | 'biquad-bp'
  | 'moog-ladder'
  | 'none'

/** Saturation type — drives the harmonic distortion character. */
export type SaturationType = 'none' | 'tanh' | 'soft-clip' | 'hard-clip'

/** LFO target — what the modulation LFO modulates. */
export type LfoTarget = 'none' | 'pitch' | 'cutoff' | 'amplitude' | 'pulse-width'

/** A single oscillator layer in the voice. */
export interface OscillatorLayer {
  /** Oscillator type. */
  type: OscillatorType
  /** Detune in cents (for layered unison). */
  detuneCents: number
  /** Mix level 0..1. */
  mix: number
  /** Octave offset (-2..+2). */
  octaveOffset: number
  /** FM amount (0..1, only for 'fm' type). */
  fmAmount?: number
}

/** Filter configuration. */
export interface FilterConfig {
  topology: FilterTopology
  cutoffHz: number
  resonance: number
  /** Envelope amount 0..1 (how much the envelope opens the filter). */
  envelopeAmount: number
}

/** Envelope configuration. */
export interface EnvelopeConfig {
  attackSec: number
  decaySec: number
  sustain: number
  releaseSec: number
}

/** Saturation configuration. */
export interface SaturationConfig {
  type: SaturationType
  /** Drive 0..1. */
  drive: number
}

/** LFO configuration. */
export interface LfoConfig {
  target: LfoTarget
  rateHz: number
  depth: number
  waveform: 'sine' | 'triangle'
}

/** Stereo configuration. */
export interface StereoConfig {
  width: number
  /** Ping-pong delay amount 0..1. */
  pingPong: number
}

/**
 * SynthRecipe — a complete voice architecture description derived from
 * SoundDNA. This is NOT a cutoff scalar — it specifies the oscillator layers,
 * filter topology, envelope, saturation, modulation, and stereo behavior.
 */
export interface SynthRecipe {
  /** The role this recipe serves (kick/bass/lead/hats/pad). */
  role: string
  /** Oscillator layers (1-3). More layers = thicker sound. */
  oscillators: OscillatorLayer[]
  /** Filter configuration. */
  filter: FilterConfig
  /** Amplitude envelope. */
  envelope: EnvelopeConfig
  /** Saturation stage. */
  saturation: SaturationConfig
  /** Modulation LFO. */
  lfo: LfoConfig
  /** Stereo behavior. */
  stereo: StereoConfig
  /** SoundDNA fingerprint (for comparison). */
  fingerprint: string
}

/**
 * SoundDNA — the learned timbral identity. Derived from TimbreProfile but
 * extended with the fields needed to make genuinely different architectures.
 */
export interface SoundDNA {
  /** Brightness 0..1 (drives oscillator type + filter cutoff). */
  brightness: number
  /** Harmonicity 0..1 (drives layer count + detune). */
  harmonicity: number
  /** Noisiness 0..1 (drives saturation + filter resonance). */
  noisiness: number
  /** Attack transient 0..1 (drives envelope attack). */
  attack: number
  /** Spectral centroid (Hz, informational). */
  spectralCentroid: number
  /** Sub energy 0..1 (drives oscillator octave + layer mix). */
  subEnergy: number
  /** Saturation amount 0..1 (drives saturation drive). */
  saturation: number
  /** Roughness 0..1 (drives FM amount + detune). */
  roughness: number
  /** Transient character 0..1 (drives envelope decay). */
  transientCharacter: number
  /** Stereo width 0..1 (drives stereo width). */
  stereoWidth: number
}

/** Convert a TimbreProfile to SoundDNA. */
export function timbreToSoundDNA(timbre: TimbreProfile): SoundDNA {
  return {
    brightness: timbre.brightness,
    harmonicity: timbre.harmonicity,
    noisiness: timbre.noisiness,
    attack: timbre.attack,
    spectralCentroid: timbre.spectralCentroid,
    subEnergy: timbre.subEnergy,
    saturation: timbre.saturation,
    roughness: timbre.roughness,
    transientCharacter: timbre.transientCharacter,
    stereoWidth: 0.5, // default; can be overridden
  }
}

/**
 * Render a SoundDNA into a SynthRecipe for a specific role. The recipe
 * differs materially between brightness/harmonicity/saturation levels:
 *
 *   - Low brightness → sine/triangle oscillator, one-pole LP, low cutoff.
 *   - High brightness → saw/square oscillator, Moog ladder, higher cutoff.
 *   - High harmonicity → 3 layered oscillators with detune.
 *   - Low harmonicity → 1 oscillator.
 *   - High saturation → tanh/hard-clip with high drive.
 *   - High roughness → FM oscillator with high FM amount.
 *
 * Two different SoundDNAs produce genuinely different architectures — not
 * just different cutoff values.
 */
export function renderSynthRecipe(dna: SoundDNA, role: string): SynthRecipe {
  // ── Oscillator layers ──
  const oscillators: OscillatorLayer[] = []
  if (dna.roughness > 0.5 && role === 'bass') {
    // Acid bass: FM oscillator.
    oscillators.push({
      type: 'fm',
      detuneCents: 0,
      mix: 1,
      octaveOffset: 0,
      fmAmount: dna.roughness * 0.8,
    })
  } else if (dna.brightness > 0.65) {
    // Bright: saw + square layered (2-3 layers).
    oscillators.push({ type: 'saw', detuneCents: 0, mix: 0.6, octaveOffset: 0 })
    oscillators.push({
      type: 'square',
      detuneCents: dna.harmonicity > 0.5 ? 7 : 0,
      mix: 0.3,
      octaveOffset: 0,
    })
    if (dna.harmonicity > 0.6) {
      oscillators.push({ type: 'saw', detuneCents: -7, mix: 0.3, octaveOffset: 1 })
    }
  } else if (dna.brightness > 0.35) {
    // Medium: triangle + saw.
    oscillators.push({ type: 'triangle', detuneCents: 0, mix: 0.7, octaveOffset: 0 })
    oscillators.push({ type: 'saw', detuneCents: 0, mix: 0.2, octaveOffset: 0 })
  } else {
    // Dark: sine (with sub layer if subEnergy is high).
    oscillators.push({ type: 'sine', detuneCents: 0, mix: 0.8, octaveOffset: 0 })
    if (dna.subEnergy > 0.5) {
      oscillators.push({ type: 'sine', detuneCents: 0, mix: 0.5, octaveOffset: -1 })
    }
  }

  // ── Filter topology ──
  let filter: FilterConfig
  if (dna.brightness > 0.65 && role !== 'kick') {
    // Bright + non-kick: Moog ladder for warmth + resonance.
    filter = {
      topology: 'moog-ladder',
      cutoffHz: 200 + dna.brightness * 4000,
      resonance: 0.2 + dna.noisiness * 0.4,
      envelopeAmount: 0.3 + dna.transientCharacter * 0.3,
    }
  } else if (dna.brightness < 0.3) {
    // Dark: one-pole LP for gentle rolloff.
    filter = {
      topology: 'one-pole-lp',
      cutoffHz: 100 + dna.brightness * 800,
      resonance: 0,
      envelopeAmount: 0.2,
    }
  } else if (role === 'hats' || role === 'percussion') {
    // Hats: high-pass for crispness.
    filter = {
      topology: 'biquad-hp',
      cutoffHz: 2000 + dna.brightness * 4000,
      resonance: 0.3,
      envelopeAmount: 0.1,
    }
  } else {
    // Medium: biquad LP.
    filter = {
      topology: 'biquad-lp',
      cutoffHz: 300 + dna.brightness * 3000,
      resonance: 0.1 + dna.noisiness * 0.3,
      envelopeAmount: 0.2 + dna.transientCharacter * 0.2,
    }
  }

  // ── Envelope ──
  const envelope: EnvelopeConfig = {
    attackSec: dna.attack > 0.5 ? 0.05 + dna.attack * 0.2 : Math.max(0.001, dna.attack * 0.01),
    decaySec: 0.05 + (1 - dna.transientCharacter) * 0.5,
    sustain: dna.transientCharacter > 0.5 ? 0.3 : 0.6,
    releaseSec: 0.1 + (1 - dna.transientCharacter) * 0.4,
  }

  // ── Saturation ──
  let saturation: SaturationConfig
  if (dna.saturation > 0.6) {
    saturation = { type: 'hard-clip', drive: 0.5 + dna.saturation * 0.4 }
  } else if (dna.saturation > 0.3) {
    saturation = { type: 'tanh', drive: 0.3 + dna.saturation * 0.4 }
  } else if (dna.noisiness > 0.4) {
    saturation = { type: 'soft-clip', drive: 0.2 + dna.noisiness * 0.3 }
  } else {
    saturation = { type: 'none', drive: 0 }
  }

  // ── LFO ──
  let lfo: LfoConfig
  if (dna.roughness > 0.5 && role === 'bass') {
    lfo = { target: 'cutoff', rateHz: 4 + dna.roughness * 8, depth: 0.3, waveform: 'sine' }
  } else if (dna.harmonicity > 0.6 && role === 'lead') {
    lfo = { target: 'pitch', rateHz: 5, depth: 0.1, waveform: 'triangle' }
  } else if (dna.noisiness > 0.5 && role === 'pad') {
    lfo = { target: 'amplitude', rateHz: 3, depth: 0.3, waveform: 'sine' }
  } else {
    lfo = { target: 'none', rateHz: 0, depth: 0, waveform: 'sine' }
  }

  // ── Stereo ──
  const stereo: StereoConfig = {
    width: dna.stereoWidth,
    pingPong: dna.noisiness > 0.5 ? 0.2 + dna.noisiness * 0.3 : 0,
  }

  return {
    role,
    oscillators,
    filter,
    envelope,
    saturation,
    lfo,
    stereo,
    fingerprint: `${role}:${oscillators.map((o) => o.type).join('+')}:${filter.topology}:${saturation.type}:${lfo.target}`,
  }
}

/**
 * Compare two SynthRecipes and return a divergence score 0..1. A score of 0
 * means identical architecture; 1 means completely different. This proves
 * different SoundDNAs produce genuinely different voice architectures.
 */
export function recipeDivergence(a: SynthRecipe, b: SynthRecipe): number {
  let diffs = 0
  let checks = 0
  // Oscillator type difference.
  const typesA = new Set(a.oscillators.map((o) => o.type))
  const typesB = new Set(b.oscillators.map((o) => o.type))
  const typeInter = [...typesA].filter((t) => typesB.has(t)).length
  const typeUnion = new Set([...typesA, ...typesB]).size
  checks++
  if (typeUnion > 0) diffs += 1 - typeInter / typeUnion
  // Layer count difference.
  checks++
  diffs += Math.abs(a.oscillators.length - b.oscillators.length) / 3
  // Filter topology difference.
  checks++
  if (a.filter.topology !== b.filter.topology) diffs += 1
  // Saturation type difference.
  checks++
  if (a.saturation.type !== b.saturation.type) diffs += 1
  // LFO target difference.
  checks++
  if (a.lfo.target !== b.lfo.target) diffs += 1
  // Cutoff difference (normalized).
  checks++
  diffs += Math.min(1, Math.abs(a.filter.cutoffHz - b.filter.cutoffHz) / 5000)
  // Envelope attack difference.
  checks++
  diffs += Math.min(1, Math.abs(a.envelope.attackSec - b.envelope.attackSec) / 0.5)
  // Stereo width difference.
  checks++
  diffs += Math.abs(a.stereo.width - b.stereo.width)
  return diffs / checks
}

/** True if two recipes have materially different architectures. */
export function isMateriallyDifferentArchitecture(
  a: SynthRecipe,
  b: SynthRecipe,
  threshold = 0.3
): boolean {
  return recipeDivergence(a, b) >= threshold
}
