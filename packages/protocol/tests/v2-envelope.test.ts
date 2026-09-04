import { describe, expect, test } from 'bun:test'
// Honesty witness: the deprecation map points at types that ACTUALLY exist in
// the legacy modules. If a legacy type is renamed/removed, the type-level
// bindings in deprecations.ts (plus these imports) die the build.
import { InMemoryChannel } from '../src/channel.ts'
import type { Channel } from '../src/channel.ts'
import type { MusicalEvent as LegacyMusicalEvent } from '../src/events.ts'
import type { DeviceState as LegacyDeviceState } from '../src/state.ts'
import type { MusicalContext as LegacyMusicalContext } from '../src/state.ts'
import type { TransportState as LegacyTransportState } from '../src/state.ts'
import { DEPRECATIONS, LEGACY_TYPE_BINDINGS, V2_TYPE_BINDINGS } from '../src/v2/deprecations.ts'
import {
  buildEnvelope,
  canonicalJson,
  decodeEnvelope,
  encodeEnvelope,
  validateEnvelope,
} from '../src/v2/envelope.ts'
import {
  type BusEnvelope,
  type BusPayload,
  type ContextPayload,
  type ErrorPayload,
  type LatencyPayload,
  type NoteOffPayload,
  type NotePayload,
  type ParamLockPayload,
  type ParamSetPayload,
  type SidechainDuckPayload,
  type TransportPayload,
  type TrigPayload,
  type VoiceCountPayload,
  asChokeGroupId,
  asDeviceId,
  asParamId,
  asSceneId,
  asTrackId,
} from '../src/v2/types.ts'

/**
 * PSYBUS v2 envelope tests (phase 3.6, PLAN_V3_MASTER).
 *
 * Locks the proven psyboss PSYBUS semantics into foundation:
 * 1. round-trip exactness over the FULL payload union (15 kinds),
 * 2. validation rejects malformed envelopes with typed errors,
 * 3. canonical JSON byte-determinism (same envelope → same bytes, always),
 * 4. seeded property test (500 random valid envelopes round-trip exactly),
 * 5. the deprecation map stays honest — every entry names real legacy types.
 */

function transportPayload(beat: number): TransportPayload {
  // Spec contract: `beat` is a safe integer; the fractional position rides in
  // `phase` (beat % 1). Phase and beat stay consistent.
  const whole = Math.floor(beat)
  return {
    kind: 'transport',
    bpm: 140,
    beat: whole,
    bar: Math.floor(whole / 4) + 1,
    phase: beat - whole,
    playing: true,
  }
}
function notePayload(track: string, note: number): NotePayload {
  return { kind: 'note', track: asTrackId(track), note, vel: 0.8, durBeats: 0.25, channel: 1 }
}
function noteOffPayload(track: string, note: number): NoteOffPayload {
  return { kind: 'note.off', track: asTrackId(track), note }
}
function trigPayload(track: string, scene: string): TrigPayload {
  return { kind: 'trig', track: asTrackId(track), scene: asSceneId(scene) }
}
function duckPayload(track: string): SidechainDuckPayload {
  return { kind: 'sidechain.duck', target: asTrackId(track), depth: 0.6, releaseMs: 120 }
}
function chokePayload(group: string): { kind: 'choke'; group: ReturnType<typeof asChokeGroupId> } {
  return { kind: 'choke', group: asChokeGroupId(group) }
}
function paramLockPayload(track: string, step: number): ParamLockPayload {
  return {
    kind: 'param.lock',
    track: asTrackId(track),
    step,
    param: asParamId('cutoff'),
    value: 0.42,
  }
}
function paramSetPayload(track: string): ParamSetPayload {
  return { kind: 'param.set', track: asTrackId(track), param: asParamId('resonance'), value: 0.7 }
}
function latencyPayload(device: string): LatencyPayload {
  return { kind: 'latency', device: asDeviceId(device), reportLatencyMs: 12.5 }
}
function voiceCountPayload(device: string): VoiceCountPayload {
  return { kind: 'voice.count', device: asDeviceId(device), active: 3, stolen: 1 }
}
function errorPayload(device: string): ErrorPayload {
  return {
    kind: 'error',
    device: asDeviceId(device),
    code: 'E_VOICE_STEAL',
    message: 'voice pool exhausted',
  }
}
function contextPayload(): ContextPayload {
  return { kind: 'context', key: 'A', scale: 'minor', energy: 0.75, section: 'build' }
}

