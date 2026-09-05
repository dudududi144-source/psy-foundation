import { createHash } from 'node:crypto'
import { renderOnce } from '@/lib/api-params'
import {
  type ExternalNote,
  type ExternalTrack,
  encodeWav,
  renderExternalNotes,
} from '@/lib/psy4/forensic-bridge'
import { enforceRateLimit } from '@/lib/rate-limit'
import { v2 } from '@psy-foundation/protocol'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Task 17 — the WHAT→HOW wire. POST a PSYBUS v2 note stream (the family wire,
// transcribed verbatim from the psyboss spec), get back foundation's sound:
// the same voices → ChannelFX → bus glue → master chain as render-forensic,
// with ZERO internal composition (no generated kick/bass/hats, no humanization,
// no 8-bar energy contour). The caller owns composition; foundation owns sound.
//
// Faithful-consumer contract:
// - every envelope is validated by foundation's own PSYBUS v2 codec
//   (`v2.validateEnvelope`) before it can touch a voice;
// - only `kind: 'note'` payloads are renderable here — anything else is an
//   honest 400 naming the offending index and kind;
// - `track` must name one of the 16 foundation voices (ExternalTrack) — a
//   stream with foreign track names is a consumer-side mapping bug, so it is
//   an honest 400 listing the supported tracks;
// - time comes from the envelope's own `ts` (seconds) × bpm — offline
//   rendering of a bus stream means sorting by ts, so the render is a
//   deterministic function of (body, seed, bpm, bars);
// - notes outside the requested window are DROPPED and counted in a response
//   header (X-Notes-Dropped) — never silently.
//
// Bounds mirror the forensic route's DoS posture: bars 1–88, notes ≤ 2000,
// body ≤ 4 MB, same rate-limit bucket ('render').

const MAX_BARS = 88
const MAX_NOTES = 2000
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MIN_BPM = 60
const MAX_BPM = 200

const SUPPORTED_TRACKS: ReadonlySet<string> = new Set<string>([
  'kick',
  'bass',
  'lead',
  'counter',
  'subbass',
  'hat',
  'openhat',
  'snare',
  'clap',
  'perc',
  'shaker',
  'pad',
  'acid',
  'riser',
  'impact',
  'texture',
])

interface ParsedNotes {
  ok: true
  notes: ExternalNote[]
  dropped: number
}
interface ParseError {
  ok: false
  response: NextResponse
}

function bad(status: number, payload: Record<string, unknown>): ParseError {
  return { ok: false, response: NextResponse.json(payload, { status }) }
}

/** Validate + map a raw PSYBUS v2 envelope array into ExternalNotes. */
function parseNoteStream(raw: unknown, bpm: number, bars: number): ParsedNotes | ParseError {
  if (!Array.isArray(raw)) {
    return bad(400, { error: '`notes` must be an array of PSYBUS v2 envelopes' })
  }
  if (raw.length === 0) {
    return bad(400, { error: '`notes` is empty — nothing to render' })
  }
  if (raw.length > MAX_NOTES) {
    return bad(400, { error: `too many notes (${raw.length}); the cap is ${MAX_NOTES}` })
  }

  const secPerBeat = 60 / bpm
  const stepsPerSec = 4 / secPerBeat // 16th-steps per second at this bpm
  const maxStep = bars * 16

  const mapped: ExternalNote[] = []
  const unknownTracks = new Set<string>()
  let dropped = 0

  for (let i = 0; i < raw.length; i++) {
    const checked = v2.validateEnvelope(raw[i])
    if (!checked.ok) {
      return bad(400, {
        error: `notes[${i}] is not a valid PSYBUS v2 envelope: ${checked.error.code} ${checked.error.path} — ${checked.error.message}`,
      })
    }
    const env = checked.value
    const p = env.payload
    if (p.kind !== 'note') {
      return bad(400, {
        error: `notes[${i}] carries kind '${p.kind}'; this endpoint renders 'note' payloads only`,
      })
    }
    if (!SUPPORTED_TRACKS.has(p.track)) {
      unknownTracks.add(p.track)
      continue
    }
    // Time: envelope ts (seconds) → absolute 16th-step at the requested bpm.
    // Fractions are kept — humanized off-grid timing renders as sent.
    const step = env.ts * stepsPerSec
    if (!Number.isFinite(step) || step < 0 || step >= maxStep) {
      dropped += 1
      continue
    }
    mapped.push({
      track: p.track as ExternalTrack,
      midi: p.note,
      step,
      durationSteps: p.durBeats * 4,
      velocity: p.vel,
    })
  }

  if (unknownTracks.size > 0) {
    return bad(400, {
      error: `unsupported track id(s): ${[...unknownTracks].sort().join(', ')}`,
      supportedTracks: [...SUPPORTED_TRACKS].sort(),
      hint: 'map your composition voices onto foundation voice names before posting',
    })
  }
  if (mapped.length === 0) {
    return bad(400, {
      error:
        dropped > 0
          ? `all ${dropped} notes fall outside the requested ${bars}-bar window`
          : 'no renderable notes after validation',
    })
  }

  // Deterministic total order for a bus stream rendered offline: by envelope
  // time first (the transport truth), then rev/src/note so identical input
  // arrays always produce identical render order.
  mapped.sort((a, b) => a.step - b.step)
  return { ok: true, notes: mapped, dropped }
}

export async function POST(req: NextRequest) {
  // Same rate-limit bucket as render-forensic: every compute route shares the
  // stranger-bucket policy (key holders bypass).
  const limited = enforceRateLimit('render', req)
  if (limited) return limited

  const bodyText = await req.text()
  if (bodyText.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `body too large (${bodyText.length} bytes; cap ${MAX_BODY_BYTES})` },
      { status: 413 }
    )
  }
  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'expected a JSON object body' }, { status: 400 })
  }
  const obj = body as Record<string, unknown>

  // ── Scalar params (body-carried; same bounds philosophy as validateBarsSeed) ──
  const seed = obj.seed
  if (typeof seed !== 'number' || !Number.isInteger(seed)) {
    return NextResponse.json({ error: 'seed must be an integer' }, { status: 400 })
  }
  const bpm = obj.bpm ?? 145
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
    return NextResponse.json(
      { error: `bpm must be a number in [${MIN_BPM}, ${MAX_BPM}]` },
      { status: 400 }
    )
  }
  const bars = obj.bars
  if (typeof bars !== 'number' || !Number.isInteger(bars) || bars < 1 || bars > MAX_BARS) {
    return NextResponse.json(
      { error: `bars must be an integer in [1, ${MAX_BARS}]` },
      { status: 400 }
    )
  }
  const useSamples = obj.useSamples === true

  const parsed = parseNoteStream(obj.notes, bpm, bars)
  if (!parsed.ok) return parsed.response

  const rendered = await renderOnce(() =>
    renderExternalNotes(parsed.notes, { bars, bpm, seed, useSamples })
  )
  if (!rendered.ok) {
    console.error('[render-notes] render failed:', rendered.error.message)
    return NextResponse.json({ error: `Render failed: ${rendered.error.message}` }, { status: 500 })
  }
  const result = rendered.result

  const wav = encodeWav(result.samplesL, result.samplesR, result.sampleRate)
  const md5 = createHash('md5').update(Buffer.from(wav)).digest('hex')
  const common: Record<string, string> = {
    'X-Seed': String(seed),
    'X-Bpm': String(bpm),
    'X-Bars': String(bars),
    'X-Notes-Accepted': String(parsed.notes.length),
    'X-Notes-Dropped': String(parsed.dropped),
    'X-Render-Worker': 'inline',
    'X-Render-Cache': 'bypass',
    'X-Render-Lufs': result.lufs.toFixed(2),
    'X-Render-TruePeakDb': result.truePeakDb.toFixed(2),
    'X-Render-SamplePeakDb': result.samplePeakDb.toFixed(2),
    'X-Render-StereoWidth': result.stereoWidth.toFixed(4),
    'X-Duration-Sec': result.durationSec.toFixed(3),
    'X-Wav-Md5': md5,
  }

  // ?mode=json — machine-readable twin of the WAV response (measurements +
  // md5, no audio bytes). The md5 matches X-Wav-Md5 of the binary response.
  if (req.nextUrl.searchParams.get('mode') === 'json') {
    return NextResponse.json(
      {
        seed,
        bpm,
        bars,
        notesAccepted: parsed.notes.length,
        notesDropped: parsed.dropped,
        format: 'pcm_s16le/44100/stereo',
        durationSec: result.durationSec,
        md5,
        lufs: Number(result.lufs.toFixed(2)),
        truePeakDb: Number(result.truePeakDb.toFixed(2)),
        samplePeakDb: Number(result.samplePeakDb.toFixed(2)),
        stereoWidth: Number(result.stereoWidth.toFixed(4)),
        monoCompatibility: Number(result.monoCompatibility.toFixed(4)),
        events: result.events,
      },
      { headers: common }
    )
  }

  return new NextResponse(wav, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': wav.byteLength.toString(),
      'Cache-Control': 'no-cache',
      ...common,
    },
  })
}
