import { NextRequest, NextResponse } from 'next/server'
import { CompositionEngine } from '@/foundation/music'
import { createIdentityA } from '@/foundation/music'
import { renderFoundationSection, encodeWav, DEFAULT_RENDER_CONFIG, type RenderResult } from '@/lib/psy4/forensic-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best config found by auto-fixer v3 (score 0.7102, 0 failures on 32 bars)
const BEST_CONFIG = {
  ...DEFAULT_RENDER_CONFIG,
  bassGain: 0.8,
  subBassGain: 0.6,
  padGain: 0.7,
}

// Valid stem bus names. When `?stem=<name>` is passed, the API returns a stereo
// WAV containing only that bus (post-bus-glue, pre-master-chain). This lets
// mastering engineers download each bus independently for per-bus processing.
type StemName = 'drum' | 'bass' | 'music'
const VALID_STEMS: Set<string> = new Set(['drum', 'bass', 'music'])

export async function GET(req: NextRequest) {
  const bars = parseInt(req.nextUrl.searchParams.get('bars') ?? '8', 10)
  const seed = parseInt(req.nextUrl.searchParams.get('seed') ?? '42', 10)
  const useSamples = req.nextUrl.searchParams.get('samples') !== 'false'
  const stemParam = req.nextUrl.searchParams.get('stem')
  const stem: StemName | null =
    stemParam && VALID_STEMS.has(stemParam) ? (stemParam as StemName) : null

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
      config: BEST_CONFIG,
      stems: stem !== null,
    })
  } catch (e) {
    console.error('Render failed, retrying without samples:', (e as Error).message)
    result = await renderFoundationSection(section, {
      useSamples: false,
      bpm: 145,
      config: BEST_CONFIG,
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

  // Default path: full stereo mix.
  const wav = encodeWav(result.samplesL, result.samplesR, result.sampleRate)

  return new NextResponse(wav, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': wav.byteLength.toString(),
      'Cache-Control': 'no-cache',
    },
  })
}
