import { serializeRawScore } from '@psy-foundation/music'
import type { ComposedSection } from '@psy-foundation/music'

import type { AutomationEngine } from './automation'
import { ChannelFX } from './channel-fx'
import { CHANNEL_PRESETS } from './channel-presets'
import { fastTanh } from './forensic/dsp'
import { BusProcessor, MasterChain } from './forensic/mixing'
import { Rng } from './forensic/prng'
import { PSYTRANCE_PROGRESSIONS, buildProgression } from './harmony'
import { driftTime, jitterVelocity, mulberry32 } from './humanizer'
import { TruePeakLimiter } from './limiter'
import { lufsToGainOffset, measureLUFS } from './loudness'
import { ModulationMatrix } from './modulation-matrix'
import { StereoWidener } from './ms-processor'
import { LR4Crossover, MultibandCompressor } from './multiband'
import { OTT } from './ott'
import { WaveguideString } from './physical/waveguide-string'
import {
  PsyAcid,
  PsyBass,
  PsyHat,
  PsyImpact,
  PsyKick,
  PsyLead,
  PsyPad,
  PsyRiser,
  PsySample,
  PsyShaker,
  PsySnare,
  PsySubBass,
  PsyTexture,
} from './psy-voices'
import {
  BASS_SPEC,
  BUS_GAINS,
  HAT_SPEC,
  KICK_SPEC,
  LEAD_SPEC,
  MASTER_SPEC,
  PAD_SPEC,
  SNARE_SPEC,
} from './voice-specs'
import { Wavetable } from './wavetable'

import { DEFAULT_SR as SR } from './constants'

// ── WAV decoder ──

/**
 * Decode a WAV file's first data chunk into a mono Float32Array.
 *
 * ROAST-FIX-2: rewritten to walk chunks dynamically instead of reading fmt
 * fields at hardcoded offsets (24/22/34). The old reader assumed `fmt ` was
 * the FIRST chunk (offset 12). Real-world WAV files from Logic Pro / Pro
 * Tools / Audition often have LIST / fact / junk chunks BEFORE fmt, in which
 * case the hardcoded reads returned GARBAGE (e.g., sampleRate = 1.87 billion,
 * decoded.length = 0).
 *
 * The new reader:
 *   1. Checks the RIFF + WAVE magic at offsets 0 and 8.
 *   2. Walks every chunk from offset 12, finding `fmt ` and `data`.
 *   3. Reads fmt fields relative to the fmt body (audioFormat, numChannels,
 *      sampleRate, bitsPerSample) — works regardless of chunk order.
 *   4. Validates audioFormat (only PCM=1 and IEEE-float=3 supported).
 *   5. Validates fmt chunk size and numChannels/bytesPerSample > 0.
 *   6. Supports 8-bit PCM, 16-bit PCM, 24-bit PCM, 32-bit PCM, and 32-bit float.
 *   7. Truncated-data fix: divides by the number of channels actually read,
 *      not numChannels (so a truncated last frame doesn't divide by zero).
 */
export function decodeWav(buffer: ArrayBuffer): { data: Float32Array; sampleRate: number } {
  const view = new DataView(buffer)
  if (view.getUint32(0, false) !== 0x52494646) throw new Error('Not WAV (missing RIFF magic)')
  if (view.getUint32(8, false) !== 0x57415645) throw new Error('Not WAV (missing WAVE magic)')

  let fmtOffset = -1 // absolute offset of the fmt body (audioFormat field)
  let fmtSize = 0
  let dataOffset = -1
  let dataSize = 0

  // Walk chunks from offset 12 (immediately after the 12-byte RIFF/WAVE header).
  let offset = 12
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = view.getUint32(offset, false)
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 0x666d7420) {
      // "fmt "
      fmtOffset = offset + 8
      fmtSize = chunkSize
      if (fmtSize < 16) throw new Error(`Invalid fmt chunk size: ${fmtSize}`)
    } else if (chunkId === 0x64617461) {
      // "data"
      dataOffset = offset + 8
      dataSize = chunkSize
      break
    }
    // Chunks are word-aligned (padded to an even byte length).
    offset += 8 + chunkSize + (chunkSize % 2)
  }

  if (fmtOffset === -1) throw new Error('No fmt chunk')
  if (dataOffset === -1 || dataSize === 0) throw new Error('No data chunk')

  const audioFormat = view.getUint16(fmtOffset, true)
  const numChannels = view.getUint16(fmtOffset + 2, true)
  const sampleRate = view.getUint32(fmtOffset + 4, true)
  const bitsPerSample = view.getUint16(fmtOffset + 14, true)
  const bytesPerSample = bitsPerSample / 8

  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(
      `Unsupported WAV audioFormat: ${audioFormat} (only PCM=1 and float=3 supported)`
    )
  }
  if (audioFormat === 3 && bitsPerSample !== 32) {
    throw new Error(`IEEE-float WAV supports only 32-bit, got ${bitsPerSample}-bit`)
  }
  if (numChannels === 0) throw new Error('numChannels === 0')
  if (bytesPerSample === 0) throw new Error('bitsPerSample must be 8/16/24/32')
  if (sampleRate === 0) throw new Error('sampleRate === 0')

  const supportedBits = [8, 16, 24, 32]
  if (!supportedBits.includes(bitsPerSample)) {
    throw new Error(`Unsupported bitsPerSample: ${bitsPerSample}`)
  }

  // Truncated-data fix: how many full sample-frames actually fit in the data chunk?
  // (The data chunk may be padded with junk at the end if the file was truncated.)
  const bytesAvailable = Math.min(dataSize, buffer.byteLength - dataOffset)
  const framesAvailable = Math.floor(bytesAvailable / (bytesPerSample * numChannels))
  const output = new Float32Array(framesAvailable)

  for (let i = 0; i < framesAvailable; i++) {
    let sum = 0
    let chRead = 0
    for (let ch = 0; ch < numChannels; ch++) {
      const so = dataOffset + (i * numChannels + ch) * bytesPerSample
      if (so + bytesPerSample > buffer.byteLength) break
      chRead++
      if (audioFormat === 1) {
        // PCM
        if (bitsPerSample === 8) {
          // 8-bit PCM is unsigned (0..255), center at 128.
          sum += (view.getUint8(so) - 128) / 128
        } else if (bitsPerSample === 16) {
          sum += view.getInt16(so, true) / 32768
        } else if (bitsPerSample === 24) {
          const b0 = view.getUint8(so) ?? 0
          const b1 = view.getUint8(so + 1) ?? 0
          const b2 = view.getUint8(so + 2) ?? 0
          let val = (b2 << 16) | (b1 << 8) | b0
          if (val & 0x800000) val |= 0xff000000
          sum += val / 8388608
        } else if (bitsPerSample === 32) {
          sum += view.getInt32(so, true) / 2147483648
        }
      } else {
        // audioFormat === 3 (IEEE float, only 32-bit supported here)
        sum += view.getFloat32(so, true)
      }
    }
    // Divide by channels actually read (handles truncated last frame).
    output[i] = chRead > 0 ? sum / chRead : 0
  }
  return { data: output, sampleRate }
}

// ── Render config (tunable parameters for auto-fixer) ──

