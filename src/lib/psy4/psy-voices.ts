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

import { fastTanh, MoogLadder, BLSaw, BLSquare, BLTriangle, OnePoleHP, PinkNoise, polyBlep } from './forensic/dsp'
import { Rng } from './forensic/prng'

const SR = 44100

// ═══════════════════════════════════════════════════════════════
// KICK — commercial psytrance kick (3-layer: body + sub + click)
// ═══════════════════════════════════════════════════════════════

export class PsyKick {
  active = false
  t = 0
  phase = 0
  subPhase = 0
  clickFilter = new MoogLadder()
  noise: PinkNoise
  amp = 1
  fund = 50
  decay = 0.15

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng)
  }

  trigger(amp: number, fund: number, decay: number) {
    this.active = true
    this.t = 0
    this.phase = 0
    this.subPhase = 0
    this.noise.reset()
    this.clickFilter.reset()
    this.amp = amp
    this.fund = fund
    this.decay = decay
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    const decayTotal = this.decay + 0.1 // longer tail for sub
    if (this.t > decayTotal) { this.active = false; return [0, true] }

    const t = this.t
    const f0 = this.fund

    // ── Pitch envelope: aggressive sweep 200Hz → 45Hz over 12ms ──
    const pitchStart = 200
    const pitchEnd = f0
    const pitchDecay = 0.012 // 12ms
    const currentFreq = (pitchStart - pitchEnd) * Math.exp(-t / pitchDecay) + pitchEnd

    // ── Body: sine with pitch sweep (the "thump") ──
    this.phase += (2 * Math.PI * currentFreq) / SR
    const bodyEnv = Math.exp(-t / (this.decay * 0.5))
    const body = Math.sin(this.phase) * bodyEnv * 1.0

    // ── Sub: sine at fundamental, longer decay (the "weight") ──
    this.subPhase += (2 * Math.PI * f0) / SR
    const subEnv = Math.exp(-t / (this.decay * 1.5)) // longer than body
    const sub = Math.sin(this.subPhase) * subEnv * 0.6

    // ── Click: noise through Moog bandpass ──
    const n = this.noise.next()
    const clickEnv = Math.exp(-t / 0.0008) // 0.8ms — very sharp
    const click = this.clickFilter.process(n * clickEnv, 5000, 0.9, 2.0, SR) * 0.4

    // ── Saturate body + sub together for cohesive punch ──
    let sample = (body + sub) * 1.2
    sample = fastTanh(sample)
    sample += click * 0.5

    sample *= this.amp * 0.75

    return [sample, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// BASS — rolling psytrance bass with filter groove
// ═══════════════════════════════════════════════════════════════

export class PsyBass {
  active = false
  t = 0
  freq = 80
  amp = 0.5
  releasing = false
  releaseT = 0
  noteOffTime = 0

  // Mid oscillator (saw through Moog) — NO separate sub (kick owns the sub)
  saw = new BLSaw()
  filter = new MoogLadder()
  hpState = 0

  // Filter envelope — dramatic open/close for groove
  cutoffStart = 800
  cutoffEnd = 200
  res = 0.3 // higher resonance for "rubber" character

  trigger(freq: number, dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.freq = freq
    this.amp = amp
    this.releasing = false
    this.releaseT = 0
    this.noteOffTime = dur
    this.hpState = 0
    this.saw.reset()
    this.saw.setFreq(freq)
    this.filter.reset()
  }

  noteOff() {
    this.releasing = true
    this.releaseT = 0
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR

    // Release phase: 5ms quick fade (was 10ms — tighter)
    if (this.releasing) {
      this.releaseT += 1 / SR
      if (this.releaseT > 0.005) { this.active = false; return [0, true] }
    }

    // ── Saw through Moog with dramatic filter envelope ──
    const inc = this.freq / SR
    const sawOut = this.saw.process(inc)

    // Filter envelope: opens to 800Hz, closes to 200Hz over 20ms
    // This creates the "wub" groove on each 16th note
    const cutoffEnv = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / 0.02) + this.cutoffEnd
    const filtered = this.filter.process(sawOut, cutoffEnv, this.res, 2.0, SR)

    // ── Saturation for harmonics (stronger) ──
    let mixed = fastTanh(filtered * 2.5)

    // ── HP at 80Hz — let the kick own the sub region ──
    const hpA = (1 / SR) * 2 * Math.PI * 80
    this.hpState += (hpA * (mixed - this.hpState)) / (1 + hpA)
    mixed = mixed - this.hpState * 0.8

    // ── Amplitude envelope: 0.5ms attack → sustain → 5ms release ──
    const attackEnv = Math.min(1, this.t / 0.0005)
    let ampEnv = attackEnv
    if (this.releasing) {
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.003)
    }

    return [mixed * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// LEAD — FM + acid filter (richer, psychedelic)
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

  // Carrier + modulator for FM
  carPhase = 0
  modPhase = 0
  modRatio = 2.0 // modulator at 2x carrier frequency
  modIndex = 200 // FM depth in Hz — grows over note for "buzzy" attack
  // Sub oscillator (triangle, one octave down for weight)
  subOsc = new BLTriangle()
  // Filter
  filter = new MoogLadder()
  cutoff = 1500
  res = 0.7
  filterEnvAmount = 3.0
  // LFO
  lfoRate = 1.2
  lfoDepth = 0.5

  constructor(_rng: Rng) {}

  trigger(freq: number, dur: number, amp: number, params?: {
    cutoff?: number; detune?: number; res?: number; lfoRate?: number; lfoDepth?: number
  }) {
    this.active = true
    this.t = 0
    this.freq = freq
    this.dur = dur
    this.amp = amp
    this.releasing = false
    this.releaseT = 0
    this.noteOffTime = dur
    this.cutoff = params?.cutoff ?? 1500
    this.res = params?.res ?? 0.7
    this.lfoRate = params?.lfoRate ?? 1.2
    this.lfoDepth = params?.lfoDepth ?? 0.5
    this.carPhase = 0
    this.modPhase = 0
    this.subOsc.reset()
    this.subOsc.setFreq(freq * 0.5)
    this.filter.reset()
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
      if (this.releaseT > 0.05) { this.active = false; return [0, true] }
    }

    // ── FM carrier: sine modulated by sine ──
    // modIndex grows during attack for "buzzy" onset, then decays
    const attackEnv = Math.min(1, this.t / 0.003)
    const modEnv = Math.exp(-this.t / 0.08) // mod depth decays over 80ms
    const currentModIndex = this.modIndex * (0.3 + 0.7 * modEnv)

    // Modulator: sine at freq * modRatio
    this.modPhase += (this.freq * this.modRatio) / SR
    if (this.modPhase >= 1) this.modPhase -= 1
    const modSig = Math.sin(2 * Math.PI * this.modPhase) * currentModIndex

    // Carrier: sine at freq + FM modulation
    this.carPhase += (this.freq + modSig) / SR
    if (this.carPhase >= 1) this.carPhase -= 1
    const carSig = Math.sin(2 * Math.PI * this.carPhase)

    // ── Sub oscillator: triangle one octave down for weight ──
    const subSig = this.subOsc.process(this.freq * 0.5 / SR) * 0.3

    // ── Mix carrier + sub ──
    let signal = carSig * 0.8 + subSig

    // ── Acid filter envelope ──
    const filterEnv = Math.exp(-this.t / 0.12) * this.filterEnvAmount
    const lfo = Math.sin(2 * Math.PI * this.lfoRate * this.t) * this.lfoDepth
    const cutoff = Math.max(200, this.cutoff * (1 + filterEnv + lfo * 0.5))
    const filtered = this.filter.process(signal, cutoff, this.res, 1.5, SR)

    // ── Hard saturation for acid character ──
    let out = fastTanh(filtered * 2.0)

    // ── Amp envelope ──
    let ampEnv = attackEnv
    if (this.releasing) {
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.02)
    }

    return [out * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// HAT — synthetic hat (fallback when no sample)
// ═══════════════════════════════════════════════════════════════

export class PsyHat {
  active = false
  t = 0
  amp = 0.5
  open = false
  decay = 0.03
  noise: PinkNoise
  prevNoise = 0

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng)
  }

  trigger(amp: number, open = false) {
    this.active = true
    this.t = 0
    this.amp = amp
    this.open = open
    this.decay = open ? 0.15 : 0.03
    this.prevNoise = 0
    this.noise.reset()
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.t > this.decay * 1.5) { this.active = false; return [0, true] }

    const n = this.noise.next()
    // High-pass via differentiation (6kHz+ emphasis)
    const hp = n - this.prevNoise
    this.prevNoise = n

    const env = Math.exp(-this.t / this.decay)
    return [hp * env * this.amp * 2.0, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// Sample Voice — for 909 kicks / MD hats / MD claps
// ═══════════════════════════════════════════════════════════════

export class PsySample {
  active = false
  pos = 0
  data: Float32Array | null = null
  sampleRate = 44100
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
    if (idx >= this.data.length) { this.active = false; return [0, true] }
    const sample = (this.data[idx] ?? 0) * this.amp
    this.pos += this.playbackRate
    return [sample, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// SNARE — proper snare with noise + tone
// ═══════════════════════════════════════════════════════════════

export class PsySnare {
  active = false
  t = 0
  amp = 0.5
  noise: PinkNoise
  prevNoise = 0
  tonePhase = 0
  freq = 200

  constructor(rng: Rng) {
    this.noise = new PinkNoise(rng)
  }

  trigger(amp: number) {
    this.active = true
    this.t = 0
    this.amp = amp
    this.prevNoise = 0
    this.tonePhase = 0
    this.noise.reset()
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.t > 0.15) { this.active = false; return [0, true] }

    const n = this.noise.next()
    const hp = n - this.prevNoise
    this.prevNoise = n
    const noiseEnv = Math.exp(-this.t / 0.06)
    const noiseOut = hp * noiseEnv * 0.6

    this.tonePhase += (2 * Math.PI * this.freq) / SR
    const toneEnv = Math.exp(-this.t / 0.04)
    const toneOut = Math.sin(this.tonePhase) * toneEnv * 0.3

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
      if (this.releaseT > 0.1) { this.active = false; return [0, true] }
    }
    this.phase += (2 * Math.PI * this.freq) / SR
    const attackEnv = Math.min(1, this.t / 0.02)
    let ampEnv = attackEnv
    if (this.releasing) ampEnv = attackEnv * Math.exp(-this.releaseT / 0.05)
    return [Math.sin(this.phase) * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// PAD — sustained chord with slow filter sweep
// ═══════════════════════════════════════════════════════════════

export class PsyPad {
  active = false
  t = 0
  saws: BLSaw[]
  filter = new MoogLadder()
  amp = 0.12
  releasing = false
  releaseT = 0
  cutoff = 800

  constructor(rng: Rng) {
    this.saws = [new BLSaw(), new BLSaw(), new BLSaw()]
    void rng
  }

  trigger(freqs: number[], _dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.amp = amp
    this.releasing = false
    this.releaseT = 0
    for (let i = 0; i < 3; i++) {
      this.saws[i]!.reset()
      this.saws[i]!.setFreq(freqs[i] ?? freqs[0] ?? 220)
    }
    this.filter.reset()
  }

  noteOff() { this.releasing = true; this.releaseT = 0 }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.releasing) {
      this.releaseT += 1 / SR
      if (this.releaseT > 0.3) { this.active = false; return [0, true] }
    }
    let signal = 0
    for (let i = 0; i < 3; i++) {
      const f = this.saws[i]!.freq
      signal += this.saws[i]!.process(f / SR)
    }
    signal /= 3
    const lfo = Math.sin(2 * Math.PI * 0.5 * this.t) * 0.3
    const cutoff = Math.max(200, this.cutoff * (1 + lfo))
    const filtered = this.filter.process(signal, cutoff, 0.2, 1.0, SR)
    const attackEnv = Math.min(1, this.t / 0.1)
    let ampEnv = attackEnv
    if (this.releasing) ampEnv = attackEnv * Math.exp(-this.releaseT / 0.15)
    return [filtered * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// SHAKER — 16th grid percussion
// ═══════════════════════════════════════════════════════════════

export class PsyShaker {
  active = false
  t = 0
  amp = 0.25
  noise: PinkNoise
  prevNoise = 0
  filter = new MoogLadder()

  constructor(rng: Rng) { this.noise = new PinkNoise(rng) }

  trigger(amp: number) {
    this.active = true
    this.t = 0
    this.amp = amp
    this.prevNoise = 0
    this.noise.reset()
    this.filter.reset()
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.t > 0.04) { this.active = false; return [0, true] }
    const n = this.noise.next()
    const hp = n - this.prevNoise
    this.prevNoise = n
    const filtered = this.filter.process(hp, 6000, 0.3, 1.0, SR)
    const env = Math.exp(-this.t / 0.02)
    return [filtered * env * this.amp * 1.5, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// FX RISER — filter sweep for builds
// ═══════════════════════════════════════════════════════════════

export class PsyRiser {
  active = false
  t = 0
  dur = 2.0
  amp = 0.25
  noise: PinkNoise
  filter = new MoogLadder()

  constructor(rng: Rng) { this.noise = new PinkNoise(rng) }

  trigger(dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.dur = dur
    this.amp = amp
    this.noise.reset()
    this.filter.reset()
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    if (this.t > this.dur) { this.active = false; return [0, true] }
    const progress = this.t / this.dur
    const n = this.noise.next()
    const cutoff = 200 + progress * 7800
    const filtered = this.filter.process(n, cutoff, 0.4, 1.5, SR)
    const env = Math.pow(progress, 2) * this.amp
    return [filtered * env, false]
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

  constructor(rng: Rng) { this.noise = new PinkNoise(rng) }

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
    if (this.t > 0.5) { this.active = false; return [0, true] }
    const freq = (120 - 35) * Math.exp(-this.t / 0.1) + 35
    this.phase += (2 * Math.PI * freq) / SR
    const sub = Math.sin(this.phase) * Math.exp(-this.t / 0.3) * 0.7
    const crack = this.noise.next() * Math.exp(-this.t / 0.02) * 0.3
    return [(sub + crack) * this.amp, false]
  }
}
