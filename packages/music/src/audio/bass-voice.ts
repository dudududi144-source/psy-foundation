/**
 * BassVoice — layered bass synthesis (sub + mid + character).
 *
 * F22 requirement: bass must NOT be a single voice. Build at least:
 *   SUB BASS — mono, sine/triangle, very stable, low distortion
 *   MID BASS — saw/square/FM, filtered, short envelope, character
 *   CHARACTER — optional distortion/resonance/FM
 *
 * The bass must be short enough not to smear into the next kick. The envelope
 * is tight (short attack, short decay, clean release) so the bass leaves
 * space for the kick.
 */

import { Adsr } from '@psy-foundation/dsp'
import { BiquadFilter, MoogLadder } from '@psy-foundation/dsp'
import { FmOscillator, PolyBlepOsc } from '@psy-foundation/dsp'
import { tanhSaturation } from '@psy-foundation/dsp'

export interface BassLayerRecipe {
  /** Oscillator type. */
  type: 'sine' | 'saw' | 'square' | 'triangle' | 'fm'
  /** Mix level 0..1. */
  mix: number
  /** Octave offset (-1 = one octave down). */
  octaveOffset: number
  /** Detune in cents. */
  detuneCents: number
  /** FM amount (0..1, only for 'fm' type). */
  fmAmount?: number
  /** Filter cutoff Hz for this layer. */
  cutoffHz: number
  /** Filter resonance 0..1. */
  resonance: number
}

export interface BassRecipe {
  /** Sub layer (low sine, stable). */
  sub: BassLayerRecipe
  /** Mid layer (saw/square, character). */
  mid: BassLayerRecipe
  /** Character layer (optional — distortion/resonance). */
  character: BassLayerRecipe | null
  /** Amplitude envelope: attack (seconds). */
  attack: number
  /** Amplitude envelope: decay (seconds). */
  decay: number
  /** Amplitude envelope: sustain level (0..1). */
  sustain: number
  /** Amplitude envelope: release (seconds). */
  release: number
  /** Saturation drive 0..1. */
  saturation: number
  /** Overall gain 0..1. */
  gain: number
}

export const DEFAULT_BASS_RECIPE: BassRecipe = {
  sub: {
    type: 'sine',
    mix: 0.6,
    octaveOffset: 0,
    detuneCents: 0,
    cutoffHz: 200,
    resonance: 0,
  },
  mid: {
    type: 'saw',
    mix: 0.4,
    octaveOffset: 0,
    detuneCents: 0,
    cutoffHz: 800,
    resonance: 0.2,
  },
  character: null,
  attack: 0.003,
  decay: 0.08,
  sustain: 0.0,
  release: 0.05,
  saturation: 0.3,
  gain: 0.8,
}

/**
 * A layered bass voice. Call noteOn(note, velocity) to trigger, then process()
 * per sample until active === false.
 */
export class BassVoice {
  private _active = false
  private readonly sr: number
  private recipe: BassRecipe
  private readonly env: Adsr
  private subOsc: PolyBlepOsc
  private midOsc: PolyBlepOsc
  private charOsc: PolyBlepOsc | FmOscillator | null = null
  private subFilter: BiquadFilter
  private midFilter: MoogLadder
  private charFilter: MoogLadder | null = null
  private currentMidi: number
  private _velocity = 1
  private releaseCounter = 0
  private releaseSamples = 0

