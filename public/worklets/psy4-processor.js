/**
 * PSY4 Real-Time AudioWorklet Processor
 *
 * This file runs in the AudioWorklet thread (separate from main thread).
 * It receives MIDI notes and renders audio in real-time at the audio rate.
 *
 * To use:
 *   await audioContext.audioWorklet.addModule('/worklets/psy4-processor.js')
 *   const node = new AudioWorkletNode(audioContext, 'psy4-processor')
 *   node.port.postMessage({ type: 'noteOn', midi: 64, velocity: 0.8 })
 *
 * Architecture:
 * - ZDF SVF filter (from PsySynthPro)
 * - BLSaw oscillator (band-limited)
 * - DecayEnv for amplitude
 * - Receives MIDI via MessagePort
 * - Outputs stereo audio to connected nodes
 *
 * This is a MINIMAL viable processor — implements a single voice (lead).
 * Future versions will add the full 13-voice engine.
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

// ── AudioWorklet Processor ──
class PSY4Processor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.voices = []
    for (let i = 0; i < 8; i++) this.voices.push(new LeadVoice())
    this.voiceIdx = 0
    this.masterGain = 0.3

    this.port.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'noteOn') {
        const voice = this.voices[this.voiceIdx % this.voices.length]
        voice.noteOn(msg.midi, msg.velocity)
        this.voiceIdx++
      } else if (msg.type === 'setCutoff') {
        for (const v of this.voices) v.cutoff = msg.value
      } else if (msg.type === 'setResonance') {
        for (const v of this.voices) v.res = msg.value
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

    for (let i = 0; i < channelL.length; i++) {
      let sample = 0
      for (const voice of this.voices) {
        if (voice.active) sample += voice.process()
      }
      sample *= this.masterGain
      channelL[i] = sample
      channelR[i] = sample
    }
    return true
  }
}

registerProcessor('psy4-processor', PSY4Processor)
