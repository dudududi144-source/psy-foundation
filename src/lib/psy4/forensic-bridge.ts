/**
 * Forensic Bridge — Foundation RawScore → Forensic Engine → Stereo PCM
 *
 * This is the integration layer that connects Foundation's WHAT (ComposedSection)
 * to PSY4's HOW (forensic DSP voices + bus/master chain).
 *
 * Pipeline:
 *   Foundation CompositionEngine → ComposedSection
 *   → RawScore (musical events: notes, timing, harmony)
 *   → Forensic voice triggers (KickVoice, BassVoice, LeadVoice, HatVoice)
 *   → 5-bus mix (drum/bass/music/atmos/fx) with sidechain
 *   → Master chain (glue comp + saturation + limiter)
 *   → Stereo PCM (Float32Array L/R)
 *   → WAV encode
 *
 * Key fixes vs the forensic engine's default:
 *   1. Bass envelope: added sustain for rolling bass (the original dies at 120ms)
 *   2. Sidechain: kick triggers bass duck (the defining psytrance mix technique)
 *   3. Stereo: lead gets Haas widening, pad gets auto-pan
 */

import { CompositionEngine } from '../../foundation/music'
import { createIdentityA } from '../../foundation/music'
import { serializeRawScore, type RawScore } from '../../foundation/music'
import type { ComposedSection } from '../../foundation/music'

// Forensic DSP + voices + mixing
import { Rng } from './forensic/prng'
import { fastTanh, MoogLadder, BLSaw, BLSquare, PinkNoise } from './forensic/dsp'
import { KickVoice, LeadVoice, HatVoice, type BassParams, type LeadParams } from './forensic/voices'
import { BusProcessor, MasterChain, SchroederReverb, StereoDelay, type BusConfig } from './forensic/mixing'

const SR = 44100

// ── Rolling Bass Voice (fixed: sustain instead of one-shot decay) ──

export class RollingBassVoice {
  active = false
  t = 0
  freq = 80
  amp = 0.5
  dur = 0.2
  acid = false
  square = new BLSquare()
  saw = new BLSaw()
  filter = new MoogLadder()
  phase = 0
  cutoffStart = 800
  cutoffEnd = 200
  res = 0.1
  hpState = 0
  noteOffTime = 0
  releasing = false
  releaseT = 0

  trigger(freq: number, dur: number, amp: number, acid: boolean, params?: BassParams): void {
    this.active = true
    this.t = 0
    this.freq = freq
    this.dur = dur
    this.amp = amp
    this.acid = acid
    this.phase = 0
    this.hpState = 0
    this.releasing = false
    this.releaseT = 0
    this.noteOffTime = dur
    this.square.reset()
    this.square.setFreq(freq)
    this.saw.reset()
    this.saw.setFreq(freq)
    this.filter.reset()
    if (acid) {
      this.cutoffStart = Math.min(4000, (params?.cutoffStart ?? 2500) * 1.5)
      this.cutoffEnd = Math.max(50, (params?.cutoffEnd ?? 100) * 0.5)
      this.res = 0.85
    } else {
      this.cutoffStart = params?.cutoffStart ?? 800
      this.cutoffEnd = params?.cutoffEnd ?? 200
      this.res = Math.min(0.3, (params?.resonance ?? 3) / 20)
    }
  }

  noteOff(): void {
    this.releasing = true
    this.releaseT = 0
  }

