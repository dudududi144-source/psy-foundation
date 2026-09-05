/**
 * PSY4 Real-Time AudioWorklet Processor — TypeScript SOURCE (DECISIONS_V3 D6).
 *
 * THIS FILE IS THE SOURCE. The file that actually ships to the browser is the
 * GENERATED build artifact `apps/web/public/worklets/psy4-processor.js`
 * (built by `scripts/build-worklet.mjs`, root script `build:worklet`).
 * DO NOT EDIT the generated file — edit this source and rebuild.
 *
 * The previous artifact was a hand-maintained 4th DSP copy (720 LOC) with its
 * own near-zero-residual BLEP saw/square, its own ZDF SVF variant and its own
 * master-chain port. Per One-DSP (D6), the DSP primitives now come from
 * `@psy-foundation/dsp` — the same classes the offline render uses:
 *   - PolyBlepOsc ('saw'/'square') replaces the hand-rolled BLSaw/BLSquare
 *   - ZDFSVF is THE Zavalishin/Simper filter from packages/dsp (D4)
 *   - MultibandCompressor + OTT are the dsp master-chain classes (D1/D3)
 * Everything else is a faithful port: same 13-voice architecture (8 Lead /
 * 2 Bass / 2 Pad / 1 Acid), same MessagePort protocol, same per-voice equal-
 * power pan (the "Haas 15 ms" in the old header comment was already replaced
 * by per-voice pan in Phase B — the port keeps the actual Phase-B behavior),
 * same saturation / M/S width / simplified limiter / sidechain duck.
 *
 * This file runs in the AudioWorklet thread (separate from the main thread).
 * It receives MIDI notes and renders audio in real time at the audio rate.
 *
 * Usage:
 *   await audioContext.audioWorklet.addModule('/worklets/psy4-processor.js')
 *   const node = new AudioWorkletNode(audioContext, 'psy4-processor')
 *   node.port.postMessage({ type: 'noteOn', midi: 64, velocity: 0.8 })
 *
 * Architecture (13 voices):
 *   - 8 LeadVoice (polyphonic, ZDF SVF + PolyBLEP saw + DecayEnv)
 *   - 2 BassVoice (sub sine + saw through filter)
 *   - 2 PadVoice (detuned saws through filter, slow env)
 *   - 1 AcidVoice (PolyBLEP square through resonant filter with sweep)
 *
 * MIDI routing by pitch range:
 *   midi < 48  → BassVoice
 *   midi >= 72 → PadVoice
 *   midi 48-71 → LeadVoice
 *   (AcidVoice triggered by noteOn with voiceType='acid')
 *
 * DETERMINISM: no Math.random — the worklet is driven entirely by messages.
 */

import { MultibandCompressor, OTT, PolyBlepOsc, ZDFSVF } from '@psy-foundation/dsp'

// The AudioWorkletGlobalScope provides `sampleRate` (always equals the
// AudioContext's rate — the Phase 1.5 fix for the old `const SR = 44100` lie).
// lib.dom has no AudioWorkletGlobalScope, so declare it here; the runtime
// guard keeps the offline-render fallback the old JS had.
declare const sampleRate: number

// AudioWorkletProcessor / registerProcessor live in the AudioWorkletGlobalScope
// and are not in lib.dom either. Declared here so the processor class type-
// checks; at runtime the real globals are used (this module is loaded ONLY via
// audioWorklet.addModule).
interface AudioWorkletProcessorOptions {
  numberOfInputs?: number
  numberOfOutputs?: number
  outputChannelCount?: number[]
}
declare abstract class AudioWorkletProcessor {
  constructor(options?: AudioWorkletProcessorOptions)
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletProcessorOptions) => AudioWorkletProcessor
): void

const SR = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 44100

// ─── Decay envelope (exponential) ──────────────────────────────────────────
// TODO(one-dsp): no exponential one-shot decay exists in @psy-foundation/dsp
// yet (envelopes.ts has Adsr + PitchEnvelope only). Small local port of the
// worklet's DecayEnv until a dsp equivalent lands.

class DecayEnv {
  t = 0
  decay = 0.3
  amp = 0

  reset(): void {
    this.t = 0
  }

  trigger(amp: number): void {
    this.t = 0
    this.amp = amp
  }

  process(): number {
    this.t += 1 / SR
    return Math.exp(-this.t / this.decay) * this.amp
  }
}

// ─── Lead Voice (ZDF SVF + PolyBLEP saw + decay env) ───────────────────────

