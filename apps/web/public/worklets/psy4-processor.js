/**
 * PSY4 Real-Time AudioWorklet Processor
 *
 * Phase 4 Day 2: updated to honestly document 13-voice engine.
 *
 * This file runs in the AudioWorklet thread (separate from main thread).
 * It receives MIDI notes and renders audio in real-time at the audio rate.
 *
 * To use:
 *   await audioContext.audioWorklet.addModule('/worklets/psy4-processor.js')
 *   const node = new AudioWorkletNode(audioContext, 'psy4-processor')
 *   node.port.postMessage({ type: 'noteOn', midi: 64, velocity: 0.8 })
 *
 * Architecture (13 voices):
 * - 8 LeadVoice (polyphonic, ZDF SVF + BLSaw + DecayEnv)
 * - 2 BassVoice (sub sine + saw through filter)
 * - 2 PadVoice (detuned saws through filter, slow env)
 * - 1 AcidVoice (BLSquare through resonant filter with sweep) [Phase 4 Day 2]
 *
 * MIDI routing by pitch range:
 *   midi < 48  → BassVoice
 *   midi >= 72 → PadVoice
 *   midi 48-71 → LeadVoice
 *   (AcidVoice triggered by noteOn with type='acid' message)
 *
 * Phase 4 Day 2 additions:
 * - AcidVoice (13th voice — TB-303 style square + filter sweep)
 * - noteOff support (all voices)
 * - Stereo output via Haas delay (15ms on R channel)
 * - parameter automation via MessagePort
 *
 * DSP primitives (ported from TypeScript):
 * - ZDF SVF (Simper/Zavalishin topology)
 * - BLSaw (PolyBLEP band-limited sawtooth)
 * - BLSquare (PolyBLEP band-limited square)
 * - DecayEnv (exponential decay)
 */

// Phase 1.5 (PLAN_V3_MASTER) fix: use the AudioWorkletGlobalScope
// `sampleRate`, which always equals the AudioContext's rate. The old
// `const SR = 44100 // Will be overridden` could never be overridden (it is
// a const), so every filter, envelope and crossover was ~9% mistuned on
// 48 kHz hardware — the most common device rate.
const SR = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 44100

// ── ZDF State-Variable Filter (same as src/lib/psy4/forensic/dsp.ts) ──
class ZDFSVF {
  constructor() {
    this.ic1eq = 0
    this.ic2eq = 0
  }
  reset() { this.ic1eq = 0; this.ic2eq = 0 }
  process(x, cutoff, res, sr, outType) {
    const g = Math.tan(Math.PI * Math.max(20, Math.min(20000, cutoff)) / sr)
    const k = Math.max(0, Math.min(1.5, res))
    const a1 = 1 / (1 + g * (g + k))
    const a2 = g * a1
    const a3 = g * a2
    const v3 = x - this.ic2eq
    const v1 = a1 * this.ic1eq + a2 * v3
    const v2 = this.ic2eq + a2 * this.ic1eq + a3 * v3
    this.ic1eq = 2 * v1 - this.ic1eq
    this.ic2eq = 2 * v2 - this.ic2eq
    if (outType === 0) return v2  // lowpass
    if (outType === 1) return v1  // bandpass
    if (outType === 2) return x - v2  // highpass
    return v2
  }
}

// ── Band-Limited Saw (PolyBLEP) ──
class BLSaw {
  constructor() {
    this.phase = 0
    this.lastPhase = 0
  }
  reset() { this.phase = 0; this.lastPhase = 0 }
  process(inc) {
    this.lastPhase = this.phase
    this.phase += inc
    let blep = 0
    if (this.phase >= 1) {
      this.phase -= 1
      const dt = inc
      const t = this.phase / dt
      blep = -t * t * (1 - t) * 0.5 * dt * 4
    }
    let saw = 2 * this.lastPhase - 1
    return saw + blep
  }
}

// ── Decay Envelope ──
class DecayEnv {
  constructor() { this.t = 0; this.decay = 0.3; this.amp = 0 }
  reset() { this.t = 0 }
  trigger(amp) { this.t = 0; this.amp = amp }
  process() {
    this.t += 1 / SR
    return Math.exp(-this.t / this.decay) * this.amp
  }
}

