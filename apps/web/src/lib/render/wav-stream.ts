/**
 * PLAN_V3 4.2 — streaming WAV responses (chunked, header-first).
 *
 * WHY NOT STREAM PCM WHILE RENDERING: the master chain is a 2-pass,
 * whole-buffer process (integrated-LUFS measure → static gain → re-limit),
 * so the final bytes of a render do not exist until the render finishes.
 * Incremental per-bar emission would reorder that pipeline and invalidate
 * every locked md5 determinism baseline + the LUFS/TP claims (the
 * 2026-09-04 deferral note in worklog.md). The deferral's premise is
 * respected here: the DSP is NOT touched.
 *
 * WHAT IS HONESTLY POSSIBLE (and implemented):
 *  - The exact WAV byte size is known BEFORE the render (frames = bars ×
 *    samplesPerBar via the shared `computeRenderGeometry`), so the 44-byte
 *    RIFF header streams immediately → first byte arrives in milliseconds
 *    even on long renders (the plan's "first-byte < 500ms" contract).
 *  - When the render completes, PCM is emitted in bounded chunks through a
 *    pull-based ReadableStream — backpressure honored, no 25 MB contiguous
 *    response-body copy. Bit-identical to `encodeWav` (parity-locked by
 *    tests/wav-stream.test.ts), so every locked md5 baseline still holds.
 *  - `Content-Length` is the exact final size. Any mid-stream failure is a
 *    LOUD truncation (body ≠ Content-Length), never silent corruption.
 */
import { NextResponse } from 'next/server'

export const WAV_HEADER_BYTES = 44

/** 16384 frames = 64 KiB of stereo 16-bit PCM per chunk. */
export const DEFAULT_CHUNK_FRAMES = 16384

/** Exact byte size of a 16-bit stereo PCM WAV: RIFF header + interleaved L/R s16. */
export function wavTotalBytes(totalFrames: number): number {
  return WAV_HEADER_BYTES + totalFrames * 4
}

/**
 * Byte-identical RIFF header for a 16-bit stereo PCM WAV.
 * Must match `encodeWav` (forensic-bridge) EXACTLY — the parity test
 * compares these 44 bytes against the buffered encoder's output.
 */
export function wavHeaderBytes(totalFrames: number, sampleRate: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(WAV_HEADER_BYTES))
  view.setUint32(0, 0x52494646, false) // 'RIFF'
  view.setUint32(4, 36 + totalFrames * 4, true)
  view.setUint32(8, 0x57415645, false) // 'WAVE'
  view.setUint32(12, 0x666d7420, false) // 'fmt '
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // format = PCM
  view.setUint16(22, 2, true) // channels
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true) // byte rate
  view.setUint16(32, 4, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  view.setUint32(36, 0x64617461, false) // 'data'
  view.setUint32(40, totalFrames * 4, true)
  return new Uint8Array(view.buffer)
}

/**
 * Encode interleaved stereo 16-bit PCM (NO RIFF header) as an async generator
 * of chunks. Used after the header has already been streamed (header-first
 * responses) — pairing it with `wavHeaderBytes` must equal `encodeWav`.
 *
 * The conversion expression matches `encodeWav` EXACTLY — DataView.setInt16
 * truncates toward zero (no rounding), so any "improvement" here (Math.round)
 * would silently change every locked md5. Do not touch the expressions.
 */
export async function* encodeWavPcmChunks(
  samplesL: Float32Array,
  samplesR: Float32Array,
  framesPerChunk: number = DEFAULT_CHUNK_FRAMES
): AsyncGenerator<Uint8Array, void, unknown> {
  const length = samplesL.length
  const frames = Math.max(1, Math.floor(framesPerChunk))
  for (let start = 0; start < length; start += frames) {
    const count = Math.min(frames, length - start)
    const view = new DataView(new ArrayBuffer(count * 4))
    for (let j = 0; j < count; j++) {
      const i = start + j
      view.setInt16(j * 4, Math.max(-1, Math.min(1, samplesL[i] ?? 0)) * 32767, true)
      view.setInt16(j * 4 + 2, Math.max(-1, Math.min(1, samplesR[i] ?? 0)) * 32767, true)
    }
    yield new Uint8Array(view.buffer)
  }
}

/**
 * Encode interleaved stereo 16-bit PCM WAV as an async generator of chunks:
 * the RIFF header first, then PCM in `framesPerChunk`-frame slices.
 *
 * The conversion expression matches `encodeWav` EXACTLY — DataView.setInt16
 * truncates toward zero (no rounding), so any "improvement" here (Math.round)
 * would silently change every locked md5. Do not touch the expressions.
 */
export async function* encodeWavChunks(
  samplesL: Float32Array,
  samplesR: Float32Array,
  sampleRate: number,
  framesPerChunk: number = DEFAULT_CHUNK_FRAMES
): AsyncGenerator<Uint8Array, void, unknown> {
  const length = samplesL.length
  yield wavHeaderBytes(length, sampleRate)
  yield* encodeWavPcmChunks(samplesL, samplesR, framesPerChunk)
}

export interface StreamWavOptions {
  /** Exact frame count — drives the declared Content-Length. */
  totalFrames: number
  sampleRate: number
  headers?: Record<string, string>
}

/**
 * Build a Response whose body streams the given WAV chunks with backpressure.
 *
 * The pull-based ReadableStream requests one chunk at a time from the
 * generator, so a slow client throttles the encoder instead of buffering the
 * whole file. If the generator throws mid-stream the stream errors — combined
 * with the exact Content-Length the client sees a hard protocol failure, not
 * a silently truncated audio file.
 */
export function streamWavResponse(
  chunks: AsyncGenerator<Uint8Array, void, unknown>,
  opts: StreamWavOptions
): NextResponse {
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (err) {
        controller.error(err)
      }
    },
    cancel() {
      // Client went away — release the generator (and any resources it holds).
      void chunks.return(undefined)
    },
  })
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(wavTotalBytes(opts.totalFrames)),
      'Cache-Control': 'no-cache',
      'X-Stream': 'wav-chunked',
      ...(opts.headers ?? {}),
    },
  })
}
