import { type LatentVector, NeuralStyleTransfer } from '@/lib/psy4/research/neural/latent-decoder'
import { enforceRateLimit } from '@/lib/rate-limit'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Reference Upload API — accepts a WAV file and learns its spectral style.
 *
 * POST /api/upload-reference
 * Body: multipart form data with 'audio' field (WAV file — 8/16/24/32-bit PCM
 * or 32-bit IEEE float, mono or multichannel, downmixed to mono)
 *
 * Returns:
 *   { success: true, latent: { bands, centroid, flatness }, hash: "..." }
 *
 * The latent can then be used by /api/style-transfer?reference=<hash>&blend=0.5
 *
 * Phase 0 (truth) hardening:
 *   - parseWav reads bitsPerSample at the correct fmt-body offset (+14, was
 *     reading the high half of sampleRate → 0 → Float32Array(Infinity) → 500
 *     on EVERY valid upload).
 *   - dataLength is clamped to the actual buffer (a crafted header claiming
 *     GBs of data can no longer force a huge allocation).
 *   - audioFormat / bitsPerSample / numChannels / sampleRate are validated
 *     with honest 400 errors (only WAV is supported — the old error text
 *     falsely advertised MP3/OGG).
 *   - referenceStore is bounded (oldest entry evicted) instead of growing
 *     forever.
 */

// In-memory storage for reference latents (production: use a database)
const REFERENCE_STORE_MAX = 32
/** PLAN_V3 4.3: entries expire after 1 hour (bounded TTL, not just bounded size). */
const REFERENCE_STORE_TTL_MS = 60 * 60 * 1000
const referenceStore = new Map<string, { latent: LatentVector; name: string; uploadedAt: number }>()

const RIFF = 0x52494646 // "RIFF"
const WAVE = 0x57415645 // "WAVE"
const FMT = 0x666d7420 // "fmt "
const DATA = 0x64617461 // "data"

export interface ParsedWav {
  samples: Float32Array
  sampleRate: number
  channels: number
  bitsPerSample: number
  audioFormat: number
}

/**
 * Parse a WAV file into mono Float32 samples. Returns a parse error string
 * instead of throwing on malformed input. Allocation is bounded by the
 * actual buffer length, never by header-claimed sizes.
 */
