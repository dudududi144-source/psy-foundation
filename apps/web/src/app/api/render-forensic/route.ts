import { renderOnce, validateBarsSeed } from '@/lib/api-params'
import {
  DEFAULT_RENDER_CONFIG,
  type RenderResult,
  encodeWav,
  renderFoundationSection,
} from '@/lib/psy4/forensic-bridge'
import { type ExportFormat, encodeAiff, getMimeType } from '@/lib/psy4/multi-export'
import { FACTORY_PRESETS } from '@/lib/psy4/preset-manager'
import { enforceRateLimit } from '@/lib/rate-limit'
import { getRenderCache, getRenderCoalescer } from '@/lib/render/render-cache'
import { getRenderPool } from '@/lib/render/render-pool'
import { CompositionEngine } from '@psy-foundation/music'
import { createIdentityA } from '@psy-foundation/music'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Best config found by auto-fixer v3 (score 0.7102, 0 failures on 32 bars)
const BEST_CONFIG = {
  ...DEFAULT_RENDER_CONFIG,
  bassGain: 0.8,
  subBassGain: 0.6,
  padGain: 0.7,
}

type StemName = 'drum' | 'bass' | 'music'
const VALID_STEMS: Set<string> = new Set(['drum', 'bass', 'music'])
const VALID_FORMATS: Set<string> = new Set(['wav', 'aiff', 'flac'])

