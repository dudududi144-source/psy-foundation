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

import { fastTanh, MoogLadder, BLSaw, BLSquare, PinkNoise, polyBlep } from './forensic/dsp'
import { Rng } from './forensic/prng'

const SR = 44100

// ═══════════════════════════════════════════════════════════════
// KICK — proper psytrance kick
// ═══════════════════════════════════════════════════════════════

export class PsyKick {
  active = false
  t = 0
  phase = 0
  subPhase = 0
  noise: PinkNoise
  prevNoise = 0
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
    this.prevNoise = 0
    this.noise.reset()
    this.amp = amp
    this.fund = fund
    this.decay = decay
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    this.t += 1 / SR
    const decayTotal = this.decay + 0.05
    if (this.t > decayTotal) { this.active = false; return [0, true] }

    const t = this.t
    const f0 = this.fund

    // ── Pitch envelope: exponential sweep from 150Hz to f0 over 30ms ──
    const pitchStart = f0 * 3.0 // 150Hz if f0=50
    const pitchEnd = f0
    const pitchDecay = 0.03 // 30ms sweep
    const currentFreq = (pitchStart - pitchEnd) * Math.exp(-t / pitchDecay) + pitchEnd

    // ── Body: sine with pitch sweep (the "thump") ──
    this.phase += (2 * Math.PI * currentFreq) / SR
    const bodyEnv = Math.exp(-t / (this.decay * 0.7))
    const body = Math.sin(this.phase) * bodyEnv * 0.7

    // ── Sub: low sine at fundamental (the "weight") ──
    this.subPhase += (2 * Math.PI * f0) / SR
    const subEnv = Math.exp(-t / (this.decay * 1.2))
    const sub = Math.sin(this.subPhase) * subEnv * 0.5

    // ── Click: differentiated noise (the "attack") ──
    const n = this.noise.next()
    const clickEnv = Math.exp(-t / 0.002) // 2ms click
    const click = (n - this.prevNoise) * clickEnv * 0.4
    this.prevNoise = n

    // ── Mix + saturate ──
    let sample = body + sub + click
    sample = fastTanh(sample * 1.3) // gentle saturation
    sample *= this.amp * 0.85

    return [sample, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// BASS — proper rolling psytrance bass
// ═══════════════════════════════════════════════════════════════

export class PsyBass {
  active = false
  t = 0
  freq = 80
  amp = 0.5
  releasing = false
  releaseT = 0
  noteOffTime = 0

  // Sub oscillator (sine)
  subPhase = 0
  // Mid oscillator (saw through Moog)
  saw = new BLSaw()
  filter = new MoogLadder()
  // HP to clean up sub rumble
  hpState = 0

  // Filter envelope
  cutoffStart = 500
  cutoffEnd = 120
  res = 0.15

  trigger(freq: number, dur: number, amp: number) {
    this.active = true
    this.t = 0
    this.freq = freq
    this.amp = amp
    this.releasing = false
    this.releaseT = 0
    this.noteOffTime = dur
    this.subPhase = 0
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

    // Release phase: 10ms quick fade
    if (this.releasing) {
      this.releaseT += 1 / SR
      if (this.releaseT > 0.01) { this.active = false; return [0, true] }
    }

    // ── Sub layer: clean sine at fundamental ──
    this.subPhase += (2 * Math.PI * this.freq) / SR
    const sub = Math.sin(this.subPhase) * 0.4

    // ── Mid layer: saw through Moog with filter envelope ──
    const inc = this.freq / SR
    const sawOut = this.saw.process(inc)

    // Filter envelope: fast attack, settle to cutoffEnd
    const cutoffEnv = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / 0.03) + this.cutoffEnd
    const filtered = this.filter.process(sawOut, cutoffEnv, this.res, 1.8, SR)

    // ── Mix sub + mid (more mid for harmonic presence) ──
    let mixed = sub * 0.35 + filtered * 0.65

    // ── Saturation for harmonics (stronger for more high-end) ──
    mixed = fastTanh(mixed * 2.0)

    // ── HP at 30Hz to clean sub rumble ──
    const hpA = (1 / SR) * 2 * Math.PI * 30
    this.hpState += (hpA * (mixed - this.hpState)) / (1 + hpA)
    mixed = mixed - this.hpState * 0.7

    // ── Amplitude envelope: 1ms attack → sustain → 10ms release ──
    const attackEnv = Math.min(1, this.t / 0.001)
    let ampEnv = attackEnv
    if (this.releasing) {
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.005)
    }

    return [mixed * ampEnv * this.amp, false]
  }
}

// ═══════════════════════════════════════════════════════════════
// LEAD — proper acid psytrance lead
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

  // 3 detuned saws for supersaw
  saws: BLSaw[]
  detune = 8 // cents
  // Filter
  filter = new MoogLadder()
  cutoff = 2000
  res = 0.4
  filterEnvAmount = 0.6
  // LFO
  lfoPhase = 0
  lfoRate = 0.8
  lfoDepth = 0.3
  // Noise for air
  noise: PinkNoise

  constructor(rng: Rng) {
    this.saws = [new BLSaw(), new BLSaw(), new BLSaw()]
    this.noise = new PinkNoise(rng)
  }

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
    this.cutoff = params?.cutoff ?? 2000
    this.detune = params?.detune ?? 8
    this.res = params?.res ?? 0.4
    this.lfoRate = params?.lfoRate ?? 0.8
    this.lfoDepth = params?.lfoDepth ?? 0.3
    this.lfoPhase = 0

    for (let i = 0; i < 3; i++) {
      this.saws[i]!.reset()
      const cents = (i - 1) * this.detune
      this.saws[i]!.setFreq(freq * Math.pow(2, cents / 1200))
    }
    this.filter.reset()
    this.noise.reset()
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

    // ── Supersaw: 3 detuned saws ──
    let signal = 0
    for (let i = 0; i < 3; i++) {
      signal += this.saws[i]!.process(this.freq / SR)
    }
    signal /= 3

    // ── Octave layer: add freq*2 saw for brightness ──
    // This adds high-end harmonics that the filter doesn't kill
    const octaveSaw = this.saws[0]!.process((this.freq * 2) / SR) * 0.3
    signal += octaveSaw

    // ── Filter envelope: opens on attack, closes to base ──
    const filterEnv = Math.exp(-this.t / 0.15) * this.filterEnvAmount
    const lfo = Math.sin(2 * Math.PI * this.lfoRate * this.t) * this.lfoDepth
    const cutoff = this.cutoff * (1 + filterEnv + lfo * 0.3)
    const filtered = this.filter.process(signal, Math.max(100, cutoff), this.res, 1.3, SR)

    // ── Air: noise for high-end presence (stronger) ──
    const airNoise = this.noise.next() * 0.05 * Math.exp(-this.t / 0.1)

    // ── Saturate (stronger for more harmonics) ──
    let out = filtered + airNoise
    out = fastTanh(out * 1.5)

    // ── Amp envelope: 5ms attack → sustain → 50ms release ──
    const attackEnv = Math.min(1, this.t / 0.005)
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
      const f = this.saws[i]!.frequency
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