export function parseWav(buffer: ArrayBuffer): { result?: ParsedWav; error?: string } {
  const view = new DataView(buffer)
  if (buffer.byteLength < 44) return { error: 'File too small to be a WAV' }
  if (view.getUint32(0, false) !== RIFF) return { error: 'Missing RIFF header' }
  if (view.getUint32(8, false) !== WAVE) return { error: 'Missing WAVE identifier' }

  let offset = 12
  let dataOffset = 0
  let dataLength = 0
  let sampleRate = 44100
  let bitsPerSample = 16
  let numChannels = 1
  let audioFormat = 1
  let sawFmt = false

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = view.getUint32(offset, false)
    const chunkSize = view.getUint32(offset + 4, true)

    if (chunkId === FMT) {
      if (chunkSize < 16 || offset + 8 + chunkSize > buffer.byteLength) {
        return { error: 'Malformed fmt chunk' }
      }
      audioFormat = view.getUint16(offset + 8, true)
      numChannels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      // fmt body: +0 audioFormat, +2 numChannels, +4 sampleRate, +8 byteRate,
      // +12 blockAlign, +14 bitsPerSample  →  file offset: body + 8.
      bitsPerSample = view.getUint16(offset + 22, true)
      sawFmt = true
    } else if (chunkId === DATA) {
      dataOffset = offset + 8
      // Clamp to the real buffer: the header may claim more than it holds.
      dataLength = Math.min(chunkSize, buffer.byteLength - dataOffset)
      break
    }
    // Chunk sizes are word-aligned.
    offset += 8 + chunkSize + (chunkSize % 2)
  }

  if (!sawFmt) return { error: 'Missing fmt chunk' }
  if (dataOffset === 0 || dataLength === 0) return { error: 'Missing or empty data chunk' }
  if (audioFormat !== 1 && audioFormat !== 3) {
    return { error: `Unsupported WAV audioFormat=${audioFormat} (only PCM=1 / float=3)` }
  }
  if (audioFormat === 1 && ![8, 16, 24, 32].includes(bitsPerSample)) {
    return { error: `Unsupported PCM bit depth: ${bitsPerSample}` }
  }
  if (audioFormat === 3 && bitsPerSample !== 32) {
    return { error: `Unsupported float bit depth: ${bitsPerSample} (only 32-bit float)` }
  }
  if (numChannels < 1 || numChannels > 8) return { error: `Invalid channel count: ${numChannels}` }
  if (sampleRate < 8000 || sampleRate > 384000) {
    return { error: `Invalid sample rate: ${sampleRate}` }
  }

  const bytesPerSample = bitsPerSample / 8
  const bytesPerFrame = bytesPerSample * numChannels
  if (dataLength < bytesPerFrame) return { error: 'Data chunk smaller than one frame' }

  const numSamples = Math.floor(dataLength / bytesPerFrame)
  const samples = new Float32Array(numSamples)

  for (let i = 0; i < numSamples; i++) {
    let sum = 0
    for (let ch = 0; ch < numChannels; ch++) {
      const p = dataOffset + (i * numChannels + ch) * bytesPerSample
      if (audioFormat === 3) {
        sum += view.getFloat32(p, true)
      } else if (bitsPerSample === 8) {
        sum += (view.getUint8(p) - 128) / 128
      } else if (bitsPerSample === 16) {
        sum += view.getInt16(p, true) / 32768
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(p)
        const b1 = view.getUint8(p + 1)
        const b2 = view.getUint8(p + 2)
        let v = (b2 << 16) | (b1 << 8) | b0
        if (v & 0x800000) v |= ~0xffffff // sign-extend 24-bit
        sum += v / 8388608
      } else {
        sum += view.getInt32(p, true) / 2147483648
      }
    }
    samples[i] = sum / numChannels
  }

  return { result: { samples, sampleRate, channels: numChannels, bitsPerSample, audioFormat } }
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit('upload', req)
  if (limited) return limited
  try {
    const formData = await req.formData()
    const file = formData.get('audio') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Only WAV is actually parsed here. Do not advertise what we cannot parse.
    const looksLikeWav =
      file.type === 'audio/wav' ||
      file.type === 'audio/x-wav' ||
      file.name.toLowerCase().endsWith('.wav')
    if (!looksLikeWav) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type || 'unknown'}. Only WAV is supported.` },
        { status: 400 }
      )
    }

    // Check file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const parsed = parseWav(buffer)
    if (parsed.error || !parsed.result) {
      return NextResponse.json(
        { error: `Failed to parse WAV: ${parsed.error ?? 'unknown error'}` },
        { status: 400 }
      )
    }

    const { samples, sampleRate } = parsed.result

    // Limit to first 30 seconds for analysis (memory constraint)
    const maxSamples = 30 * sampleRate
    const analysisSamples = samples.length > maxSamples ? samples.subarray(0, maxSamples) : samples

    // Learn the reference style
    const styleTransfer = new NeuralStyleTransfer()
    styleTransfer.loadReference(analysisSamples, sampleRate)

    const latent = styleTransfer.getReferenceLatent()
    if (!latent) {
      return NextResponse.json({ error: 'Failed to analyze reference' }, { status: 500 })
    }

    // Generate a unique hash for this reference
    const hash = `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

    // Bound the store: evict the oldest entry when full.
    if (referenceStore.size >= REFERENCE_STORE_MAX) {
      let oldestKey: string | null = null
      let oldestTime = Number.POSITIVE_INFINITY
      for (const [k, v] of referenceStore) {
        if (v.uploadedAt < oldestTime) {
          oldestTime = v.uploadedAt
          oldestKey = k
        }
      }
      if (oldestKey) referenceStore.delete(oldestKey)
    }
    referenceStore.set(hash, { latent, name: file.name, uploadedAt: Date.now() })

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
      sampleRate,
      channels: parsed.result.channels,
      bitsPerSample: parsed.result.bitsPerSample,
      durationAnalyzed: Math.min(30, analysisSamples.length / sampleRate),
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

/** Get a stored reference latent by hash (for style-transfer route). TTL-aware. */
export function getReferenceLatent(hash: string): LatentVector | null {
  const ref = referenceStore.get(hash)
  if (!ref) return null
  if (Date.now() - ref.uploadedAt > REFERENCE_STORE_TTL_MS) {
    referenceStore.delete(hash)
    return null
  }
  return ref.latent
}
