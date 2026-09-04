/**
 * OTT behavior tests (moved from apps/web/tests/roast-fix.test.ts 'Roast Fix 9'
 * into the package that owns the implementation — DECISIONS_V3 D1).
 *
 * D2 note: `sampleRate` is now REQUIRED in OTTOptions, so the moved tests pass
 * it explicitly (all production call sites always did).
 */
import { describe, expect, test } from 'bun:test'
import { OTT } from '../src/index.ts'

describe('OTT clamps extreme params (was 685 billion output)', () => {
  test('OTT with depth=10 produces bounded output (was 186x)', () => {
    const sr = 44100
    const ott = new OTT({ sampleRate: sr, depth: 10 }) // clamped to 1
    const L = new Float32Array(sr)
    const R = new Float32Array(sr)
    for (let i = 0; i < sr; i++) {
      L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
      R[i] = L[i]
    }
    ott.processBuffer(L, R)
    let maxOut = 0
    for (let i = 0; i < sr; i++) maxOut = Math.max(maxOut, Math.abs(L[i] ?? 0))
    expect(maxOut).toBeLessThan(10) // was 186 before clamp
    expect(maxOut).toBeGreaterThan(0) // still produces signal
  })

  test('OTT with upwardGain=20dB produces bounded output (was 685 billion)', () => {
    const sr = 44100
    const ott = new OTT({ sampleRate: sr, depth: 1, upwardGainDb: 20 }) // clamped to 12
    const L = new Float32Array(sr)
    const R = new Float32Array(sr)
    for (let i = 0; i < sr; i++) {
      L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
      R[i] = L[i]
    }
    ott.processBuffer(L, R)
    let maxOut = 0
    for (let i = 0; i < sr; i++) maxOut = Math.max(maxOut, Math.abs(L[i] ?? 0))
    expect(maxOut).toBeLessThan(100) // was 685 billion before clamp
    expect(Number.isFinite(maxOut)).toBe(true)
  })

  test('OTT with normal params still works (no regression)', () => {
    const sr = 44100
    const ott = new OTT({ sampleRate: sr, depth: 0.3, upwardGainDb: 2, downwardGainDb: -2 })
    const L = new Float32Array(sr)
    const R = new Float32Array(sr)
    for (let i = 0; i < sr; i++) {
      L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
      R[i] = L[i]
    }
    ott.processBuffer(L, R)
    let maxOut = 0
    for (let i = 0; i < sr; i++) maxOut = Math.max(maxOut, Math.abs(L[i] ?? 0))
    expect(maxOut).toBeGreaterThan(0.1)
    expect(maxOut).toBeLessThan(1.0)
  })

  test('OTT depth=0 is still a no-op', () => {
    const sr = 44100
    const ott = new OTT({ sampleRate: sr, depth: 0 })
    const L = new Float32Array(sr)
    const R = new Float32Array(sr)
    for (let i = 0; i < sr; i++) {
      L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
      R[i] = L[i]
    }
    const Lin = L.slice()
    ott.processBuffer(L, R)
    let maxDiff = 0
    for (let i = 0; i < sr; i++) maxDiff = Math.max(maxDiff, Math.abs((Lin[i] ?? 0) - (L[i] ?? 0)))
    expect(maxDiff).toBe(0) // true no-op
  })
})