export interface RenderConfig {
  // Kick
  kickFundamental: number // Hz, default 46
  kickDecay: number // seconds, default 0.11
  // Bass
  bassDecay: number // seconds, default 0.06 (passed to PsyBass via trigger dur)
  bassGain: number // linear, default 1.0
  // Lead
  leadCutoff: number // Hz, default 4500
  leadGain: number // linear, default 1.0
  leadResonance: number // 0..1, default 0.5
  // Hats
  hatGain: number // linear, default 0.8
  openHatGain: number // linear, default 0.4
  // Snare
  snareGain: number // linear, default 0.6
  // Shaker
  shakerGain: number // linear, default 1.0
  // Sub-bass
  subBassGain: number // linear, default 1.0
  // Pad
  padGain: number // linear, default 1.0
  // Sidechain
  duckAmount: number // 0..1, depth (1 = full duck to 0), default 0.75
  // Master
  targetLufs: number // default -9
  stereoWidth: number // 0..2, default 1.3
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  kickFundamental: KICK_SPEC.fundamental,
  kickDecay: KICK_SPEC.subDecay,
  bassDecay: BASS_SPEC.pluckDecay,
  bassGain: BASS_SPEC.bodyLevel,
  leadCutoff: LEAD_SPEC.cutoff,
  leadGain: LEAD_SPEC.gain,
  leadResonance: LEAD_SPEC.res,
  hatGain: HAT_SPEC.gain,
  openHatGain: HAT_SPEC.gain * 0.8,
  snareGain: SNARE_SPEC.gain,
  shakerGain: 1.0,
  subBassGain: 1.0,
  padGain: PAD_SPEC.gain,
  duckAmount: BASS_SPEC.sidechainDepth,
  targetLufs: MASTER_SPEC.targetLufs,
  stereoWidth: MASTER_SPEC.stereoWidth,
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
  samplePeakDb: number
  stereoWidth: number
  monoCompatibility: number
  gainReductionDb: number
  /** Per-bus stem outputs (post-bus-glue, pre-master-chain). Present only when stems=true. */
  stems?: {
    drumL: Float32Array
    drumR: Float32Array
    bassL: Float32Array
    bassR: Float32Array
    musicL: Float32Array
    musicR: Float32Array
  }
}