// ── Voice (single lead voice) ──
class LeadVoice {
  constructor() {
    this.saw = new BLSaw()
    this.filter = new ZDFSVF()
    this.env = new DecayEnv()
    this.freq = 440
    this.cutoff = 3000
    this.res = 0.3
    this.active = false
  }
  noteOn(midi, velocity) {
    this.freq = 440 * Math.pow(2, (midi - 69) / 12)
    this.saw.reset()
    this.filter.reset()
    this.env.trigger(velocity)
    this.active = true
  }
  process() {
    if (!this.active) return 0
    const env = this.env.process()
    if (env < 0.001) { this.active = false; return 0 }
    const saw = this.saw.process(this.freq / SR)
    const filtered = this.filter.process(saw, this.cutoff, this.res, SR, 0)
    return filtered * env
  }
}

// ── Bass Voice (simple sub + saw) ──
class BassVoice {
  constructor() {
    this.subPhase = 0
    this.saw = new BLSaw()
    this.filter = new ZDFSVF()
    this.env = new DecayEnv()
    this.freq = 82
    this.cutoff = 800
    this.res = 0.3
    this.active = false
  }
  noteOn(midi, velocity) {
    this.freq = 440 * Math.pow(2, (midi - 69) / 12)
    this.subPhase = 0
    this.saw.reset()
    this.filter.reset()
    this.env.decay = 0.15
    this.env.trigger(velocity)
    this.active = true
  }
  process() {
    if (!this.active) return 0
    const env = this.env.process()
    if (env < 0.001) { this.active = false; return 0 }
    this.subPhase += (2 * Math.PI * this.freq) / SR
    if (this.subPhase > 2 * Math.PI) this.subPhase -= 2 * Math.PI
    const sub = Math.sin(this.subPhase) * 0.5
    const saw = this.saw.process(this.freq / SR) * 0.5
    const filtered = this.filter.process(sub + saw, this.cutoff, this.res, SR, 0)
    return filtered * env
  }
}

// ── Pad Voice (detuned saws + slow env) ──
class PadVoice {
  constructor() {
    this.saw1 = new BLSaw()
    this.saw2 = new BLSaw()
    this.filter = new ZDFSVF()
    this.env = new DecayEnv()
    this.freq = 220
    this.cutoff = 600
    this.res = 0.2
    this.active = false
  }
  noteOn(midi, velocity) {
    this.freq = 440 * Math.pow(2, (midi - 69) / 12)
    this.saw1.reset()
    this.saw2.reset()
    this.filter.reset()
    this.env.decay = 0.8  // slow pad decay
    this.env.trigger(velocity * 0.5)
    this.active = true
  }
  noteOff() { this.active = false }
  process() {
    if (!this.active) return 0
    const env = this.env.process()
    if (env < 0.001) { this.active = false; return 0 }
    const s1 = this.saw1.process(this.freq / SR)
    const s2 = this.saw2.process(this.freq * 1.005 / SR)  // detune
    const filtered = this.filter.process((s1 + s2) * 0.5, this.cutoff, this.res, SR, 0)
    return filtered * env
  }
}

// ── Band-Limited Square (PolyBLEP) — Phase 4 Day 2 ──
class BLSquare {
  constructor() { this.phase = 0; this.lastPhase = 0 }
  reset() { this.phase = 0; this.lastPhase = 0 }
  process(inc) {
    this.lastPhase = this.phase
    this.phase += inc
    // Naive square: +1 for first half, -1 for second half
    let square = this.lastPhase < 0.5 ? 1 : -1

    // PolyBLEP at phase=0 wraparound (falling edge: +1 → -1)
    if (this.phase >= 1) {
      this.phase -= 1
      const t = this.phase / inc
      // Correction: the discontinuity is -2 (from +1 to -1)
      // PolyBLEP residual * amplitude
      const blep = -t * t * (1 - t) * 0.5 * inc * 4
      square += blep * (-2) // scale by discontinuity magnitude
    }

    // PolyBLEP at phase=0.5 transition (rising edge: -1 → +1)
    // Check if we crossed 0.5 this sample
    const prevHalf = this.lastPhase < 0.5
    const currHalf = (this.phase < 0.5) && (this.phase < this.lastPhase || this.phase >= 0.5 - inc)
    // Actually: if lastPhase < 0.5 and phase >= 0.5 (didn't wrap), OR
    // if lastPhase >= 0.5 and phase wrapped and phase+1 >= 0.5
    const crossedHalf = (this.lastPhase < 0.5 && this.phase >= 0.5) ||
                        (this.lastPhase >= 0.5 && this.phase < this.lastPhase && this.phase + 1 >= 0.5)
    if (crossedHalf) {
      // Distance from 0.5 in sample units
      const crossPoint = 0.5
      const dist = (this.phase >= this.lastPhase)
        ? (this.phase - crossPoint) / inc  // didn't wrap
        : (this.phase + 1 - crossPoint) / inc  // wrapped
      const t = Math.abs(dist)
      if (t < 1) {
        const blep = -t * t * (1 - t) * 0.5 * inc * 4
        square += blep * 2 // scale by +2 (rising edge)
      }
    }

    return square
  }
}