class LeadVoice {
  saw = new PolyBlepOsc({ waveform: 'saw', sampleRate: SR, frequency: 440 })
  filter = new ZDFSVF()
  env = new DecayEnv()
  freq = 440
  cutoff = 3000
  res = 0.3
  active = false
  /** MIDI note this voice is currently playing (per-note noteOff). */
  currentMidi: number | null = null

  noteOn(midi: number, velocity: number): void {
    this.freq = 440 * 2 ** ((midi - 69) / 12)
    this.saw.setFrequency(this.freq)
    this.saw.reset()
    this.filter.reset()
    this.env.trigger(velocity)
    this.currentMidi = midi
    this.active = true
  }

  noteOff(): void {
    this.active = false
    this.currentMidi = null
  }

  process(): number {
    if (!this.active) return 0
    const env = this.env.process()
    if (env < 0.001) {
      this.active = false
      return 0
    }
    const saw = this.saw.process()
    const filtered = this.filter.process(saw, this.cutoff, this.res, SR, 0)
    return filtered * env
  }
}

// ─── Bass Voice (sub sine + saw) ───────────────────────────────────────────

class BassVoice {
  subPhase = 0
  saw = new PolyBlepOsc({ waveform: 'saw', sampleRate: SR, frequency: 82 })
  filter = new ZDFSVF()
  env = new DecayEnv()
  freq = 82
  cutoff = 800
  res = 0.3
  active = false
  currentMidi: number | null = null

  noteOn(midi: number, velocity: number): void {
    this.freq = 440 * 2 ** ((midi - 69) / 12)
    this.saw.setFrequency(this.freq)
    this.subPhase = 0
    this.saw.reset()
    this.filter.reset()
    this.env.decay = 0.15
    this.env.trigger(velocity)
    this.currentMidi = midi
    this.active = true
  }

  noteOff(): void {
    this.active = false
    this.currentMidi = null
  }

  process(): number {
    if (!this.active) return 0
    const env = this.env.process()
    if (env < 0.001) {
      this.active = false
      return 0
    }
    this.subPhase += (2 * Math.PI * this.freq) / SR
    if (this.subPhase > 2 * Math.PI) this.subPhase -= 2 * Math.PI
    const sub = Math.sin(this.subPhase) * 0.5
    const saw = this.saw.process() * 0.5
    const filtered = this.filter.process(sub + saw, this.cutoff, this.res, SR, 0)
    return filtered * env
  }
}

// ─── Pad Voice (detuned saws + slow env) ───────────────────────────────────

class PadVoice {
  saw1 = new PolyBlepOsc({ waveform: 'saw', sampleRate: SR, frequency: 220 })
  saw2 = new PolyBlepOsc({ waveform: 'saw', sampleRate: SR, frequency: 221 })
  filter = new ZDFSVF()
  env = new DecayEnv()
  freq = 220
  cutoff = 600
  res = 0.2
  active = false
  currentMidi: number | null = null

  noteOn(midi: number, velocity: number): void {
    this.freq = 440 * 2 ** ((midi - 69) / 12)
    this.saw1.setFrequency(this.freq)
    this.saw2.setFrequency(this.freq * 1.005) // detune
    this.saw1.reset()
    this.saw2.reset()
    this.filter.reset()
    this.env.decay = 0.8 // slow pad decay
    this.env.trigger(velocity * 0.5)
    this.currentMidi = midi
    this.active = true
  }

  noteOff(): void {
    this.active = false
    this.currentMidi = null
  }

  process(): number {
    if (!this.active) return 0
    const env = this.env.process()
    if (env < 0.001) {
      this.active = false
      return 0
    }
    const s1 = this.saw1.process()
    const s2 = this.saw2.process()
    const filtered = this.filter.process((s1 + s2) * 0.5, this.cutoff, this.res, SR, 0)
    return filtered * env
  }
}

// ─── Acid Voice (TB-303 style: square + resonant filter sweep) ─────────────

class AcidVoice {
  square = new PolyBlepOsc({ waveform: 'square', sampleRate: SR, frequency: 220 })
  filter = new ZDFSVF()
  env = new DecayEnv()
  filterEnv = new DecayEnv()
  freq = 220
  cutoff = 500
  res = 0.8
  filterEnvAmount = 2000
  active = false
  currentMidi: number | null = null

  noteOn(midi: number, velocity: number): void {
    this.freq = 440 * 2 ** ((midi - 69) / 12)
    this.square.setFrequency(this.freq)
    this.square.reset()
    this.filter.reset()
    this.env.decay = 0.3
    this.filterEnv.decay = 0.2
    this.env.trigger(velocity)
    this.filterEnv.trigger(1.0)
    this.currentMidi = midi
    this.active = true
  }

