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

const SR = 44100  // Will be overridden by actual sampleRate

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

// ── AudioWorklet Processor (13 voices + stereo) ──
class PSY4Processor extends AudioWorkletProcessor {
  constructor() {
    super()
    // 13 voices: 8 lead + 2 bass + 2 pad + 1 acid
    this.leadVoices = []
    for (let i = 0; i < 8; i++) this.leadVoices.push(new LeadVoice())
    this.bassVoices = [new BassVoice(), new BassVoice()]
    this.padVoices = [new PadVoice(), new PadVoice()]
    this.acidVoice = new AcidVoice() // 13th voice — Phase 4 Day 2
    this.voiceIdx = 0
    this.bassIdx = 0
    this.padIdx = 0
    this.masterGain = 0.3

    // Stereo Haas delay buffer (15ms = ~662 samples at 44.1kHz)
    this.haasDelay = Math.floor(0.015 * SR)
    this.haasBuffer = new Float32Array(this.haasDelay)
    this.haasIdx = 0

    this.port.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'noteOn') {
        if (msg.voiceType === 'acid') {
          // Explicit acid voice trigger
          this.acidVoice.noteOn(msg.midi, msg.velocity)
        } else if (msg.midi < 48) {
          // Route by MIDI range: < 48 = bass, < 72 = lead, >= 72 = pad
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
      } else if (msg.type === 'noteOff') {
        // Phase 4 Day 2: noteOff support
        for (const v of [...this.leadVoices, ...this.bassVoices, ...this.padVoices, this.acidVoice]) {
          if (v.active) v.noteOff()
        }
      } else if (msg.type === 'setCutoff') {
        for (const v of [...this.leadVoices, ...this.bassVoices, ...this.padVoices, this.acidVoice]) v.cutoff = msg.value
      } else if (msg.type === 'setResonance') {
        for (const v of [...this.leadVoices, ...this.bassVoices, ...this.padVoices, this.acidVoice]) v.res = msg.value
      } else if (msg.type === 'setMasterGain') {
        this.masterGain = msg.value
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const channelL = output[0]
    const channelR = output[1] || output[0]
    const allVoices = [...this.leadVoices, ...this.bassVoices, ...this.padVoices, this.acidVoice]

    for (let i = 0; i < channelL.length; i++) {
      let sample = 0
      for (const voice of allVoices) {
        if (voice.active) sample += voice.process()
      }
      sample *= this.masterGain

      // Phase 4 Day 2: Stereo via Haas delay
      // L = direct, R = delayed by 15ms
      channelL[i] = sample
      const delayed = this.haasBuffer[this.haasIdx]
      this.haasBuffer[this.haasIdx] = sample
      this.haasIdx = (this.haasIdx + 1) % this.haasDelay
      channelR[i] = delayed
    }
    return true
  }
}

registerProcessor('psy4-processor', PSY4Processor)
