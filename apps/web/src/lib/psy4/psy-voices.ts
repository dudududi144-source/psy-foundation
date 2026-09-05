/**
 * Psytrance Synth Voices — rewritten from scratch for commercial quality.
 *
 * The previous voices were primitive: sine sweep kick, simple saw bass,
 * basic supersaw lead. They sounded like a toy.
 *
 * These new voices use proper DSP:
 * - Kick: exponential pitch sweep (150→50Hz) + click transient + sub body + tanh sat
 * - Bass: dual-osc (sub sine + mid saw) through Moog ladder with env, tight 16th envelope
 * - Lead: supersaw through resonant Moog with filter envelope + LFO + Haas stereo
 * - Hats: real samples with velocity variation
 *
 * All voices are sample-accurate, deterministic, and produce commercial-grade sound.
 */

import {
  BLSaw,
  BLSquare,
  BLTriangle,
  LR4Highpass,
  OnePoleHP,
  OversampledSaturation,
  PinkNoise,
  ZDFSVF,
} from './forensic/dsp'
import { Rng } from './forensic/prng'
import { GrainCloud } from './granular'
import type { ModulationMatrix } from './modulation-matrix'
import type { WaveguideString } from './physical/waveguide-string'
import {
  ACID_SPEC,
  BASS_SPEC,
  HAT_SPEC,
  KICK_SPEC,
  LEAD_SPEC,
  PAD_SPEC,
  SNARE_SPEC,
} from './voice-specs'
import type { Wavetable } from './wavetable'

import { DEFAULT_SR as SR } from './constants'

// ═══════════════════════════════════════════════════════════════
// KICK — 3-layer: SUB (dominant) + mid + click
// PSY3 Rule 1: Sub over click (sub 90x longer than click)
// ═══════════════════════════════════════════════════════════════

