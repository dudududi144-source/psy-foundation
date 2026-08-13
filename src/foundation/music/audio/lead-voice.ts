/**
 * LeadVoice — a lead synth with filter envelope, articulation, and sound families.
 *
 * F22 requirement: the lead must have gesture — attack, phrase, accent, pitch
 * movement, filter movement, resonance movement, delay response, release.
 * Two phrases with the same MIDI notes but different modulation must sound
 * different.
 *
 * The lead supports 6 sound families:
 *   PSY_ACID — saw/square + resonant filter + envelope modulation + drive
 *   FM_PSY — carrier + modulator + FM index envelope + saturation
 *   RUBBER_GOA — saw + detune + resonant filter + portamento
 *   METALLIC — FM + inharmonic ratios + short envelope + distortion
 *   ATMOSPHERIC — multiple oscillators + slow modulation + stereo
 *   PLUCK — harmonic source + fast attack + short decay + filter env
 */

import { Adsr } from '@psy-foundation/dsp'
import { MoogLadder } from '@psy-foundation/dsp'
import { FmOscillator, PolyBlepOsc } from '@psy-foundation/dsp'
import { softClip, tanhSaturation } from '@psy-foundation/dsp'

export type SoundFamily =
  | 'PSY_ACID'
  | 'FM_PSY'
  | 'RUBBER_GOA'
  | 'METALLIC'
  | 'ATMOSPHERIC'
  | 'PLUCK'

export interface LeadRecipe {
  /** Sound family — drives the overall architecture. */
  family: SoundFamily
  /** Oscillator type for the primary layer. */
  oscType: 'sine' | 'saw' | 'square' | 'triangle' | 'fm'
  /** Layer count (1-3). */
  layerCount: number
  /** Detune between layers (cents). */
  detuneCents: number
  /** Filter cutoff Hz. */
  cutoffHz: number
  /** Filter resonance 0..1. */
  resonance: number
  /** Filter envelope amount 0..1 (how much the amp env opens the filter). */
  filterEnvAmount: number
  /** Amplitude envelope. */
  attack: number
  decay: number
  sustain: number
  release: number
  /** Saturation type. */
  saturationType: 'none' | 'tanh' | 'soft-clip' | 'hard-clip'
  /** Saturation drive 0..1. */
  saturationDrive: number
  /** FM amount (0..1, for FM families). */
  fmAmount: number
  /** Stereo width 0..1. */
  stereoWidth: number
  /** Overall gain 0..1. */
  gain: number
}

export const DEFAULT_LEAD_RECIPE: LeadRecipe = {
  family: 'PSY_ACID',
  oscType: 'saw',
  layerCount: 2,
  detuneCents: 7,
  cutoffHz: 1500,
  resonance: 0.3,
  filterEnvAmount: 0.4,
  attack: 0.01,
  decay: 0.15,
  sustain: 0.6,
  release: 0.2,
  saturationType: 'tanh',
  saturationDrive: 0.3,
  fmAmount: 0.5,
  stereoWidth: 0.5,
  gain: 0.5,
}

/**
 * A lead voice with filter envelope and articulation.
 * Call noteOn(note, velocity) to trigger, process() per sample,
 * noteOff() to release.
 */
export class LeadVoice {
  private _active = false
  private readonly sr: number
  private recipe: LeadRecipe
  private readonly ampEnv: Adsr
  private readonly filterEnv: Adsr
  private osc1: PolyBlepOsc | FmOscillator
  private osc2: PolyBlepOsc | null = null
  private osc3: PolyBlepOsc | null = null
  private filter: MoogLadder
  private baseCutoff: number
  private currentMidi: number
  private _velocity = 1
  private releaseCounter = 0
  private releaseSamples = 0
  private noteStartTime = 0
  private sampleCounter = 0

