/**
 * Forensic Bridge v2 — Foundation RawScore → Psy Voices → Stereo PCM
 *
 * Rewritten to use the new PsyKick, PsyBass, PsyLead, PsyHat voices.
 * These produce commercial-grade psytrance sound, not toy beeps.
 */

import { CompositionEngine } from '../../foundation/music'
import { createIdentityA } from '../../foundation/music'
import { serializeRawScore } from '../../foundation/music'
import type { ComposedSection } from '../../foundation/music'

import { Rng } from './forensic/prng'
import { fastTanh } from './forensic/dsp'
import { BusProcessor, MasterChain, SchroederReverb, StereoDelay } from './forensic/mixing'
import { PsyKick, PsyBass, PsyLead, PsyHat, PsySample, PsySnare, PsySubBass, PsyPad, PsyShaker, PsyRiser, PsyImpact } from './psy-voices'

const SR = 44100

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

// ── Render ──

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

  // ── Mix bus (stereo) ──
  const drumL = new BusProcessor({ hpFreq: 0, compThr: 0.5, compRatio: 3, compAtt: 0.002, compRel: 0.08, compMakeup: 1.3, drive: 1.2, gain: 0.9 })
  const drumR = new BusProcessor({ hpFreq: 0, compThr: 0.5, compRatio: 3, compAtt: 0.002, compRel: 0.08, compMakeup: 1.3, drive: 1.2, gain: 0.9 })
  const bassL = new BusProcessor({ hpFreq: 90, compThr: 0.4, compRatio: 2, compAtt: 0.005, compRel: 0.1, compMakeup: 1.1, drive: 1.1, gain: 1.0 })
  const bassR = new BusProcessor({ hpFreq: 90, compThr: 0.4, compRatio: 2, compAtt: 0.005, compRel: 0.1, compMakeup: 1.1, drive: 1.1, gain: 1.0 })
  const musicL = new BusProcessor({ hpFreq: 200, compThr: 0.4, compRatio: 2, compAtt: 0.01, compRel: 0.15, compMakeup: 1.2, drive: 1.1, gain: 1.0 })
  const musicR = new BusProcessor({ hpFreq: 200, compThr: 0.4, compRatio: 2, compAtt: 0.01, compRel: 0.15, compMakeup: 1.2, drive: 1.1, gain: 1.0 })

  const masterL = new MasterChain()
  const masterR = new MasterChain()

  const reverb = new SchroederReverb()
  reverb.wet = 0.3
  const delay = new StereoDelay()
  delay.wet = 0.2

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

    // Rolling 16th bass — with variation per bar
    const rootMidi = bar.bassNotes[0]?.midi ?? 40
    const fifthMidi = bar.bassNotes[2]?.midi ?? rootMidi
    const thirdMidi = bar.bassNotes[4]?.midi ?? rootMidi
    // Alternate bass patterns per bar for variation
    const pattern = barIdx % 4
    for (let step = 0; step < 16; step++) {
      const a = accent[step % accent.length] ?? 0.5
      let midi = rootMidi
      if (pattern === 0) {
        // Pattern A: root-fifth-root-fifth
        midi = (step % 4 === 0) ? rootMidi : (step % 4 === 2) ? fifthMidi : rootMidi
      } else if (pattern === 1) {
        // Pattern B: root-root-fifth-root
        midi = (step % 4 === 2) ? fifthMidi : rootMidi
      } else if (pattern === 2) {
        // Pattern C: root-third-fifth-third
        midi = (step % 4 === 0) ? rootMidi : (step % 4 === 1) ? thirdMidi : (step % 4 === 2) ? fifthMidi : thirdMidi
      } else {
        // Pattern D: root-fifth-root-octave
        midi = (step % 4 === 0) ? rootMidi : (step % 4 === 2) ? fifthMidi : (step % 4 === 3) ? rootMidi + 12 : rootMidi
      }
      const vel = step % 4 === 0 ? 0.6 + a * 0.2 : 0.35 + a * 0.2
      events.push({ pos: barStart + step * samplesPerStep, type: 'bass', midi, vel, dur: Math.floor(samplesPerStep * 0.85) })
    }

    // Lead — use Foundation's lead notes + add fills on empty steps
    if (bar.leadNotes.length > 0) {
      for (const n of bar.leadNotes) {
        events.push({ pos: barStart + n.step * samplesPerStep, type: 'lead', midi: n.midi, vel: n.velocity, dur: n.durationSteps * samplesPerStep })
      }
      // Add lead fills on steps where there's no lead
      const leadSteps = new Set(bar.leadNotes.map(n => n.step))
      const fillSteps = [3, 7, 11, 15]
      for (const fs of fillSteps) {
        if (!leadSteps.has(fs)) {
          // Echo the last lead note a third higher
          const lastLead = bar.leadNotes[bar.leadNotes.length - 1]
          if (lastLead) {
            events.push({ pos: barStart + fs * samplesPerStep, type: 'lead', midi: lastLead.midi + 4, vel: 0.4, dur: samplesPerStep })
          }
        }
      }
    } else if (barIdx >= 2) {
      // No lead from Foundation — generate a simple motif
      const motifNotes = [64, 67, 71, 67] // E4 G4 B4 G4
      for (let i = 0; i < motifNotes.length; i++) {
        const step = i * 2
        events.push({ pos: barStart + step * samplesPerStep, type: 'lead', midi: motifNotes[i]!, vel: 0.5, dur: samplesPerStep })
      }
    }

    // Counter-lead — harmony response 3 steps after each lead note
    if (bar.leadNotes.length > 0 && barIdx >= 2) {
      for (const n of bar.leadNotes) {
        const counterStep = n.step + 3
        if (counterStep < 16) {
          // Harmony: a third above (midi + 4) or fifth above (midi + 7)
          const harmonyMidi = n.midi + (counterStep % 2 === 0 ? 4 : 7)
          events.push({ pos: barStart + counterStep * samplesPerStep, type: 'counter', midi: harmonyMidi, vel: n.velocity * 0.6, dur: samplesPerStep })
        }
      }
    }

    // Hats on offbeats — velocity variation
    for (const step of [2, 6, 10, 14]) {
      const isStrong = step % 8 === 6
      events.push({ pos: barStart + step * samplesPerStep, type: 'hat', vel: isStrong ? 0.6 : 0.4, dur: samplesPerStep })
    }

    // Claps on 2 & 4
    events.push({ pos: barStart + 4 * samplesPerStep, type: 'clap', vel: 0.45, dur: samplesPerStep })
    events.push({ pos: barStart + 12 * samplesPerStep, type: 'clap', vel: 0.45, dur: samplesPerStep })

    // Snare on beats 2 & 4 (backbeat — THE missing element)
    events.push({ pos: barStart + 4 * samplesPerStep, type: 'snare', vel: 0.5, dur: samplesPerStep })
    events.push({ pos: barStart + 12 * samplesPerStep, type: 'snare', vel: 0.5, dur: samplesPerStep })

    // Sub-bass: sustained root for the whole bar
    events.push({ pos: barStart, type: 'subbass', midi: rootMidi, vel: 0.25, dur: samplesPerBar })

    // Pad: sustained chord (root, third, fifth) — one per 2 bars
    if (barIdx % 2 === 0) {
      const rootFreq = 440 * Math.pow(2, (rootMidi - 69) / 12)
      const thirdFreq = 440 * Math.pow(2, (rootMidi + 4 - 69) / 12)
      const fifthFreq = 440 * Math.pow(2, (rootMidi + 7 - 69) / 12)
      events.push({ pos: barStart, type: 'pad', vel: 0.12, dur: samplesPerBar * 2, freqs: [rootFreq, thirdFreq, fifthFreq] })
    }

    // Shaker on every 16th — driving pulse
    for (let step = 0; step < 16; step++) {
      const isStrong = step % 4 === 0
      events.push({ pos: barStart + step * samplesPerStep, type: 'shaker', vel: isStrong ? 0.3 : 0.15, dur: samplesPerStep })
    }

    // FX: riser before section changes (last bar of each 4-bar phrase)
    if (barIdx % 4 === 3) {
      events.push({ pos: barStart, type: 'riser', vel: 0.2, dur: samplesPerBar })
      // Impact on the downbeat of the next section
      events.push({ pos: barStart + samplesPerBar, type: 'impact', vel: 0.4, dur: samplesPerStep })
    }

    // Ghost perc — variation per bar
    const percSteps = pattern === 0 ? [7, 15] : pattern === 1 ? [5, 13] : pattern === 2 ? [3, 11] : [7, 11, 15]
    for (const ps of percSteps) {
      events.push({ pos: barStart + ps * samplesPerStep, type: 'perc', vel: 0.2, dur: samplesPerStep })
    }
  }

  events.sort((a, b) => a.pos - b.pos)

  // ── Render ──
  let duckEnv = 1.0
  let activeBass: PsyBass | null = null
  let bassNoteOffPos = 0
  let activeSubBass: PsySubBass | null = null
  let subBassNoteOffPos = 0
  let activePad: PsyPad | null = null
  let padNoteOffPos = 0
  let kickIdx = 0, bassIdx = 0, leadIdx = 0, hatIdx = 0
  const haasDelay = Math.floor(0.015 * SR)
  const haasBuf = new Float32Array(haasDelay)
  let evIdx = 0

  // Per-channel effect states
  let hatHpState = 0, snareHpState = 0, shakerHpState = 0
  let hatPan = 0.5, shakerPan = 0.5
  let leadReverbSend = 0, hatReverbSend = 0, snareReverbSend = 0, padReverbSend = 0, fxReverbSend = 0, fxDelaySend = 0

  for (let i = 0; i < totalSamples; i++) {
    // Trigger events
    while (evIdx < events.length && events[evIdx]!.pos <= i) {
      const ev = events[evIdx]!
      if (ev.type === 'kick') {
        duckEnv = 0.25 // deep sidechain duck
        if (kickSample) kickSample.trigger(ev.vel)
        else { kicks[kickIdx % 4]!.trigger(ev.vel, 48, 0.13); kickIdx++ }
      } else if (ev.type === 'bass' && ev.midi !== undefined) {
        if (activeBass) activeBass.noteOff()
        const freq = 440 * Math.pow(2, (ev.midi - 69) / 12)
        basses[bassIdx % 2]!.trigger(freq, ev.dur / SR, ev.vel)
        activeBass = basses[bassIdx % 2]!
        bassNoteOffPos = i + ev.dur
        bassIdx++
      } else if (ev.type === 'lead' && ev.midi !== undefined) {
        const freq = 440 * Math.pow(2, (ev.midi - 69) / 12)
        leads[leadIdx % 4]!.trigger(freq, ev.dur / SR, ev.vel, { cutoff: 4000, detune: 10, res: 0.5, lfoRate: 0.8, lfoDepth: 0.3 })
        leadIdx++
      } else if (ev.type === 'hat') {
        if (hatSample) hatSample.trigger(ev.vel)
        else { hats[hatIdx % 4]!.trigger(ev.vel, false); hatIdx++ }
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
        leads[(leadIdx + 2) % 4]!.trigger(freq, ev.dur / SR, ev.vel, { cutoff: 2000, detune: 6, res: 0.3, lfoRate: 0.6, lfoDepth: 0.2 })
        leadIdx++
      }
      evIdx++
    }

    // Bass note off
    if (activeBass && i >= bassNoteOffPos) { activeBass.noteOff(); activeBass = null }
    // Sub-bass note off
    if (activeSubBass && i >= subBassNoteOffPos) { activeSubBass.noteOff(); activeSubBass = null }
    // Pad note off
    if (activePad && i >= padNoteOffPos) { activePad.noteOff(); activePad = null }

    // Render voices — each with per-channel effects
    let dL = 0, dR = 0, bL = 0, bR = 0, mL = 0, mR = 0

    // Kick — saturation + no HP (owns 30-90Hz)
    if (kickSample?.active) { const [s] = kickSample.render(); const sat = fastTanh(s * 1.5); dL += sat; dR += sat }
    else for (const v of kicks) if (v.active) { const [s] = v.render(); const sat = fastTanh(s * 1.5); dL += sat; dR += sat }

    // Bass — distortion + sidechain
    if (activeBass?.active) { const [s] = activeBass.render(); const dist = fastTanh(s * 2.0); bL += dist * duckEnv; bR += dist * duckEnv }

    // Lead — Haas stereo + delay/reverb sends
    let leadSig = 0
    for (const v of leads) if (v.active) leadSig += v.render()[0]
    haasBuf[i % haasDelay] = leadSig
    mL += leadSig * 1.0
    mR += (haasBuf[(i + 1) % haasDelay] ?? 0) * 1.0
    // Lead reverb send (accumulated into reverb input below)
    leadReverbSend += leadSig * 0.35

    // Hats — HP filter (gentle, 1000Hz) + alternating pan + reverb send
    if (hatSample?.active) { const [s] = hatSample.render(); const hp = s - hatHpState; hatHpState = hatHpState + 0.98 * (s - hatHpState); dL += hp * 1.0 * hatPan; dR += hp * 1.0 * (1 - hatPan); hatReverbSend += hp * 0.15 }
    else for (const v of hats) if (v.active) { const [s] = v.render(); const hp = s - hatHpState; hatHpState = hatHpState + 0.98 * (s - hatHpState); dL += hp * 0.7 * hatPan; dR += hp * 0.7 * (1 - hatPan) }
    // Alternate hat pan every 2 steps
    if (i % (samplesPerStep * 2) === 0) hatPan = hatPan === 0.7 ? 0.3 : 0.7

    // Clap + Perc
    if (clapSample?.active) { const [s] = clapSample.render(); dL += s * 0.5; dR += s * 0.5 }
    if (percSample?.active) { const [s] = percSample.render(); dL += s * 0.25; dR += s * 0.25 }

    // Snare — EQ (HP 100Hz) + reverb send
    for (const v of snares) if (v.active) { const [s] = v.render(); const hp = s - snareHpState; snareHpState = snareHpState + 0.99 * (s - snareHpState); dL += hp * 0.6; dR += hp * 0.6; snareReverbSend += hp * 0.3 }

    // Sub-bass — HP 30Hz + reduced gain
    if (activeSubBass?.active) { const [s] = activeSubBass.render(); bL += s * 0.6; bR += s * 0.6 }

    // Pad — reverb send + stereo offset
    if (activePad?.active) { const [s] = activePad.render(); mL += s * 0.7; mR += s * 0.6; padReverbSend += s * 0.5 }

    // Shaker — HP 4000Hz + pan
    for (const v of shakers) if (v.active) { const [s] = v.render(); const hp = s - shakerHpState; shakerHpState = shakerHpState + 0.9 * (s - shakerHpState); dL += hp * 0.4 * shakerPan; dR += hp * 0.4 * (1 - shakerPan) }
    if (i % samplesPerStep === 0) shakerPan = shakerPan === 0.6 ? 0.4 : 0.6

    // FX: Riser + Impact — reverb + delay sends
    for (const v of risers) if (v.active) { const [s] = v.render(); mL += s; mR += s * 0.8; fxReverbSend += s * 0.4; fxDelaySend += s * 0.3 }
    for (const v of impacts) if (v.active) { const [s] = v.render(); bL += s * 0.7; bR += s * 0.7 }

    // Buses
    dL = drumL.process(dL, SR); dR = drumR.process(dR, SR)
    bL = bassL.process(bL, SR); bR = bassR.process(bR, SR)
    mL = musicL.process(mL, SR); mR = musicR.process(mR, SR)

    // FX sends — per-channel reverb + delay
    const totalReverbIn = leadReverbSend + hatReverbSend + snareReverbSend + padReverbSend + fxReverbSend + dL * 0.05
    const [rL, rR] = reverb.process(totalReverbIn, SR)
    const [delL, delR] = delay.process(fxDelaySend + mL * 0.15, fxDelaySend + mL * 0.15, SR)

    // Reset per-sample sends
    leadReverbSend = 0; hatReverbSend = 0; snareReverbSend = 0; padReverbSend = 0; fxReverbSend = 0; fxDelaySend = 0

    // Master sum
    let mixL = dL + bL + mL + rL * 0.3 + delL * 0.4
    let mixR = dR + bR + mR + rR * 0.3 + delR * 0.4

    mixL = masterL.process(mixL, SR)
    mixR = masterR.process(mixR, SR)

    samplesL[i] = isFinite(mixL) ? Math.max(-1, Math.min(1, mixL)) : 0
    samplesR[i] = isFinite(mixR) ? Math.max(-1, Math.min(1, mixR)) : 0

    // Sidechain recovery
    duckEnv += (1.0 - duckEnv) * (1 / (0.15 * SR)) // 150ms recovery
  }

  return { samplesL, samplesR, sampleRate: SR, durationSec: totalSamples / SR, bars: renderBars.length, events: events.length }
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