/** One valid envelope per payload kind + addressing shape. 15 kinds total. */
function envelopeMatrix(): Array<{ label: string; payload: BusPayload; dst: string }> {
  return [
    { label: 'transport', payload: transportPayload(9.5), dst: 'broadcast' },
    { label: 'transport.seek', payload: { kind: 'transport.seek', beat: 32 }, dst: 'broadcast' },
    { label: 'transport.start', payload: { kind: 'transport.start' }, dst: 'broadcast' },
    { label: 'transport.stop', payload: { kind: 'transport.stop' }, dst: 'broadcast' },
    { label: 'context', payload: contextPayload(), dst: 'broadcast' },
    { label: 'note', payload: notePayload('bass', 45), dst: 'dev-bass-synth' },
    { label: 'note.off', payload: noteOffPayload('bass', 45), dst: 'dev-bass-synth' },
    { label: 'trig', payload: trigPayload('drums', 'drop-a'), dst: 'dev-psydrum' },
    { label: 'sidechain.duck', payload: duckPayload('bass'), dst: 'broadcast' },
    { label: 'choke', payload: chokePayload('hats'), dst: 'dev-psydrum' },
    { label: 'param.lock', payload: paramLockPayload('lead', 7), dst: 'dev-lead' },
    { label: 'param.set', payload: paramSetPayload('lead'), dst: 'dev-lead' },
    { label: 'latency', payload: latencyPayload('dev-psydrum'), dst: 'host' },
    { label: 'voice.count', payload: voiceCountPayload('dev-bass-synth'), dst: 'host' },
    { label: 'error', payload: errorPayload('dev-lead'), dst: 'host' },
  ]
}

const BASE_INPUT = { rev: 7, seed: 1234, src: 'host', ts: 1.25 } as const

function buildOk(payload: BusPayload, dst = 'broadcast'): BusEnvelope {
  const result = buildEnvelope({ ...BASE_INPUT, dst, payload })
  if (!result.ok)
    throw new Error(
      `buildEnvelope unexpectedly failed for ${payload.kind}: ${JSON.stringify(result.error)}`
    )
  return result.value
}

describe('PSYBUS v2 — round-trip exactness over the full payload union', () => {
  for (const { label, payload, dst } of envelopeMatrix()) {
    test(`round-trips ${label} (dst=${dst})`, () => {
      const built = buildOk(payload, dst)
      const encoded = encodeEnvelope(built)
      expect(encoded.ok).toBe(true)
      const decoded = decodeEnvelope(encoded.ok ? encoded.value : '')
      expect(decoded.ok).toBe(true)
      if (decoded.ok) expect(decoded.value).toEqual(built)
    })
  }

  test('host→device, device→host, device→device and broadcast all address correctly', () => {
    const h2d = buildOk(notePayload('bass', 40), 'dev-bass-synth')
    const d2h = buildOk(latencyPayload('dev-bass-synth'), 'host')
    const d2d = buildOk(chokePayload('hats'), 'dev-psydrum')
    const bc = buildOk(transportPayload(1), 'broadcast')
    expect(h2d.src).toBe('host')
    expect(d2h.dst).toBe(asDeviceId('host'))
    expect(d2d.src).toBe('host') // src is validated+branded regardless of direction
    expect(bc.dst).toBe('broadcast')
  })
})

