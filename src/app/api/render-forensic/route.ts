import { NextRequest, NextResponse } from 'next/server'
import { CompositionEngine } from '@/foundation/music'
import { createIdentityA } from '@/foundation/music'
import { renderFoundationSection, encodeWav, DEFAULT_RENDER_CONFIG } from '@/lib/psy4/forensic-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best config found by auto-fixer (score 0.6568 on 32 bars)
const BEST_CONFIG = {
  ...DEFAULT_RENDER_CONFIG,
  kickDecay: 0.079475,
  bassGain: 0.75,
  leadCutoff: 6500,
  leadGain: 1.4,
  hatGain: 1.6,
  shakerGain: 1.8,
  subBassGain: 0.5,
  duckAmount: 0.95,
  stereoWidth: 1.5,
}

export async function GET(req: NextRequest) {
  const bars = parseInt(req.nextUrl.searchParams.get('bars') ?? '8', 10)
  const seed = parseInt(req.nextUrl.searchParams.get('seed') ?? '42', 10)
  const useSamples = req.nextUrl.searchParams.get('samples') !== 'false'

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

  let result
  try {
    result = await renderFoundationSection(section, { useSamples, bpm: 145, config: BEST_CONFIG })
  } catch (e) {
    console.error('Render failed, retrying without samples:', (e as Error).message)
    result = await renderFoundationSection(section, { useSamples: false, bpm: 145, config: BEST_CONFIG })
  }

  const wav = encodeWav(result.samplesL, result.samplesR, result.sampleRate)

  return new NextResponse(wav, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': wav.byteLength.toString(),
      'Cache-Control': 'no-cache',
    },
  })
}
