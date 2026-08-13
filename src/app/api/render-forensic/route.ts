import { NextRequest, NextResponse } from 'next/server'
import { CompositionEngine } from '@/foundation/music'
import { createIdentityA } from '@/foundation/music'
import { renderFoundationSection, encodeWav } from '@/lib/psy4/forensic-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  const result = await renderFoundationSection(section, { useSamples, bpm: 145 })

  const wav = encodeWav(result.samplesL, result.samplesR, result.sampleRate)

  return new NextResponse(wav, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': wav.byteLength.toString(),
      'Cache-Control': 'no-cache',
    },
  })
}
