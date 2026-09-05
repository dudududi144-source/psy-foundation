import { describe, expect, test } from 'bun:test'
import { CompositionEngine, createIdentityA, serializeRawScore } from '@psy-foundation/music'
import { DEFAULT_SR } from '../src/lib/psy4/constants'
import {
  computeRenderGeometry,
  encodeWav,
  renderFoundationSection,
} from '../src/lib/psy4/forensic-bridge'
import {
  DEFAULT_CHUNK_FRAMES,
  WAV_HEADER_BYTES,
  encodeWavChunks,
  encodeWavPcmChunks,
  streamWavResponse,
  wavHeaderBytes,
  wavTotalBytes,
} from '../src/lib/render/wav-stream'

/**
 * PLAN_V3 4.2 — streaming WAV locks.
 *
 * The streamed bytes MUST be bit-identical to the buffered encoder
 * (`encodeWav`): every md5 determinism baseline in verify.mjs rides on it.
 * The geometry prediction MUST equal the render's actual frame count: the
 * streamed RIFF header (and its Content-Length) is sized before rendering.
 */

/** Deterministic pseudo-random floats incl. extremes, mid-clamp values and
 * NaN — the NaN case matters: DataView.setInt16(NaN) truncates to 0, and the
 * chunked encoder must reproduce that EXACTLY (no Math.round improvements). */
function testSamples(n: number): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  let s = 123456789
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  for (let i = 0; i < n; i++) {
    const pick = i % 13
    if (pick === 0)
      l[i] = 1.0001 // clamps to 1
    else if (pick === 1)
      l[i] = -1.5 // clamps to -1
    else if (pick === 2)
      l[i] = Number.NaN // truncates to 0 in PCM
    else l[i] = rnd() * 2.4 - 1.2
    const pick2 = (i + 5) % 11
    if (pick2 === 0) r[i] = 1
    else if (pick2 === 1) r[i] = -1
    else if (pick2 === 2) r[i] = Number.NaN
    else r[i] = rnd() * 2 - 1
  }
  return { l, r }
}

