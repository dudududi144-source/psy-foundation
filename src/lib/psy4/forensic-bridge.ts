/**
 * Forensic Bridge v3 — Foundation RawScore → Psy Voices → Per-Channel FX → Master Chain → Stereo PCM
 *
 * Architecture:
 *   RawScore → event scheduler → voice pools → per-type ChannelFX (EQ+delay+reverb+pan+width)
 *   → 3-bus sum (drum/bass/music) with glue compression
 *   → MultibandCompressor (3-band, LR4 crossovers)
 *   → StereoWidener (M/S, width 1.3)
 *   → LUFS measurement → gain targeting (-9 LUFS)
 *   → TruePeakLimiter (4x oversampled, -1 dBTP brickwall)
 *   → Stereo PCM 44100Hz
 *
 * All stages deterministic. Same seed → bit-identical output.
 */

import { CompositionEngine } from '../../foundation/music'
import { createIdentityA } from '../../foundation/music'
import { serializeRawScore } from '../../foundation/music'
import type { ComposedSection } from '../../foundation/music'

import { Rng } from './forensic/prng'
import { fastTanh } from './forensic/dsp'
import { BusProcessor, MasterChain } from './forensic/mixing'
import { PsyKick, PsyBass, PsyLead, PsyHat, PsySample, PsySnare, PsySubBass, PsyPad, PsyShaker, PsyRiser, PsyImpact } from './psy-voices'
import { ChannelFX } from './channel-fx'
import { CHANNEL_PRESETS } from './channel-presets'
import { MultibandCompressor } from './multiband'
import { StereoWidener } from './ms-processor'
import { measureLUFS, lufsToGainOffset } from './loudness'
import { TruePeakLimiter } from './limiter'

const SR = 44100
const TARGET_LUFS = -11.0

// ── WAV decoder ──

function decodeWav(buffer: ArrayBuffer): { data: Float32Array; sampleRate: number } {
  const view = new DataView(buffer)
  if (view.getUint32(0, false) !== 0x52494646) throw new Error('Not WAV')
  let dataOffset = 44, dataSize = 0, offset = 12
  while (offset < buffer.byteLength - 8) {
    const chunkId = view.getUint32(offset, false)
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 0x64617461) { dataOffset = offset + 8; dataSize = chunkSize; break }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  if (dataSize === 0) throw new Error('No data chunk')
  const sampleRate = view.getUint32(24, true)
  const numChannels = view.getUint16(22, true)
  const bitsPerSample = view.getUint16(34, true)
  const bytesPerSample = bitsPerSample / 8
  const samples = Math.floor(dataSize / (bytesPerSample * numChannels))
  const output = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    let sum = 0
    for (let ch = 0; ch < numChannels; ch++) {
      const so = dataOffset + (i * numChannels + ch) * bytesPerSample
      if (so + bytesPerSample > buffer.byteLength) break
      if (bitsPerSample === 16) sum += view.getInt16(so, true) / 32768
      else if (bitsPerSample === 24) {
        const b0 = view.getUint8(so) ?? 0
        const b1 = view.getUint8(so + 1) ?? 0
        const b2 = view.getUint8(so + 2) ?? 0
        let val = (b2 << 16) | (b1 << 8) | b0
        if (val & 0x800000) val |= 0xff000000
        sum += val / 8388608
      }
    }
    output[i] = sum / numChannels
  }
  return { data: output, sampleRate }
}

// ── Render config (tunable parameters for auto-fixer) ──

export interface RenderConfig {
  // Kick
  kickFundamental: number      // Hz, default 46
  kickDecay: number            // seconds, default 0.11
  // Bass
  bassDecay: number            // seconds, default 0.06 (passed to PsyBass via trigger dur)
  bassGain: number             // linear, default 1.0
  // Lead
  leadCutoff: number           // Hz, default 4500
  leadGain: number             // linear, default 1.0
  leadResonance: number        // 0..1, default 0.5
  // Hats
  hatGain: number              // linear, default 0.8
  openHatGain: number          // linear, default 0.4
  // Snare
  snareGain: number            // linear, default 0.6
  // Shaker
  shakerGain: number           // linear, default 1.0
  // Sub-bass
  subBassGain: number          // linear, default 1.0
  // Pad
  padGain: number              // linear, default 1.0
  // Sidechain
  duckAmount: number           // 0..1, depth (1 = full duck to 0), default 0.75
  // Master
  targetLufs: number           // default -9
  stereoWidth: number          // 0..2, default 1.3
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  kickFundamental: 46,
  kickDecay: 0.11,
  bassDecay: 0.06,
  bassGain: 1.0,
  leadCutoff: 4500,
  leadGain: 1.0,
  leadResonance: 0.5,
  hatGain: 0.8,
  openHatGain: 0.4,
  snareGain: 0.6,
  shakerGain: 1.0,
  subBassGain: 1.0,
  padGain: 1.0,
  duckAmount: 0.75,
  targetLufs: TARGET_LUFS,
  stereoWidth: 1.3,
}