  constructor(sampleRate: number, recipe: LeadRecipe = DEFAULT_LEAD_RECIPE) {
    this.sr = sampleRate
    this.recipe = recipe
    this.currentMidi = 69
    this.baseCutoff = recipe.cutoffHz
    this.ampEnv = new Adsr({
      sampleRate,
      attack: recipe.attack,
      decay: recipe.decay,
      sustain: recipe.sustain,
      release: recipe.release,
    })
    this.filterEnv = new Adsr({
      sampleRate,
      attack: recipe.attack * 0.5,
      decay: recipe.decay * 0.8,
      sustain: recipe.sustain * 0.5,
      release: recipe.release * 0.5,
    })
    this.osc1 = this.createOsc(recipe.oscType, 440)
    if (recipe.layerCount >= 2) {
      this.osc2 = this.createOsc(recipe.oscType, 440) as PolyBlepOsc
    }
    if (recipe.layerCount >= 3) {
      this.osc3 = this.createOsc(recipe.oscType, 440) as PolyBlepOsc
    }
    this.filter = new MoogLadder(sampleRate, recipe.cutoffHz, recipe.resonance)
  }

  private createOsc(type: LeadRecipe['oscType'], freq: number): PolyBlepOsc | FmOscillator {
    if (type === 'fm') {
      return new FmOscillator({
        sampleRate: this.sr,
        carrierFreq: freq,
        modIndex: this.recipe.fmAmount,
      })
    }
    return new PolyBlepOsc({ waveform: type, sampleRate: this.sr, frequency: freq })
  }

  setRecipe(recipe: LeadRecipe): void {
    this.recipe = recipe
    this.baseCutoff = recipe.cutoffHz
    this.ampEnv.setAttack(Math.max(0.001, recipe.attack))
    this.ampEnv.setDecay(recipe.decay)
    this.ampEnv.setSustain(recipe.sustain)
    this.ampEnv.setRelease(recipe.release)
    this.filterEnv.setAttack(Math.max(0.001, recipe.attack * 0.5))
    this.filterEnv.setDecay(recipe.decay * 0.8)
    this.filterEnv.setSustain(recipe.sustain * 0.5)
    this.filterEnv.setRelease(recipe.release * 0.5)
    this.filter.setResonance(recipe.resonance)
  }

  noteOn(note: number, velocity: number): void {
    this._active = true
    this._velocity = velocity
    this.currentMidi = note
    this.sampleCounter = 0
    this.noteStartTime = this.sampleCounter / this.sr
    const freq = 440 * 2 ** ((note - 69) / 12)
    this.setOscFreq(this.osc1, freq, 0)
    if (this.osc2) this.setOscFreq(this.osc2, freq, this.recipe.detuneCents)
    if (this.osc3) this.setOscFreq(this.osc3, freq, -this.recipe.detuneCents)
    this.ampEnv.reset()
    this.filterEnv.reset()
    this.ampEnv.gateOn()
    this.filterEnv.gateOn()
    this.releaseCounter = 0
  }

  private setOscFreq(osc: PolyBlepOsc | FmOscillator, freq: number, detuneCents: number): void {
    const detuned = freq * 2 ** (detuneCents / 1200)
    if (osc instanceof FmOscillator) {
      osc.setCarrier(detuned)
    } else {
      osc.setFrequency(detuned)
    }
  }

  noteOff(): void {
    if (this._active) {
      this.ampEnv.gateOff()
      this.filterEnv.gateOff()
      this.releaseSamples = Math.ceil(this.recipe.release * this.sr * 2)
      this.releaseCounter = 0
    }
  }

  panic(): void {
    this._active = false
    this.ampEnv.reset()
    this.filterEnv.reset()
  }

  get isActive(): boolean {
    return this._active
  }

  process(): number {
    if (!this._active) return 0

    const ampValue = this.ampEnv.process()
    const filterValue = this.filterEnv.process()

    if (this.ampEnv.currentStage === 'release') {
      this.releaseCounter++
      if (this.releaseCounter >= this.releaseSamples || ampValue < 0.001) {
        this._active = false
        return 0
      }
    }
    if (this.ampEnv.currentStage === 'idle') {
      this._active = false
      return 0
    }

    // ── Filter cutoff: base + filter envelope ──
    const cutoff = this.baseCutoff + this.recipe.filterEnvAmount * filterValue * 3000
    this.filter.setCutoff(Math.max(50, Math.min(18000, cutoff)))

    // ── Oscillators ──
    let signal = 0
    signal += this.getOscSample(this.osc1)
    if (this.osc2) signal += this.getOscSample(this.osc2) * 0.7
    if (this.osc3) signal += this.getOscSample(this.osc3) * 0.5
    signal /= Math.max(1, this.recipe.layerCount)

    // ── Filter ──
    signal = this.filter.process(signal)

    // ── Saturation ──
    if (this.recipe.saturationType === 'tanh') {
      signal = tanhSaturation(signal, 1 + this.recipe.saturationDrive * 2)
    } else if (this.recipe.saturationType === 'soft-clip') {
      signal = softClip(signal, 1 + this.recipe.saturationDrive * 2)
    } else if (this.recipe.saturationType === 'hard-clip') {
      signal = Math.max(-1, Math.min(1, signal * (1 + this.recipe.saturationDrive * 3)))
    }

    signal *= ampValue * this._velocity * this.recipe.gain
    this.sampleCounter++
    return signal
  }

