import {
  DEFAULT_RENDER_CONFIG,
  encodeWav,
  renderFoundationSection,
} from '@/lib/psy4/forensic-bridge'
import { NeuralStyleTransfer } from '@/lib/psy4/neural/latent-decoder'
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
 * Style Transfer API — applies reference track's spectral style to PSY4 render.
 *
 * GET /api/style-transfer?bars=8&seed=42&blend=0.3
 *
 * This endpoint:
 * 1. Renders a PSY4 section (like render-forensic)
 * 2. Applies NeuralStyleTransfer to the render
 * 3. Returns the styled WAV
 *
 * Note: Without a real reference file upload, this uses the render itself
 * as a "self-reference" (style applied to itself = no-op at blend=0).
 * To use a real reference, POST the reference audio to /api/style-transfer
 * with multipart form data.
 */
export async function GET(req: NextRequest) {
  const bars = Number.parseInt(req.nextUrl.searchParams.get('bars') ?? '8', 10)
  const seed = Number.parseInt(req.nextUrl.searchParams.get('seed') ?? '42', 10)
  const blend = Number.parseFloat(req.nextUrl.searchParams.get('blend') ?? '0.3')
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
  } catch {
    result = await renderFoundationSection(section, {
      useSamples: false,
      bpm: 145,
      config: BEST_CONFIG,
    })
  }

  // Apply style transfer (mono for now — use left channel as reference)
  // In a real implementation, the reference would come from an uploaded file.
  // Here we demonstrate the API: the render is both source and reference.
  const st = new NeuralStyleTransfer()
  st.loadReference(result.samplesL, result.sampleRate)
  st.setBlendAmount(blend)

  // Process in blocks
  const blockSize = 2048
  const styledL = new Float32Array(result.samplesL.length)
  const styledR = new Float32Array(result.samplesR.length)
  for (let i = 0; i < result.samplesL.length; i += blockSize) {
    const end = Math.min(i + blockSize, result.samplesL.length)
    const blockL = result.samplesL.subarray(i, end)
    const blockR = result.samplesR.subarray(i, end)
    const styledBlockL = st.transfer(blockL, result.sampleRate)
    const styledBlockR = st.transfer(blockR, result.sampleRate)
    for (let j = 0; j < styledBlockL.length; j++) {
      styledL[i + j] = styledBlockL[j] ?? 0
      styledR[i + j] = styledBlockR[j] ?? 0
    }
  }

  const wav = encodeWav(styledL, styledR, result.sampleRate)

  return new NextResponse(wav, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': wav.byteLength.toString(),
      'Cache-Control': 'no-cache',
      'X-Style-Blend': blend.toString(),
      'X-Has-Reference': st.hasReference().toString(),
    },
  })
}