// ── Render ──

export interface RenderResult {
  samplesL: Float32Array
  samplesR: Float32Array
  sampleRate: number
  durationSec: number
  bars: number
  events: number
  lufs: number
  truePeakDb: number
  stereoWidth: number
  monoCompatibility: number
  gainReductionDb: number
}

export async function renderFoundationSection(
  section: ComposedSection,
  options: { useSamples?: boolean; bpm?: number; config?: Partial<RenderConfig> } = {}
): Promise<RenderResult> {
  const cfg: RenderConfig = { ...DEFAULT_RENDER_CONFIG, ...options.config }
  const rawScore = serializeRawScore(section)
  const bpm = options.bpm ?? 145
  const targetLufs = cfg.targetLufs
  const secondsPerStep = 60 / bpm / (rawScore.groove.stepsPerBar / 4)
  const samplesPerStep = Math.ceil(secondsPerStep * SR)
  const samplesPerBar = samplesPerStep * rawScore.groove.stepsPerBar

  // Only render bars with kick+bass (skip INTRO/BREAK/OUTRO silence)
  const activeBars = rawScore.bars.filter(b => b.roles.kick && b.roles.bass && b.arrangementState !== 'INTRO' && b.arrangementState !== 'BREAK' && b.arrangementState !== 'OUTRO')
  const renderBars = activeBars.length > 0 ? activeBars : rawScore.bars
  const barRemap = new Map<number, number>()
  renderBars.forEach((b, i) => barRemap.set(b.barIndex, i))
  const totalSamples = samplesPerBar * renderBars.length

  const samplesL = new Float32Array(totalSamples)
  const samplesR = new Float32Array(totalSamples)
  const rng = new Rng(42)

  // ── Voice pools ──
  const kicks = [new PsyKick(rng), new PsyKick(rng), new PsyKick(rng), new PsyKick(rng)]
  const basses = [new PsyBass(), new PsyBass()]
  const leads = [new PsyLead(rng), new PsyLead(rng), new PsyLead(rng), new PsyLead(rng)]
  const hats = [new PsyHat(rng), new PsyHat(rng), new PsyHat(rng), new PsyHat(rng)]
  const snares = [new PsySnare(rng), new PsySnare(rng)]
  const subBasses = [new PsySubBass(), new PsySubBass()]
  const pads = [new PsyPad(rng), new PsyPad(rng)]
  const shakers = [new PsyShaker(rng), new PsyShaker(rng)]
  const risers = [new PsyRiser(rng)]
  const impacts = [new PsyImpact(rng)]

  // ── Per-type ChannelFX instances (one per voice type, shared across pool) ──
  const fxKick = new ChannelFX(CHANNEL_PRESETS.kick, SR)
  const fxBass = new ChannelFX(CHANNEL_PRESETS.bass, SR)
  const fxSubBass = new ChannelFX(CHANNEL_PRESETS.subbass, SR)
  const fxLead = new ChannelFX(CHANNEL_PRESETS.lead, SR)
  const fxCounter = new ChannelFX(CHANNEL_PRESETS.counter, SR)
  const fxHat = new ChannelFX(CHANNEL_PRESETS.hat, SR)
  const fxOpenHat = new ChannelFX(CHANNEL_PRESETS.openhat, SR)
  const fxSnare = new ChannelFX(CHANNEL_PRESETS.snare, SR)
  const fxShaker = new ChannelFX(CHANNEL_PRESETS.shaker, SR)
  const fxPad = new ChannelFX(CHANNEL_PRESETS.pad, SR)
  const fxRiser = new ChannelFX(CHANNEL_PRESETS.riser, SR)
  const fxImpact = new ChannelFX(CHANNEL_PRESETS.impact, SR)
  const fxClap = new ChannelFX(CHANNEL_PRESETS.clap, SR)
  const fxPerc = new ChannelFX(CHANNEL_PRESETS.perc, SR)

  // ── Samples ──
  let kickSample: PsySample | null = null
  let hatSample: PsySample | null = null
  let clapSample: PsySample | null = null
  let percSample: PsySample | null = null

  if (options.useSamples) {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')
      const dir = path.join(process.cwd(), 'public', 'samples', 'real')

      const loadSample = async (name: string) => {
        const buf = await fs.readFile(path.join(dir, name))
        const decoded = decodeWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
        const s = new PsySample()
        s.setData(decoded.data, decoded.sampleRate)
        return s
      }

      kickSample = await loadSample('909_BD_02.wav')
      const hatFiles = (await fs.readdir(dir)).filter(f => f.includes('md_hat'))
      if (hatFiles[0]) hatSample = await loadSample(hatFiles[0])
      const clapFiles = (await fs.readdir(dir)).filter(f => f.includes('md_clap'))
      if (clapFiles[0]) clapSample = await loadSample(clapFiles[0])
      const percFiles = (await fs.readdir(dir)).filter(f => f.includes('md_perc'))
      if (percFiles[0]) percSample = await loadSample(percFiles[0])
    } catch (e) {
      console.warn('Samples not available:', (e as Error).message)
    }
  }

  // ── Mix bus (stereo) — glue compression per bus ──
  const drumBusL = new BusProcessor({ hpFreq: 0, compThr: 0.5, compRatio: 3, compAtt: 0.002, compRel: 0.08, compMakeup: 1.3, drive: 1.2, gain: 1.0 })
  const drumBusR = new BusProcessor({ hpFreq: 0, compThr: 0.5, compRatio: 3, compAtt: 0.002, compRel: 0.08, compMakeup: 1.3, drive: 1.2, gain: 1.0 })
  const bassBusL = new BusProcessor({ hpFreq: 100, compThr: 0.4, compRatio: 2, compAtt: 0.005, compRel: 0.1, compMakeup: 1.0, drive: 1.0, gain: 0.55 })
  const bassBusR = new BusProcessor({ hpFreq: 100, compThr: 0.4, compRatio: 2, compAtt: 0.005, compRel: 0.1, compMakeup: 1.0, drive: 1.0, gain: 0.55 })
  const musicBusL = new BusProcessor({ hpFreq: 180, compThr: 0.4, compRatio: 2, compAtt: 0.01, compRel: 0.15, compMakeup: 1.3, drive: 1.2, gain: 1.1 })
  const musicBusR = new BusProcessor({ hpFreq: 180, compThr: 0.4, compRatio: 2, compAtt: 0.01, compRel: 0.15, compMakeup: 1.3, drive: 1.2, gain: 1.1 })

  const masterGlueL = new MasterChain()
  const masterGlueR = new MasterChain()

  // ── Events ──
  interface Ev { pos: number; type: string; midi?: number; freqs?: number[]; vel: number; dur: number }
  const events: Ev[] = []

  for (const bar of renderBars) {
    const barStart = (barRemap.get(bar.barIndex) ?? 0) * samplesPerBar
    const accent = rawScore.groove.accent
    const barIdx = barRemap.get(bar.barIndex) ?? 0

    // Four-on-the-floor kick
    for (const step of [0, 4, 8, 12]) {
      const a = accent[step % accent.length] ?? 1
      events.push({ pos: barStart + step * samplesPerStep, type: 'kick', vel: 0.8 + a * 0.2, dur: samplesPerStep })
    }

    // Rolling 16th bass — with swing and dramatic velocity variation
    const rootMidi = bar.bassNotes[0]?.midi ?? 40
    const fifthMidi = bar.bassNotes[2]?.midi ?? rootMidi
    const thirdMidi = bar.bassNotes[4]?.midi ?? rootMidi
    const pattern = barIdx % 4
    // Swing: delay odd 16th steps by ~15% of step duration for groove
    const swingAmount = Math.floor(samplesPerStep * 0.15)
    for (let step = 0; step < 16; step++) {
      const a = accent[step % accent.length] ?? 0.5
      let midi = rootMidi
      if (pattern === 0) {
        midi = (step % 4 === 0) ? rootMidi : (step % 4 === 2) ? fifthMidi : rootMidi
      } else if (pattern === 1) {
        midi = (step % 4 === 2) ? fifthMidi : rootMidi
      } else if (pattern === 2) {
        midi = (step % 4 === 0) ? rootMidi : (step % 4 === 1) ? thirdMidi : (step % 4 === 2) ? fifthMidi : thirdMidi
      } else {
        midi = (step % 4 === 0) ? rootMidi : (step % 4 === 2) ? fifthMidi : (step % 4 === 3) ? rootMidi + 12 : rootMidi
      }
      // Dramatic velocity: downbeats strong, offbeats ghost notes
      const isDownbeat = step % 4 === 0
      const isOffbeat = step % 2 === 1
      let vel: number
      if (isDownbeat) vel = 0.7 + a * 0.2
      else if (isOffbeat) vel = 0.25 + a * 0.15 // ghost notes
      else vel = 0.45 + a * 0.2

      // Swing: delay odd steps
      const swingOffset = step % 2 === 1 ? swingAmount : 0
      events.push({
        pos: barStart + step * samplesPerStep + swingOffset,
        type: 'bass', midi, vel,
        dur: Math.floor(samplesPerStep * (isOffbeat ? 0.6 : 0.85))
      })
    }

    // Lead — use Foundation's lead notes (start from bar 0, not bar 2)
    if (bar.leadNotes.length > 0) {
      for (const n of bar.leadNotes) {
        events.push({ pos: barStart + n.step * samplesPerStep, type: 'lead', midi: n.midi, vel: n.velocity, dur: n.durationSteps * samplesPerStep })
      }
      const leadSteps = new Set(bar.leadNotes.map(n => n.step))
      const fillSteps = [3, 7, 11, 15]
      for (const fs of fillSteps) {
        if (!leadSteps.has(fs)) {
          const lastLead = bar.leadNotes[bar.leadNotes.length - 1]
          if (lastLead) {
            events.push({ pos: barStart + fs * samplesPerStep, type: 'lead', midi: lastLead.midi + 4, vel: 0.4, dur: samplesPerStep })
          }
        }
      }
    } else {
      // No lead from Foundation — generate a simple motif from bar 0
      const motifNotes = [64, 67, 71, 67]
      for (let i = 0; i < motifNotes.length; i++) {
        const step = i * 2
        events.push({ pos: barStart + step * samplesPerStep, type: 'lead', midi: motifNotes[i]!, vel: 0.5, dur: samplesPerStep })
      }
    }

    // Counter-lead — harmony response (start from bar 0)
    if (bar.leadNotes.length > 0) {
      for (const n of bar.leadNotes) {
        const counterStep = n.step + 3
        if (counterStep < 16) {
          const harmonyMidi = n.midi + (counterStep % 2 === 0 ? 4 : 7)
          events.push({ pos: barStart + counterStep * samplesPerStep, type: 'counter', midi: harmonyMidi, vel: n.velocity * 0.6, dur: samplesPerStep })
        }
      }
    }

    // Closed hats on offbeats — velocity varies per bar for rhythmic interest
    const hatVelBase = barIdx % 2 === 0 ? 0.4 : 0.35
    const hatVelStrong = barIdx % 2 === 0 ? 0.6 : 0.55
    for (const step of [2, 6, 10, 14]) {
      const isStrong = step % 8 === 6
      events.push({ pos: barStart + step * samplesPerStep, type: 'hat', vel: isStrong ? hatVelStrong : hatVelBase, dur: samplesPerStep })
    }

    // Open hats — syncopated (steps 6 and 14, even bars only)
    if (barIdx % 2 === 0) {
      events.push({ pos: barStart + 6 * samplesPerStep, type: 'openhat', vel: 0.4, dur: samplesPerStep })
      events.push({ pos: barStart + 14 * samplesPerStep, type: 'openhat', vel: 0.4, dur: samplesPerStep })
    }

    // Claps on 2 & 4
    events.push({ pos: barStart + 4 * samplesPerStep, type: 'clap', vel: 0.45, dur: samplesPerStep })
    events.push({ pos: barStart + 12 * samplesPerStep, type: 'clap', vel: 0.45, dur: samplesPerStep })

    // Snare on beats 2 & 4 (backbeat)
    events.push({ pos: barStart + 4 * samplesPerStep, type: 'snare', vel: 0.5, dur: samplesPerStep })
    events.push({ pos: barStart + 12 * samplesPerStep, type: 'snare', vel: 0.5, dur: samplesPerStep })

    // Snare roll before section changes (last bar of 4-bar phrase)
    if (barIdx % 4 === 3) {
      events.push({ pos: barStart + 13 * samplesPerStep, type: 'snare', vel: 0.3, dur: samplesPerStep })
      events.push({ pos: barStart + 14 * samplesPerStep, type: 'snare', vel: 0.4, dur: samplesPerStep })
      events.push({ pos: barStart + 15 * samplesPerStep, type: 'snare', vel: 0.5, dur: samplesPerStep })
      events.push({ pos: barStart + 15 * samplesPerStep + Math.floor(samplesPerStep / 2), type: 'snare', vel: 0.7, dur: samplesPerStep })
    }

    // Sub-bass: sustained root for the whole bar
    events.push({ pos: barStart, type: 'subbass', midi: rootMidi, vel: 0.25, dur: samplesPerBar })

    // Pad: sustained chord — one per 2 bars
    if (barIdx % 2 === 0) {
      const rootFreq = 440 * Math.pow(2, (rootMidi - 69) / 12)
      const thirdFreq = 440 * Math.pow(2, (rootMidi + 4 - 69) / 12)
      const fifthFreq = 440 * Math.pow(2, (rootMidi + 7 - 69) / 12)
      events.push({ pos: barStart, type: 'pad', vel: 0.12, dur: samplesPerBar * 2, freqs: [rootFreq, thirdFreq, fifthFreq] })
    }

    // Shaker on every 16th
    for (let step = 0; step < 16; step++) {
      const isStrong = step % 4 === 0
      events.push({ pos: barStart + step * samplesPerStep, type: 'shaker', vel: isStrong ? 0.3 : 0.15, dur: samplesPerStep })
    }

    // FX: riser + impact before section changes
    if (barIdx % 4 === 3) {
      events.push({ pos: barStart, type: 'riser', vel: 0.2, dur: samplesPerBar })
      events.push({ pos: barStart + samplesPerBar, type: 'impact', vel: 0.4, dur: samplesPerStep })
    }

    // Ghost perc
    const percSteps = pattern === 0 ? [7, 15] : pattern === 1 ? [5, 13] : pattern === 2 ? [3, 11] : [7, 11, 15]
    for (const ps of percSteps) {
      events.push({ pos: barStart + ps * samplesPerStep, type: 'perc', vel: 0.2, dur: samplesPerStep })
    }
  }

  events.sort((a, b) => a.pos - b.pos)

  // ── Render loop ──
  let duckEnv = 1.0
  let activeBass: PsyBass | null = null
  let bassNoteOffPos = 0
  let activeSubBass: PsySubBass | null = null
  let subBassNoteOffPos = 0
  let activePad: PsyPad | null = null
  let padNoteOffPos = 0
  let kickIdx = 0, bassIdx = 0, leadIdx = 0, hatIdx = 0
  let evIdx = 0

  // Alternating pan state for hats (per-type, driven by step grid)
  let hatPanFlip = false
  let openHatPanFlip = false

  // Energy contour: create tension/release by modulating overall energy across bars.
  // Pattern: bars 0-3 full, bar 4 dip (70%), bars 5-6 build (85%→100%), bar 7 peak (105%).
  // This creates a 8-bar tension/release cycle that improves the dynamic contour.
  function barEnergy(barIdx: number): number {
    const phase = barIdx % 8
    if (phase === 4) return 0.65  // breakdown dip
    if (phase === 5) return 0.80  // rebuild
    if (phase === 6) return 0.95  // build
    if (phase === 7) return 1.05  // climax
    return 1.0                    // full energy
  }

  for (let i = 0; i < totalSamples; i++) {
    const currentBar = Math.floor(i / samplesPerBar)
    const energyMul = barEnergy(currentBar)
    while (evIdx < events.length && events[evIdx]!.pos <= i) {
      const ev = events[evIdx]!
      if (ev.type === 'kick') {
        duckEnv = 1.0 - cfg.duckAmount
        if (kickSample) kickSample.trigger(ev.vel)
        else { kicks[kickIdx % 4]!.trigger(ev.vel, cfg.kickFundamental, cfg.kickDecay); kickIdx++ }
      } else if (ev.type === 'bass' && ev.midi !== undefined) {
        if (activeBass) activeBass.noteOff()
        const freq = 440 * Math.pow(2, (ev.midi - 69) / 12)
        basses[bassIdx % 2]!.trigger(freq, cfg.bassDecay, ev.vel)
        activeBass = basses[bassIdx % 2]!
        bassNoteOffPos = i + ev.dur
        bassIdx++
      } else if (ev.type === 'lead' && ev.midi !== undefined) {
        const freq = 440 * Math.pow(2, (ev.midi - 69) / 12)
        leads[leadIdx % 4]!.trigger(freq, ev.dur / SR, ev.vel, { cutoff: cfg.leadCutoff, detune: 10, res: cfg.leadResonance, lfoRate: 1.2, lfoDepth: 0.5 })
        leadIdx++
      } else if (ev.type === 'hat') {
        if (hatSample) hatSample.trigger(ev.vel)
        else { hats[hatIdx % 4]!.trigger(ev.vel, false); hatIdx++ }
      } else if (ev.type === 'openhat') {
        hats[(hatIdx + 2) % 4]!.trigger(ev.vel, true)
      } else if (ev.type === 'clap' && clapSample) {
        clapSample.trigger(ev.vel)
      } else if (ev.type === 'perc' && percSample) {
        percSample.trigger(ev.vel)
      } else if (ev.type === 'snare') {
        snares[0]!.trigger(ev.vel)
      } else if (ev.type === 'subbass' && ev.midi !== undefined) {
        const freq = 440 * Math.pow(2, (ev.midi - 69) / 12)
        if (activeSubBass) activeSubBass.noteOff()
        subBasses[0]!.trigger(freq, ev.dur / SR, ev.vel)
        activeSubBass = subBasses[0]!
        subBassNoteOffPos = i + ev.dur
      } else if (ev.type === 'pad' && ev.freqs) {
        if (activePad) activePad.noteOff()
        pads[0]!.trigger(ev.freqs, ev.dur / SR, ev.vel)
        activePad = pads[0]!
        padNoteOffPos = i + ev.dur
      } else if (ev.type === 'shaker') {
        shakers[0]!.trigger(ev.vel)
      } else if (ev.type === 'riser') {
        risers[0]!.trigger(ev.dur / SR, ev.vel)
      } else if (ev.type === 'impact') {
        impacts[0]!.trigger(ev.vel)
      } else if (ev.type === 'counter' && ev.midi !== undefined) {
        const freq = 440 * Math.pow(2, (ev.midi - 69) / 12)
        leads[(leadIdx + 2) % 4]!.trigger(freq, ev.dur / SR, ev.vel, { cutoff: Math.floor(cfg.leadCutoff * 0.5), detune: 6, res: 0.3, lfoRate: 0.6, lfoDepth: 0.2 })
        leadIdx++
      }
      evIdx++
    }

    // Note-offs
    if (activeBass && i >= bassNoteOffPos) { activeBass.noteOff(); activeBass = null }
    if (activeSubBass && i >= subBassNoteOffPos) { activeSubBass.noteOff(); activeSubBass = null }
    if (activePad && i >= padNoteOffPos) { activePad.noteOff(); activePad = null }

    // ── Render voices → per-type ChannelFX → buses ──
    let drumL = 0, drumR = 0, bassL = 0, bassR = 0, musicL = 0, musicR = 0

    // Kick → fxKick → drum bus
    let kickMono = 0
    if (kickSample?.active) kickMono += kickSample.render()[0]
    for (const v of kicks) if (v.active) kickMono += v.render()[0]
    if (kickMono !== 0) { const [kl, kr] = fxKick.process(kickMono); drumL += kl; drumR += kr }

    // Bass (with sidechain) → fxBass → bass bus
    let bassMono = 0
    if (activeBass?.active) bassMono += activeBass.render()[0]
    if (bassMono !== 0) { const [bl, br] = fxBass.process(bassMono * duckEnv * cfg.bassGain); bassL += bl; bassR += br }

    // Sub-bass → fxSubBass → bass bus
    let subMono = 0
    if (activeSubBass?.active) subMono += activeSubBass.render()[0]
    if (subMono !== 0) { const [sl, sr] = fxSubBass.process(subMono * cfg.subBassGain); bassL += sl; bassR += sr }

    // Lead → fxLead → music bus
    let leadMono = 0
    for (const v of leads) if (v.active) leadMono += v.render()[0]
    if (leadMono !== 0) { const [ll, lr] = fxLead.process(leadMono * cfg.leadGain); musicL += ll; musicR += lr }

    // Counter-lead — rendered by the same lead pool but the FX type is 'counter'
    // Since the lead pool is shared, we detect counter activity by checking if a counter
    // event was recently triggered. To keep it simple and deterministic, we route the
    // SAME lead signal through fxCounter when a counter note is active.
    // (The lead pool voices are triggered with different cutoff params for counter events,
    //  so the timbre differs. We apply the counter FX to whichever lead voice was most
    //  recently triggered as a counter.)
    // Simplified: counter uses the same lead render but through fxCounter for the notes
    // triggered with cutoff 2000. Since we can't distinguish per-voice, we apply a small
    // counter send from the lead signal.
    if (leadMono !== 0) {
      const [cl, cr] = fxCounter.process(leadMono * 0.3 * cfg.leadGain)
      musicL += cl; musicR += cr
    }

    // Closed hats → fxHat → drum bus
    let hatMono = 0
    if (hatSample?.active) hatMono += hatSample.render()[0]
    for (const v of hats) if (v.active && !v.open) hatMono += v.render()[0]
    if (hatMono !== 0) {
      const [hl, hr] = fxHat.process(hatMono * cfg.hatGain)
      drumL += hl; drumR += hr
    }

    // Open hats → fxOpenHat → drum bus (separate FX chain for longer decay/reverb)
    let openHatMono = 0
    for (const v of hats) if (v.active && v.open) openHatMono += v.render()[0]
    if (openHatMono !== 0) {
      const [ohl, ohr] = fxOpenHat.process(openHatMono * cfg.openHatGain)
      drumL += ohl; drumR += ohr
    }

    // Clap → fxClap → drum bus
    let clapMono = 0
    if (clapSample?.active) clapMono += clapSample.render()[0]
    if (clapMono !== 0) { const [cl, cr] = fxClap.process(clapMono); drumL += cl; drumR += cr }

    // Perc → fxPerc → drum bus
    let percMono = 0
    if (percSample?.active) percMono += percSample.render()[0]
    if (percMono !== 0) { const [pl, pr] = fxPerc.process(percMono); drumL += pl; drumR += pr }

    // Snare → fxSnare → drum bus
    let snareMono = 0
    for (const v of snares) if (v.active) snareMono += v.render()[0]
    if (snareMono !== 0) { const [sl, sr] = fxSnare.process(snareMono * cfg.snareGain); drumL += sl; drumR += sr }

    // Shaker → fxShaker → drum bus
    let shakerMono = 0
    for (const v of shakers) if (v.active) shakerMono += v.render()[0]
    if (shakerMono !== 0) { const [sl, sr] = fxShaker.process(shakerMono * cfg.shakerGain); drumL += sl; drumR += sr }

    // Pad → fxPad → music bus
    let padMono = 0
    if (activePad?.active) padMono += activePad.render()[0]
    if (padMono !== 0) { const [pl, pr] = fxPad.process(padMono * cfg.padGain); musicL += pl; musicR += pr }

    // Riser → fxRiser → music bus
    let riserMono = 0
    for (const v of risers) if (v.active) riserMono += v.render()[0]
    if (riserMono !== 0) { const [rl, rr] = fxRiser.process(riserMono); musicL += rl; musicR += rr }

    // Impact → fxImpact → bass bus
    let impactMono = 0
    for (const v of impacts) if (v.active) impactMono += v.render()[0]
    if (impactMono !== 0) { const [il, ir] = fxImpact.process(impactMono); bassL += il; bassR += ir }

    // ── Bus glue compression ──
    drumL = drumBusL.process(drumL, SR); drumR = drumBusR.process(drumR, SR)
    bassL = bassBusL.process(bassL, SR); bassR = bassBusR.process(bassR, SR)
    musicL = musicBusL.process(musicL, SR); musicR = musicBusR.process(musicR, SR)

    // ── Master sum + glue ── (apply energy contour for tension/release)
    let mixL = (drumL + bassL + musicL) * energyMul
    let mixR = (drumR + bassR + musicR) * energyMul
    mixL = masterGlueL.process(mixL, SR)
    mixR = masterGlueR.process(mixR, SR)

    samplesL[i] = isFinite(mixL) ? Math.max(-1.5, Math.min(1.5, mixL)) : 0
    samplesR[i] = isFinite(mixR) ? Math.max(-1.5, Math.min(1.5, mixR)) : 0

    // Sidechain recovery
    duckEnv += (1.0 - duckEnv) * (1 / (0.15 * SR))
  }

  // ═══════════════════════════════════════════════════════════════
  // POST-LOOP MASTER CHAIN
  // ═══════════════════════════════════════════════════════════════

  // 1. Multiband compressor (3-band, LR4 crossovers at 200Hz / 2000Hz)
  const multiband = new MultibandCompressor({ sampleRate: SR })
  multiband.processBuffer(samplesL, samplesR)

  // 2. Stereo widener (M/S, width from config)
  const widener = new StereoWidener(cfg.stereoWidth)
  widener.processBuffer(samplesL, samplesR)
  const monoCompat = widener.getMonoCompatibility()

  // 3. Measure LUFS
  const lufsResult = measureLUFS(samplesL, samplesR, SR)

  // 4. Apply LUFS gain targeting (-9 LUFS)
  const gainOffset = lufsToGainOffset(lufsResult.integratedLUFS, targetLufs)
  // Clamp gain to avoid extreme boosts on quiet signals
  const safeGain = Math.max(0.1, Math.min(8.0, gainOffset))
  for (let i = 0; i < totalSamples; i++) {
    samplesL[i] = (samplesL[i] ?? 0) * safeGain
    samplesR[i] = (samplesR[i] ?? 0) * safeGain
  }

  // 5. True-peak limiter (4x oversampled, -1 dBTP brickwall)
  const limiter = new TruePeakLimiter({ thresholdDb: -1.0, ceilingDb: -1.0, sampleRate: SR })
  limiter.processBuffer(samplesL, samplesR)

  // Final safety clamp
  for (let i = 0; i < totalSamples; i++) {
    let l = samplesL[i] ?? 0
    let r = samplesR[i] ?? 0
    if (l > 1) l = 1; else if (l < -1) l = -1
    if (r > 1) r = 1; else if (r < -1) r = -1
    samplesL[i] = l
    samplesR[i] = r
  }

  // Measure final metrics
  const finalLufs = measureLUFS(samplesL, samplesR, SR)
  const stereoWidth = StereoWidener.measureWidth(samplesL, samplesR)

  return {
    samplesL, samplesR, sampleRate: SR,
    durationSec: totalSamples / SR,
    bars: renderBars.length,
    events: events.length,
    lufs: finalLufs.integratedLUFS,
    truePeakDb: finalLufs.truePeakDb,
    stereoWidth,
    monoCompatibility: monoCompat,
    gainReductionDb: limiter.getMaxGainReductionDb(),
  }
}

// ── WAV encoder ──

export function encodeWav(samplesL: Float32Array, samplesR: Float32Array, sr: number): ArrayBuffer {
  const length = samplesL.length
  const buffer = new ArrayBuffer(44 + length * 4)
  const view = new DataView(buffer)
  view.setUint32(0, 0x52494646, false)
  view.setUint32(4, 36 + length * 4, true)
  view.setUint32(8, 0x57415645, false)
  view.setUint32(12, 0x666d7420, false)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, sr, true)
  view.setUint32(28, sr * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, 0x64617461, false)
  view.setUint32(40, length * 4, true)
  for (let i = 0; i < length; i++) {
    view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, samplesL[i] ?? 0)) * 32767, true)
    view.setInt16(44 + i * 4 + 2, Math.max(-1, Math.min(1, samplesR[i] ?? 0)) * 32767, true)
  }
  return buffer
}
