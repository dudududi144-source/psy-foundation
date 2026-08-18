import { NextRequest, NextResponse } from 'next/server'
import { CompositionEngine } from '@/foundation/music'
import { createIdentityA } from '@/foundation/music'
import { renderFoundationSection, encodeWav, DEFAULT_RENDER_CONFIG, type RenderResult } from '@/lib/psy4/forensic-bridge'
import { encodeAiff, encodeFlacPlaceholder, getMimeType, type ExportFormat } from '@/lib/psy4/multi-export'
import { FACTORY_PRESETS } from '@/lib/psy4/preset-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best config found by auto-fixer v3 (score 0.7102, 0 failures on 32 bars)
const BEST_CONFIG = {
  ...DEFAULT_RENDER_CONFIG,
  bassGain: 0.8,
  subBassGain: 0.6,
  padGain: 0.7,
}

type StemName = 'drum' | 'bass' | 'music'
const VALID_STEMS: Set<string> = new Set(['drum', 'bass', 'music'])
const VALID_FORMATS: Set<string> = new Set(['wav', 'aiff', 'flac'])

export async function GET(req: NextRequest) {
  const bars = parseInt(req.nextUrl.searchParams.get('bars') ?? '8', 10)
  const seed = parseInt(req.nextUrl.searchParams.get('seed') ?? '42', 10)
  const useSamples = req.nextUrl.searchParams.get('samples') !== 'false'
  const stemParam = req.nextUrl.searchParams.get('stem')
  const stem: StemName | null =
    stemParam && VALID_STEMS.has(stemParam) ? (stemParam as StemName) : null
  // Multi-format export: ?format=wav|aiff|flac (default: wav)
  const formatParam = req.nextUrl.searchParams.get('format') ?? 'wav'
  const format: ExportFormat = VALID_FORMATS.has(formatParam) ? (formatParam as ExportFormat) : 'wav'

  // Preset support: ?preset=Full-On+Lead applies preset params to render config
  const presetName = req.nextUrl.searchParams.get('preset')
  let renderConfig = { ...BEST_CONFIG }
  if (presetName) {
    const preset = FACTORY_PRESETS.find(p => p.name === presetName)
    if (preset) {
      // Map preset params to RenderConfig overrides
      const overrides: Record<string, number> = {}
      if (preset.params.cutoff !== undefined) overrides.leadCutoff = preset.params.cutoff
      if (preset.params.gain !== undefined) overrides.leadGain = preset.params.gain
      if (preset.params.res !== undefined) overrides.leadResonance = preset.params.res
      if (preset.params.fundamental !== undefined) overrides.kickFundamental = preset.params.fundamental
      if (preset.params.subDecay !== undefined) overrides.kickDecay = preset.params.subDecay
      if (preset.params.bodyLevel !== undefined) overrides.bassGain = preset.params.bodyLevel
      if (preset.params.targetLufs !== undefined) overrides.targetLufs = preset.params.targetLufs
      if (preset.params.stereoWidth !== undefined) overrides.stereoWidth = preset.params.stereoWidth
      renderConfig = { ...renderConfig, ...overrides }
    }
  }

  const ctx = {
    tonic: 4,
    scaleName: 'phrygian-dominant',
    octave: 4,
    bpm: 145,
    beatsPerBar: 4,
    beatPosition: 0,
    barPosition: 0,
    phrasePosition: 0,
    harmonicContext: [],
    density: 0.7,
    energy: 0.7,
    tension: 0.3,
    sectionRole: 'full-on',
    repetitionPressure: 0.3,
    noveltyPressure: 0.5,
  }

  const engine = new CompositionEngine({ seed, context: ctx, identity: createIdentityA() })
  const section = engine.composeSection({ bars })

  // When a stem is requested, we render with stems=true so the bus outputs are
  // captured. Otherwise (full mix) we skip the stem allocation entirely.
  let result: RenderResult
  try {
    result = await renderFoundationSection(section, {
      useSamples,
      bpm: 145,
      config: renderConfig,
      stems: stem !== null,
    })
  } catch (e) {
    console.error('Render failed, retrying without samples:', (e as Error).message)
    result = await renderFoundationSection(section, {
      useSamples: false,
      bpm: 145,
      config: renderConfig,
      stems: stem !== null,
    })
  }

  // Stem export path: encode only the requested bus as a stereo WAV.
  if (stem !== null && result.stems) {
    let stemL: Float32Array
    let stemR: Float32Array
    if (stem === 'drum') {
      stemL = result.stems.drumL; stemR = result.stems.drumR
    } else if (stem === 'bass') {
      stemL = result.stems.bassL; stemR = result.stems.bassR
    } else {
      stemL = result.stems.musicL; stemR = result.stems.musicR
    }

    // Normalize the stem to peak 0.95 so it doesn't go silent when solo'd
    // (each bus alone is much quieter than the full mix). This keeps the WAV
    // at a usable monitoring level without changing the relative dynamics.
    let peak = 0
    for (let i = 0; i < stemL.length; i++) {
      const a = Math.abs(stemL[i] ?? 0)
      const b = Math.abs(stemR[i] ?? 0)
      if (a > peak) peak = a
      if (b > peak) peak = b
    }
    const normGain = peak > 1e-6 ? Math.min(8, 0.95 / peak) : 1
    if (normGain !== 1) {
      for (let i = 0; i < stemL.length; i++) {
        stemL[i] = (stemL[i] ?? 0) * normGain
        stemR[i] = (stemR[i] ?? 0) * normGain
      }
    }

    const wav = encodeWav(stemL, stemR, result.sampleRate)
    return new NextResponse(wav, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': wav.byteLength.toString(),
        'Cache-Control': 'no-cache',
        'X-Stem-Bus': stem,
        'X-Stem-Peak-Normalized': peak > 1e-6 ? 'true' : 'false',
      },
    })
  }

  // Default path: full stereo mix with multi-format support.
  let audioBuffer: ArrayBuffer
  if (format === 'aiff') {
    audioBuffer = encodeAiff(result.samplesL, result.samplesR, result.sampleRate)
  } else if (format === 'flac') {
    audioBuffer = encodeFlacPlaceholder(result.samplesL, result.samplesR, result.sampleRate)
  } else {
    audioBuffer = encodeWav(result.samplesL, result.samplesR, result.sampleRate)
  }

  return new NextResponse(audioBuffer, {
    headers: {
      'Content-Type': getMimeType(format),
      'Content-Length': audioBuffer.byteLength.toString(),
      'Cache-Control': 'no-cache',
      'X-Export-Format': format,
    },
  })
}