  render(): [number, boolean] {
    if (!this.active) return [0, true]
    const sr = SR
    this.t += 1 / sr

    // Sustain phase: hold at full level until noteOff
    // Release phase: quick exponential decay after noteOff
    if (this.releasing) {
      this.releaseT += 1 / sr
      if (this.releaseT > 0.03) { // 30ms release
        this.active = false
        return [0, true]
      }
    }

    const inc = this.freq / sr
    const osc = this.acid ? this.saw.process(inc) : this.square.process(inc)

    // Filter envelope: fast attack then settle to cutoffEnd
    const cutoffEnv = (this.cutoffStart - this.cutoffEnd) * Math.exp(-this.t / 0.04) + this.cutoffEnd
    const drive = this.acid ? 2.5 : 1.3
    const filtered = this.filter.process(osc, cutoffEnv, this.res, drive, sr)

    // Sub sine layer
    this.phase += (2 * Math.PI * this.freq) / sr
    const sub = Math.sin(this.phase) * 0.45

    let mixed = filtered * 0.55 + sub * 0.45
    mixed = fastTanh(mixed * 1.8)

    // 30Hz HP to clean sub
    const hpCutoff = 30
    const hpA = (1 / sr) * 2 * Math.PI * hpCutoff
    this.hpState += (hpA * (mixed - this.hpState)) / (1 + hpA)
    mixed = mixed - this.hpState * 0.7

    // Envelope: 1ms attack → sustain at 1.0 → 30ms release
    const attackEnv = Math.min(1, this.t / 0.001)
    let ampEnv = attackEnv
    if (this.releasing) {
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.01)
    }

    return [mixed * ampEnv * this.amp, false]
  }
}

// ── Sample Voice (for 909 kicks / MD hats) ──

export class SampleVoice {
  active = false
  t = 0
  data: Float32Array | null = null
  sampleRate = 44100
  amp = 1
  playbackRate = 1
  env = 0

  setData(data: Float32Array, sampleRate: number): void {
    this.data = data
    this.sampleRate = sampleRate
  }

  trigger(amp: number, pitch = 1): void {
    this.active = true
    this.t = 0
    this.amp = amp
    this.playbackRate = pitch * (this.sampleRate / SR)
    this.env = 1
  }

  render(): [number, boolean] {
    if (!this.active || !this.data) return [0, true]
    const pos = Math.floor(this.t * this.playbackRate)
    if (pos >= this.data.length) {
      this.active = false
      return [0, true]
    }
    const sample = (this.data[pos] ?? 0) * this.amp
    this.t += 1
    return [sample, false]
  }
}

// ── WAV decoder (for loading samples) ──

function decodeWav(buffer: ArrayBuffer): { data: Float32Array; sampleRate: number } {
  const view = new DataView(buffer)
  // RIFF header
  if (view.getUint32(0, false) !== 0x52494646) throw new Error('Not WAV')

  // Find the 'data' chunk — it may not be at offset 44
  let dataOffset = 44
  let dataSize = 0
  let offset = 12 // after RIFF header
  while (offset < buffer.byteLength - 8) {
    const chunkId = view.getUint32(offset, false)
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 0x64617461) { // 'data'
      dataOffset = offset + 8
      dataSize = chunkSize
      break
    }
    offset += 8 + chunkSize + (chunkSize % 2) // chunks are padded to even
  }
  if (dataSize === 0) throw new Error('No data chunk found')

  const sampleRate = view.getUint32(24, true)
  const numChannels = view.getUint16(22, true)
  const bitsPerSample = view.getUint16(34, true)
  const bytesPerSample = bitsPerSample / 8
  const samples = Math.floor(dataSize / (bytesPerSample * numChannels))
  const output = new Float32Array(samples)

  for (let i = 0; i < samples; i++) {
    let sum = 0
    for (let ch = 0; ch < numChannels; ch++) {
      const sampleOffset = dataOffset + (i * numChannels + ch) * bytesPerSample
      if (sampleOffset + bytesPerSample > buffer.byteLength) break
      if (bitsPerSample === 16) {
        sum += view.getInt16(sampleOffset, true) / 32768
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(sampleOffset) ?? 0
        const b1 = view.getUint8(sampleOffset + 1) ?? 0
        const b2 = view.getUint8(sampleOffset + 2) ?? 0
        let val = (b2 << 16) | (b1 << 8) | b0
        // Sign extend from 24-bit
        if (val & 0x800000) val |= 0xff000000
        sum += val / 8388608
      }
    }
    output[i] = sum / numChannels
  }
  return { data: output, sampleRate }
}

// ── Render pipeline ──

export interface RenderResult {
  samplesL: Float32Array
  samplesR: Float32Array
  sampleRate: number
  durationSec: number
  bars: number
  events: number
}

