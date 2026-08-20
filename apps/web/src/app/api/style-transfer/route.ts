import {
  DEFAULT_RENDER_CONFIG,
  encodeWav,
  renderFoundationSection,
} from '@/lib/psy4/forensic-bridge'
import { CompositionEngine } from '@psy-foundation/music'
import { createIdentityA } from '@psy-foundation/music'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BEST_CONFIG = {
  ...DEFAULT_RENDER_CONFIG,
  bassGain: 0.8,
  subBassGain: 0.6,
  padGain: 0.7,
}

/**
 * Style Transfer API — HONEST STATUS:
 *
 * Phase F closure: NeuralStyleTransfer was a spectral approximation (not neural)
 * that used the render as its own reference (self-reference no-op).
 *
 * The module has been moved to research/neural/ and is no longer imported.
 * This endpoint now returns the plain render with a note that style transfer
 * is not available until trained models exist.
 *
 * To activate real style transfer:
 * 1. Train RAVE model (see research/neural/training/)
 * 2. Fix onnx-inference missing await
 * 3. Wire ?reference=<hash> to upload-reference store
 * 4. Replace this endpoint with ONNX-based inference
 */

export async function GET(req: NextRequest) {
  const bars = Number.parseInt(req.nextUrl.searchParams.get('bars') ?? '8', 10)
  const seed = Number.parseInt(req.nextUrl.searchParams.get('seed') ?? '42', 10)
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

  let result: Awaited<ReturnType<typeof renderFoundationSection>> | undefined
  try {
    result = await renderFoundationSection(section, { useSamples, bpm: 145, config: BEST_CONFIG })
  } catch {
    result = await renderFoundationSection(section, {
      useSamples: false,
      bpm: 145,
      config: BEST_CONFIG,
    })
  }

  // Phase F: style transfer is not available — return plain render
  const wav = encodeWav(result.samplesL, result.samplesR, result.sampleRate)

  return new NextResponse(wav, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Disposition': 'attachment; filename="psy4-render.wav"',
      'X-Style-Transfer': 'unavailable — no trained models. See research/neural/',
    },
  })
}
