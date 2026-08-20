import { NeuralStyleTransfer } from '@/lib/psy4/neural/latent-decoder'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Reference Upload API — accepts an audio file and learns its spectral style.
 *
 * POST /api/upload-reference
 * Body: multipart form data with 'audio' field (WAV/MP3 file)
 *
 * Returns:
 *   { success: true, latent: { bands, centroid, flatness }, hash: "..." }
 *
 * The latent can then be used by /api/style-transfer?reference=<hash>&blend=0.5
 *
 * NOTE: For simplicity, this endpoint returns the latent vector as JSON.
 * A production version would store the reference in a database (Supabase)
 * and return a reference ID for use in subsequent style-transfer calls.
 */

// In-memory storage for reference latents (production: use Supabase)
// biome-ignore lint/suspicious/noExplicitAny: latent vector is dynamic
const referenceStore = new Map<string, { latent: any; name: string; uploadedAt: number }>()

// Simple WAV parser (mono, 16-bit PCM)
function parseWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } | null {
  const view = new DataView(buffer)
  // Check RIFF header
  if (view.getUint32(0, false) !== 0x52494646) return null // "RIFF"
  if (view.getUint32(8, false) !== 0x57415645) return null // "WAVE"

  // Find data chunk
  let offset = 12
  let dataOffset = 0
  let dataLength = 0
  let sampleRate = 44100
  let bitsPerSample = 16
  let numChannels = 1

  while (offset < buffer.byteLength - 8) {
    const chunkId = view.getUint32(offset, false)
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 0x666d7420) {
      // "fmt "
      sampleRate = view.getUint32(offset + 12, true)
      numChannels = view.getUint16(offset + 10, true)
      bitsPerSample = view.getUint16(offset + 14, true)
    } else if (chunkId === 0x64617461) {
      // "data"
      dataOffset = offset + 8
      dataLength = chunkSize
      break
    }
    offset += 8 + chunkSize
  }

  if (dataOffset === 0 || dataLength === 0) return null

  // Parse samples (16-bit PCM, downmix to mono)
  const numSamples = Math.floor(dataLength / (bitsPerSample / 8) / numChannels)
  const samples = new Float32Array(numSamples)

  for (let i = 0; i < numSamples; i++) {
    let sum = 0
    for (let ch = 0; ch < numChannels; ch++) {
      const byteOffset = dataOffset + (i * numChannels + ch) * (bitsPerSample / 8)
      if (bitsPerSample === 16) {
        const sample = view.getInt16(byteOffset, true)
        sum += sample / 32768
      } else if (bitsPerSample === 32) {
        const sample = view.getFloat32(byteOffset, true)
        sum += sample
      }
    }
    samples[i] = sum / numChannels
  }

  return { samples, sampleRate }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('audio') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Check file type
    const validTypes = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg']
    if (!validTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.wav')) {
      return NextResponse.json(
        {
          error: `Invalid file type: ${file.type}. Supported: WAV, MP3, OGG`,
        },
        { status: 400 }
      )
    }

    // Check file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()

    // Parse audio (WAV only for now — MP3 would need a decoder)
    const parsed = parseWav(buffer)
    if (!parsed) {
      return NextResponse.json(
        {
          error: 'Failed to parse audio file. Only WAV format is supported.',
        },
        { status: 400 }
      )
    }

    // Limit to first 30 seconds for analysis (memory constraint)
    const maxSamples = 30 * parsed.sampleRate
    const analysisSamples =
      parsed.samples.length > maxSamples ? parsed.samples.subarray(0, maxSamples) : parsed.samples

    // Learn the reference style
    const styleTransfer = new NeuralStyleTransfer()
    styleTransfer.loadReference(analysisSamples, parsed.sampleRate)

    const latent = styleTransfer.getReferenceLatent()
    if (!latent) {
      return NextResponse.json({ error: 'Failed to analyze reference' }, { status: 500 })
    }

    // Generate a unique hash for this reference
    const hash = `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    // Store the latent (production: use Supabase)
    referenceStore.set(hash, {
      latent,
      name: file.name,
      uploadedAt: Date.now(),
    })

    // Calculate statistics for display
    const bandStats = {
      min: Math.min(...Array.from(latent.bands)),
      max: Math.max(...Array.from(latent.bands)),
      avg: Array.from(latent.bands).reduce((a, b) => a + b, 0) / latent.bands.length,
    }

    return NextResponse.json({
      success: true,
      hash,
      name: file.name,
      size: file.size,
      sampleRate: parsed.sampleRate,
      durationAnalyzed: Math.min(30, analysisSamples.length / parsed.sampleRate),
      latent: {
        centroid: Math.round(latent.centroid),
        flatness: Math.round(latent.flatness * 1000) / 1000,
        bands: Array.from(latent.bands).map((v: number) => Math.round(v * 1000) / 1000),
        bandStats,
      },
      message: `Reference loaded. Use /api/style-transfer?reference=${hash}&blend=0.5 to apply.`,
    })
  } catch (e) {
    console.error('Upload reference error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

/** Get a stored reference latent by hash (for style-transfer route) */
// biome-ignore lint/suspicious/noExplicitAny: returns dynamic latent
export function getReferenceLatent(hash: string): any | null {
  const ref = referenceStore.get(hash)
  return ref ? ref.latent : null
}
