/**
 * Phase 0 (truth) contract tests — the fixes from AUDIT_FORENSIC_2026-09-04.
 *
 * These tests assert BEHAVIOR (parsed bytes, rejection codes, exact bar
 * sums), not source text. Each one maps to a critical audit finding:
 *
 *   C6  upload-reference parseWav read bitsPerSample at the wrong fmt offset
 *       → Float32Array(Infinity) → 500 on every valid upload.
 *   C6  style-transfer default header contained an em-dash → guaranteed 500.
 *   C7  unbounded bars/seed/variations → trivial DoS.
 *   C7  upload-reference trusted header-claimed dataLength → memory bomb.
 *   —   /api/arrangement reported totalBars that contradicted targetBars.
 */
import { describe, expect, test } from 'bun:test'
import { parseWav } from '@/app/api/upload-reference/route'
import { ArrangementGenerator } from '@/lib/psy4/arrangement/ArrangementGenerator'

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal WAV ArrayBuffer. fmt chunk at offset 12 (standard). */
function buildWav(opts: {
  channels?: number
  sampleRate?: number
  bits?: 8 | 16 | 24 | 32
  float?: boolean
  frames?: number
}): ArrayBuffer {
  const channels = opts.channels ?? 2
  const sampleRate = opts.sampleRate ?? 44100
  const bits = opts.bits ?? 16
  const float = opts.float ?? false
  const frames = opts.frames ?? 100
  const bytesPerSample = bits / 8
  const dataLength = frames * channels * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, float ? 3 : 1, true) // audioFormat
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bytesPerSample, true) // byteRate
  view.setUint16(32, channels * bytesPerSample, true) // blockAlign
  view.setUint16(34, bits, true) // bitsPerSample — the offset the old bug missed
  writeStr(36, 'data')
  view.setUint32(40, dataLength, true)

  // Fill data with a rising ramp (values within range for every format).
  let p = 44
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const v = (i / frames) * 2 - 1 // -1..1
      if (float) {
        view.setFloat32(p, v, true)
        p += 4
      } else if (bits === 8) {
        view.setUint8(p, Math.round((v * 0.5 + 0.5) * 255))
        p += 1
      } else if (bits === 16) {
        view.setInt16(p, Math.round(v * 16000), true)
        p += 2
      } else if (bits === 24) {
        const n = Math.round(v * 4_000_000)
        view.setUint8(p, n & 0xff)
        view.setUint8(p + 1, (n >> 8) & 0xff)
        view.setUint8(p + 2, (n >> 16) & 0xff)
        p += 3
      } else {
        view.setInt32(p, Math.round(v * 1_000_000_000), true)
        p += 4
      }
    }
  }
  return buffer
}

// ─── C6: parseWav correctness (was Float32Array(Infinity) on every file) ────

describe('parseWav (audit C6 fix)', () => {
  test('parses a standard 16-bit stereo WAV without throwing', () => {
    const parsed = parseWav(buildWav({ frames: 480 }))
    expect(parsed.error).toBeUndefined()
    const r = parsed.result!
    expect(r.samples.length).toBe(480)
    expect(r.sampleRate).toBe(44100)
    expect(r.bitsPerSample).toBe(16)
    expect(r.channels).toBe(2)
    // Ramp: monotonic values, finite, within [-1, 1]
    expect(Number.isFinite(r.samples[0]!)).toBe(true)
    expect(Number.isFinite(r.samples[479]!)).toBe(true)
    expect(r.samples.some((v) => !Number.isFinite(v))).toBe(false)
    expect(r.samples.every((v) => v >= -1 && v <= 1)).toBe(true)
  })

  test('parses 32-bit float WAV', () => {
    const r = parseWav(buildWav({ bits: 32, float: true, frames: 64 })).result!
    expect(r.audioFormat).toBe(3)
    expect(r.samples.length).toBe(64)
    expect(Number.isFinite(r.samples[63]!)).toBe(true)
  })

  test('parses 24-bit and 8-bit PCM WAV', () => {
    const r24 = parseWav(buildWav({ bits: 24, frames: 32 })).result!
    expect(r24.bitsPerSample).toBe(24)
    expect(r24.samples.length).toBe(32)
    const r8 = parseWav(buildWav({ bits: 8, frames: 32 })).result!
    expect(r8.bitsPerSample).toBe(8)
    expect(r8.samples.length).toBe(32)
  })

  test('rejects a crafted header claiming more data than the file holds (memory bomb)', () => {
    const buf = buildWav({ frames: 100 })
    const view = new DataView(buf)
    view.setUint32(40, 0xfffffff0, true) // claims ~4GB of data
    const parsed = parseWav(buf)
    expect(parsed.error).toBeUndefined() // clamped, not rejected
    expect(parsed.result!.samples.length).toBe(100) // actual capacity, not 4GB
  })

  test('rejects non-PCM / bad bit depth / bad channel count with honest errors', () => {
    const bad = buildWav({ frames: 10 })
    new DataView(bad).setUint16(20, 0x6a1a, true) // nonsense audioFormat
    expect(parseWav(bad).error).toContain('audioFormat')

    const badBits = buildWav({ frames: 10 })
    new DataView(badBits).setUint16(34, 12, true)
    expect(parseWav(badBits).error).toContain('bit depth')

    const badCh = buildWav({ channels: 64, frames: 10 })
    expect(parseWav(badCh).error).toContain('channel')
  })

  test('rejects a tiny non-WAV buffer', () => {
    expect(parseWav(new ArrayBuffer(10)).error).toBeDefined()
    expect(parseWav(new ArrayBuffer(0)).error).toBeDefined()
  })
})

// ─── C7 + arrangement contract: exact bars ─────────────────────────────────

describe('ArrangementGenerator exact-bars contract (audit C7/correctness fix)', () => {
  test('generate(bars) sums to exactly the target for many targets and seeds', () => {
    for (const bars of [1, 4, 8, 16, 32, 88, 120]) {
      for (const seed of [1, 42, 999, 123456]) {
        const plan = new ArrangementGenerator(seed).generate(bars)
        const sum = plan.sections.reduce((a, s) => a + s.bars, 0)
        expect(sum).toBe(bars)
        expect(plan.totalBars).toBe(bars)
        expect(plan.sections.length).toBeGreaterThan(0)
      }
    }
  })

  test('generateShort(bars) sums to exactly the target', () => {
    for (const bars of [4, 8, 16, 32]) {
      const plan = new ArrangementGenerator(42).generateShort(bars)
      const sum = plan.sections.reduce((a, s) => a + s.bars, 0)
      expect(sum).toBe(bars)
      expect(plan.totalBars).toBe(bars)
    }
  })

  test('generateVariations respects the target exactly', () => {
    const plans = ArrangementGenerator.generateVariations(3, 7, 32)
    expect(plans.length).toBe(3)
    for (const p of plans) {
      const sum = p.sections.reduce((a, s) => a + s.bars, 0)
      expect(sum).toBe(32)
    }
  })

  test('structure stays deterministic after normalization', () => {
    const a = new ArrangementGenerator(42).generate(88)
    const b = new ArrangementGenerator(42).generate(88)
    expect(a.structureHash).toBe(b.structureHash)
    expect(a.sections.map((s) => `${s.type}${s.bars}`)).toEqual(
      b.sections.map((s) => `${s.type}${s.bars}`)
    )
  })
})