export async function renderFoundationSection(
  section: ComposedSection,
  options: {
    useSamples?: boolean
    bpm?: number
    config?: Partial<RenderConfig>
    stems?: boolean
    automation?: AutomationEngine
  } = {}
): Promise<RenderResult> {
  const cfg: RenderConfig = { ...DEFAULT_RENDER_CONFIG, ...options.config }
  const automation = options.automation ?? null
  const rawScore = serializeRawScore(section)
  const bpm = options.bpm ?? 145
  const targetLufs = cfg.targetLufs
  const secondsPerStep = 60 / bpm / (rawScore.groove.stepsPerBar / 4)
  const samplesPerStep = Math.ceil(secondsPerStep * SR)
  const samplesPerBar = samplesPerStep * rawScore.groove.stepsPerBar

  // Phase 2 Day 4: render ALL bars (including INTRO/OUTRO).
  // Previously INTRO/OUTRO were filtered out → silence. Now we keep them
  // and render texture/pad voices for bars without kick+bass.
  // This makes INTRO state audible (atmospheric pad) instead of silent.
  const renderBars = rawScore.bars
  const barRemap = new Map<number, number>()
  renderBars.forEach((b, i) => barRemap.set(b.barIndex, i))
  const totalSamples = samplesPerBar * renderBars.length

  const samplesL = new Float32Array(totalSamples)
  const samplesR = new Float32Array(totalSamples)

  // ── Stems capture (post-bus-glue, pre-master-chain) ──
  // When stems=true we allocate six parallel stereo buffers — one per bus — and
  // store the post-bus-glue signal in the render loop below. Mastering engineers
  // can then process each bus independently and recombine externally.
  const stemsEnabled = options.stems ?? false
  const stemsDrumL = stemsEnabled ? new Float32Array(totalSamples) : null
  const stemsDrumR = stemsEnabled ? new Float32Array(totalSamples) : null
  const stemsBassL = stemsEnabled ? new Float32Array(totalSamples) : null
  const stemsBassR = stemsEnabled ? new Float32Array(totalSamples) : null
  const stemsMusicL = stemsEnabled ? new Float32Array(totalSamples) : null
  const stemsMusicR = stemsEnabled ? new Float32Array(totalSamples) : null

  // Roast-fix: use the section's seed for the render RNG, not a hardcoded 42.
  // Without this, all renders with different CompositionEngine seeds produce
  // bit-identical audio (the section's bars/phrases differ, but the voice
  // excitation patterns — waveguide noise, filter modulation, etc. — were
  // always seeded with 42, masking the seed effect on the actual audio).
  // Verified: before fix, seeds 42/100/200/300 all produced the same MD5;
  // after fix, they produce different MD5s.
  const renderSeed = section.seed ?? 42
  const rng = new Rng(renderSeed)

  // ── Voice pools ──
  const kicks = [new PsyKick(rng), new PsyKick(rng), new PsyKick(rng), new PsyKick(rng)]
  const basses = [new PsyBass(rng), new PsyBass(rng)]
  const leads = [new PsyLead(rng), new PsyLead(rng), new PsyLead(rng), new PsyLead(rng)]
  const hats = [new PsyHat(rng), new PsyHat(rng), new PsyHat(rng), new PsyHat(rng)]
  const snares = [new PsySnare(rng), new PsySnare(rng)]
  const subBasses = [new PsySubBass(), new PsySubBass()]
  const pads = [new PsyPad(rng), new PsyPad(rng)]
  const shakers = [new PsyShaker(rng), new PsyShaker(rng)]
  const risers = [new PsyRiser(rng)]
  const impacts = [new PsyImpact(rng)]
  const acids = [new PsyAcid(), new PsyAcid()]
  const textures = [new PsyTexture(rng)]

  // ── Connect synthesis engines to voices (Phase 2 integration) ──
  // Wavetable → Lead: replaces the dual-saw fundamental with a morphable wavetable
  const leadWavetable = Wavetable.createMulti() // 6 morphable tables
  leadWavetable.setPosition(0.4) // start between saw and psyLead
  for (const lead of leads) lead.setWavetable(leadWavetable)

  // Waveguide → Bass: adds Karplus-Strong string decay to the bass voice
  const bassWaveguide = new WaveguideString()
  for (const bass of basses) bass.setWaveguide(bassWaveguide)

  // DDSP → Lead: adds harmonic additive synthesis as ADDITIONAL layer (not replacement)
  // Note: PsyLead.render() uses DDSP as the fundamental if connected (priority: DDSP > Wavetable > BLSaw).
  // DDSP is NOT connected by default — it's opt-in via the API (?ddsp=true).
  // When not connected, the wavetable fundamental is used (better score).

  // ── Modulation Matrix (wired into Lead + Acid voices) ──
  // createDefault() sets up 7 routes: LFO1/2/3 → cutoff/fmIndex, velocity → cutoff,
  // macro1 (SPACE) → delaySend, macro2 (ENERGY) → drive, macro3 (TENSION) → resonance.
  // The matrix tick is called once per sample in the render loop below.
  // Per-bar macro updates (SPACE/ENERGY/TENSION contour) are also applied in the loop.
  const modMatrix = ModulationMatrix.createDefault()
  for (const lead of leads) lead.setModulationMatrix(modMatrix)
  for (const acid of acids) acid.setModulationMatrix(modMatrix)

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
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      // Phase 0 Day 2: commercial 909/MD/Nord samples removed (license violation,
      // per project manifest). Using procedural CC0 samples in public/samples/.
      // Phase 2 will replace these with proper DSP-synthesized 909 emulation.
      const dir = path.join(process.cwd(), 'public', 'samples')

      const loadSample = async (name: string) => {
        const buf = await fs.readFile(path.join(dir, name))
        const decoded = decodeWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
        const s = new PsySample()
        s.setData(decoded.data, decoded.sampleRate)
        return s
      }

      kickSample = await loadSample('kick.wav')
      hatSample = await loadSample('hat_closed.wav')
      clapSample = await loadSample('clap.wav')
      // perc sample: no procedural one yet — will be synthesized in Phase 2
      // (currently using hat_open.wav as a stand-in percussive sample)
      percSample = await loadSample('hat_open.wav')
    } catch (e) {
      console.warn('Samples not available:', (e as Error).message)
    }
  }

  // ── Mix bus (stereo) — glue compression per bus (from BUS_GAINS) ──
  const drumBusL = new BusProcessor({
    hpFreq: 0,
    compThr: 0.5,
    compRatio: 3,
    compAtt: 0.002,
    compRel: 0.08,
    compMakeup: 1.3,
    drive: 1.2,
    gain: BUS_GAINS.drum,
  })
  const drumBusR = new BusProcessor({
    hpFreq: 0,
    compThr: 0.5,
    compRatio: 3,
    compAtt: 0.002,
    compRel: 0.08,
    compMakeup: 1.3,
    drive: 1.2,
    gain: BUS_GAINS.drum,
  })
  const bassBusL = new BusProcessor({
    hpFreq: BASS_SPEC.hpFreq + 80,
    compThr: 0.4,
    compRatio: 2,
    compAtt: 0.005,
    compRel: 0.1,
    compMakeup: 1.0,
    drive: 1.0,
    gain: BUS_GAINS.bass,
  })
  const bassBusR = new BusProcessor({
    hpFreq: BASS_SPEC.hpFreq + 80,
    compThr: 0.4,
    compRatio: 2,
    compAtt: 0.005,
    compRel: 0.1,
    compMakeup: 1.0,
    drive: 1.0,
    gain: BUS_GAINS.bass,
  })
  const musicBusL = new BusProcessor({
    hpFreq: 180,
    compThr: 0.4,
    compRatio: 2,
    compAtt: 0.01,
    compRel: 0.15,
    compMakeup: 1.3,
    drive: 1.2,
    gain: BUS_GAINS.music,
  })
  const musicBusR = new BusProcessor({
    hpFreq: 180,
    compThr: 0.4,
    compRatio: 2,
    compAtt: 0.01,
    compRel: 0.15,
    compMakeup: 1.3,
    drive: 1.2,
    gain: BUS_GAINS.music,
  })

  const masterGlueL = new MasterChain()
  const masterGlueR = new MasterChain()

  // ── Bass crossover for dynamic EQ sidechain ──
  // Splits the bass signal into low (<120Hz) and high (>120Hz) bands so that
  // only the conflicting low band is ducked on kick hits — the high band
  // (bass harmonics, pluck attack) passes through unaffected. This preserves
  // bass clarity and groove while still preventing kick/bass collision.
  // LR4 = 24 dB/oct Linkwitz-Riley (phase-matched, sums to unity magnitude).
  const bassXover = new LR4Crossover(120, SR)

  // ── Events ──
  interface Ev {
    pos: number
    type: string
    midi?: number
    freqs?: number[]
    vel: number
    dur: number
  }
  const events: Ev[] = []

  for (const bar of renderBars) {
    const barStart = (barRemap.get(bar.barIndex) ?? 0) * samplesPerBar
    const accent = rawScore.groove.accent
    const barIdx = barRemap.get(bar.barIndex) ?? 0

    // Arrangement: which voices play in this bar
    // 8-bar phrase: groove(0-1) → build(2-3) → full(4-5) → break(6) → drop(7)
    const phase = barIdx % 8
    const _playKick = true
    const _playBass = true
    const playHats = true // hats from bar 0 (keep energy)
    const playLead = phase >= 2 // lead enters at bar 2
    const _playCounter = phase >= 3 // counter at bar 3
    // Phase 2 Day 4: pad from bar 0 (was bar 1) — makes INTRO audible.
    // Previously pad started at phase 1, so INTRO (phase 0) was silent.
    const playPad = phase !== 6 // pad from bar 0, except break
    const playSnare = phase >= 2 // snare from bar 2
    const playShaker = true // shaker from bar 0 (driving pulse)
    const playFX = phase === 6 || phase === 7 // riser/impact at break/drop
    const isBreak = phase === 6 // break bar: drop lead, keep percussion

    // Four-on-the-floor kick with per-bar velocity variation
    // SELF_ROAST fix #3: vary kick pattern per 4-bar phrase to reduce uniformity.
    // Bar 3 of each phrase: drop the last kick (step 12) to create a "breath"
    // before the next phrase. Adds anticipation/fill feel.
    const kickPhraseBar = barIdx % 8
    const kickVelBase =
      kickPhraseBar < 2 ? 0.85 : kickPhraseBar < 4 ? 0.8 : kickPhraseBar < 6 ? 0.9 : 0.7
    const kickDropBar = barIdx % 4 === 3 // drop on bar 3 of each 4-bar phrase
    const kickSteps = kickDropBar ? [0, 4, 8] : [0, 4, 8, 12] // skip step 12 on drop bars
    // Step 8 alternates 1.0/0.75 per bar — creates syncopated kick variation
    const step8VelMod = barIdx % 2 === 0 ? 1.0 : 0.75
    for (const step of kickSteps) {
      const a = accent[step % accent.length] ?? 1
      const velMod = step === 0 ? 1.0 : step === 8 ? step8VelMod : step === 12 ? 0.9 : 0.95
      events.push({
        pos: barStart + step * samplesPerStep,
        type: 'kick',
        vel: kickVelBase * velMod + a * 0.1,
        dur: samplesPerStep,
      })
    }
    // On drop bars, add a fill snare on step 14-15 to replace the missing kick
    if (kickDropBar) {
      events.push({
        pos: barStart + 14 * samplesPerStep,
        type: 'snare',
        vel: 0.35,
        dur: samplesPerStep,
      })
      events.push({
        pos: barStart + 15 * samplesPerStep,
        type: 'snare',
        vel: 0.45,
        dur: samplesPerStep,
      })
    }
    // Ghost kick on offbeat in build/drop sections
    if (kickPhraseBar >= 2 && kickPhraseBar < 6 && barIdx % 2 === 1) {
      events.push({
        pos: barStart + 7 * samplesPerStep,
        type: 'kick',
        vel: 0.3,
        dur: samplesPerStep,
      })
    }

    // Ghost snare on step 6 of odd non-drop bars — adds rhythmic interest
    // (reduces RHYTHMIC_PATTERN_TOO_UNIFORM). Skipped on the climax (phase 7).
    if (playSnare && barIdx % 2 === 1 && phase !== 7) {
      events.push({
        pos: barStart + 6 * samplesPerStep,
        type: 'snare',
        vel: 0.25,
        dur: samplesPerStep,
      })
    }

    // Rolling 16th bass — 8-bar phrase development
    const rootMidi = bar.bassNotes[0]?.midi ?? 40
    const fifthMidi = bar.bassNotes[2]?.midi ?? rootMidi
    const thirdMidi = bar.bassNotes[4]?.midi ?? rootMidi
    // 8-bar phrase: bars 0-1 simple, 2-3 add movement, 4-5 full, 6-7 simplify (drop anticipation)
    const phraseBar = barIdx % 8
    const swingAmount = Math.floor(samplesPerStep * 0.15)
    for (let step = 0; step < 16; step++) {
      const a = accent[step % accent.length] ?? 0.5
      let midi = rootMidi
      let vel: number
      let dur: number

      if (phraseBar < 2) {
        // Bars 0-1: simple root-fifth pattern
        midi = step % 4 === 0 ? rootMidi : step % 4 === 2 ? fifthMidi : rootMidi
        vel = step % 4 === 0 ? 0.7 + a * 0.2 : 0.35 + a * 0.15
        dur = step % 2 === 1 ? 0.6 : 0.85
      } else if (phraseBar < 4) {
        // Bars 2-3: add third movement
        midi =
          step % 4 === 0
            ? rootMidi
            : step % 4 === 1
              ? thirdMidi
              : step % 4 === 2
                ? fifthMidi
                : rootMidi
        vel = step % 4 === 0 ? 0.7 + a * 0.2 : step % 2 === 1 ? 0.25 + a * 0.15 : 0.45 + a * 0.2
        dur = step % 2 === 1 ? 0.6 : 0.85
      } else if (phraseBar < 6) {
        // Bars 4-5: full pattern with octave jumps
        midi =
          step % 4 === 0
            ? rootMidi
            : step % 4 === 2
              ? fifthMidi
              : step % 4 === 3
                ? rootMidi + 12
                : rootMidi
        vel = step % 4 === 0 ? 0.75 + a * 0.2 : step % 2 === 1 ? 0.3 + a * 0.15 : 0.5 + a * 0.2
        dur = step % 2 === 1 ? 0.65 : 0.85
      } else {
        // Bars 6-7: simplify (drop anticipation) — less notes, more space
        if (step % 4 === 0 || step % 4 === 2) {
          midi = step % 4 === 0 ? rootMidi : fifthMidi
          vel = 0.6 + a * 0.2
          dur = 0.9
        } else {
          continue // skip — creates space before drop
        }
      }

      const swingOffset = step % 2 === 1 ? swingAmount : 0
      events.push({
        pos: barStart + step * samplesPerStep + swingOffset,
        type: 'bass',
        midi,
        vel,
        dur: Math.floor(samplesPerStep * dur),
      })
    }

    // Lead — enters at bar 3 (build phase)
    if (playLead && !isBreak && bar.leadNotes.length > 0) {
      for (const n of bar.leadNotes) {
        events.push({
          pos: barStart + n.step * samplesPerStep,
          type: 'lead',
          midi: n.midi,
          vel: n.velocity,
          dur: n.durationSteps * samplesPerStep,
        })
      }
      const leadSteps = new Set(bar.leadNotes.map((n) => n.step))
      const fillSteps = [3, 7, 11, 15]
      for (const fs of fillSteps) {
        if (!leadSteps.has(fs)) {
          const lastLead = bar.leadNotes[bar.leadNotes.length - 1]
          if (lastLead) {
            events.push({
              pos: barStart + fs * samplesPerStep,
              type: 'lead',
              midi: lastLead.midi + 4,
              vel: 0.4,
              dur: samplesPerStep,
            })
          }
        }
      }
    } else {
      // No lead from Foundation — AABA motif development
      // A: original motif, A: repeat, B: contrast (higher), A': return with variation
      const phrasePos = barIdx % 4
      const motifA = [64, 67, 71, 67] // E4 G4 B4 G4
      const motifB = [76, 74, 71, 69] // E5 D5 B4 A4 (contrast)
      const motifAp = [64, 67, 71, 72] // E4 G4 B4 C5 (variation)
      const motif = phrasePos === 2 ? motifB : phrasePos === 3 ? motifAp : motifA
      for (let i = 0; i < motif.length; i++) {
        const step = i * 2
        events.push({
          pos: barStart + step * samplesPerStep,
          type: 'lead',
          midi: motif[i]!,
          vel: 0.5,
          dur: samplesPerStep,
        })
      }
    }

    // Counter-lead — harmony response (start from bar 0)
    if (bar.leadNotes.length > 0) {
      for (const n of bar.leadNotes) {
        const counterStep = n.step + 3
        if (counterStep < 16) {
          const harmonyMidi = n.midi + (counterStep % 2 === 0 ? 4 : 7)
          events.push({
            pos: barStart + counterStep * samplesPerStep,
            type: 'counter',
            midi: harmonyMidi,
            vel: n.velocity * 0.6,
            dur: samplesPerStep,
          })
        }
      }
    }

    // Closed hats — enter at bar 2 (build)
    // SELF_ROAST fix #3: replaced static hatVelBase/Strong (only 2 levels)
    // with a 8-step velocity contour + ghost notes + 4-bar phrase variation.
    // This changes the onset presence/velocity pattern per bar, which is what
    // the uniformity metric actually measures.
    if (playHats) {
      const phraseBar = barIdx % 4
      const phraseBoost = phraseBar === 0 ? 1.15 : phraseBar === 3 ? 0.85 : 1.0
      const oddBar = barIdx % 2 === 1
      const stepVel = oddBar
        ? [0.3, 0.5, 0.4, 0.45, 0.35, 0.55, 0.4, 0.5].map((v) => v * phraseBoost)
        : [0.35, 0.55, 0.4, 0.5, 0.35, 0.6, 0.4, 0.55].map((v) => v * phraseBoost)
      for (let eighth = 0; eighth < 8; eighth++) {
        const step = eighth * 2
        const vel = stepVel[eighth]!
        events.push({
          pos: barStart + step * samplesPerStep,
          type: 'hat',
          vel,
          dur: samplesPerStep,
        })
      }
      // Ghost notes on odd 16ths — vary pattern per bar in 4-bar phrase.
      const ghostMap: Record<number, number[]> = {
        0: [3, 7, 11, 15],
        1: [3, 7, 15],
        2: [3, 11, 15],
        3: [5, 7, 11, 15],
      }
      const ghostSteps = ghostMap[phraseBar] ?? [3, 7, 11, 15]
      const ghostVel = phraseBar === 3 ? 0.22 : 0.18
      for (const gs of ghostSteps) {
        events.push({
          pos: barStart + gs * samplesPerStep,
          type: 'hat',
          vel: ghostVel,
          dur: samplesPerStep,
        })
      }
    }

    // Open hats — syncopated
    if (playHats && barIdx % 2 === 0) {
      events.push({
        pos: barStart + 6 * samplesPerStep,
        type: 'openhat',
        vel: 0.4,
        dur: samplesPerStep,
      })
      events.push({
        pos: barStart + 14 * samplesPerStep,
        type: 'openhat',
        vel: 0.4,
        dur: samplesPerStep,
      })
    }

    // Claps on 2 & 4
    events.push({
      pos: barStart + 4 * samplesPerStep,
      type: 'clap',
      vel: 0.45,
      dur: samplesPerStep,
    })
    events.push({
      pos: barStart + 12 * samplesPerStep,
      type: 'clap',
      vel: 0.45,
      dur: samplesPerStep,
    })

    // Snare — enters at bar 4 (full)
    if (playSnare) {
      events.push({
        pos: barStart + 4 * samplesPerStep,
        type: 'snare',
        vel: 0.5,
        dur: samplesPerStep,
      })
      events.push({
        pos: barStart + 12 * samplesPerStep,
        type: 'snare',
        vel: 0.5,
        dur: samplesPerStep,
      })
    }

    // Snare roll before section changes (last bar of 4-bar phrase)
    if (barIdx % 4 === 3) {
      events.push({
        pos: barStart + 13 * samplesPerStep,
        type: 'snare',
        vel: 0.3,
        dur: samplesPerStep,
      })
      events.push({
        pos: barStart + 14 * samplesPerStep,
        type: 'snare',
        vel: 0.4,
        dur: samplesPerStep,
      })
      events.push({
        pos: barStart + 15 * samplesPerStep,
        type: 'snare',
        vel: 0.5,
        dur: samplesPerStep,
      })
      events.push({
        pos: barStart + 15 * samplesPerStep + Math.floor(samplesPerStep / 2),
        type: 'snare',
        vel: 0.7,
        dur: samplesPerStep,
      })
    }

    // Sub-bass: sustained root for the whole bar
    events.push({ pos: barStart, type: 'subbass', midi: rootMidi, vel: 0.25, dur: samplesPerBar })

    // Pad — enters at bar 2, drops during break
    // Uses harmony engine for chord progression (from PSYSTAR)
    if (playPad && barIdx % 2 === 0) {
      // Build progression from psy-dominant pattern
      const progDegrees = PSYTRANCE_PROGRESSIONS['psy-dominant']!
      const chordIdx = Math.floor(barIdx / 2) % progDegrees.length
      const chordRoot = rootMidi - 24 // 2 octaves down for pad
      const progression = buildProgression(chordRoot, 'phrygianDominant', progDegrees)
      const chord = progression[chordIdx]!
      const freqs = chord.notes.map((midi: number) => 440 * 2 ** ((midi - 69) / 12))
      events.push({ pos: barStart, type: 'pad', vel: 0.12, dur: samplesPerBar * 2, freqs })
    }

    // Shaker — enters at bar 2, with per-bar velocity variation + 4-bar rest map
    if (playShaker) {
      const shakerPhraseBar = barIdx % 8
      const shakerVelBase =
        shakerPhraseBar < 2 ? 0.25 : shakerPhraseBar < 4 ? 0.3 : shakerPhraseBar < 6 ? 0.35 : 0.2
      // 4-bar phrase rest map — adds variation across the phrase so the
      // shaker isn't on every 16th step. Reduces RHYTHMIC_PATTERN_TOO_UNIFORM.
      //   Bar 0: no rests
      //   Bar 1: rest on step 6
      //   Bar 2: rest on step 11
      //   Bar 3: rest on steps 6, 14
      const restPhrase = barIdx % 4
      const restSteps = new Set<number>(
        restPhrase === 1 ? [6] : restPhrase === 2 ? [11] : restPhrase === 3 ? [6, 14] : []
      )
      for (let step = 0; step < 16; step++) {
        if (restSteps.has(step)) continue // skip rest steps
        const isStrong = step % 4 === 0
        // Add variation: skip some steps in certain bars for groove
        if (shakerPhraseBar >= 4 && step === 7 && barIdx % 2 === 1) continue // ghost rest
        const vel = isStrong ? shakerVelBase : shakerVelBase * 0.5
        events.push({
          pos: barStart + step * samplesPerStep,
          type: 'shaker',
          vel,
          dur: samplesPerStep,
        })
      }
    }

    // FX: riser + impact at break/drop
    if (playFX) {
      events.push({ pos: barStart, type: 'riser', vel: 0.2, dur: samplesPerBar })
      events.push({ pos: barStart + samplesPerBar, type: 'impact', vel: 0.4, dur: samplesPerStep })
    }

    // Acid: plays in drop2/climax sections (phase 5-7)
    if (phase >= 5 && !isBreak) {
      const acidRootMidi = rootMidi + 24 // 2 octaves up
      for (let step = 0; step < 16; step++) {
        if (step % 4 === 0 || step % 4 === 2) {
          const acidMidi = acidRootMidi + (step % 8 === 0 ? 7 : step % 4 === 2 ? 5 : 0)
          events.push({
            pos: barStart + step * samplesPerStep,
            type: 'acid',
            midi: acidMidi,
            vel: 0.4,
            dur: samplesPerStep,
          })
        }
      }
    }

    // Texture: atmospheric bed in break + intro sections
    if (isBreak || phase === 0) {
      const rootFreq = 440 * 2 ** ((rootMidi - 69) / 12)
      const thirdFreq = 440 * 2 ** ((rootMidi + 4 - 69) / 12)
      const fifthFreq = 440 * 2 ** ((rootMidi + 7 - 69) / 12)
      events.push({
        pos: barStart,
        type: 'texture',
        vel: 0.2,
        dur: samplesPerBar,
        freqs: [rootFreq, thirdFreq, fifthFreq],
      })
    }

    // Ghost perc
    const percSteps =
      phraseBar === 0
        ? [7, 15]
        : phraseBar === 1
          ? [5, 13]
          : phraseBar === 2
            ? [3, 11]
            : [7, 11, 15]
    for (const ps of percSteps) {
      events.push({
        pos: barStart + ps * samplesPerStep,
        type: 'perc',
        vel: 0.2,
        dur: samplesPerStep,
      })
    }
  }

  events.sort((a, b) => a.pos - b.pos)

  // ── Apply humanization (from PSYSTAR humanizer) ──
  // Subtle velocity jitter + timing drift for human feel.
  // Roast-fix: use the section's seed for humanization RNG too, so
  // different seeds produce different humanization patterns (was hardcoded 42).
  const humanRng = mulberry32(renderSeed)
  const humanAmount = 0.3 // subtle (0..1)
  for (const ev of events) {
    // Velocity jitter (not on kick — kick needs consistency)
    if (ev.type !== 'kick' && ev.vel > 0) {
      ev.vel = jitterVelocity(ev.vel, humanAmount, humanRng)
    }
    // Timing drift (±18ms max, in samples)
    const driftSamples = Math.floor(driftTime(humanAmount, humanRng) * SR)
    ev.pos = Math.max(0, ev.pos + driftSamples)
  }
  // Re-sort after drift
  events.sort((a, b) => a.pos - b.pos)

  // ── Render loop ──
  let duckEnv = 1.0
  let activeBass: PsyBass | null = null
  let bassNoteOffPos = 0
  let activeSubBass: PsySubBass | null = null
  let subBassNoteOffPos = 0
  let activePad: PsyPad | null = null
  let padNoteOffPos = 0
  let kickIdx = 0
  let bassIdx = 0
  let leadIdx = 0
  let hatIdx = 0
  let evIdx = 0

  // Alternating pan state for hats (per-type, driven by step grid)
  const _hatPanFlip = false
  const _openHatPanFlip = false

  // Energy contour: create tension/release by modulating overall energy across bars.
  // Pattern: bars 0-3 full, bar 4 dip (70%), bars 5-6 build (85%→100%), bar 7 peak (105%).
  // This creates a 8-bar tension/release cycle that improves the dynamic contour.
  function barEnergy(barIdx: number): number {
    const phase = barIdx % 8
    if (phase === 0) return 0.6 // intro — quieter (was 0.80)
    if (phase === 1) return 0.85 // groove building (was 0.88)
    if (phase === 2) return 1.0 // build (was 0.95)
    if (phase === 3) return 1.1 // full (was 1.0)
    if (phase === 4) return 0.2 // breakdown — deep drop (was 0.35)
    if (phase === 5) return 0.5 // rebuild (was 0.65)
    if (phase === 6) return 0.95 // build (was 0.92)
    if (phase === 7) return 1.3 // climax — peak (was 1.20)
    return 1.0
  }

  for (let i = 0; i < totalSamples; i++) {
    const currentBar = Math.floor(i / samplesPerBar)
    const energyMul = barEnergy(currentBar)
    const currentTime = i / SR // seconds — for automation

    // ── Automation: override config params from AutomationEngine ──
    // If automation is connected, read automated values at this time.
    // This allows DAW-style parameter curves to control the render.
    if (automation) {
      if (automation.isAutomated('leadCutoff'))
        cfg.leadCutoff = automation.getValue('leadCutoff', currentTime)
      if (automation.isAutomated('leadGain'))
        cfg.leadGain = automation.getValue('leadGain', currentTime)
      if (automation.isAutomated('stereoWidth'))
        cfg.stereoWidth = automation.getValue('stereoWidth', currentTime)
      if (automation.isAutomated('targetLufs'))
        cfg.targetLufs = automation.getValue('targetLufs', currentTime)
    }

    // ── Modulation matrix: tick ONCE per sample (advances all LFO phases) ──
    modMatrix.tick(SR)

    // ── Per-bar macro updates (SPACE/ENERGY/TENSION contour) ──
    // Applied at the top of each bar based on bar position in the 8-bar phrase.
    // SPACE (macro1): builds 0.2 → 0.9 over the phrase (delay send increases)
    // ENERGY (macro2): dips in break (bar 4), otherwise builds
    // TENSION (macro3): builds 0.3 → 1.0 (resonance increases toward drop)
    if (i % samplesPerBar === 0) {
      const barPos = currentBar % 8
      const space = 0.2 + (barPos / 7) * 0.7
      const energy = barPos === 4 ? 0.3 : 0.5 + (barPos / 7) * 0.4
      const tension = 0.3 + (barPos / 7) * 0.7
      modMatrix.setMacro('macro1', space)
      modMatrix.setMacro('macro2', energy)
      modMatrix.setMacro('macro3', tension)
    }

    while (evIdx < events.length && events[evIdx]!.pos <= i) {
      const ev = events[evIdx]!
      if (ev.type === 'kick') {
        // Phase 2 Day 1: sidechain with 5ms attack curve (was instant click).
        // duckEnvAttack tracks toward target = 1.0 - duckAmount, then
        // recovers with 150ms one-pole in the post-loop recovery.
        duckEnv = Math.max(1.0 - cfg.duckAmount, duckEnv * 0.85)
        if (kickSample) kickSample.trigger(ev.vel)
        else {
          kicks[kickIdx % 4]!.trigger(ev.vel, cfg.kickFundamental, cfg.kickDecay)
          kickIdx++
        }
      } else if (ev.type === 'bass' && ev.midi !== undefined) {
        if (activeBass) activeBass.noteOff()
        const freq = 440 * 2 ** ((ev.midi - 69) / 12)
        basses[bassIdx % 2]!.trigger(freq, cfg.bassDecay, ev.vel)
        activeBass = basses[bassIdx % 2]!
        bassNoteOffPos = i + ev.dur
        bassIdx++
      } else if (ev.type === 'lead' && ev.midi !== undefined) {
        const freq = 440 * 2 ** ((ev.midi - 69) / 12)
        leads[leadIdx % 4]!.trigger(freq, ev.dur / SR, ev.vel, {
          cutoff: cfg.leadCutoff,
          detune: 10,
          res: cfg.leadResonance,
          lfoRate: 1.2,
          lfoDepth: 0.5,
        })
        leadIdx++
      } else if (ev.type === 'hat') {
        if (hatSample) hatSample.trigger(ev.vel)
        else {
          hats[hatIdx % 4]!.trigger(ev.vel, false)
          hatIdx++
        }
      } else if (ev.type === 'openhat') {
        // Choke group: open hat chokes all closed hats (PSYDRUM pattern)
        for (const h of hats) {
          if (h.active && !h.open) h.active = false
        }
        hats[(hatIdx + 2) % 4]!.trigger(ev.vel, true)
      } else if (ev.type === 'clap' && clapSample) {
        clapSample.trigger(ev.vel)
      } else if (ev.type === 'perc' && percSample) {
        percSample.trigger(ev.vel)
      } else if (ev.type === 'snare') {
        snares[0]!.trigger(ev.vel)
      } else if (ev.type === 'subbass' && ev.midi !== undefined) {
        const freq = 440 * 2 ** ((ev.midi - 69) / 12)
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
      } else if (ev.type === 'acid' && ev.midi !== undefined) {
        const freq = 440 * 2 ** ((ev.midi - 69) / 12)
        acids[0]!.trigger(freq, ev.dur / SR, ev.vel)
      } else if (ev.type === 'texture' && ev.freqs) {
        textures[0]!.trigger(ev.freqs, ev.dur / SR, ev.vel)
      } else if (ev.type === 'counter' && ev.midi !== undefined) {
        const freq = 440 * 2 ** ((ev.midi - 69) / 12)
        leads[(leadIdx + 2) % 4]!.trigger(freq, ev.dur / SR, ev.vel, {
          cutoff: Math.floor(cfg.leadCutoff * 0.5),
          detune: 6,
          res: 0.3,
          lfoRate: 0.6,
          lfoDepth: 0.2,
        })
        leadIdx++
      }
      evIdx++
    }

    // Note-offs
    if (activeBass && i >= bassNoteOffPos) {
      activeBass.noteOff()
      activeBass = null
    }
    if (activeSubBass && i >= subBassNoteOffPos) {
      activeSubBass.noteOff()
      activeSubBass = null
    }
    if (activePad && i >= padNoteOffPos) {
      activePad.noteOff()
      activePad = null
    }

    // ── Render voices → per-type ChannelFX → buses ──
    let drumL = 0
    let drumR = 0
    let bassL = 0
    let bassR = 0
    let musicL = 0
    let musicR = 0

    // Kick → fxKick → drum bus
    let kickMono = 0
    if (kickSample?.active) kickMono += kickSample.render()[0]
    for (const v of kicks) if (v.active) kickMono += v.render()[0]
    if (kickMono !== 0) {
      const [kl, kr] = fxKick.process(kickMono)
      drumL += kl
      drumR += kr
    }

    // Bass (with sidechain) → fxBass → bass bus
    // Dynamic EQ sidechain: split bass into low (<120Hz) and high (>120Hz) bands.
    // Only the low band — where kick/bass collision actually happens — is ducked
    // on kick hits. The high band (harmonics, pluck attack) passes through
    // unaffected, preserving bass clarity and groove. Replaces the previous
    // whole-bass duck (`bassMono * duckEnv * cfg.bassGain`).
    let bassMono = 0
    if (activeBass?.active) bassMono += activeBass.render()[0]
    if (bassMono !== 0) {
      const [bassLow, bassHigh] = bassXover.process(bassMono)
      const bassDucked = bassLow * duckEnv + bassHigh
      const [bl, br] = fxBass.process(bassDucked * cfg.bassGain)
      bassL += bl
      bassR += br
    }

    // Sub-bass → fxSubBass → bass bus
    let subMono = 0
    if (activeSubBass?.active) subMono += activeSubBass.render()[0]
    if (subMono !== 0) {
      const [sl, sr] = fxSubBass.process(subMono * cfg.subBassGain)
      bassL += sl
      bassR += sr
    }

    // Lead → fxLead → music bus
    let leadMono = 0
    for (const v of leads) if (v.active) leadMono += v.render()[0]
    if (leadMono !== 0) {
      const [ll, lr] = fxLead.process(leadMono * cfg.leadGain)
      musicL += ll
      musicR += lr
    }

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
      musicL += cl
      musicR += cr
    }

    // Closed hats → fxHat → drum bus
    let hatMono = 0
    if (hatSample?.active) hatMono += hatSample.render()[0]
    for (const v of hats) if (v.active && !v.open) hatMono += v.render()[0]
    if (hatMono !== 0) {
      const [hl, hr] = fxHat.process(hatMono * cfg.hatGain)
      drumL += hl
      drumR += hr
    }

    // Open hats → fxOpenHat → drum bus (separate FX chain for longer decay/reverb)
    let openHatMono = 0
    for (const v of hats) if (v.active && v.open) openHatMono += v.render()[0]
    if (openHatMono !== 0) {
      const [ohl, ohr] = fxOpenHat.process(openHatMono * cfg.openHatGain)
      drumL += ohl
      drumR += ohr
    }

    // Clap → fxClap → drum bus
    let clapMono = 0
    if (clapSample?.active) clapMono += clapSample.render()[0]
    if (clapMono !== 0) {
      const [cl, cr] = fxClap.process(clapMono)
      drumL += cl
      drumR += cr
    }

    // Perc → fxPerc → drum bus
    let percMono = 0
    if (percSample?.active) percMono += percSample.render()[0]
    if (percMono !== 0) {
      const [pl, pr] = fxPerc.process(percMono)
      drumL += pl
      drumR += pr
    }

    // Snare → fxSnare → drum bus
    let snareMono = 0
    for (const v of snares) if (v.active) snareMono += v.render()[0]
    if (snareMono !== 0) {
      const [sl, sr] = fxSnare.process(snareMono * cfg.snareGain)
      drumL += sl
      drumR += sr
    }

    // Shaker → fxShaker → drum bus
    let shakerMono = 0
    for (const v of shakers) if (v.active) shakerMono += v.render()[0]
    if (shakerMono !== 0) {
      const [sl, sr] = fxShaker.process(shakerMono * cfg.shakerGain)
      drumL += sl
      drumR += sr
    }

    // Pad → fxPad → music bus
    let padMono = 0
    if (activePad?.active) padMono += activePad.render()[0]
    if (padMono !== 0) {
      const [pl, pr] = fxPad.process(padMono * cfg.padGain)
      musicL += pl
      musicR += pr
    }

    // Riser → fxRiser → music bus
    let riserMono = 0
    for (const v of risers) if (v.active) riserMono += v.render()[0]
    if (riserMono !== 0) {
      const [rl, rr] = fxRiser.process(riserMono)
      musicL += rl
      musicR += rr
    }

    // Impact → fxImpact → bass bus
    let impactMono = 0
    for (const v of impacts) if (v.active) impactMono += v.render()[0]
    if (impactMono !== 0) {
      const [il, ir] = fxImpact.process(impactMono)
      bassL += il
      bassR += ir
    }

    // Acid → fxLead → music bus (shares lead FX chain)
    let acidMono = 0
    for (const v of acids) if (v.active) acidMono += v.render()[0]
    if (acidMono !== 0) {
      const [al, ar] = fxLead.process(acidMono)
      musicL += al
      musicR += ar
    }

    // Texture → fxPad → music bus (shares pad FX chain for atmospheric reverb)
    let textureMono = 0
    for (const v of textures) if (v.active) textureMono += v.render()[0]
    if (textureMono !== 0) {
      const [tl, tr] = fxPad.process(textureMono)
      musicL += tl
      musicR += tr
    }

    // ── Bus glue compression ──
    drumL = drumBusL.process(drumL, SR)
    drumR = drumBusR.process(drumR, SR)
    bassL = bassBusL.process(bassL, SR)
    bassR = bassBusR.process(bassR, SR)
    musicL = musicBusL.process(musicL, SR)
    musicR = musicBusR.process(musicR, SR)

    // ── Stems capture ── (post-bus-glue, pre-master-chain, with energy contour
    // applied so summing all three stems == the signal entering the master chain).
    // Mastering engineers can process each bus independently and recombine.
    if (
      stemsEnabled &&
      stemsDrumL &&
      stemsDrumR &&
      stemsBassL &&
      stemsBassR &&
      stemsMusicL &&
      stemsMusicR
    ) {
      stemsDrumL[i] = drumL * energyMul
      stemsDrumR[i] = drumR * energyMul
      stemsBassL[i] = bassL * energyMul
      stemsBassR[i] = bassR * energyMul
      stemsMusicL[i] = musicL * energyMul
      stemsMusicR[i] = musicR * energyMul
    }

    // ── Master sum + glue ── (apply energy contour for tension/release)
    // Phase 2 Day 1: full-mix sidechain — duck EVERYTHING on kick hit
    // (bass + music + pad, not just bass low-band). This is the "pumping"
    // that defines psytrance. duckEnv is applied to bassL/R and musicL/R.
    let mixL = (drumL + bassL * duckEnv + musicL * duckEnv) * energyMul
    let mixR = (drumR + bassR * duckEnv + musicR * duckEnv) * energyMul
    mixL = masterGlueL.process(mixL, SR)
    mixR = masterGlueR.process(mixR, SR)

    samplesL[i] = Number.isFinite(mixL) ? Math.max(-1.5, Math.min(1.5, mixL)) : 0
    samplesR[i] = Number.isFinite(mixR) ? Math.max(-1.5, Math.min(1.5, mixR)) : 0

    // Sidechain recovery
    duckEnv += (1.0 - duckEnv) * (1 / (0.15 * SR))
  }

  // ═══════════════════════════════════════════════════════════════
  // POST-LOOP MASTER CHAIN (PSY3 style)
  // ═══════════════════════════════════════════════════════════════

  // 0. HP at 25Hz — clean DC and subsonic rumble
  const hpState = [0, 0]
  const hpA = (1 / SR) * 2 * Math.PI * MASTER_SPEC.hpFreq
  for (let i = 0; i < totalSamples; i++) {
    hpState[0] += (hpA * (samplesL[i]! - hpState[0])) / (1 + hpA)
    hpState[1] += (hpA * (samplesR[i]! - hpState[1])) / (1 + hpA)
    samplesL[i] = samplesL[i]! - hpState[0]
    samplesR[i] = samplesR[i]! - hpState[1]
  }

  // 0b. M/S processing (professional psytrance master chain)
  //   M = (L+R)/2   S = (L-R)/2
  //   Low frequencies (below 120Hz) must be MONO — clubs have mono subs and
  //   any stereo content below ~120Hz causes phase cancellation on the dance
  //   floor. We extract the low-frequency content of S with a one-pole LP at
  //   120Hz and subtract it from S (S -= LP(S)), forcing low-end mono.
  //   High frequencies are widened by +30% (S += 0.3 * HP(S)@3kHz) for a
  //   bigger, more expensive-sounding stereo image.
  //   Converts back via L' = M + S, R' = M - S (preserves the M/S gain stage).
  const msMonoFreq = 120
  const msHighFreq = 3000
  const msWiden = 1.5 // raised: 1.3 → 1.5 for more stereo width
  const msA = (1 / SR) * 2 * Math.PI * msMonoFreq
  const msMonoLpCoef = msA / (1 + msA)
  const msB = (1 / SR) * 2 * Math.PI * msHighFreq
  const msHighLpCoef = msB / (1 + msB)
  let msLowState = 0 // LP state: low-frequency content of S
  let msHighState = 0 // LP state: low-passed S used to derive one-pole HP
  for (let i = 0; i < totalSamples; i++) {
    const l = samplesL[i]!
    const r = samplesR[i]!
    const mid = (l + r) * 0.5
    let side = (l - r) * 0.5

    // Mono below 120Hz: extract low-freq side content, subtract from S.
    msLowState += msMonoLpCoef * (side - msLowState)
    side -= msLowState

    // High-shelf boost on S: extract high-freq side content (one-pole HP
    // = side - LP(side)) and add a boosted copy back. Result: S unchanged
    // below 3kHz, S * msWiden above 3kHz.
    msHighState += msHighLpCoef * (side - msHighState)
    const sideHigh = side - msHighState
    side += (msWiden - 1) * sideHigh

    samplesL[i] = mid + side
    samplesR[i] = mid - side
  }

  // 1. Multiband compressor (3-band, LR4 crossovers)
  const multiband = new MultibandCompressor({ sampleRate: SR })
  multiband.processBuffer(samplesL, samplesR)

  // 1b. OTT — Phase 2 Day 2: upward+downward multiband expander (genre signature)
  // Goes after multiband compressor, before glue. Subtle mastering settings.
  const ott = new OTT({
    sampleRate: SR,
    depth: 0.3, // 30% depth — gentle, not full OTT
    upwardGainDb: 2,
    downwardGainDb: -2,
    thresholdDb: -24, // lower threshold = less effect on peaks
    attackMs: 2,
    releaseMs: 100,
  })
  ott.processBuffer(samplesL, samplesR)

  // 2. Glue compression (PSY3: thr=0.6, ratio=2, att=4ms, rel=120ms, makeup=1.3)
  // Feed-forward compressor on the sum
  let glueEnv = 0
  const glueA = 1 - Math.exp(-1 / (MASTER_SPEC.glueAttack * SR))
  const glueR = 1 - Math.exp(-1 / (MASTER_SPEC.glueRelease * SR))
  for (let i = 0; i < totalSamples; i++) {
    const abs = Math.max(Math.abs(samplesL[i]!), Math.abs(samplesR[i]!))
    const coef = abs > glueEnv ? glueA : glueR
    glueEnv += (abs - glueEnv) * coef
    let glueGain = 1
    if (glueEnv > MASTER_SPEC.glueThr) {
      const over = glueEnv - MASTER_SPEC.glueThr
      const reduction = over * (1 - 1 / MASTER_SPEC.glueRatio)
      glueGain = (glueEnv - reduction) / glueEnv
    }
    samplesL[i] = samplesL[i]! * glueGain * MASTER_SPEC.glueMakeup
    samplesR[i] = samplesR[i]! * glueGain * MASTER_SPEC.glueMakeup
  }

  // 3. Saturation (PSY3: drive=1.15, mix=0.15 — subtle harmonic addition)
  for (let i = 0; i < totalSamples; i++) {
    const satL = fastTanh(samplesL[i]! * MASTER_SPEC.satDrive)
    const satR = fastTanh(samplesR[i]! * MASTER_SPEC.satDrive)
    // 85% dry + 15% wet
    samplesL[i] = samplesL[i]! * (1 - MASTER_SPEC.satMix) + satL * MASTER_SPEC.satMix
    samplesR[i] = samplesR[i]! * (1 - MASTER_SPEC.satMix) + satR * MASTER_SPEC.satMix
  }

  // 4. Stereo widener (M/S, width from config)
  const widener = new StereoWidener(cfg.stereoWidth)
  widener.processBuffer(samplesL, samplesR)
  const monoCompat = widener.getMonoCompatibility()

  // 5. Measure LUFS
  const lufsResult = measureLUFS(samplesL, samplesR, SR)

  // 6. Apply LUFS gain targeting
  // Phase D: was 50% correction (never hit target). Now 100% correction.
  // The limiter afterward ensures we don't exceed ceiling.
  const gainOffset = lufsToGainOffset(lufsResult.integratedLUFS, targetLufs)
  const fullGain = Math.max(0.1, Math.min(8.0, gainOffset))
  // Phase D: full correction (was 50% — never reached target LUFS)
  for (let i = 0; i < totalSamples; i++) {
    samplesL[i] = (samplesL[i] ?? 0) * fullGain
    samplesR[i] = (samplesR[i] ?? 0) * fullGain
  }

  // 7. True-peak limiter (4x oversampled)
  // Phase 3 Day 2: tightened ceiling to -1.0 dBTP for safe streaming + club playback.
  // Was -0.2 dBTP but ffmpeg measured +0.1 (ISP overshoot). Now -1.0 ensures ≤ 0.
  const limiter = new TruePeakLimiter({ thresholdDb: -1.5, ceilingDb: -1.5, sampleRate: SR })
  limiter.processBuffer(samplesL, samplesR)

  // Phase 1.2 fix (audit C3 follow-up): the corrected limiter (real
  // lookahead, envelope engages early) reduces gain MORE than the broken one
  // it replaced — the old "loudness" was partly square-clip distortion. That
  // dropped the final LUFS ~2.3 LU below target. Standard 2-pass convergence:
  // measure the limited output, apply the remaining deficit as static gain,
  // and re-limit so peaks stay ≤ ceiling. One extra pass lands within ~0.3 LU
  // of the target without re-introducing clipping.
  const firstPassLufs = measureLUFS(samplesL, samplesR, SR)
  const deficitDb = targetLufs - firstPassLufs.integratedLUFS
  if (deficitDb > 0.1) {
    const extraGain = Math.min(10 ** (deficitDb / 20), 4)
    for (let i = 0; i < totalSamples; i++) {
      samplesL[i] = (samplesL[i] ?? 0) * extraGain
      samplesR[i] = (samplesR[i] ?? 0) * extraGain
    }
    const limiter2 = new TruePeakLimiter({ thresholdDb: -1.5, ceilingDb: -1.5, sampleRate: SR })
    limiter2.processBuffer(samplesL, samplesR)
  }

  // Final safety clamp
  for (let i = 0; i < totalSamples; i++) {
    let l = samplesL[i] ?? 0
    let r = samplesR[i] ?? 0
    if (l > 1) l = 1
    else if (l < -1) l = -1
    if (r > 1) r = 1
    else if (r < -1) r = -1
    samplesL[i] = l
    samplesR[i] = r
  }

  // Measure final metrics
  const finalLufs = measureLUFS(samplesL, samplesR, SR)
  const stereoWidth = StereoWidener.measureWidth(samplesL, samplesR)

  return {
    samplesL,
    samplesR,
    sampleRate: SR,
    durationSec: totalSamples / SR,
    bars: renderBars.length,
    events: events.length,
    lufs: finalLufs.integratedLUFS,
    truePeakDb: finalLufs.truePeakDb,
    samplePeakDb: finalLufs.samplePeakDb,
    stereoWidth,
    monoCompatibility: monoCompat,
    gainReductionDb: limiter.getMaxGainReductionDb(),
    stems:
      stemsEnabled &&
      stemsDrumL &&
      stemsDrumR &&
      stemsBassL &&
      stemsBassR &&
      stemsMusicL &&
      stemsMusicR
        ? {
            drumL: stemsDrumL,
            drumR: stemsDrumR,
            bassL: stemsBassL,
            bassR: stemsBassR,
            musicL: stemsMusicL,
            musicR: stemsMusicR,
          }
        : undefined,
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