describe('PSYBUS v2 — validation rejects malformed envelopes (typed errors, no throws)', () => {
  test('missing required envelope fields are rejected per-field', () => {
    for (const key of ['rev', 'seed', 'src', 'dst', 'ts', 'payload']) {
      const broken: Record<string, unknown> = {
        ...BASE_INPUT,
        dst: 'broadcast',
        payload: transportPayload(1),
      }
      delete broken[key]
      const result = validateEnvelope(broken)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code.length).toBeGreaterThan(0)
    }
  })

  test('negative rev, non-finite ts and non-numeric seed are rejected', () => {
    expect(
      validateEnvelope({ ...BASE_INPUT, dst: 'broadcast', rev: -1, payload: transportPayload(1) })
        .ok
    ).toBe(false)
    expect(
      validateEnvelope({
        ...BASE_INPUT,
        dst: 'broadcast',
        ts: Number.NaN,
        payload: transportPayload(1),
      }).ok
    ).toBe(false)
    expect(
      validateEnvelope({ ...BASE_INPUT, dst: 'broadcast', seed: 'x', payload: transportPayload(1) })
        .ok
    ).toBe(false)
  })

  test('unknown payload kind is rejected', () => {
    const result = validateEnvelope({
      ...BASE_INPUT,
      dst: 'broadcast',
      payload: { kind: 'not-a-real-kind' },
    })
    expect(result.ok).toBe(false)
  })

  test('kind-mismatched payload fields are rejected (note without track, latency without device)', () => {
    expect(
      validateEnvelope({ ...BASE_INPUT, dst: 'broadcast', payload: { kind: 'note', note: 60 } }).ok
    ).toBe(false)
    expect(
      validateEnvelope({
        ...BASE_INPUT,
        dst: 'broadcast',
        payload: { kind: 'latency', reportLatencyMs: 5 },
      }).ok
    ).toBe(false)
  })

  test('oversized payloads beyond MAX_ENVELOPE_JSON_BYTES are rejected', async () => {
    const { MAX_ENVELOPE_JSON_BYTES } = await import('../src/v2/envelope.ts')
    const huge = {
      kind: 'error',
      device: asDeviceId('d'),
      code: 'X',
      message: 'x'.repeat(MAX_ENVELOPE_JSON_BYTES + 1),
    }
    expect(validateEnvelope({ ...BASE_INPUT, dst: 'broadcast', payload: huge }).ok).toBe(false)
  })

  test('ids longer than MAX_ID_LENGTH are rejected', async () => {
    const { MAX_ID_LENGTH } = await import('../src/v2/envelope.ts')
    expect(
      validateEnvelope({
        ...BASE_INPUT,
        src: 'x'.repeat(MAX_ID_LENGTH + 1),
        dst: 'broadcast',
        payload: transportPayload(1),
      }).ok
    ).toBe(false)
  })

  test('decodeEnvelope rejects corrupt JSON and wrong-version envelopes without throwing', () => {
    expect(decodeEnvelope('{not json').ok).toBe(false)
    const wrongVersion = JSON.stringify({
      ...JSON.parse(JSON.stringify(buildOk(transportPayload(1)))),
      pv: 99,
    })
    expect(decodeEnvelope(wrongVersion).ok).toBe(false)
  })
})

describe('PSYBUS v2 — canonical JSON determinism', () => {
  test('same envelope always serializes byte-identical, independent of key insertion order', () => {
    const a = {
      pv: 2,
      rev: 1,
      seed: 2,
      src: 'host',
      dst: 'broadcast',
      ts: 0,
      payload: { kind: 'note', track: 'bass', note: 40, vel: 0.8, durBeats: 0.25, channel: 1 },
    }
    const b = {
      payload: { channel: 1, durBeats: 0.25, vel: 0.8, note: 40, track: 'bass', kind: 'note' },
      ts: 0,
      dst: 'broadcast',
      src: 'host',
      seed: 2,
      rev: 1,
      pv: 2,
    }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(encodeEnvelope(buildOk(notePayload('bass', 40))).ok).toBe(true)
    const enc1 = encodeEnvelope(buildOk(notePayload('bass', 40)))
    const enc2 = encodeEnvelope(buildOk(notePayload('bass', 40)))
    expect(enc1).toEqual(enc2)
  })

  test('nested payload objects also canonicalize (deep key order)', () => {
    const deep1 = { z: { b: 1, a: { y: 2, x: 3 } }, a: 0 }
    const deep2 = { a: 0, z: { a: { x: 3, y: 2 }, b: 1 } }
    expect(canonicalJson(deep1)).toBe(canonicalJson(deep2))
  })
})

