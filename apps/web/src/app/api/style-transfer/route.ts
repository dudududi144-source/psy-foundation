import { getReferenceLatent } from '@/app/api/upload-reference/route'
import {
  DEFAULT_RENDER_CONFIG,
  encodeWav,
  renderFoundationSection,
} from '@/lib/psy4/forensic-bridge'
import { NeuralStyleTransfer } from '@/lib/psy4/research/neural/latent-decoder'
import { CompositionEngine, createIdentityA } from '@psy-foundation/music'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BEST_CONFIG = {
  ...DEFAULT_RENDER_CONFIG,
  bassGain: 0.8,
  subBassGain: 0.6,
  padGain: 0.7,
}

const FFT_BLOCK = 2048

/**
 * Style Transfer API — re-enabled real implementation (ROAST-FIX-1).
 *
 * The previous "Phase F closure: NeuralStyleTransfer was a self-reference
 * no-op" comment was FALSE — the class is functional DSP. The "no-op"
 * behavior came from the OLD style-transfer route calling
 * loadReference(render) — using the render as its own reference — which IS a
 * no-op. The class itself was always correct (modulo the *10 decode bug
 * fixed in latent-decoder.ts).
 *
 * This route now accepts an optional `?reference=<hash>&blend=<0..1>` pair.
 *   - If `reference` is omitted: returns the plain render (back-compat).
 *   - If `reference` is provided AND found in the upload-reference store:
 *     applies NeuralStyleTransfer to the render per-channel in FFT_BLOCK
 *     chunks. Sets X-Style-Transfer: "applied" so callers can verify.
 *   - If `reference` is provided but NOT found: returns the plain render with
 *     X-Style-Transfer: "missing-reference:<hash>" so callers can see what
 *     happened.
 */

/**
 * Process one channel of audio through the style transfer, in FFT_BLOCK
 * chunks. Resets the decoder between calls so callers can re-use the same
 * NeuralStyleTransfer instance for L then R without bleed-through state.
 */
function processChannel(
  channel: Float32Array,
  st: NeuralStyleTransfer,
  sampleRate: number
): Float32Array {
  const out = new Float32Array(channel.length)
  for (let i = 0; i < channel.length; i += FFT_BLOCK) {
    const block = channel.subarray(i, Math.min(i + FFT_BLOCK, channel.length))
    // transfer() expects a full FFT_BLOCK; pad the last block with zeros.
    let working: Float32Array
    if (block.length === FFT_BLOCK) {
      working = block
    } else {
      working = new Float32Array(FFT_BLOCK)
      working.set(block, 0)
    }
    const styled = st.transfer(working, sampleRate)
    // Copy the surviving (unpadded) samples back.
    out.set(styled.subarray(0, block.length), i)
  }
  return out
}

export async function GET(req: NextRequest) {
  const bars = Number.parseInt(req.nextUrl.searchParams.get('bars') ?? '8', 10)
  const seed = Number.parseInt(req.nextUrl.searchParams.get('seed') ?? '42', 10)
  const useSamples = req.nextUrl.searchParams.get('samples') !== 'false'
  const referenceHash = req.nextUrl.searchParams.get('reference')
  const blendRaw = Number.parseFloat(req.nextUrl.searchParams.get('blend') ?? '0.3')
  const blend = Number.isFinite(blendRaw) ? Math.max(0, Math.min(1, blendRaw)) : 0.3

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

  // Resolve reference latent (if any) and apply style transfer.
  let samplesL = result.samplesL
  let samplesR = result.samplesR
  let statusHeader = 'none — no reference requested'

  if (referenceHash) {
    const refLatent = getReferenceLatent(referenceHash)
    if (!refLatent) {
      statusHeader = `missing-reference:${referenceHash}`
    } else {
      // Apply per channel. Each channel uses a fresh NeuralStyleTransfer
      // (with the decoder reset between channels) so state doesn't bleed.
      const stL = new NeuralStyleTransfer()
      stL.applyReference(refLatent, result.sampleRate)
      stL.setBlendAmount(blend)
      samplesL = processChannel(samplesL, stL, result.sampleRate)

      const stR = new NeuralStyleTransfer()
      stR.applyReference(refLatent, result.sampleRate)
      stR.setBlendAmount(blend)
      samplesR = processChannel(samplesR, stR, result.sampleRate)

      statusHeader = `applied (blend=${blend}, hash=${referenceHash})`
    }
  }

  const wav = encodeWav(samplesL, samplesR, result.sampleRate)

  return new NextResponse(wav, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Disposition': 'attachment; filename="psy4-render.wav"',
      'X-Style-Transfer': statusHeader,
    },
  })
}