export async function renderFoundationSection(
  section: ComposedSection,
  options: { useSamples?: boolean; bpm?: number } = {}
): Promise<RenderResult> {
  const rawScore = serializeRawScore(section)
  const bpm = options.bpm ?? 145
  const secondsPerStep = 60 / bpm / (rawScore.groove.stepsPerBar / 4)
  const samplesPerStep = Math.ceil(secondsPerStep * SR)
  const samplesPerBar = samplesPerStep * rawScore.groove.stepsPerBar
  const totalSamples = samplesPerBar * rawScore.bars.length
  const samplesL = new Float32Array(totalSamples)
  const samplesR = new Float32Array(totalSamples)
  const rng = new Rng(42)

  // Create voice pools
  const kickVoices = [new KickVoice(rng), new KickVoice(rng), new KickVoice(rng), new KickVoice(rng)]
  const bassVoices = [new RollingBassVoice(), new RollingBassVoice()]
  const leadVoices = [new LeadVoice(rng), new LeadVoice(rng), new LeadVoice(rng), new LeadVoice(rng)]
  const hatVoices = [new HatVoice(rng), new HatVoice(rng), new HatVoice(rng), new HatVoice(rng)]

  // Sample voices (optional) — load via fs for Node/Bun compatibility
  let kickSample: SampleVoice | null = null
  let hatSample: SampleVoice | null = null
  if (options.useSamples) {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')

      const samplesDir = path.join(process.cwd(), 'public', 'samples', 'real')

      // Load a 909 kick
      const kickPath = path.join(samplesDir, '909_BD_02.wav')
      const kickBuffer = await fs.readFile(kickPath)
      const kickData = decodeWav(kickBuffer.buffer.slice(kickBuffer.byteOffset, kickBuffer.byteOffset + kickBuffer.byteLength))
      kickSample = new SampleVoice()
      kickSample.setData(kickData.data, kickData.sampleRate)

      // Load a Machinedrum hat
      const hatPath = path.join(samplesDir, 'md_hat_Hats_0008.wav')
      const hatBuffer = await fs.readFile(hatPath)
      const hatData = decodeWav(hatBuffer.buffer.slice(hatBuffer.byteOffset, hatBuffer.byteOffset + hatBuffer.byteLength))
      hatSample = new SampleVoice()
      hatSample.setData(hatData.data, hatData.sampleRate)
    } catch (e) {
      console.warn('Samples not available, falling back to synth:', (e as Error).message)
    }
  }

  // Bus processors (separate L/R for stereo)
  const drumBusL = new BusProcessor({ hpFreq: 0, compThr: 0.5, compRatio: 3, compAtt: 0.002, compRel: 0.08, compMakeup: 1.4, drive: 1.4, gain: 0.85 })
  const drumBusR = new BusProcessor({ hpFreq: 0, compThr: 0.5, compRatio: 3, compAtt: 0.002, compRel: 0.08, compMakeup: 1.4, drive: 1.4, gain: 0.85 })
  const bassBusL = new BusProcessor({ hpFreq: 40, compThr: 0.4, compRatio: 2, compAtt: 0.005, compRel: 0.12, compMakeup: 1.2, drive: 1.2, gain: 1.0 })
  const bassBusR = new BusProcessor({ hpFreq: 40, compThr: 0.4, compRatio: 2, compAtt: 0.005, compRel: 0.12, compMakeup: 1.2, drive: 1.2, gain: 1.0 })
  const musicBusL = new BusProcessor({ hpFreq: 80, compThr: 0.45, compRatio: 2, compAtt: 0.01, compRel: 0.15, compMakeup: 1.1, drive: 1.15, gain: 1.0 })
  const musicBusR = new BusProcessor({ hpFreq: 80, compThr: 0.45, compRatio: 2, compAtt: 0.01, compRel: 0.15, compMakeup: 1.1, drive: 1.15, gain: 1.0 })

  // Master chain (separate L/R)
  const masterL = new MasterChain()
  const masterR = new MasterChain()

  // Reverb + Delay
  const reverb = new SchroederReverb()
  reverb.wet = 0.35
  const delay = new StereoDelay()
  delay.wet = 0.25

  // Sidechain state
  let duckEnv = 1.0

  // Lead params
  const leadParams: LeadParams = { cutoff: 2000, detune: 10, resonance: 3, lfoRate: 0.8, lfoDepth: 0.3 }
  const bassParams: BassParams = { cutoffStart: 800, cutoffEnd: 200, resonance: 3 }

  // Event collection
  let eventCount = 0

  // Schedule all events
  interface ScheduledEvent {
    samplePos: number
    type: 'kick' | 'bass' | 'lead' | 'hat'
    midi?: number
    velocity: number
    durationSteps: number
    durationSamples: number
  }
  const events: ScheduledEvent[] = []

  for (const bar of rawScore.bars) {
    const barStart = bar.barIndex * samplesPerBar
    for (const step of bar.kickNotes) {
      events.push({ samplePos: barStart + step * samplesPerStep, type: 'kick', velocity: 0.9, durationSteps: 1, durationSamples: samplesPerStep })
    }
    for (const note of bar.bassNotes) {
      events.push({ samplePos: barStart + note.step * samplesPerStep, type: 'bass', midi: note.midi, velocity: 0.7, durationSteps: note.durationSteps, durationSamples: note.durationSteps * samplesPerStep })
    }
    for (const note of bar.leadNotes) {
      events.push({ samplePos: barStart + note.step * samplesPerStep, type: 'lead', midi: note.midi, velocity: note.velocity, durationSteps: note.durationSteps, durationSamples: note.durationSteps * samplesPerStep })
    }
    for (const step of bar.hatNotes) {
      events.push({ samplePos: barStart + step * samplesPerStep, type: 'hat', velocity: 0.5, durationSteps: 1, durationSamples: samplesPerStep })
    }
  }

  // Sort events by sample position
  events.sort((a, b) => a.samplePos - b.samplePos)
  eventCount = events.length

  // Track which voice to use (round-robin)
  let kickIdx = 0, bassIdx = 0, leadIdx = 0, hatIdx = 0
  // Track active bass voice for noteOff
  let activeBass: RollingBassVoice | null = null
  let activeBassNoteOffPos = 0

  // Lead Haas delay buffer
  const haasDelay = Math.floor(0.018 * SR) // 18ms
  const haasBuffer = new Float32Array(haasDelay)

  // Render sample by sample
  let eventIdx = 0
  for (let i = 0; i < totalSamples; i++) {
    // Trigger events at this sample position
    while (eventIdx < events.length && events[eventIdx]!.samplePos <= i) {
      const ev = events[eventIdx]!
      if (ev.type === 'kick') {
        // Sidechain: trigger duck
        duckEnv = 0.3 // deep duck
        if (kickSample) {
          kickSample.trigger(ev.velocity)
        } else {
          const v = kickVoices[kickIdx % kickVoices.length]!
          v.trigger(i / SR, ev.velocity, 50, 0.15, SR)
          kickIdx++
        }
      } else if (ev.type === 'bass' && ev.midi !== undefined) {
        // Note off previous bass
        if (activeBass) activeBass.noteOff()
        const freq = 440 * Math.pow(2, (ev.midi - 69) / 12)
        const v = bassVoices[bassIdx % bassVoices.length]!
        v.trigger(freq, ev.durationSamples / SR, ev.velocity, false, bassParams)
        activeBass = v
        activeBassNoteOffPos = i + ev.durationSamples
        bassIdx++
      } else if (ev.type === 'lead' && ev.midi !== undefined) {
        const freq = 440 * Math.pow(2, (ev.midi - 69) / 12)
        const v = leadVoices[leadIdx % leadVoices.length]!
        v.trigger(i / SR, freq, ev.durationSamples / SR, ev.velocity, SR, leadParams)
        leadIdx++
      } else if (ev.type === 'hat') {
        if (hatSample) {
          hatSample.trigger(ev.velocity)
        } else {
          const v = hatVoices[hatIdx % hatVoices.length]!
          v.trigger(i / SR, false, ev.velocity, SR)
          hatIdx++
        }
      }
      eventIdx++
    }

    // Note off bass at the right time
    if (activeBass && i >= activeBassNoteOffPos) {
      activeBass.noteOff()
      activeBass = null
    }

    // Render all active voices
    let drumL = 0, drumR = 0
    let bassL = 0, bassR = 0
    let musicL = 0, musicR = 0

    // Kick
    if (kickSample && kickSample.active) {
      const [s] = kickSample.render()
      drumL += s
      drumR += s
    } else {
      for (const v of kickVoices) {
        if (v.active) {
          const [s] = v.render()
          drumL += s
          drumR += s
        }
      }
    }

    // Bass (with sidechain duck)
    if (activeBass && activeBass.active) {
      const [s] = activeBass.render()
      bassL += s * duckEnv
      bassR += s * duckEnv
    }

    // Lead (with Haas stereo)
    let leadSignal = 0
    for (const v of leadVoices) {
      if (v.active) {
        const [s] = v.render()
        leadSignal += s
      }
    }
    // Haas: L = direct, R = delayed
    haasBuffer[i % haasDelay] = leadSignal
    musicL += leadSignal
    musicR += haasBuffer[(i + 1) % haasDelay] ?? 0

    // Hats
    if (hatSample && hatSample.active) {
      const [s] = hatSample.render()
      drumL += s * 0.5
      drumR += s * 0.5
    } else {
      for (const v of hatVoices) {
        if (v.active) {
          const [s] = v.render()
          drumL += s * 0.5
          drumR += s * 0.5
        }
      }
    }

    // Process buses
    drumL = drumBusL.process(drumL, SR)
    drumR = drumBusR.process(drumR, SR)
    bassL = bassBusL.process(bassL, SR)
    bassR = bassBusR.process(bassR, SR)
    musicL = musicBusL.process(musicL, SR)
    musicR = musicBusR.process(musicR, SR)

    // Reverb sends (stereo return)
    const reverbIn = musicL * 0.35 + drumL * 0.05
    const [revL, revR] = reverb.process(reverbIn, SR)

    // Delay sends (stereo return)
    const delayIn = musicL * 0.20
    const [delayL, delayR] = delay.process(delayIn, delayIn, SR)

    // Sum to master
    let mixL = drumL + bassL + musicL + revL * 0.3 + delayL * 0.5
    let mixR = drumR + bassR + musicR + revR * 0.3 + delayR * 0.5

    // Master chain
    mixL = masterL.process(mixL, SR)
    mixR = masterR.process(mixR, SR)

    samplesL[i] = isFinite(mixL) ? Math.max(-1, Math.min(1, mixL)) : 0
    samplesR[i] = isFinite(mixR) ? Math.max(-1, Math.min(1, mixR)) : 0

    // Sidechain recovery (250ms one-pole)
    duckEnv += (1.0 - duckEnv) * (1 / (0.25 * SR))
  }

  return {
    samplesL,
    samplesR,
    sampleRate: SR,
    durationSec: totalSamples / SR,
    bars: rawScore.bars.length,
    events: eventCount,
  }
}