describe('PSYBUS v2 — seeded property test (determinism is sacred)', () => {
  // xorshift32 — seeded, reproducible; no Math.random anywhere in this suite.
  function makeRng(seed: number): () => number {
    let s = seed | 0
    if (s === 0) s = 0x9e3779b9
    return () => {
      s ^= s << 13
      s ^= s >>> 17
      s ^= s << 5
      s |= 0
      return (s >>> 0) / 0x100000000
    }
  }

  test('500 random valid envelopes build → encode → decode exactly', () => {
    const rng = makeRng(0x5eed)
    const kinds: Array<(r: () => number) => BusPayload> = [
      (r) => transportPayload(Math.floor(r() * 64)),
      (r) => ({ kind: 'transport.seek', beat: Math.floor(r() * 64) }),
      () => ({ kind: 'transport.start' }),
      () => ({ kind: 'transport.stop' }),
      (r) => ({
        kind: 'context',
        key: 'ABCDEF'[Math.floor(r() * 6)],
        scale: 'minor',
        energy: r(),
        section: 'build',
      }),
      (r) => notePayload(`track-${Math.floor(r() * 4)}`, Math.floor(r() * 128)),
      (r) => noteOffPayload(`track-${Math.floor(r() * 4)}`, Math.floor(r() * 128)),
      (r) => trigPayload(`track-${Math.floor(r() * 4)}`, `scene-${Math.floor(r() * 8)}`),
      (r) => duckPayload(`track-${Math.floor(r() * 4)}`),
      (r) => chokePayload(`group-${Math.floor(r() * 4)}`),
      (r) => paramLockPayload(`track-${Math.floor(r() * 4)}`, Math.floor(r() * 16)),
      (r) => paramSetPayload(`track-${Math.floor(r() * 4)}`),
      (r) => latencyPayload(`dev-${Math.floor(r() * 8)}`),
      (r) => voiceCountPayload(`dev-${Math.floor(r() * 8)}`),
      (r) => errorPayload(`dev-${Math.floor(r() * 8)}`),
    ]
    for (let i = 0; i < 500; i++) {
      const payload = kinds[Math.floor(rng() * kinds.length)](rng)
      const dst = rng() < 0.5 ? 'broadcast' : `dev-${Math.floor(rng() * 8)}`
      const built = buildOk(payload, dst)
      const encoded = encodeEnvelope(built)
      if (!encoded.ok)
        throw new Error(
          `encode failed at i=${i} kind=${payload.kind}: ${JSON.stringify(encoded.error)}`
        )
      const decoded = decodeEnvelope(encoded.value)
      if (!decoded.ok)
        throw new Error(
          `decode failed at i=${i} kind=${payload.kind}: ${JSON.stringify(decoded.error)}`
        )
      expect(decoded.value).toEqual(built)
    }
  })
})

describe('PSYBUS v2 — deprecation map honesty', () => {
  test('every DEPRECATIONS entry points at a legacy type that still exists (type-level bindings)', () => {
    // LEGACY_TYPE_BINDINGS is `{ [K in keyof LegacyTypeWitness]: true }` —
    // tsc-enforced: if a legacy type in the map is renamed/removed, this file
    // stops compiling. The runtime assertion documents the same contract.
    expect(Object.keys(LEGACY_TYPE_BINDINGS).length).toBeGreaterThanOrEqual(15)
    expect(Object.keys(V2_TYPE_BINDINGS).length).toBeGreaterThanOrEqual(15)
    for (const entry of DEPRECATIONS) {
      expect(entry.status).toBe('deprecated-in-v2')
      expect(entry.migration.length).toBeGreaterThan(0)
      expect(entry.replacedBy.length).toBeGreaterThan(0)
    }
  })

  test('legacy modules are real and importable (channel/events/state)', () => {
    // Runtime witness for the channel module: InMemoryChannel constructs.
    const legacyChannel: Channel = new InMemoryChannel()
    expect(legacyChannel).toBeDefined()
    // Type-level witnesses (compile-time existence proof for the mapped names):
    const t: LegacyTransportState | null = null
    const c: LegacyMusicalContext | null = null
    const d: LegacyDeviceState | null = null
    const e: LegacyMusicalEvent | null = null
    void t
    void c
    void d
    void e
  })
})