// ── Acid Voice (TB-303 style: square + resonant filter sweep) — Phase 4 Day 2 ──
class AcidVoice {
  constructor() {
    this.square = new BLSquare()
    this.filter = new ZDFSVF()
    this.env = new DecayEnv()
    this.filterEnv = new DecayEnv()
    this.freq = 220
    this.cutoff = 500
    this.res = 0.8
    this.filterEnvAmount = 2000
    this.active = false
  }
  noteOn(midi, velocity) {
    this.freq = 440 * Math.pow(2, (midi - 69) / 12)
    this.square.reset()
    this.filter.reset()
    this.env.decay = 0.3
    this.filterEnv.decay = 0.2
    this.env.trigger(velocity)
    this.filterEnv.trigger(1.0)
    this.active = true
  }
  noteOff() { this.active = false }
  process() {
    if (!this.active) return 0
    const env = this.env.process()
    if (env < 0.001) { this.active = false; return 0 }
    const filterEnv = this.filterEnv.process()
    const dynamicCutoff = this.cutoff + filterEnv * this.filterEnvAmount
    const sq = this.square.process(this.freq / SR)
    const filtered = this.filter.process(sq, dynamicCutoff, this.res, SR, 0)
    return filtered * env * 0.5
  }
}

// ── Add noteOff to LeadVoice and BassVoice ──
LeadVoice.prototype.noteOff = function() { this.active = false }
BassVoice.prototype.noteOff = function() { this.active = false }

// ── Biquad Section (RBJ LP/HP) — for LR4Crossover ──────────────────────────
// Ported from src/lib/psy4/multiband.ts BiquadSection.
// Direct Form II Transposed: numerically well-conditioned for audio.

const BUTTERWORTH_Q = Math.SQRT1_2 // 1/√2 — maximally flat 2nd-order