  constructor(sampleRate: number, recipe: BassRecipe = DEFAULT_BASS_RECIPE) {
    this.sr = sampleRate
    this.recipe = recipe
    this.currentMidi = 36
    this.env = new Adsr({
      sampleRate,
      attack: recipe.attack,
      decay: recipe.decay,
      sustain: recipe.sustain,
      release: recipe.release,
    })
    this.subOsc = new PolyBlepOsc({ waveform: 'sine', sampleRate, frequency: 65 })
    this.midOsc = new PolyBlepOsc({ waveform: 'saw', sampleRate, frequency: 65 })
    this.subFilter = new BiquadFilter(sampleRate, 'lowpass', 200, 0.7)
    this.midFilter = new MoogLadder(sampleRate, 800, 0.2)
    if (recipe.character) {
      if (recipe.character.type === 'fm') {
        this.charOsc = new FmOscillator({
          sampleRate,
          carrierFreq: 65,
          modIndex: recipe.character.fmAmount ?? 0.5,
        })
      } else {
        this.charOsc = new PolyBlepOsc({
          waveform: recipe.character.type,
          sampleRate,
          frequency: 65,
        })
      }
      this.charFilter = new MoogLadder(
        sampleRate,
        recipe.character.cutoffHz,
        recipe.character.resonance
      )
    }
  }

  setRecipe(recipe: BassRecipe): void {
    this.recipe = recipe
    this.env.setAttack(Math.max(0.001, recipe.attack))
    this.env.setDecay(recipe.decay)
    this.env.setSustain(recipe.sustain)
    this.env.setRelease(recipe.release)
    this.subFilter.setParams('lowpass', recipe.sub.cutoffHz, 0.7)
    this.midFilter.setCutoff(recipe.mid.cutoffHz)
    this.midFilter.setResonance(recipe.mid.resonance)
  }

  noteOn(note: number, velocity: number): void {
    this._active = true
    this._velocity = velocity
    this.currentMidi = note
    const freq = 440 * 2 ** ((note - 69) / 12)
    this.subOsc.setFrequency(freq * 2 ** this.recipe.sub.octaveOffset)
    this.midOsc.setFrequency(freq * 2 ** this.recipe.mid.octaveOffset)
    if (this.charOsc instanceof PolyBlepOsc && this.recipe.character) {
      this.charOsc.setFrequency(freq * 2 ** this.recipe.character.octaveOffset)
    } else if (this.charOsc instanceof FmOscillator && this.recipe.character) {
      this.charOsc.setCarrier(freq * 2 ** this.recipe.character.octaveOffset)
    }
    this.env.reset()
    this.env.gateOn()
    this.releaseCounter = 0
  }

  noteOff(): void {
    if (this._active) {
      this.env.gateOff()
      this.releaseSamples = Math.ceil(this.recipe.release * this.sr)
      this.releaseCounter = 0
    }
  }

  panic(): void {
    this._active = false
    this.env.reset()
  }

  get isActive(): boolean {
    return this._active
  }

  process(): number {
    if (!this._active) return 0

    const envValue = this.env.process()
    if (this.env.currentStage === 'release') {
      this.releaseCounter++
      if (this.releaseCounter >= this.releaseSamples || envValue < 0.001) {
        this._active = false
        return 0
      }
    }
    // If sustain is 0 and we're past decay, the note ends.
    if (this.env.currentStage === 'idle') {
      this._active = false
      return 0
    }

    // ── Sub layer: sine through LP ──
    const subRaw = this.subOsc.process()
    const subFiltered = this.subFilter.process(subRaw)
    const subOut = subFiltered * this.recipe.sub.mix

    // ── Mid layer: saw through Moog ──
    const midRaw = this.midOsc.process()
    const midFiltered = this.midFilter.process(midRaw)
    const midOut = midFiltered * this.recipe.mid.mix

    // ── Character layer ──
    let charOut = 0
    if (this.charOsc && this.charFilter && this.recipe.character) {
      const charRaw = this.charOsc.process()
      const charFiltered = this.charFilter.process(charRaw)
      charOut = charFiltered * this.recipe.character.mix
    }

    // ── Mix + saturate ──
    let sample = (subOut + midOut + charOut) * envValue * this._velocity
    if (this.recipe.saturation > 0) {
      sample = tanhSaturation(sample, 1 + this.recipe.saturation * 2)
    }
    sample *= this.recipe.gain

    return sample
  }
}