async function collect(
  gen: AsyncGenerator<Uint8Array, void, unknown>
): Promise<{ bytes: Uint8Array; chunks: number }> {
  const parts: Uint8Array[] = []
  let total = 0
  for await (const part of gen) {
    parts.push(part)
    total += part.length
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return { bytes: out, chunks: parts.length }
}

describe('wav-stream: RIFF header parity with encodeWav', () => {
  test('header bytes identical for several frame counts and sample rates', () => {
    for (const frames of [0, 1, 100, DEFAULT_CHUNK_FRAMES, DEFAULT_CHUNK_FRAMES * 3 + 7]) {
      for (const sr of [44100, 48000]) {
        const { l, r } = testSamples(frames)
        const buffered = new Uint8Array(encodeWav(l, r, sr))
        const header = wavHeaderBytes(frames, sr)
        expect(header.length).toBe(WAV_HEADER_BYTES)
        expect(
          Buffer.from(header).equals(Buffer.from(buffered.subarray(0, WAV_HEADER_BYTES)))
        ).toBe(true)
      }
    }
  })

  test('wavTotalBytes matches encodeWav output size', () => {
    for (const frames of [0, 1, 4097, 65536]) {
      const { l, r } = testSamples(frames)
      expect(wavTotalBytes(frames)).toBe(encodeWav(l, r, DEFAULT_SR).byteLength)
    }
  })
})

describe('wav-stream: chunked encoder is bit-identical to encodeWav', () => {
  const sizes = [
    0,
    1,
    2,
    DEFAULT_CHUNK_FRAMES - 1,
    DEFAULT_CHUNK_FRAMES,
    DEFAULT_CHUNK_FRAMES + 1,
    DEFAULT_CHUNK_FRAMES * 3 + 123,
  ]

  for (const frames of sizes) {
    test(`frames=${frames} (default chunk size)`, async () => {
      const { l, r } = testSamples(frames)
      const buffered = new Uint8Array(encodeWav(l, r, DEFAULT_SR))
      const { bytes, chunks } = await collect(encodeWavChunks(l, r, DEFAULT_SR))
      expect(Buffer.from(bytes).equals(Buffer.from(buffered))).toBe(true)
      expect(chunks).toBe(1 + Math.ceil(frames / DEFAULT_CHUNK_FRAMES))
    })
  }

  test('odd chunk sizes still produce identical bytes', async () => {
    const { l, r } = testSamples(1000)
    const buffered = new Uint8Array(encodeWav(l, r, DEFAULT_SR))
    for (const chunkFrames of [1, 3, 7, 499, 999, 1000, 1001]) {
      const { bytes } = await collect(encodeWavChunks(l, r, DEFAULT_SR, chunkFrames))
      expect(Buffer.from(bytes).equals(Buffer.from(buffered))).toBe(true)
    }
  })
})

describe('wav-stream: streamWavResponse integration', () => {
  test('ReadableStream body + headers match buffered encoder', async () => {
    const { l, r } = testSamples(DEFAULT_CHUNK_FRAMES * 2 + 5)
    const buffered = new Uint8Array(encodeWav(l, r, DEFAULT_SR))
    const res = streamWavResponse(encodeWavChunks(l, r, DEFAULT_SR), {
      totalFrames: l.length,
      sampleRate: DEFAULT_SR,
      headers: { 'X-Render-Cache': 'miss' },
    })
    expect(res.headers.get('content-type')).toBe('audio/wav')
    expect(res.headers.get('content-length')).toBe(String(buffered.byteLength))
    expect(res.headers.get('x-stream')).toBe('wav-chunked')
    expect(res.headers.get('x-render-cache')).toBe('miss')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(Buffer.from(body).equals(Buffer.from(buffered))).toBe(true)
  })

  test('generator failure mid-stream errors the body (loud truncation)', async () => {
    async function* failing(): AsyncGenerator<Uint8Array, void, unknown> {
      yield wavHeaderBytes(64, DEFAULT_SR)
      throw new Error('render failed after stream start')
    }
    const res = streamWavResponse(failing(), {
      totalFrames: 64,
      sampleRate: DEFAULT_SR,
    })
    // The declared length says 44+256 bytes; the body errors instead — the
    // mismatch is what makes a mid-stream failure detectable client-side.
    expect(res.headers.get('content-length')).toBe(String(wavTotalBytes(64)))
    await expect(res.arrayBuffer()).rejects.toThrow('render failed after stream start')
  })

  test('route-style generator: header streams BEFORE the render resolves (header-first lock)', async () => {
    // Mirrors the render-forensic cold path: RIFF header yielded first, PCM
    // only after a slow "render" promise resolves. The verify.mjs TTFB claim
    // depends on this ordering — here it is locked without wall-clock timing.
    const { l, r } = testSamples(200)
    let resolved = false
    let resolveRender!: (v: { samplesL: Float32Array; samplesR: Float32Array }) => void
    const renderPromise = new Promise<{ samplesL: Float32Array; samplesR: Float32Array }>((res) => {
      resolveRender = (v) => {
        resolved = true
        res(v)
      }
    })
    async function* routeStyle(): AsyncGenerator<Uint8Array, void, unknown> {
      yield wavHeaderBytes(200, DEFAULT_SR)
      const rendered = await renderPromise
      yield* encodeWavPcmChunks(rendered.samplesL, rendered.samplesR)
    }
    const res = streamWavResponse(routeStyle(), {
      totalFrames: 200,
      sampleRate: DEFAULT_SR,
    })
    const reader = res.body!.getReader()
    const first = await reader.read()
    // The header arrived while the "render" was STILL pending.
    expect(first.done).toBe(false)
    expect(first.value!.length).toBe(WAV_HEADER_BYTES)
    expect(resolved).toBe(false)
    // Complete the render; the rest of the body must equal encodeWav's PCM.
    resolveRender({ samplesL: l, samplesR: r })
    const parts: Uint8Array[] = [first.value!]
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value!)
    }
    let total = 0
    for (const p of parts) total += p.length
    const all = new Uint8Array(total)
    let off = 0
    for (const p of parts) {
      all.set(p, off)
      off += p.length
    }
    const buffered = new Uint8Array(encodeWav(l, r, DEFAULT_SR))
    expect(Buffer.from(all).equals(Buffer.from(buffered))).toBe(true)
  })
})

describe('wav-stream: geometry parity with the real render', () => {
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
    progressionName: 'psy-dominant',
    bassMode: 'standard',
  }

  test('computeRenderGeometry predicts the render frame count exactly (8 bars @145)', async () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    const geometry = computeRenderGeometry(serializeRawScore(section), 145)
    const rendered = await renderFoundationSection(section, { useSamples: false, bpm: 145 })
    expect(rendered.samplesL.length).toBe(geometry.totalSamples)
    expect(rendered.samplesR.length).toBe(geometry.totalSamples)
    expect(rendered.sampleRate).toBe(DEFAULT_SR)
    // WAV size math agrees with the buffered encoder on the real render.
    expect(wavTotalBytes(geometry.totalSamples)).toBe(
      encodeWav(rendered.samplesL, rendered.samplesR, rendered.sampleRate).byteLength
    )
  }, 60000)

  test('geometry is linear in bars and distinct across bpm (pure formula checks)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const s8 = serializeRawScore(engine.composeSection({ bars: 8 }))
    const s16 = serializeRawScore(engine.composeSection({ bars: 16 }))
    const g8 = computeRenderGeometry(s8, 145)
    const g16 = computeRenderGeometry(s16, 145)
    expect(g16.totalSamples).toBe(g8.totalSamples * 2)
    // stepsPerBar is 16 for the 4/4 groove → 8 bars @145 = 13.24s (verify locks this)
    expect(g8.samplesPerBar).toBeGreaterThan(0)
    expect(g8.samplesPerStep * s8.groove.stepsPerBar).toBe(g8.samplesPerBar)
    const gSlow = computeRenderGeometry(s8, 134)
    expect(gSlow.totalSamples).toBeGreaterThan(g8.totalSamples) // slower bpm → more frames
  })
})