  noteOff(): void {
    this.active = false
    this.currentMidi = null
  }

  process(): number {
    if (!this.active) return 0
    const env = this.env.process()
    if (env < 0.001) {
      this.active = false
      return 0
    }
    const filterEnv = this.filterEnv.process()
    const dynamicCutoff = this.cutoff + filterEnv * this.filterEnvAmount
    const sq = this.square.process()
    const filtered = this.filter.process(sq, dynamicCutoff, this.res, SR, 0)
    return filtered * env * 0.5
  }
}

// ─── MessagePort protocol (Phase 4.5: per-note noteOff + mixer gains) ──────

type VoiceSection = 'lead' | 'bass' | 'pad' | 'acid'

type WorkletMessage =
  | { type: 'noteOn'; midi: number; velocity: number; voiceType?: string }
  /** Release the voice playing `midi` (per-note), or ALL active voices when
   *  midi is omitted (back-compat with the original release-all semantics). */
  | { type: 'noteOff'; midi?: number }
  | { type: 'setCutoff'; value: number }
  | { type: 'setResonance'; value: number }
  | { type: 'setMasterGain'; value: number }
  | { type: 'setStereoWidth'; value: number }
  | { type: 'setSidechain'; value: number }
  /** Mixer strip (PLAN_V3 4.5): per-section gain, 0..~2. Mute = gain 0. */
  | { type: 'setVoiceGain'; section: VoiceSection; value: number }

// ─── Processor (13 voices + per-voice pan + master chain) ──────────────────

class PSY4Processor extends AudioWorkletProcessor {
  // 13 voices: 8 lead + 2 bass + 2 pad + 1 acid
  leadVoices: LeadVoice[] = []
  bassVoices: BassVoice[] = []
  padVoices: PadVoice[] = []
  acidVoice = new AcidVoice()
  voiceIdx = 0
  bassIdx = 0
  padIdx = 0
  masterGain = 0.3

  // Mixer strip (PLAN_V3 4.5): per-section gains, applied at the voice mix
  // stage (before the master chain — same point the offline mixer sits at).
  voiceGains: Record<VoiceSection, number> = { lead: 1, bass: 1, pad: 1, acid: 1 }

  // Per-voice pan (equal-power, -1=left, 0=center, 1=right).
  // Phase B: replaced Haas fake stereo with per-voice pan.
  leadPans = [-0.6, -0.3, -0.1, 0.1, 0.3, 0.5, -0.4, 0.6]
  bassPans = [-0.2, 0.2] // bass slightly off-center
  padPans = [-0.5, 0.5] // pad wide
  acidPan = 0.0 // acid center

  // Master chain state
  ceiling = 0.89 // -1 dBTP
  limiterEnv = 0
  limiterAttack = 1 - Math.exp(-1 / (0.001 * SR)) // 1ms attack
  limiterRelease = 1 - Math.exp(-1 / (0.1 * SR)) // 100ms release

  // Sidechain state
  duckEnv = 1.0
  duckAmount = 0.6
  duckRecovery = 1 - Math.exp(-1 / (0.15 * SR)) // 150ms recovery

  // M/S stereo widener state
  msWidth = 1.3 // stereo width factor

  // Master chain (Roast-fix-10): the @psy-foundation/dsp classes the offline
  // render uses — the real-time path now shares ONE implementation with the
  // offline master chain (DECISIONS_V3 D1/D6). Band settings match the ones
  // this worklet always used (threshold -18 dB, ratio 2.5, 8/80 ms, makeups
  // 2/1/1.5 dB), expressed through the dsp per-band settings.
  multiband = new MultibandCompressor({
    sampleRate: SR,
    lowSettings: { thresholdDb: -18, ratio: 2.5, attackMs: 8, releaseMs: 80, makeupDb: 2 },
    midSettings: { thresholdDb: -18, ratio: 2.5, attackMs: 8, releaseMs: 80, makeupDb: 1 },
    highSettings: { thresholdDb: -18, ratio: 2.5, attackMs: 8, releaseMs: 80, makeupDb: 1.5 },
  })
  ott = new OTT({
    sampleRate: SR,
    depth: 0.3, // 30% — gentle, not full OTT (matches offline)
    upwardGainDb: 2,
    downwardGainDb: -2,
    thresholdDb: -24,
    attackMs: 2,
    releaseMs: 100,
  })