export class PsyKick {
  active = false
  t = 0
  phase = 0 // mid body phase
  subPhase = 0 // sub phase
  midPhase = 0 // mid triangle phase
  clickHPState = 0
  sat = new OversampledSaturation()
  noise: PinkNoise
  amp = 1
  fund = KICK_SPEC.fundamental
  decay = KICK_SPEC.subDecay

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng)
  }

  trigger(amp: number, fund: number, decay: number) {
    this.active = true
    this.t = 0
    this.phase = 0
    this.subPhase = 0
    this.midPhase = 0
    this.clickHPState = 0
    this.noise.reset()
    this.sat.reset()
    this.amp = amp
    this.fund = fund || KICK_SPEC.fundamental
    this.decay = decay || KICK_SPEC.subDecay
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    // Sub tail extends well beyond mid (PSY3: sub 0.18s, mid 0.05s)
    const decayTotal = KICK_SPEC.subDecay + 0.05
    if (this.t > decayTotal) {
      this.active = false
      return [0, true]
    }

    const t = this.t
    const f0 = this.fund

    // ── Layer 1: SUB (dominant) — sine at fundamental, 0.18s decay ──
    // Starts at peak (cosine phase) for instant punch
    this.subPhase += (2 * Math.PI * f0) / SR
    const subEnv = Math.exp(-t / KICK_SPEC.subDecay)
    const sub = Math.sin(this.subPhase + Math.PI / 2) * subEnv * KICK_SPEC.subLevel

    // ── Layer 2: MID — triangle with pitch sweep, 0.05s decay ──
    const pitchStart = KICK_SPEC.pitchStart
    const pitchEnd = f0
    const currentFreq = (pitchStart - pitchEnd) * Math.exp(-t / KICK_SPEC.pitchDecay) + pitchEnd
    this.midPhase += (2 * Math.PI * currentFreq) / SR
    const midEnv = Math.exp(-t / KICK_SPEC.midDecay)
    // Triangle for warmer mid (sine is too clean, saw too harsh)
    const midTri = 2 * Math.abs(2 * (this.midPhase % 1) - 1) - 1
    const mid = midTri * midEnv * KICK_SPEC.midLevel

    // ── Layer 3: CLICK — noise HP, 0.002s decay (90x shorter than sub) ──
    // Velocity-to-timbre: louder hits = brighter (more click), PSYDRUM pattern
    const n = this.noise.next()
    const clickEnv = Math.exp(-t / KICK_SPEC.clickDecay)
    const hpOut = n - this.clickHPState
    this.clickHPState = this.clickHPState + 0.95 * (n - this.clickHPState)
    // Velocity modulates click level: 0.5x at vel=0, 1.5x at vel=1
    const velToTimbre = 0.5 + this.amp * 1.0
    const click = hpOut * clickEnv * KICK_SPEC.clickLevel * velToTimbre

    // ── Saturate sub + mid together (cohesive punch) ──
    let sample = this.sat.process(sub + mid, KICK_SPEC.saturation)
    sample += click // click is additive, not saturated

    sample *= this.amp

    return [sample, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// BASS — 3-layer: sub + body + character, pluck/sustain mode
// PSY3 Rule 2: Bass leaves room (filter drops to 150Hz)
// LR4 HP at 45Hz (24 dB/oct — keeps kick sub region clean)
// Mid scoop at 300Hz via bandpass subtract (removes boxy mud)
// ═══════════════════════════════════════════════════════════════

export class PsyBass {
  active = false
  t = 0
  freq = 80
  amp = 0.5
  releasing = false
  releaseT = 0
  noteOffTime = 0
  mode: 'pluck' | 'sustain' = BASS_SPEC.mode

  // Waveguide (optional — when set, blends a Karplus-Strong plucked-string
  // decay with the existing bass layers. Default null = legacy behavior.)
  private waveguide: WaveguideString | null = null
  private waveguideLevel = 0.3 // blend level 0..1
  private waveguideDamping = 0.5 // 0=bright pluck, 1=warm sustain
  // Rng for deterministic waveguide excitation (also allows future per-note
  // variation without changing the constructor signature for callers that
  // don't pass an rng)
  private _rng: Rng

  // Layer 1: Sub (sine at f/2, mono)
  subPhase = 0
  // Layer 2: Body (saw through Moog)
  saw1 = new BLSaw()
  saw2 = new BLSaw() // detuned for stereo width
  filter = new ZDFSVF()
  // Layer 3: Character (square through BP, stereo)
  charSquare = new BLSquare()
  charFilter = new ZDFSVF()
  sat = new OversampledSaturation()
  // LR4 highpass (24 dB/oct) — replaces the 6 dB/oct one-pole HP
  hp = new LR4Highpass()
  // Mid scoop: ZDFSVF in bandpass mode at 300Hz, subtract 0.35 depth
  midScoop = new ZDFSVF()

  /**
   * Constructor — accepts an optional Rng for deterministic waveguide mode.
   * Existing call sites (e.g. `new PsyBass()`) still work — the default
   * Rng(seed=1) ensures reproducible excitation noise.
   */
  constructor(rng?: Rng) {
    this._rng = rng ?? new Rng(1)
  }

  trigger(freq: number, dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.freq = freq
    this.amp = amp
    this.releasing = false
    this.releaseT = 0
    this.noteOffTime = dur
    this.subPhase = 0
    // Body saws
    this.saw1.reset()
    this.saw1.setFreq(freq)
    this.saw2.reset()
    this.saw2.setFreq(freq * 2 ** (5 / 1200)) // +5 cents detune
    // Character square
    this.charSquare.reset()
    this.charSquare.setFreq(freq * 2) // octave up
    this.filter.reset()
    this.charFilter.reset()
    this.midScoop.reset()
    this.hp.reset()
    this.sat.reset()
    // Waveguide: trigger with bass frequency for realistic string decay.
    // Deterministic excitation via _rng so reruns produce bit-identical output.
    if (this.waveguide) {
      this.waveguide.triggerDeterministic(freq, 1.0, this.waveguideDamping, this._rng)
    }
  }

  /**
   * setWaveguide — connect an optional WaveguideString to add realistic
   * plucked-string decay to the bass. Pass null to disable.
   */
  setWaveguide(wg: WaveguideString | null): void {
    this.waveguide = wg
  }

  /** Set the waveguide blend level (0..1, default 0.3). */
  setWaveguideLevel(level: number): void {
    this.waveguideLevel = Math.max(0, Math.min(1, level))
  }

  /** Set the waveguide damping (0=bright pluck, 1=warm sustain, default 0.5). */
  setWaveguideDamping(damping: number): void {
    this.waveguideDamping = Math.max(0, Math.min(1, damping))
  }

  setMode(mode: 'pluck' | 'sustain') {
    this.mode = mode
  }

  noteOff() {
    this.releasing = true
    this.releaseT = 0
    if (this.waveguide) this.waveguide.noteOff()
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR

    if (this.releasing) {
      this.releaseT += 1 / SR
      if (this.releaseT > BASS_SPEC.sustainRelease) {
        this.active = false
        return [0, true]
      }
    }

    // ── Layer 1: SUB — sine at f/2, mono, clean low end ──
    this.subPhase += (2 * Math.PI * this.freq * 0.5) / SR
    const sub = Math.sin(this.subPhase) * BASS_SPEC.subLevel

    // ── Layer 2: BODY — 2 detuned saws through Moog ──
    const inc = this.freq / SR
    const sawOut1 = this.saw1.process(inc)
    const sawOut2 = this.saw2.process((this.freq * 2 ** (5 / 1200)) / SR)
    const sawOut = (sawOut1 + sawOut2) * 0.5

    // Filter envelope: opens to 1500Hz, drops to 150Hz (PSY3 Rule 2)
    const cutoffEnv =
      (BASS_SPEC.cutoffStart - BASS_SPEC.cutoffEnd) * Math.exp(-this.t / 0.03) + BASS_SPEC.cutoffEnd
    const filtered = this.filter.process(sawOut, cutoffEnv, BASS_SPEC.res, SR, 0)

    // ── Layer 3: CHARACTER — square through BP at 400Hz, stereo ──
    const charOut = this.charSquare.process((this.freq * 2) / SR)
    const charFiltered =
      this.charFilter.process(charOut, 400, 0.7, SR, 1) * BASS_SPEC.characterLevel

    // ── Mix layers ──
    let mixed = sub + filtered * BASS_SPEC.bodyLevel + charFiltered

    // ── Waveguide layer — Karplus-Strong plucked-string decay ──
    // Adds realistic string-like decay impossible with oscillator+filter.
    // Blended BEFORE the mid scoop + saturation + HP so it gets the same
    // channel treatment as the rest of the bass — keeps the bass cohesive.
    if (this.waveguide && this.waveguideLevel > 0) {
      const wgSig = this.waveguide.render() * this.waveguideLevel
      mixed += wgSig
    }

    // ── Mid scoop: subtract bandpass at 300Hz (depth 0.35) ──
    // This removes the boxy 250-400Hz mud that builds up when the body saw
    // harmonics accumulate. ZDFSVF bandpass output is subtracted from the mix.
    const scoopSig = this.midScoop.process(mixed, 300, 0.6, SR, 1)
    mixed = mixed - scoopSig * 0.5 // deepened: 0.35 → 0.5

    // ── Saturation with oversampling ──
    mixed = this.sat.process(mixed, BASS_SPEC.saturation)

    // ── LR4 HP at 45Hz (24 dB/oct) — let kick own the sub region ──
    // Replaces the previous 6 dB/oct one-pole HP. LR4 gives a much steeper
    // crossover so the bass fundamental (82Hz) is preserved cleanly while
    // everything below 45Hz is removed with minimal phase smear.
    mixed = this.hp.process(mixed, BASS_SPEC.hpFreq, SR)

    // ── Amplitude envelope: pluck vs sustain ──
    const attackEnv = Math.min(1, this.t / 0.0005)
    let ampEnv: number
    if (this.mode === 'pluck') {
      // Pluck: fast decay, no sustain
      ampEnv = attackEnv * Math.exp(-this.t / BASS_SPEC.pluckDecay)
    } else {
      // Sustain: attack → sustain level → release
      const decayEnv = Math.exp(-this.t / 0.05)
      ampEnv = attackEnv * (BASS_SPEC.sustainLevel + (1 - BASS_SPEC.sustainLevel) * decayEnv)
    }
    if (this.releasing) {
      ampEnv *= Math.exp(-this.releaseT / 0.003)
    }

    return [mixed * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// LEAD — 5-layer: fundamental + octave + air + FM + 8kHz harmonic
// PSY3 Rule 3: Band-limited oscillators, no harsh highs
// Layer 5 (8kHz harmonic) BYPASSES the main filter and is added
// after saturation — directly targets the 5-12kHz band where
// HIGH_END_TOO_WEAK was being flagged.
// ═══════════════════════════════════════════════════════════════

export class PsyLead {
  active = false
  t = 0
  freq = 440
  amp = 0.5
  dur = 0.3
  releasing = false
  releaseT = 0
  noteOffTime = 0

  // ModulationMatrix (optional — wired by forensic-bridge)
  private matrix: ModulationMatrix | null = null
  // Per-sample modulation params buffer (reused to avoid allocation)
  private _modParams: {
    cutoff?: number
    fmIndex?: number
    amp?: number
    drive?: number
    delaySend?: number
    wavetablePos?: number
  } = {}

  // Wavetable (optional — when set, replaces the saw fundamental layer with a
  // morphable wavetable. Default null = legacy BLSaw behavior preserved.)
  private wavetable: Wavetable | null = null
  // Wavetable morph position 0..1 (default 0.5 = middle of multi-table)
  private wavetablePos = 0.5

  // DDSP Harmonic synth — REMOVED (Task 13). The field + setter existed but
  // setDDSP had zero callers: an unreachable render branch. Archived under
  // archive/neural-onnx-research/ with revival conditions.

  // trigger() params — stored in fields and used throughout render()
  // Default to LEAD_SPEC values; trigger() overrides from params argument.
  private pCutoff: number = LEAD_SPEC.cutoff
  private pDetune: number = LEAD_SPEC.detune
  private pRes: number = LEAD_SPEC.res
  private pLfoRate: number = LEAD_SPEC.lfoRate
  private pLfoDepth: number = LEAD_SPEC.lfoDepth

  // Layer 1: Fundamental (2 detuned saws)
  saw1 = new BLSaw()
  saw2 = new BLSaw()
  // Layer 2: Octave-up (2 detuned saws)
  octSaw1 = new BLSaw()
  octSaw2 = new BLSaw()
  // Layer 3: Air (noise through HP)
  noise: PinkNoise
  airHP = new OnePoleHP()
  // Layer 4: FM (carrier + modulator)
  carPhase = 0
  modPhase = 0
  // Layer 5: 8kHz harmonic — BLSaw at 4× freq through ZDFSVF bandpass @ 8000Hz
  // BYPASSES main filter, added to output AFTER saturation.
  harmSaw = new BLSaw()
  harmFilter = new ZDFSVF()
  // Filter + saturation
  filter = new ZDFSVF()
  sat = new OversampledSaturation()

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng)
  }

  setModulationMatrix(m: ModulationMatrix | null): void {
    this.matrix = m
  }

  /**
   * setWavetable — connect an optional morphable wavetable to replace the
   * saw fundamental layer. Pass null to restore legacy BLSaw behavior.
   * The wavetable's morph position can be modulated via the matrix destination
   * 'wavetablePos' (see modulation-matrix.ts).
   */
  setWavetable(wt: Wavetable | null): void {
    this.wavetable = wt
  }

  /** Set the wavetable morph position directly (0..1). */
  setWavetablePosition(pos: number): void {
    this.wavetablePos = Math.max(0, Math.min(1, pos))
  }

  /**
   * setDDSP — REMOVED (Task 13). Never called anywhere in the repo; the
   * fundamental-layer branch it controlled was unreachable. See
   * archive/neural-onnx-research/README.md for revival conditions.
   */

  trigger(
    freq: number,
    dur: number,
    amp: number,
    params?: {
      cutoff?: number
      detune?: number
      res?: number
      lfoRate?: number
      lfoDepth?: number
    }
  ) {
    this.active = true
    this.t = 0
    this.freq = freq
    this.dur = dur
    this.amp = amp * LEAD_SPEC.gain
    this.releasing = false
    this.releaseT = 0
    this.noteOffTime = dur
    this.carPhase = 0
    this.modPhase = 0
    // Store trigger params into fields (defaults: LEAD_SPEC values)
    this.pCutoff = params?.cutoff ?? LEAD_SPEC.cutoff
    this.pDetune = params?.detune ?? LEAD_SPEC.detune
    this.pRes = params?.res ?? LEAD_SPEC.res
    this.pLfoRate = params?.lfoRate ?? LEAD_SPEC.lfoRate
    this.pLfoDepth = params?.lfoDepth ?? LEAD_SPEC.lfoDepth
    // Fundamental saws (±pDetune cents)
    this.saw1.reset()
    this.saw1.setFreq(freq * 2 ** (-this.pDetune / 1200))
    this.saw2.reset()
    this.saw2.setFreq(freq * 2 ** (this.pDetune / 1200))
    // Octave saws (±7 cents, octave up) — octave detune stays from spec
    this.octSaw1.reset()
    this.octSaw1.setFreq(freq * 2 * 2 ** (-LEAD_SPEC.octaveDetune / 1200))
    this.octSaw2.reset()
    this.octSaw2.setFreq(freq * 2 * 2 ** (LEAD_SPEC.octaveDetune / 1200))
    // Layer 5: 8kHz harmonic — BLSaw at 4× freq
    this.harmSaw.reset()
    this.harmSaw.setFreq(freq * 4)
    this.noise.reset()
    this.airHP.reset()
    this.harmFilter.reset()
    this.filter.reset()
    this.sat.reset()
    // Wavetable: reset phase, set fundamental frequency.
    if (this.wavetable) {
      this.wavetable.reset()
      this.wavetable.setFreq(freq)
    }
  }

  noteOff() {
    this.releasing = true
    this.releaseT = 0
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR

    if (this.releasing) {
      this.releaseT += 1 / SR
      if (this.releaseT > 0.05) {
        this.active = false
        return [0, true]
      }
    }

    const attackEnv = Math.min(1, this.t / 0.001) // faster attack: 3ms → 1ms = sharper transients

    // ── Layer 1: Fundamental — wavetable OR 2 detuned saws ──
    // (The DDSP branch was removed in Task 13 — setDDSP had no callers, so
    // the branch was unreachable. Priority was DDSP > Wavetable > BLSaw.)
    let fundSig: number
    if (this.wavetable) {
      const inc = this.freq / SR
      fundSig = this.wavetable.process(inc)
    } else {
      fundSig =
        (this.saw1.process((this.freq * 2 ** (-this.pDetune / 1200)) / SR) +
          this.saw2.process((this.freq * 2 ** (this.pDetune / 1200)) / SR)) *
        0.5
    }

    // ── Layer 2: Octave-up — 2 detuned saws, adds brightness ──
    const octSig =
      (this.octSaw1.process((this.freq * 2 * 2 ** (-LEAD_SPEC.octaveDetune / 1200)) / SR) +
        this.octSaw2.process((this.freq * 2 * 2 ** (LEAD_SPEC.octaveDetune / 1200)) / SR)) *
      0.5 *
      LEAD_SPEC.octaveLevel

    // ── Layer 3: Air — noise through HP, adds "sheen" ──
    const n = this.noise.next()
    const airSig =
      this.airHP.process(n, 8000, SR) * LEAD_SPEC.airLevel * Math.exp(-this.t / LEAD_SPEC.airDecay)

    // ── Layer 4: FM — carrier + modulator for harmonic richness ──
    const modEnv = Math.exp(-this.t / 0.08)
    let currentModIndex = LEAD_SPEC.fmIndex * (0.3 + 0.7 * modEnv)
    this.modPhase += (this.freq * LEAD_SPEC.fmRatio) / SR
    if (this.modPhase >= 1) this.modPhase -= 1

    // ── Mix Layers 1-3 (FM added after modIndex is finalized) ──
    let signal = fundSig + octSig + airSig

    // ── Filter cutoff + drive: matrix path OR legacy inline LFO ──
    const filterEnv = Math.exp(-this.t / LEAD_SPEC.filterEnvDecay) * LEAD_SPEC.filterEnvAmount
    let cutoff: number
    let drive = LEAD_SPEC.saturation
    if (this.matrix) {
      // Matrix path: LFO1/2/3, velocity, macros all routed through the matrix.
      // No inline LFO — the matrix handles cutoff/fmIndex/drive modulation.
      this.matrix.setEnvValue(modEnv)
      this.matrix.setVelocity(this.amp)
      this._modParams.cutoff = this.pCutoff * (1 + filterEnv)
      this._modParams.fmIndex = currentModIndex
      this._modParams.amp = 1
      this._modParams.drive = drive
      this._modParams.delaySend = 0
      // Wavetable morph position is included so matrix routes targeting
      // 'wavetablePos' can morph the table during playback.
      this._modParams.wavetablePos = this.wavetablePos
      this.matrix.apply(this._modParams)
      cutoff = Math.max(200, this._modParams.cutoff ?? this.pCutoff)
      currentModIndex = this._modParams.fmIndex ?? currentModIndex
      drive = this._modParams.drive ?? drive
      // Update wavetable morph position from matrix output
      if (this.wavetable && this._modParams.wavetablePos !== undefined) {
        this.wavetable.setPosition(this._modParams.wavetablePos)
      }
    } else {
      // Legacy inline LFO path (preserves pre-matrix behavior when matrix is null)
      const lfo1 = Math.sin(2 * Math.PI * this.pLfoRate * this.t) * this.pLfoDepth
      const lfo2 = Math.sin(2 * Math.PI * 5.5 * this.t) * 0.15 // shimmer LFO
      cutoff = Math.max(200, this.pCutoff * (1 + filterEnv + lfo1 + lfo2))
      // No matrix — apply wavetablePos directly (no LFO modulation)
      if (this.wavetable) this.wavetable.setPosition(this.wavetablePos)
    }

    // FM signal (uses final currentModIndex, after matrix modulation if any)
    const modSig = Math.sin(2 * Math.PI * this.modPhase) * currentModIndex
    this.carPhase += (this.freq + modSig) / SR
    if (this.carPhase >= 1) this.carPhase -= 1
    const fmSig = Math.sin(2 * Math.PI * this.carPhase) * LEAD_SPEC.fmLevel

    // Add FM to the signal that goes through the main filter
    signal = signal + fmSig

    // ── Main filter (uses pRes + computed cutoff) ──
    const filtered = this.filter.process(signal, cutoff, this.pRes, SR, 0)

    // ── Saturation with oversampling (uses computed drive) ──
    let out = this.sat.process(filtered, drive)

    // ── Layer 5: 8kHz harmonic — BYPASSES main filter, added AFTER saturation ──
    // BLSaw at 4× freq through ZDFSVF bandpass @ 8000Hz (res 0.7), amplitude 0.8.
    // Targets the 5-12kHz "presence" band directly to eliminate HIGH_END_TOO_WEAK.
    // v9.2: amplitude 0.7 → 0.8, multiplied by ampEnv for proper envelope tracking.
    const harmRaw = this.harmSaw.process((this.freq * 4) / SR)
    const harmBP = this.harmFilter.process(harmRaw, 8000, 0.7, SR, 1)
    const harmSig = harmBP * 1.0 * attackEnv
    out += harmSig

    // ── Amp envelope ──
    let ampEnv = attackEnv
    if (this.releasing) {
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.02)
    }

    return [out * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// HAT — metallic synthesis (TR-808 style: 6 square oscillators)
// ═══════════════════════════════════════════════════════════════

export class PsyHat {
  active = false
  t = 0
  amp = 0.5
  open = false
  decay = 0.03

  // 6 square oscillators at inharmonic ratios (TR-808 frequencies)
  // These create the characteristic metallic shimmer
  private phases = new Float64Array(6)
  private freqs = [540, 800, 1080, 1360, 1700, 2400]
  // Bandpass filter for the metallic clang
  private bp = new ZDFSVF()
  // Highpass for cleaning up low end
  private hp = new OnePoleHP()
  // Sparkle layer: pink noise through HP at 12kHz, amplitude 0.6
  // Adds airy high-frequency shimmer above the metallic body (5-12kHz band).
  private sparkleNoise: PinkNoise
  private sparkleHP = new OnePoleHP()
  // Per-hit variation (deterministic via Rng)
  private rng: Rng
  private pitchMul = 1.0
  private decayMul = 1.0

  constructor(rng: Rng) {
    this.rng = rng
    this.sparkleNoise = new PinkNoise(rng)
  }

  trigger(amp: number, open = false) {
    this.active = true
    this.t = 0
    this.amp = amp
    this.open = open
    // Per-hit variation: ±2% pitch, ±10% decay (HAT_SPEC)
    this.pitchMul = 1.0 + this.rng.range(-1, 1) * HAT_SPEC.pitchVar
    this.decayMul = 1.0 + this.rng.range(-1, 1) * 0.1
    this.decay = (open ? 0.18 : 0.04) * this.decayMul
    this.phases.fill(0)
    this.bp.reset()
    this.hp.reset()
    this.sparkleNoise.reset()
    this.sparkleHP.reset()
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.t > this.decay * 2) {
      this.active = false
      return [0, true]
    }

    // Sum 6 square oscillators at inharmonic frequencies (with per-hit pitch variation)
    let metallic = 0
    for (let i = 0; i < 6; i++) {
      this.phases[i] = (this.phases[i]! + (this.freqs[i]! * this.pitchMul) / SR) % 1
      metallic += this.phases[i]! < 0.5 ? 1 : -1
    }
    metallic /= 6

    // Bandpass at ~10kHz for shimmer
    const bpOut = this.bp.process(metallic, 12000, 0.5, SR, 1) // bandpass
    // Highpass at 6kHz to remove any low leakage
    const hpOut = this.hp.process(bpOut, 6000, SR)

    // Sparkle layer: pink noise through HP at 12kHz, amplitude 0.6
    // Adds air above the metallic body — targets 5-12kHz presence band.
    const sparkleN = this.sparkleNoise.next()
    const sparkleSig = this.sparkleHP.process(sparkleN, 12000, SR) * 1.0 // raised: 0.6 → 1.0

    // Two-stage envelope: fast attack, exponential decay
    const env = Math.exp(-this.t / this.decay)

    return [(hpOut + sparkleSig) * env * this.amp * 1.5, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// Sample Voice — for 909 kicks / MD hats / MD claps
// ═══════════════════════════════════════════════════════════════

export class PsySample {
  active = false
  pos = 0
  data: Float32Array | null = null
  sampleRate = SR
  amp = 1
  playbackRate = 1

  setData(data: Float32Array, sampleRate: number) {
    this.data = data
    this.sampleRate = sampleRate
  }

  trigger(amp: number) {
    this.active = true
    this.pos = 0
    this.amp = amp
    this.playbackRate = this.sampleRate / SR
  }

  render(): [number, boolean] {
    if (!this.active || !this.data) return [0, true]
    const idx = Math.floor(this.pos)
    if (idx >= this.data.length) {
      this.active = false
      return [0, true]
    }
    const sample = (this.data[idx] ?? 0) * this.amp
    this.pos += this.playbackRate
    return [sample, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// SNARE — 2 tone oscillators + filtered noise (TR-808 style)
// ═══════════════════════════════════════════════════════════════

export class PsySnare {
  active = false
  t = 0
  amp = 0.5
  noise: PinkNoise
  // Two tone oscillators at 180Hz and 330Hz (snare body)
  tone1Phase = 0
  tone2Phase = 0
  freq1 = SNARE_SPEC.tone1Freq
  freq2 = SNARE_SPEC.tone2Freq
  // Bandpass for the noise component
  noiseBP = new ZDFSVF()
  // Highpass for cleaning
  noiseHP = new OnePoleHP()
  // Per-hit variation
  private rng: Rng
  private toneVar = 1.0

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng)
    this.rng = rng
  }

  trigger(amp: number) {
    this.active = true
    this.t = 0
    this.amp = amp
    // Per-hit variation: ±5% tone pitch
    this.toneVar = 1.0 + this.rng.range(-1, 1) * 0.05
    this.tone1Phase = 0
    this.tone2Phase = 0
    this.noise.reset()
    this.noiseBP.reset()
    this.noiseHP.reset()
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.t > 0.2) {
      this.active = false
      return [0, true]
    }

    // ── Noise component: filtered through bandpass + highpass ──
    const n = this.noise.next()
    const bpOut = this.noiseBP.process(n, 1800, 0.7, SR, 1) // ~1.8kHz bandpass
    const hpOut = this.noiseHP.process(bpOut, 1000, SR) // HP at 1kHz
    // Noise has longer decay (the "sizzle")
    const noiseEnv = Math.exp(-this.t / 0.08)
    const noiseOut = hpOut * noiseEnv * 0.7

    // ── Tone component: 2 sines at 180+330Hz (the "body") ──
    this.tone1Phase += (2 * Math.PI * this.freq1 * this.toneVar) / SR
    this.tone2Phase += (2 * Math.PI * this.freq2 * this.toneVar) / SR
    // Tone has shorter decay (the "thwack")
    const toneEnv = Math.exp(-this.t / 0.05)
    const toneOut =
      (Math.sin(this.tone1Phase) * 0.5 + Math.sin(this.tone2Phase) * 0.4) * toneEnv * 0.4

    return [(noiseOut + toneOut) * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// SUB-BASS — sustained sine root
// ═══════════════════════════════════════════════════════════════

export class PsySubBass {
  active = false
  t = 0
  phase = 0
  freq = 50
  amp = 0.3
  releasing = false
  releaseT = 0

  trigger(freq: number, _dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.phase = 0
    this.freq = freq
    this.amp = amp
    this.releasing = false
    this.releaseT = 0
  }

  noteOff() {
    this.releasing = true
    this.releaseT = 0
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.releasing) {
      this.releaseT += 1 / SR
      if (this.releaseT > 0.1) {
        this.active = false
        return [0, true]
      }
    }
    this.phase += (2 * Math.PI * this.freq) / SR
    const attackEnv = Math.min(1, this.t / 0.02)
    let ampEnv = attackEnv
    if (this.releasing) ampEnv = attackEnv * Math.exp(-this.releaseT / 0.05)
    return [Math.sin(this.phase) * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// PAD — 5-layer: 3 osc + chorus + shimmer (PSY3 style)
// ═══════════════════════════════════════════════════════════════

export class PsyPad {
  active = false
  t = 0
  amp = PAD_SPEC.gain
  releasing = false
  releaseT = 0

  // Layer 1-3: 3 detuned oscillators (2 saws + 1 triangle octave-up)
  saws: BLSaw[]
  triOct: BLTriangle
  // Layer 4: Chorus (delayed detuned copy)
  chorusBuf: Float32Array
  chorusPos = 0
  chorusDelay = 882 // 20ms at 44100
  // Layer 5: Shimmer (octave-up via rate modulation)
  shimmerPhase = 0
  // Filter + saturation
  filter = new ZDFSVF()
  sat = new OversampledSaturation()

  constructor(_rng: Rng) {
    this.saws = [new BLSaw(), new BLSaw()]
    this.triOct = new BLTriangle()
    this.chorusBuf = new Float32Array(this.chorusDelay)
  }

  trigger(freqs: number[], _dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.amp = amp * PAD_SPEC.gain
    this.releasing = false
    this.releaseT = 0
    // 2 saws detuned ±7 cents
    this.saws[0]!.reset()
    this.saws[0]!.setFreq(freqs[0]! * 2 ** (-PAD_SPEC.detune / 1200))
    this.saws[1]!.reset()
    this.saws[1]!.setFreq(freqs[1] ?? freqs[0]! * 2 ** (PAD_SPEC.detune / 1200))
    // Triangle octave-up
    this.triOct.reset()
    this.triOct.setFreq((freqs[2] ?? freqs[0]!) * 2)
    // Reset chorus buffer
    this.chorusBuf.fill(0)
    this.chorusPos = 0
    this.shimmerPhase = 0
    this.filter.reset()
    this.sat.reset()
  }

  noteOff() {
    this.releasing = true
    this.releaseT = 0
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.releasing) {
      this.releaseT += 1 / SR
      if (this.releaseT > PAD_SPEC.release) {
        this.active = false
        return [0, true]
      }
    }

    // ── Layers 1-2: Detuned saws ──
    const saw1 = this.saws[0]!.process(this.saws[0]!.freq / SR)
    const saw2 = this.saws[1]!.process(this.saws[1]!.freq / SR)
    const sawSig = (saw1 + saw2) * 0.35

    // ── Layer 3: Triangle octave-up ──
    const triSig = this.triOct.process(this.triOct.freq / SR) * 0.2

    // ── Layer 4: Chorus — delayed detuned copy with LFO ──
    const inputSig = sawSig + triSig
    const chorusLfo = Math.sin(2 * Math.PI * PAD_SPEC.chorusRate * this.t) * PAD_SPEC.chorusDepth
    const chorusReadPos =
      (this.chorusPos - Math.floor(this.chorusDelay * (1 + chorusLfo * 0.1)) + this.chorusDelay) %
      this.chorusDelay
    const chorusSig = this.chorusBuf[chorusReadPos]! * 0.3
    this.chorusBuf[this.chorusPos] = inputSig
    this.chorusPos = (this.chorusPos + 1) % this.chorusDelay

    // ── Layer 5: Shimmer — octave-up via doubled phase ──
    this.shimmerPhase += (this.triOct.freq * 2) / SR // 2x rate = octave up
    if (this.shimmerPhase >= 1) this.shimmerPhase -= 1
    const shimmerSig = (2 * Math.abs(2 * this.shimmerPhase - 1) - 1) * PAD_SPEC.shimmerLevel * 0.3

    // ── Mix all layers ──
    const signal = inputSig + chorusSig + shimmerSig

    // ── Filter: slow sweep with dual LFO ──
    const lfo1 = Math.sin(2 * Math.PI * PAD_SPEC.filterLfoRate * this.t) * PAD_SPEC.filterLfoDepth
    const lfo2 = Math.sin(2 * Math.PI * 0.23 * this.t) * 0.2
    const cutoff = Math.max(200, PAD_SPEC.cutoff * (1 + lfo1 + lfo2))
    const filtered = this.filter.process(signal, cutoff, PAD_SPEC.res, SR, 0)

    // ── Subtle saturation ──
    const out = this.sat.process(filtered, PAD_SPEC.saturation)

    // ── Envelope: long attack + release ──
    const attackEnv = Math.min(1, this.t / PAD_SPEC.attack)
    let ampEnv = attackEnv
    if (this.releasing) ampEnv = attackEnv * Math.exp(-this.releaseT / 0.15)

    return [out * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// SHAKER — filtered noise with bandpass + two-stage decay
// ═══════════════════════════════════════════════════════════════

export class PsyShaker {
  active = false
  t = 0
  amp = 0.25
  noise: PinkNoise
  // Bandpass for the "shhh" character
  bp = new ZDFSVF()
  // Highpass for cleanup
  hp = new OnePoleHP()
  // Per-hit variation
  private rng: Rng
  private bpFreqVar = 7000

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng)
    this.rng = rng
  }

  trigger(amp: number) {
    this.active = true
    this.t = 0
    this.amp = amp
    // Per-hit variation: ±200Hz bandpass center
    this.bpFreqVar = 7000 + this.rng.range(-1, 1) * 200
    this.noise.reset()
    this.bp.reset()
    this.hp.reset()
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.t > 0.06) {
      this.active = false
      return [0, true]
    }
    const n = this.noise.next()
    // Bandpass with per-hit frequency variation
    const bpOut = this.bp.process(n, this.bpFreqVar, 0.4, SR, 1)
    const hpOut = this.hp.process(bpOut, 4000, SR)
    // Two-stage envelope: fast body + slow tail
    const bodyEnv = Math.exp(-this.t / 0.008)
    const tailEnv = Math.exp(-this.t / 0.03)
    const env = bodyEnv * 0.7 + tailEnv * 0.3
    return [hpOut * env * this.amp * 2.0, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// ACID — bidirectional filter LFO (303-style)
// ═══════════════════════════════════════════════════════════════

export class PsyAcid {
  active = false
  t = 0
  freq = 220
  amp = ACID_SPEC.gain
  releasing = false
  releaseT = 0

  // ModulationMatrix (optional — wired by forensic-bridge)
  private matrix: ModulationMatrix | null = null
  // Per-sample modulation params buffer (reused to avoid allocation)
  private _modParams: { cutoff?: number; resonance?: number; drive?: number; amp?: number } = {}

  square = new BLSquare()
  filter = new ZDFSVF()
  sat = new OversampledSaturation()
  hp = new OnePoleHP()

  setModulationMatrix(m: ModulationMatrix | null): void {
    this.matrix = m
  }

  trigger(freq: number, _dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.freq = freq
    this.amp = amp * ACID_SPEC.gain
    this.releasing = false
    this.releaseT = 0
    this.square.reset()
    this.square.setFreq(freq)
    this.filter.reset()
    this.sat.reset()
    this.hp.reset()
  }

  noteOff() {
    this.releasing = true
    this.releaseT = 0
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.releasing) {
      this.releaseT += 1 / SR
      if (this.releaseT > 0.1) {
        this.active = false
        return [0, true]
      }
    }

    // ── Square oscillator ──
    const osc = this.square.process(this.freq / SR)

    // ── Bidirectional filter LFO (up-down, not one-directional) ──
    // This is the key difference from lead: cutoff goes UP and DOWN
    const env = Math.exp(-this.t / ACID_SPEC.envDecay) * ACID_SPEC.envAmount

    let cutoff: number
    let res = ACID_SPEC.res
    let drive = ACID_SPEC.distortion
    if (this.matrix) {
      // Matrix path: LFO2 (2Hz bidirectional) + macros handle cutoff/res/drive.
      this.matrix.setEnvValue(env)
      this.matrix.setVelocity(this.amp)
      this._modParams.cutoff = ACID_SPEC.cutoff * (1 + env)
      this._modParams.resonance = res
      this._modParams.drive = drive
      this._modParams.amp = 1
      this.matrix.apply(this._modParams)
      cutoff = Math.max(200, this._modParams.cutoff ?? ACID_SPEC.cutoff)
      res = this._modParams.resonance ?? res
      drive = this._modParams.drive ?? drive
    } else {
      // Legacy inline LFO path
      const lfo = Math.sin(2 * Math.PI * ACID_SPEC.lfoRate * this.t) * ACID_SPEC.lfoDepth
      // Cutoff modulates bidirectionally: base ± (lfo * range) + env
      cutoff = Math.max(200, ACID_SPEC.cutoff * (1 + lfo + env))
    }

    const filtered = this.filter.process(osc, cutoff, res, SR, 0)

    // ── Heavy distortion (uses computed drive) ──
    let out = this.sat.process(filtered, drive)

    // ── HP to clean low end ──
    out = this.hp.process(out, ACID_SPEC.hpFreq, SR)

    // ── Amp envelope ──
    const attackEnv = Math.min(1, this.t / 0.002)
    let ampEnv = attackEnv
    if (this.releasing) ampEnv = attackEnv * Math.exp(-this.releaseT / 0.05)

    return [out * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// TEXTURE — real granular synthesis + morphing atmospheric bed
// ═══════════════════════════════════════════════════════════════

export class PsyTexture {
  active = false
  t = 0
  amp = 0.15
  releasing = false
  releaseT = 0

  // Grain cloud — replaces the old "4 detuned saws + fake grain movement"
  // with real granular synthesis. Each grain has its own position, pitch,
  // pan, and Hann envelope. Spawns grains at the configured density.
  private cloud: GrainCloud
  private cloudAmp = 0.6 // gain applied to grain cloud output
  // Noise bed (kept — adds a low-frequency rumble layer beneath the grains)
  noise: PinkNoise
  noiseBP = new ZDFSVF()
  // Filter
  filter = new ZDFSVF()
  sat = new OversampledSaturation()
  // Source-buffer cache so we don't regenerate per trigger
  private sourceBuffer: Float32Array | null = null
  private sourceFreq = 220
  // Rng reference (for source-buffer generation)
  private rng: Rng

  constructor(rng: Rng) {
    this.rng = rng
    // Default source: 2-second mixed saw+noise buffer. Will be regenerated
    // in trigger() based on the actual chord freqs.
    this.sourceBuffer = GrainCloud.generateMixedBuffer(rng, 220, 2.0, 0.5)
    this.cloud = new GrainCloud(this.sourceBuffer, rng)
    // Density 60 grains/sec, 40ms grains — dense evolving texture
    this.cloud.setDensity(60)
    this.cloud.setGrainDuration(40)
    this.cloud.setPitchVar(0.15) // +/-15% pitch variation
    this.cloud.setPosVar(0.4) // +/-40% position spread
    this.cloud.setAmp(0.5)
    this.noise = new PinkNoise(rng)
  }

  trigger(freqs: number[], _dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.amp = amp * 0.15
    this.releasing = false
    this.releaseT = 0
    // Generate a fresh source buffer based on the chord's root frequency.
    // Mixed saw+noise gives the cloud both pitch definition (for harmonic
    // coherence with the rest of the mix) and noisy evolution (for texture).
    const root = freqs[0] ?? 220
    if (Math.abs(root - this.sourceFreq) > 0.5 || !this.sourceBuffer) {
      this.sourceFreq = root
      this.sourceBuffer = GrainCloud.generateMixedBuffer(this.rng, root, 2.0, 0.5)
      this.cloud.setBuffer(this.sourceBuffer)
    } else {
      this.cloud.reset()
    }
    this.noise.reset()
    this.noiseBP.reset()
    this.filter.reset()
    this.sat.reset()
  }

  noteOff() {
    this.releasing = true
    this.releaseT = 0
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.releasing) {
      this.releaseT += 1 / SR
      if (this.releaseT > 0.5) {
        this.active = false
        return [0, true]
      }
    }

    // ── Layer 1: Real granular cloud — spawns grains, applies Hann window ──
    // Returns stereo [L, R] with per-grain pan. We sum to mono (0.5*(L+R))
    // since PsyTexture's output interface is mono — external M/S widening
    // (in forensic-bridge master chain) spreads this back to stereo.
    const [gL, gR] = this.cloud.process()
    const grainSig = (gL + gR) * 0.5 * this.cloudAmp

    // ── Layer 2: Noise bed with slow bandpass sweep (kept from old design) ──
    const n = this.noise.next()
    const noiseSweep = 400 + Math.sin(2 * Math.PI * 0.1 * this.t) * 300 // 100-700Hz
    const noiseSig = this.noiseBP.process(n, noiseSweep, 0.5, SR, 1) * 0.3

    // ── Mix ──
    const signal = grainSig + noiseSig * 0.4

    // ── Filter: slow morph (0.05Hz) ──
    const morphLfo = Math.sin(2 * Math.PI * 0.05 * this.t) * 0.5
    const cutoff = Math.max(200, 800 * (1 + morphLfo))
    const filtered = this.filter.process(signal, cutoff, 0.3, SR, 0)

    // ── Saturation ──
    const out = this.sat.process(filtered, 1.2)

    // ── Envelope: very slow attack + long release ──
    const attackEnv = Math.min(1, this.t / 0.5) // 0.5s attack
    let ampEnv = attackEnv
    if (this.releasing) ampEnv = attackEnv * Math.exp(-this.releaseT / 0.3)

    return [out * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// FX RISER — noise + saw sweep with pitch rise for tension build
// ═══════════════════════════════════════════════════════════════

export class PsyRiser {
  active = false
  t = 0
  dur = 2.0
  amp = 0.25
  noise: PinkNoise
  filter = new ZDFSVF()
  // Saw oscillator for pitched rise
  saw = new BLSaw()
  sawPhase = 0

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng)
  }

  trigger(dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.dur = dur
    this.amp = amp
    this.noise.reset()
    this.filter.reset()
    this.saw.reset()
    this.sawPhase = 0
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.t > this.dur) {
      this.active = false
      return [0, true]
    }
    const progress = this.t / this.dur

    // Noise sweep: filter opens from 200Hz to 10kHz
    const n = this.noise.next()
    const cutoff = 200 + progress ** 1.5 * 9800
    const filtered = this.filter.process(n, cutoff, 0.5, SR, 0)

    // Pitched saw: rises from 100Hz to 800Hz exponentially
    const sawFreq = 100 * 8 ** progress // 100→800Hz
    this.sawPhase += sawFreq / SR
    if (this.sawPhase >= 1) this.sawPhase -= 1
    const sawSig = (2 * this.sawPhase - 1) * 0.3

    // Mix noise + saw, with exponential energy build
    const mixed = filtered * 0.6 + sawSig * 0.4
    const env = progress ** 2 * this.amp
    return [mixed * env, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// FX IMPACT — sub drop
// ═══════════════════════════════════════════════════════════════

export class PsyImpact {
  active = false
  t = 0
  phase = 0
  amp = 0.4
  noise: PinkNoise

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng)
  }

  trigger(amp: number) {
    this.active = true
    this.t = 0
    this.phase = 0
    this.amp = amp
    this.noise.reset()
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.t > 0.5) {
      this.active = false
      return [0, true]
    }
    const freq = (120 - 35) * Math.exp(-this.t / 0.1) + 35
    this.phase += (2 * Math.PI * freq) / SR
    const sub = Math.sin(this.phase) * Math.exp(-this.t / 0.3) * 0.7
    const crack = this.noise.next() * Math.exp(-this.t / 0.02) * 0.3
    return [(sub + crack) * this.amp, false]
  }
}