// ── WAV encoder ──

export function encodeWav(samplesL: Float32Array, samplesR: Float32Array, sr: number): ArrayBuffer {
  const length = samplesL.length
  const buffer = new ArrayBuffer(44 + length * 4)
  const view = new DataView(buffer)

  // RIFF header
  view.setUint32(0, 0x52494646, false) // 'RIFF'
  view.setUint32(4, 36 + length * 4, true)
  view.setUint32(8, 0x57415645, false) // 'WAVE'

  // fmt chunk
  view.setUint32(12, 0x666d7420, false) // 'fmt '
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 2, true) // stereo
  view.setUint32(24, sr, true)
  view.setUint32(28, sr * 4, true) // byte rate
  view.setUint16(32, 4, true) // block align
  view.setUint16(34, 16, true) // bits per sample

  // data chunk
  view.setUint32(36, 0x64617461, false) // 'data'
  view.setUint32(40, length * 4, true)

  // Write interleaved samples
  for (let i = 0; i < length; i++) {
    const l = Math.max(-1, Math.min(1, samplesL[i] ?? 0))
    const r = Math.max(-1, Math.min(1, samplesR[i] ?? 0))
    view.setInt16(44 + i * 4, l * 32767, true)
    view.setInt16(44 + i * 4 + 2, r * 32767, true)
  }

  return buffer
}