class BiquadSection {
  constructor(type, freq, Q, sampleRate) {
    this.b0 = 0; this.b1 = 0; this.b2 = 0
    this.a1 = 0; this.a2 = 0
    this.z1 = 0; this.z2 = 0
    const w0 = (2 * Math.PI * freq) / sampleRate
    const cosw0 = Math.cos(w0)
    const sinw0 = Math.sin(w0)
    const alpha = sinw0 / (2 * Q)
    let b0, b1, b2
    if (type === 'lp') {
      const c = 1 - cosw0
      b0 = c / 2; b1 = c; b2 = c / 2
    } else { // hp
      const c = 1 + cosw0
      b0 = c / 2; b1 = -c; b2 = c / 2
    }
    const a0 = 1 + alpha
    const a1 = -2 * cosw0
    const a2 = 1 - alpha
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0
    this.a1 = a1 / a0; this.a2 = a2 / a0
  }
  process(x) {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
  reset() { this.z1 = 0; this.z2 = 0 }
}

// ── LR4 Crossover (24 dB/oct, phase-matched LP + HP) ─────────────────────
// Ported from src/lib/psy4/multiband.ts LR4Crossover.
// Two cascaded Butterworth sections per path. |LP|+|HP| = 1 (perfect reconstruction).

class LR4Crossover {
  constructor(crossoverFreq, sampleRate) {
    this.lp1 = new BiquadSection('lp', crossoverFreq, BUTTERWORTH_Q, sampleRate)
    this.lp2 = new BiquadSection('lp', crossoverFreq, BUTTERWORTH_Q, sampleRate)
    this.hp1 = new BiquadSection('hp', crossoverFreq, BUTTERWORTH_Q, sampleRate)
    this.hp2 = new BiquadSection('hp', crossoverFreq, BUTTERWORTH_Q, sampleRate)
  }
  process(input) {
    const lp = this.lp2.process(this.lp1.process(input))
    const hp = this.hp2.process(this.hp1.process(input))
    return [lp, hp]
  }
  reset() { this.lp1.reset(); this.lp2.reset(); this.hp1.reset(); this.hp2.reset() }
}

// ── Band Compressor (feed-forward peak detector + smooth envelope) ────────
// Ported from src/lib/psy4/multiband.ts BandCompressor.

class BandCompressor {
  constructor(opts) {
    this.threshold = Math.pow(10, opts.thresholdDb / 20)
    this.ratio = Math.max(1, opts.ratio)
    this.makeupGain = Math.pow(10, opts.makeupDb / 20)
    const attackSamples = Math.max(1e-6, opts.attackMs * 0.001 * opts.sampleRate)
    const releaseSamples = Math.max(1e-6, opts.releaseMs * 0.001 * opts.sampleRate)
    this.attackCoeff = 1 - Math.exp(-1 / attackSamples)
    this.releaseCoeff = 1 - Math.exp(-1 / releaseSamples)
    this.envFollower = 0
  }
  process(input) {
    const rect = Math.abs(input)
    const coeff = rect > this.envFollower ? this.attackCoeff : this.releaseCoeff
    this.envFollower += (rect - this.envFollower) * coeff
    let gr = 1
    const env = this.envFollower
    if (env > this.threshold) {
      const exponent = 1 - 1 / this.ratio
      gr = Math.pow(this.threshold / env, exponent)
    }
    return input * gr * this.makeupGain
  }
  reset() { this.envFollower = 0 }
}

// ── Multiband Compressor (3-band LR4 + per-band compression) ──────────────
// Ported from src/lib/psy4/multiband.ts MultibandCompressor.
// Matches the offline render's master chain step 1.

class MultibandCompressor {
  constructor(opts = {}) {
    const sr = opts.sampleRate || SR
    const lowHz = opts.lowCrossoverHz || 200
    const midHz = opts.midCrossoverHz || 2000
    // Separate crossovers for L and R — each channel needs its own filter
    // state, otherwise processing R through the same crossover as L gives
    // R a different filter response (the state was advanced by L).
    this.lowXoverL = new LR4Crossover(lowHz, sr)
    this.midXoverL = new LR4Crossover(midHz, sr)
    this.lowXoverR = new LR4Crossover(lowHz, sr)
    this.midXoverR = new LR4Crossover(midHz, sr)
    // Defaults match the offline MultibandCompressor (subtle mastering).
    const compOpts = {
      thresholdDb: -18, ratio: 2.5, attackMs: 8, releaseMs: 80, makeupDb: 2,
      sampleRate: sr,
    }
    // Separate compressors per channel too (envelope follower state).
    this.lowCompL = new BandCompressor(compOpts)
    this.midCompL = new BandCompressor({ ...compOpts, makeupDb: 1 })
    this.highCompL = new BandCompressor({ ...compOpts, makeupDb: 1.5 })
    this.lowCompR = new BandCompressor(compOpts)
    this.midCompR = new BandCompressor({ ...compOpts, makeupDb: 1 })
    this.highCompR = new BandCompressor({ ...compOpts, makeupDb: 1.5 })
  }
  // Process a single stereo sample. Returns [L, R].
  processSample(l, r) {
    const [lowL, restL] = this.lowXoverL.process(l)
    const [midL, highL] = this.midXoverL.process(restL)
    const [lowR, restR] = this.lowXoverR.process(r)
    const [midR, highR] = this.midXoverR.process(restR)
    const lowOutL = this.lowCompL.process(lowL)
    const midOutL = this.midCompL.process(midL)
    const highOutL = this.highCompL.process(highL)
    const lowOutR = this.lowCompR.process(lowR)
    const midOutR = this.midCompR.process(midR)
    const highOutR = this.highCompR.process(highR)
    return [lowOutL + midOutL + highOutL, lowOutR + midOutR + highOutR]
  }
  reset() {
    this.lowXoverL.reset(); this.midXoverL.reset()
    this.lowXoverR.reset(); this.midXoverR.reset()
  }
}

// ── Band Expander (upward + downward, for OTT) ────────────────────────────
// Ported from src/lib/psy4/ott.ts BandExpander (with roast-fix gain clamp).

class BandExpander {
  constructor(opts) {
    this.threshold = Math.pow(10, opts.thresholdDb / 20)
    this.upwardGain = Math.pow(10, opts.upwardGainDb / 20)
    this.downwardGain = Math.pow(10, opts.downwardGainDb / 20)
    this.depth = Math.max(0, Math.min(1, opts.depth))
    const attackSec = Math.max(1e-6, opts.attackMs / 1000)
    const releaseSec = Math.max(1e-6, opts.releaseMs / 1000)
    this.attackCoef = 1 - Math.exp(-1 / (attackSec * opts.sampleRate))
    this.releaseCoef = 1 - Math.exp(-1 / (releaseSec * opts.sampleRate))
    this.env = 0
  }
  process(x) {
    const abs = Math.abs(x)
    const coef = abs > this.env ? this.attackCoef : this.releaseCoef
    this.env += (abs - this.env) * coef
    let gain = 1
    if (this.env > this.threshold) {
      const over = this.env / this.threshold
      gain = Math.pow(this.downwardGain, Math.log2(over))
    } else if (this.env > 1e-6) {
      const under = this.threshold / Math.max(this.env, 1e-6)
      gain = Math.pow(this.upwardGain, Math.log2(under))
    }
    // Roast-fix: clamp gain to ±40 dB (0.01..100) — matches offline OTT.
    gain = Math.max(0.01, Math.min(100, gain))
    const wetGain = 1 + (gain - 1) * this.depth
    return x * wetGain
  }
  reset() { this.env = 0 }
}

// ── OTT (3-band upward+downward multiband expander) ───────────────────────
// Ported from src/lib/psy4/ott.ts OTT (with roast-fix param clamps).
// Matches the offline render's master chain step 1b.

class OTT {
  constructor(opts = {}) {
    const sr = opts.sampleRate || SR
    const lowHz = opts.lowCrossoverHz || 200
    const midHz = opts.midCrossoverHz || 2000
    // Roast-fix: clamp params — matches offline OTT.
    const depth = Math.max(0, Math.min(1, opts.depth ?? 0.3))
    const upwardDb = Math.max(0, Math.min(12, opts.upwardGainDb ?? 2))
    const downwardDb = Math.max(-12, Math.min(0, opts.downwardGainDb ?? -2))
    const thresholdDb = opts.thresholdDb ?? -24
    const attackMs = opts.attackMs ?? 2
    const releaseMs = opts.releaseMs ?? 100
    this.depth = depth
    this.enabled = depth > 0.001
    // Separate crossovers for L and R (same fix as MultibandCompressor).
    this.lowXoverL = new LR4Crossover(lowHz, sr)
    this.midXoverL = new LR4Crossover(midHz, sr)
    this.lowXoverR = new LR4Crossover(lowHz, sr)
    this.midXoverR = new LR4Crossover(midHz, sr)
    const expOpts = {
      thresholdDb, upwardGainDb: upwardDb, downwardGainDb: downwardDb,
      depth, attackMs, releaseMs, sampleRate: sr,
    }
    // Separate expanders per channel too (envelope follower state).
    this.lowExpL = new BandExpander(expOpts)
    this.midExpL = new BandExpander({ ...expOpts, upwardGainDb: upwardDb * 0.8 })
    this.highExpL = new BandExpander({ ...expOpts, upwardGainDb: upwardDb * 1.2 })
    this.lowExpR = new BandExpander(expOpts)
    this.midExpR = new BandExpander({ ...expOpts, upwardGainDb: upwardDb * 0.8 })
    this.highExpR = new BandExpander({ ...expOpts, upwardGainDb: upwardDb * 1.2 })
  }
  processSample(l, r) {
    if (!this.enabled) return [l, r]
    const [lowL, restL] = this.lowXoverL.process(l)
    const [midL, highL] = this.midXoverL.process(restL)
    const [lowR, restR] = this.lowXoverR.process(r)
    const [midR, highR] = this.midXoverR.process(restR)
    const outL = this.lowExpL.process(lowL) + this.midExpL.process(midL) + this.highExpL.process(highL)
    const outR = this.lowExpR.process(lowR) + this.midExpR.process(midR) + this.highExpR.process(highR)
    return [outL, outR]
  }
  reset() {
    this.lowXoverL.reset(); this.midXoverL.reset()
    this.lowXoverR.reset(); this.midXoverR.reset()
  }
}

// ── AudioWorklet Processor (13 voices + per-voice pan + master chain) ──
// Phase B: replaced Haas fake stereo with per-voice pan + added master chain

class PSY4Processor extends AudioWorkletProcessor {
  constructor() {
    super()
    // 13 voices: 8 lead + 2 bass + 2 pad + 1 acid
    this.leadVoices = []
    for (let i = 0; i < 8; i++) this.leadVoices.push(new LeadVoice())
    this.bassVoices = [new BassVoice(), new BassVoice()]
    this.padVoices = [new PadVoice(), new PadVoice()]
    this.acidVoice = new AcidVoice()
    this.voiceIdx = 0
    this.bassIdx = 0
    this.padIdx = 0
    this.masterGain = 0.3

    // Phase B: per-voice pan (equal-power, -1=left, 0=center, 1=right)
    // Lead voices spread across stereo field
    this.leadPans = [-0.6, -0.3, -0.1, 0.1, 0.3, 0.5, -0.4, 0.6]
    this.bassPans = [-0.2, 0.2] // bass slightly off-center
    this.padPans = [-0.5, 0.5] // pad wide
    this.acidPan = 0.0 // acid center

    // Phase B: master chain state
    this.ceiling = 0.89 // -1 dBTP
    this.limiterEnv = 0
    this.limiterAttack = 1 - Math.exp(-1 / (0.001 * SR)) // 1ms attack
    this.limiterRelease = 1 - Math.exp(-1 / (0.1 * SR)) // 100ms release

    // Phase B: sidechain state
    this.duckEnv = 1.0
    this.duckAmount = 0.6
    this.duckRecovery = 1 - Math.exp(-1 / (0.15 * SR)) // 150ms recovery

    // Phase B: M/S stereo widener state
    this.msWidth = 1.3 // stereo width factor

    // Roast-fix-10: multiband compressor + OTT — ported from offline render.
    // These match the offline forensic-bridge master chain steps 1 + 1b,
    // so the real-time path now has the same mastering quality as the
    // offline render. Previously the worklet only had saturation + M/S +
    // simple limiter, missing the multiband + OTT that give psytrance its
    // "glued" sound.
    this.multiband = new MultibandCompressor({ sampleRate: SR })
    this.ott = new OTT({
      sampleRate: SR,
      depth: 0.3,         // 30% — gentle, not full OTT (matches offline)
      upwardGainDb: 2,
      downwardGainDb: -2,
      thresholdDb: -24,
      attackMs: 2,
      releaseMs: 100,
    })

    this.allVoices = [...this.leadVoices, ...this.bassVoices, ...this.padVoices, this.acidVoice]

    this.port.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'noteOn') {
        if (msg.voiceType === 'acid') {
          this.acidVoice.noteOn(msg.midi, msg.velocity)
        } else if (msg.midi < 48) {
          const voice = this.bassVoices[this.bassIdx % this.bassVoices.length]
          voice.noteOn(msg.midi, msg.velocity)
          this.bassIdx++
        } else if (msg.midi >= 72) {
          const voice = this.padVoices[this.padIdx % this.padVoices.length]
          voice.noteOn(msg.midi, msg.velocity)
          this.padIdx++
        } else {
          const voice = this.leadVoices[this.voiceIdx % this.leadVoices.length]
          voice.noteOn(msg.midi, msg.velocity)
          this.voiceIdx++
        }
        // Phase B: trigger sidechain on any note (simulates kick duck)
        this.duckEnv = Math.max(1.0 - this.duckAmount, this.duckEnv * 0.85)
      } else if (msg.type === 'noteOff') {
        for (const v of this.allVoices) {
          if (v.active) v.noteOff()
        }
      } else if (msg.type === 'setCutoff') {
        for (const v of this.allVoices) v.cutoff = msg.value
      } else if (msg.type === 'setResonance') {
        for (const v of this.allVoices) v.res = msg.value
      } else if (msg.type === 'setMasterGain') {
        this.masterGain = msg.value
      } else if (msg.type === 'setStereoWidth') {
        this.msWidth = msg.value
      } else if (msg.type === 'setSidechain') {
        this.duckAmount = msg.value
      }
    }
  }

  // Equal-power pan: pan -1..1 → [gainL, gainR]
  panToGain(pan) {
    const angle = (pan + 1) * 0.25 * Math.PI // 0..π/2
    return [Math.cos(angle), Math.sin(angle)]
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const channelL = output[0]
    const channelR = output[1] || output[0]

    // Phase B: process with per-voice pan + master chain
    for (let i = 0; i < channelL.length; i++) {
      // ── 1. Render voices with per-voice pan ──
      let mixL = 0
      let mixR = 0

      // Lead voices (8) with spread pan
      for (let v = 0; v < this.leadVoices.length; v++) {
        const voice = this.leadVoices[v]
        if (voice.active) {
          const sample = voice.process()
          const [gL, gR] = this.panToGain(this.leadPans[v])
          mixL += sample * gL
          mixR += sample * gR
        }
      }

      // Bass voices (2) with slight pan
      for (let v = 0; v < this.bassVoices.length; v++) {
        const voice = this.bassVoices[v]
        if (voice.active) {
          const sample = voice.process()
          const [gL, gR] = this.panToGain(this.bassPans[v])
          mixL += sample * gL
          mixR += sample * gR
        }
      }

      // Pad voices (2) with wide pan
      for (let v = 0; v < this.padVoices.length; v++) {
        const voice = this.padVoices[v]
        if (voice.active) {
          const sample = voice.process()
          const [gL, gR] = this.panToGain(this.padPans[v])
          mixL += sample * gL
          mixR += sample * gR
        }
      }

      // Acid voice (1) center
      if (this.acidVoice.active) {
        const sample = this.acidVoice.process()
        mixL += sample * 0.707 // center = equal power
        mixR += sample * 0.707
      }

      // ── 2. Apply sidechain (duck bass+music on note trigger) ──
      // Phase B: full-mix sidechain — duck everything except... well, there's no
      // separate drum bus in the worklet, so we duck the whole mix slightly.
      // This simulates the "pumping" effect.
      const duckedL = mixL * this.duckEnv
      const duckedR = mixR * this.duckEnv

      // ── 3. Master gain ──
      let outL = duckedL * this.masterGain
      let outR = duckedR * this.masterGain

      // ── 3b. Multiband compressor + OTT (Roast-fix-10) ──
      // Ported from the offline render. These add the "glued" mastering
      // sound that was missing from the real-time path.
      const mbOut = this.multiband.processSample(outL, outR)
      outL = mbOut[0]
      outR = mbOut[1]
      const ottOut = this.ott.processSample(outL, outR)
      outL = ottOut[0]
      outR = ottOut[1]

      // ── 4. Soft saturation (tanh) ──
      outL = Math.tanh(outL * 1.2) * 0.7 + outL * 0.3
      outR = Math.tanh(outR * 1.2) * 0.7 + outR * 0.3

      // ── 5. M/S stereo widener ──
      const mid = (outL + outR) * 0.5
      const side = (outL - outR) * 0.5 * this.msWidth
      outL = mid + side
      outR = mid - side

      // ── 6. Lookahead limiter (simplified) ──
      const absMax = Math.max(Math.abs(outL), Math.abs(outR))
      if (absMax > this.limiterEnv) {
        this.limiterEnv += (absMax - this.limiterEnv) * this.limiterAttack
      } else {
        this.limiterEnv += (absMax - this.limiterEnv) * this.limiterRelease
      }
      let limGain = 1
      if (this.limiterEnv > this.ceiling) {
        limGain = this.ceiling / this.limiterEnv
      }
      outL *= limGain
      outR *= limGain

      // Brickwall safety
      if (outL > this.ceiling) outL = this.ceiling
      else if (outL < -this.ceiling) outL = -this.ceiling
      if (outR > this.ceiling) outR = this.ceiling
      else if (outR < -this.ceiling) outR = -this.ceiling

      channelL[i] = outL
      channelR[i] = outR

      // Sidechain recovery
      this.duckEnv += (1.0 - this.duckEnv) * this.duckRecovery
    }
    return true
  }
}

registerProcessor('psy4-processor', PSY4Processor)