  allVoices: Array<LeadVoice | BassVoice | PadVoice | AcidVoice>

  constructor() {
    super()
    for (let i = 0; i < 8; i++) this.leadVoices.push(new LeadVoice())
    this.bassVoices = [new BassVoice(), new BassVoice()]
    this.padVoices = [new PadVoice(), new PadVoice()]
    this.acidVoice = new AcidVoice()

    this.allVoices = [...this.leadVoices, ...this.bassVoices, ...this.padVoices, this.acidVoice]

    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data as WorkletMessage
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
        // Trigger sidechain on any note (simulates kick duck).
        this.duckEnv = Math.max(1.0 - this.duckAmount, this.duckEnv * 0.85)
      } else if (msg.type === 'noteOff') {
        if (msg.midi !== undefined) {
          // Per-note release (PLAN_V3 4.5): only voices currently playing
          // that note stop; held notes on other keys keep sounding.
          for (const v of this.allVoices) {
            if (v.active && v.currentMidi === msg.midi) v.noteOff()
          }
        } else {
          for (const v of this.allVoices) {
            if (v.active) v.noteOff()
          }
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
      } else if (msg.type === 'setVoiceGain') {
        // Clamp to a sane mixer range (allow slight boost, forbid NaN/negatives).
        const g = Number.isFinite(msg.value) ? Math.max(0, Math.min(2, msg.value)) : 1
        this.voiceGains[msg.section] = g
      }
    }
  }

  /** Equal-power pan: pan -1..1 → [gainL, gainR]. */
  panToGain(pan: number): [number, number] {
    const angle = (pan + 1) * 0.25 * Math.PI // 0..π/2
    return [Math.cos(angle), Math.sin(angle)]
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const channelL = output[0]
    const channelR = output[1] || output[0]
    const frames = channelL.length

    // ── 1. Render voices with per-voice pan, sidechain duck, master gain ──
    for (let i = 0; i < frames; i++) {
      let mixL = 0
      let mixR = 0

      // Lead voices (8) with spread pan
      for (let v = 0; v < this.leadVoices.length; v++) {
        const voice = this.leadVoices[v]
        if (voice.active) {
          const s = voice.process() * this.voiceGains.lead
          const [gL, gR] = this.panToGain(this.leadPans[v])
          mixL += s * gL
          mixR += s * gR
        }
      }

      // Bass voices (2) with slight pan
      for (let v = 0; v < this.bassVoices.length; v++) {
        const voice = this.bassVoices[v]
        if (voice.active) {
          const s = voice.process() * this.voiceGains.bass
          const [gL, gR] = this.panToGain(this.bassPans[v])
          mixL += s * gL
          mixR += s * gR
        }
      }

      // Pad voices (2) with wide pan
      for (let v = 0; v < this.padVoices.length; v++) {
        const voice = this.padVoices[v]
        if (voice.active) {
          const s = voice.process() * this.voiceGains.pad
          const [gL, gR] = this.panToGain(this.padPans[v])
          mixL += s * gL
          mixR += s * gR
        }
      }

      // Acid voice (1) center
      if (this.acidVoice.active) {
        const s = this.acidVoice.process() * this.voiceGains.acid
        const center = Math.SQRT1_2 // center = equal power
        mixL += s * center
        mixR += s * center
      }

      // ── 2. Sidechain duck (full mix) → 3. master gain ──
      channelL[i] = mixL * this.duckEnv * this.masterGain
      channelR[i] = mixR * this.duckEnv * this.masterGain
    }

    // ── 3b. Multiband compressor + OTT (the dsp master chain, in-place) ──
    // Filter/compressor state persists across quanta, so processing the
    // 128-frame block with processBuffer is mathematically identical to the
    // old per-sample processSample calls.
    this.multiband.processBuffer(channelL, channelR)
    this.ott.processBuffer(channelL, channelR)

    // ── 4-6. Saturation, M/S width, simplified limiter, brickwall ──
    for (let i = 0; i < frames; i++) {
      let outL = channelL[i]
      let outR = channelR[i]

      // 4. Soft saturation (tanh)
      outL = Math.tanh(outL * 1.2) * 0.7 + outL * 0.3
      outR = Math.tanh(outR * 1.2) * 0.7 + outR * 0.3

      // 5. M/S stereo widener
      const mid = (outL + outR) * 0.5
      const side = (outL - outR) * 0.5 * this.msWidth
      outL = mid + side
      outR = mid - side

      // 6. Lookahead limiter (simplified)
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