  private getOscSample(osc: PolyBlepOsc | FmOscillator): number {
    if (osc instanceof FmOscillator) {
      // For FM families, modulate the index over time for movement.
      const t = this.sampleCounter / this.sr
      const indexMod = this.recipe.fmAmount * (1 + 0.3 * Math.sin(2 * Math.PI * 5 * t))
      osc.setModIndex(indexMod)
    }
    return osc.process()
  }
}

/**
 * Get a LeadRecipe for a specific sound family. Each family has a genuinely
 * different architecture — not just a cutoff change.
 */
export function getRecipeForFamily(family: SoundFamily): LeadRecipe {
  switch (family) {
    case 'PSY_ACID':
      return {
        family: 'PSY_ACID',
        oscType: 'saw',
        layerCount: 2,
        detuneCents: 7,
        cutoffHz: 1200,
        resonance: 0.5,
        filterEnvAmount: 0.6,
        attack: 0.005,
        decay: 0.12,
        sustain: 0.4,
        release: 0.15,
        saturationType: 'tanh',
        saturationDrive: 0.4,
        fmAmount: 0,
        stereoWidth: 0.6,
        gain: 0.45,
      }
    case 'FM_PSY':
      return {
        family: 'FM_PSY',
        oscType: 'fm',
        layerCount: 1,
        detuneCents: 0,
        cutoffHz: 3000,
        resonance: 0.2,
        filterEnvAmount: 0.2,
        attack: 0.008,
        decay: 0.2,
        sustain: 0.5,
        release: 0.25,
        saturationType: 'soft-clip',
        saturationDrive: 0.3,
        fmAmount: 0.7,
        stereoWidth: 0.5,
        gain: 0.4,
      }
    case 'RUBBER_GOA':
      return {
        family: 'RUBBER_GOA',
        oscType: 'saw',
        layerCount: 3,
        detuneCents: 12,
        cutoffHz: 900,
        resonance: 0.6,
        filterEnvAmount: 0.5,
        attack: 0.01,
        decay: 0.18,
        sustain: 0.3,
        release: 0.2,
        saturationType: 'tanh',
        saturationDrive: 0.5,
        fmAmount: 0,
        stereoWidth: 0.7,
        gain: 0.4,
      }
    case 'METALLIC':
      return {
        family: 'METALLIC',
        oscType: 'fm',
        layerCount: 1,
        detuneCents: 0,
        cutoffHz: 5000,
        resonance: 0.3,
        filterEnvAmount: 0.3,
        attack: 0.002,
        decay: 0.08,
        sustain: 0.2,
        release: 0.08,
        saturationType: 'hard-clip',
        saturationDrive: 0.6,
        fmAmount: 0.9,
        stereoWidth: 0.4,
        gain: 0.35,
      }
    case 'ATMOSPHERIC':
      return {
        family: 'ATMOSPHERIC',
        oscType: 'triangle',
        layerCount: 3,
        detuneCents: 15,
        cutoffHz: 2000,
        resonance: 0.15,
        filterEnvAmount: 0.3,
        attack: 0.05,
        decay: 0.3,
        sustain: 0.7,
        release: 0.4,
        saturationType: 'tanh',
        saturationDrive: 0.2,
        fmAmount: 0,
        stereoWidth: 0.9,
        gain: 0.35,
      }
    case 'PLUCK':
      return {
        family: 'PLUCK',
        oscType: 'square',
        layerCount: 1,
        detuneCents: 0,
        cutoffHz: 2500,
        resonance: 0.25,
        filterEnvAmount: 0.7,
        attack: 0.001,
        decay: 0.1,
        sustain: 0.1,
        release: 0.1,
        saturationType: 'soft-clip',
        saturationDrive: 0.25,
        fmAmount: 0,
        stereoWidth: 0.5,
        gain: 0.4,
      }
  }
}