export async function GET(req: NextRequest) {
  // PLAN_V3 4.3 — rate limit BEFORE any work, same policy as every compute
  // route: strangers are bucketed (429 + Retry-After when empty); key holders
  // (PSY_API_KEY + x-api-key) bypass buckets entirely (operator/CI mode).
  const limited = enforceRateLimit('render', req)
  if (limited) return limited

  const params = validateBarsSeed(req, 8)
  if (!params.ok) return params.response
  const { bars, seed } = params
  const useSamples = req.nextUrl.searchParams.get('samples') !== 'false'
  const stemParam = req.nextUrl.searchParams.get('stem')
  const stem: StemName | null =
    stemParam && VALID_STEMS.has(stemParam) ? (stemParam as StemName) : null
  // Multi-format export: ?format=wav|aiff|flac (default: wav)
  const formatParam = req.nextUrl.searchParams.get('format') ?? 'wav'
  const format: ExportFormat = VALID_FORMATS.has(formatParam)
    ? (formatParam as ExportFormat)
    : 'wav'

  // Phase C: progression + bassMode + style parameters
  const progression = req.nextUrl.searchParams.get('progression') ?? undefined
  const bassMode = req.nextUrl.searchParams.get('bassMode') ?? undefined
  const style = req.nextUrl.searchParams.get('style') ?? undefined

  // Style presets: ?style=full-on|darkpsy|progressive
  const stylePresets: Record<
    string,
    { scale: string; bpm: number; progression: string; bassMode?: string }
  > = {
    'full-on': { scale: 'phrygian-dominant', bpm: 145, progression: 'psy-dominant' },
    darkpsy: { scale: 'phrygian', bpm: 150, progression: 'dark', bassMode: '16th' },
    progressive: { scale: 'minor', bpm: 134, progression: 'uplifting' },
    forest: { scale: 'phrygian', bpm: 155, progression: 'dark', bassMode: '16th' },
    hypnotic: { scale: 'phrygian-dominant', bpm: 138, progression: 'hypnotic' },
  }
  const stylePreset = style ? stylePresets[style] : undefined

  // Preset support: ?preset=Full-On+Lead applies preset params to render config
  const presetName = req.nextUrl.searchParams.get('preset')
  let renderConfig = { ...BEST_CONFIG }
  if (presetName) {
    const preset = FACTORY_PRESETS.find((p) => p.name === presetName)
    if (preset) {
      // Map preset params to RenderConfig overrides
      const overrides: Record<string, number> = {}
      if (preset.params.cutoff !== undefined) overrides.leadCutoff = preset.params.cutoff
      if (preset.params.gain !== undefined) overrides.leadGain = preset.params.gain
      if (preset.params.res !== undefined) overrides.leadResonance = preset.params.res
      if (preset.params.fundamental !== undefined)
        overrides.kickFundamental = preset.params.fundamental
      if (preset.params.subDecay !== undefined) overrides.kickDecay = preset.params.subDecay
      if (preset.params.bodyLevel !== undefined) overrides.bassGain = preset.params.bodyLevel
      if (preset.params.targetLufs !== undefined) overrides.targetLufs = preset.params.targetLufs
      if (preset.params.stereoWidth !== undefined) overrides.stereoWidth = preset.params.stereoWidth
      renderConfig = { ...renderConfig, ...overrides }
    }
  }

  const ctx = {
    tonic: 4,
    scaleName: stylePreset?.scale ?? 'phrygian-dominant',
    octave: 4,
    bpm: stylePreset?.bpm ?? 145,
    beatsPerBar: 4,
    beatPosition: 0,
    barPosition: 0,
    phrasePosition: 0,
    harmonicContext: [],
    density: 0.7,
    energy: 0.7,
    tension: 0.3,
    sectionRole: style ?? 'full-on',
    repetitionPressure: 0.3,
    noveltyPressure: 0.5,
    // Phase C: progression and bassMode from query params or style preset
    progressionName: progression ?? stylePreset?.progression ?? 'psy-dominant',
    bassMode: bassMode ?? stylePreset?.bassMode ?? 'standard',
  }

  const engine = new CompositionEngine({ seed, context: ctx, identity: createIdentityA() })
  const section = engine.composeSection({ bars })

  // PLAN_V3 4.1 — canonical cache key over EVERY render-affecting param.
  // ?nocache=1 forces a real re-render (verify's determinism claim must prove
  // re-render determinism, not cache determinism) and skips cache store.
  const nocache = req.nextUrl.searchParams.get('nocache') === '1'
  const cacheKey = JSON.stringify({
    bars,
    seed,
    useSamples,
    stem,
    format,
    progression: progression ?? null,
    bassMode: bassMode ?? null,
    style: style ?? null,
    preset: presetName ?? null,
  })

  // Cache hit (fast path): full-mix renders only — the stem path mutates
  // buffers in place (idempotent peak normalization), so cached stems stay
  // correct, but we still only cache full mixes to keep the fast path pure.
  const cache = getRenderCache()
  if (stem === null && !nocache) {
    const cached = cache.get(cacheKey)
    if (cached) {
      const wav =
        format === 'aiff'
          ? encodeAiff(cached.samplesL, cached.samplesR, cached.sampleRate)
          : encodeWav(cached.samplesL, cached.samplesR, cached.sampleRate)
      return new NextResponse(wav, {
        headers: {
          'Content-Type': getMimeType(format),
          'Content-Length': wav.byteLength.toString(),
          'Cache-Control': 'no-cache',
          'X-Export-Format': format,
          'X-Render-Cache': 'hit',
        },
      })
    }
  }

  // Render via the shared path: coalesced (concurrent identical requests
  // share ONE render) + off the event loop when the worker pool is alive.
  // The coalesced task either produces a render or an honest error response.
  type RenderOutcome =
    | { kind: 'render'; result: RenderResult }
    | { kind: 'error'; response: NextResponse }
  const coalescer = getRenderCoalescer<RenderOutcome>()
  let viaWorker = 'inline'
  const outcome: RenderOutcome = await coalescer.run(cacheKey, async (): Promise<RenderOutcome> => {
    const pool = getRenderPool()
    if (pool.isAvailable()) {
      viaWorker = 'worker'
      try {
        const reply = await pool.render({
          bars,
          seed,
          useSamples,
          bpm: ctx.bpm,
          wantStems: stem !== null,
          ctx,
          config: renderConfig,
        })
        // WorkerRenderOk mirrors RenderResult exactly (stems included); the
        // pool parity test locks byte-identical output vs the in-thread path.
        return { kind: 'render', result: reply as unknown as RenderResult }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('render queue full')) {
          return {
            kind: 'error',
            response: NextResponse.json(
              { error: 'render queue full — retry shortly' },
              { status: 503, headers: { 'Retry-After': '5' } }
            ),
          }
        }
        console.error('Worker render failed, falling back in-thread:', message)
        viaWorker = 'inline-fallback'
      }
    }
    // In-thread fallback (dev without artifact / degraded pool). Phase 0
    // (truth): single render attempt, honest 500 on failure.
    const rendered = await renderOnce(() =>
      renderFoundationSection(section, {
        useSamples,
        bpm: ctx.bpm,
        config: renderConfig,
        stems: stem !== null,
      })
    )
    if (!rendered.ok) {
      return {
        kind: 'error',
        response: NextResponse.json(
          { error: `Render failed: ${rendered.error.message}` },
          { status: 500 }
        ),
      }
    }
    return { kind: 'render', result: rendered.result }
  })

  if (outcome.kind === 'error') {
    return outcome.response
  }
  const result: RenderResult = outcome.result

  // Cache the completed full-mix render (stems/nocache paths skip caching).
  if (stem === null && !nocache) {
    cache.set(cacheKey, { ...result, stems: result.stems ?? null })
  }
  const renderHeaders: Record<string, string> = {
    'X-Render-Worker': viaWorker,
    'X-Render-Cache': 'miss',
  }

  // Stem export path: encode only the requested bus as a stereo WAV.
  if (stem !== null && result.stems) {
    let stemL: Float32Array
    let stemR: Float32Array
    if (stem === 'drum') {
      stemL = result.stems.drumL
      stemR = result.stems.drumR
    } else if (stem === 'bass') {
      stemL = result.stems.bassL
      stemR = result.stems.bassR
    } else {
      stemL = result.stems.musicL
      stemR = result.stems.musicR
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
        ...renderHeaders,
      },
    })
  }

  // Default path: full stereo mix with multi-format support.
  let audioBuffer: ArrayBuffer
  const actualFormat: ExportFormat = format
  if (format === 'aiff') {
    audioBuffer = encodeAiff(result.samplesL, result.samplesR, result.sampleRate)
  } else if (format === 'flac') {
    // Roast-fix: FLAC is not supported in pure TS. Previous code returned a
    // broken file (WAV with fLaC magic, neither valid FLAC nor valid WAV).
    // Now we honestly reject the request and tell the user to use wav/aiff.
    return NextResponse.json(
      {
        error:
          'FLAC export is not supported in pure TypeScript. Use ?format=wav or ?format=aiff. To add FLAC support, install a FLAC encoder library and wire it into multi-export.ts.',
        format: 'flac',
        alternatives: ['wav', 'aiff'],
      },
      { status: 501, headers: { 'X-Export-Format': 'flac-unsupported' } }
    )
  } else {
    audioBuffer = encodeWav(result.samplesL, result.samplesR, result.sampleRate)
  }

  return new NextResponse(audioBuffer, {
    headers: {
      'Content-Type': getMimeType(actualFormat),
      'Content-Length': audioBuffer.byteLength.toString(),
      'Cache-Control': 'no-cache',
      'X-Export-Format': actualFormat,
      ...renderHeaders,
    },
  })
}
