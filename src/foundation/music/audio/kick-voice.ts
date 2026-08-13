import { MoogLadder } from '@psy-foundation/dsp'
import { tanhSaturation } from '@psy-foundation/dsp'

export interface KickRecipe {
  /** Starting pitch in Hz (the "click" pitch before the drop). */
  pitchStart: number
  /** Ending pitch in Hz (the body/sub frequency). */
  pitchEnd: number
  /** Time for the pitch to drop from pitchStart to pitchEnd (seconds). */
  pitchDropTime: number
  /** Body decay time (seconds). */
  bodyDecay: number
  /** Sub tail decay time (seconds). */
  subDecay: number
  /** Click amount 0..1. */
  clickAmount: number
  /** Click brightness 0..1 (higher = brighter click). */
  clickBrightness: number
  /** Transient decay (seconds) — how fast the click fades. */
  transientDecay: number
  /** Body harmonics 0..1 (adds a layered saw for punch). */
  bodyHarmonics: number
  /** Saturation drive 0..1. */
  saturation: number
  /** Overall gain 0..1. */
  gain: number
}

export const DEFAULT_KICK_RECIPE: KickRecipe = {
  pitchStart: 150,
  pitchEnd: 50,
  pitchDropTime: 0.03,
  bodyDecay: 0.15,
  subDecay: 0.3,
  clickAmount: 0.6,
  clickBrightness: 0.7,
  transientDecay: 0.005,
  bodyHarmonics: 0.3,
  saturation: 0.4,
  gain: 0.9,
}

/**
 * A single kick voice. Call noteOn() to trigger, then process() per sample
 * until active === false.
 */
export class KickVoice {
  readonly active = false
  private _active = false
  private readonly sr: number
  private recipe: KickRecipe
  private phase = 0
  private subPhase = 0
  private sampleCounter = 0
  private totalSamples = 0
  private bodyEnv = 0
  private subEnv = 0
  private clickEnv = 0
  private currentFreq: number
  private readonly clickFilter: MoogLadder
  private _velocity = 1

  constructor(sampleRate: number, recipe: KickRecipe = DEFAULT_KICK_RECIPE) {
    this.sr = sampleRate
    this.recipe = recipe
    this.currentFreq = recipe.pitchEnd
    this.clickFilter = new MoogLadder(sampleRate, 3000, 0.5)
  }

  setRecipe(recipe: KickRecipe): void {
    this.recipe = recipe
  }

  noteOn(_note: number, velocity: number): void {
    this._active = true
    this._velocity = velocity
    this.phase = 0
    this.subPhase = 0
    this.sampleCounter = 0
    this.currentFreq = this.recipe.pitchStart
    this.totalSamples = Math.ceil((this.recipe.bodyDecay + this.recipe.subDecay) * this.sr)
    this.bodyEnv = 1
    this.subEnv = 1
    this.clickEnv = 1
  }

  noteOff(): void {
    // Kick is percussive — noteOff doesn't do much; the envelope decays naturally.
  }

  panic(): void {
    this._active = false
    this.bodyEnv = 0
    this.subEnv = 0
    this.clickEnv = 0
  }

  get isActive(): boolean {
    return this._active
  }

  process(): number {
    if (!this._active) return 0

    const t = this.sampleCounter / this.sr
    const r = this.recipe

    // ── Pitch trajectory: exponential drop from pitchStart to pitchEnd ──
    if (t < r.pitchDropTime) {
      const dropProgress = t / r.pitchDropTime
      this.currentFreq = r.pitchStart * (r.pitchEnd / r.pitchStart) ** dropProgress
    } else {
      this.currentFreq = r.pitchEnd
    }

    // ── Body envelope: exponential decay ──
    const bodyDecayRate = 1 / (r.bodyDecay * this.sr)
    this.bodyEnv *= Math.exp(-bodyDecayRate * 3)

    // ── Sub envelope: slower decay ──
    const subDecayRate = 1 / (r.subDecay * this.sr)
    this.subEnv *= Math.exp(-subDecayRate * 2)

    // ── Click envelope: very fast decay ──
    const clickDecayRate = 1 / (r.transientDecay * this.sr)
    this.clickEnv *= Math.exp(-clickDecayRate * 5)

    // ── Body oscillator: sine at currentFreq (with pitch drop) ──
    this.phase += this.currentFreq / this.sr
    this.phase %= 1
    const body = Math.sin(2 * Math.PI * this.phase)

    // ── Body harmonics: layered saw for punch ──
    let bodySignal = body
    if (r.bodyHarmonics > 0) {
      const harmPhase = (this.phase * 2) % 1
      const saw = 2 * harmPhase - 1
      bodySignal = body * (1 - r.bodyHarmonics) + saw * r.bodyHarmonics * 0.5
    }

    // ── Sub oscillator: low sine at pitchEnd ──
    this.subPhase += r.pitchEnd / this.sr
    this.subPhase %= 1
    const sub = Math.sin(2 * Math.PI * this.subPhase)

    // ── Click: filtered noise burst ──
    const noise = Math.random() * 2 - 1
    const click = this.clickFilter.process(noise) * r.clickBrightness

    // ── Mix ──
    const bodyOut = bodySignal * this.bodyEnv * this._velocity
    const subOut = sub * this.subEnv * this._velocity * 0.7
    const clickOut = click * this.clickEnv * r.clickAmount * this._velocity

    let sample = bodyOut + subOut + clickOut

    // ── Saturation ──
    if (r.saturation > 0) {
      sample = tanhSaturation(sample, 1 + r.saturation * 3)
    }

    sample *= r.gain

    this.sampleCounter++
    if (this.sampleCounter >= this.totalSamples) {
      this._active = false
    }

    return sample
  }
}
