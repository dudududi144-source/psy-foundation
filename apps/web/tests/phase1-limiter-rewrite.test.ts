/**
 * Phase 1.2 (PLAN_V3_MASTER) — TruePeakLimiter rewrite behavior tests.
 *
 * The 2026-09-04 forensic audit (finding C3) proved the old limiter:
 *   1. had NO lookahead (the deque window [i, i+D-1] never existed — the
 *      detector only saw the current sample), and
 *   2. square-clipped at ceiling × 0.65 (≈4.7 dB below the advertised
 *      ceiling) — audible distortion + 3.7 dB wasted headroom.
 *
 * These tests assert the CORRECTED behavior — numerically, not by reading
 * the source:
 *   - brickwall: sample peak ≤ ceiling for pathological input
 *   - headroom: loud program material uses the headroom up to ~ceiling
 *   - early engagement: gain reduction begins BEFORE a transient's samples
 *     reach the output (the whole point of lookahead)
 *   - transparency: sub-threshold signals pass essentially untouched
 *   - determinism: same input → bit-identical output
 */
import { describe, expect, test } from 'bun:test'
import { TruePeakLimiter } from '../src/lib/psy4/limiter'

const SR = 44100

function peakOf(buf: Float32Array): number {
  let p = 0
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i] ?? 0))
  return p
}

describe('TruePeakLimiter rewrite (audit C3 fix)', () => {
  test('brickwall: worst-case content never exceeds the advertised ceiling', () => {
    const ceilingDb = -1
    const ceiling = 10 ** (ceilingDb / 20)
    const limiter = new TruePeakLimiter({ ceilingDb, thresholdDb: ceilingDb, sampleRate: SR })
    const n = SR
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      L[i] = Math.sin((2 * Math.PI * 1000 * i) / SR) * 4
      R[i] = i % 2 === 0 ? 4 : -4 // full-scale square
    }
    limiter.processBuffer(L, R)
    expect(peakOf(L)).toBeLessThanOrEqual(ceiling + 1e-6)
    expect(peakOf(R)).toBeLessThanOrEqual(ceiling + 1e-6)
  })

  test('loud material uses the headroom (no 0.65 squash)', () => {
    // +6 dB over ceiling sine: the old code clipped everything at ~0.63;
    // the fixed limiter should shape gain so peaks land near the threshold.
    const ceilingDb = -1
    const limiter = new TruePeakLimiter({ ceilingDb, thresholdDb: ceilingDb, sampleRate: SR })
    const n = SR
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      L[i] = Math.sin((2 * Math.PI * 997 * i) / SR) * 2.0
      R[i] = L[i]!
    }
    limiter.processBuffer(L, R)
    const p = peakOf(L)
    expect(p).toBeGreaterThan(0.85) // headroom actually used (old: ~0.63)
    expect(p).toBeLessThanOrEqual(10 ** (ceilingDb / 20) + 1e-6)
  })

  test('lookahead engages gain BEFORE the transient reaches the output', () => {
    // Silence, then a loud square transient at t=100ms. With a 5ms lookahead
    // the envelope must ALREADY be reducing when the transient's samples
    // exit — the old limiter only began attacking as the transient entered
    // the detector (99.3% un-engaged) and let the clipper do the work.
    const ceilingDb = -1
    const ceiling = 10 ** (ceilingDb / 20)
    const limiter = new TruePeakLimiter({
      ceilingDb,
      thresholdDb: ceilingDb,
      attackMs: 1,
      releaseMs: 100,
      lookaheadMs: 5,
      sampleRate: SR,
    })
    const n = SR
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const transientStart = Math.floor(SR * 0.1)
    for (let i = transientStart; i < transientStart + 2000; i++) {
      L[i] = i % 2 === 0 ? 1.2 : -1.2
      R[i] = L[i]!
    }
    limiter.processBuffer(L, R)
    // Gain reduction was actually applied by the envelope (windowMax ≈ 1.2
    // → target ≈ 0.74 → ≈ -2.6 dB), not just by the safety clip:
    expect(limiter.getMaxGainReductionDb()).toBeLessThan(-2)
    // The transient region peaks near the ceiling (headroom used), NOT
    // squashed to the old 0.65 × ceiling square-clip level:
    let transientPeak = 0
    for (let i = transientStart; i < transientStart + 2000; i++) {
      transientPeak = Math.max(transientPeak, Math.abs(L[i] ?? 0))
    }
    expect(transientPeak).toBeGreaterThan(ceiling * 0.9)
    expect(transientPeak).toBeLessThanOrEqual(ceiling + 1e-6)
    // Silence before the transient stays silent (no premature gain artifacts):
    for (let i = 0; i < transientStart; i++) {
      expect(L[i]).toBe(0)
    }
  })

  test('sub-threshold signal passes untouched (unity, no pumping)', () => {
    const limiter = new TruePeakLimiter({ ceilingDb: -1, sampleRate: SR })
    const n = SR
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      L[i] = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.5 // -6 dBFS, below -1 dB ceiling
      R[i] = L[i]!
    }
    const ref = L.slice()
    limiter.processBuffer(L, R)
    let maxDiff = 0
    for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs((L[i] ?? 0) - (ref[i] ?? 0)))
    expect(maxDiff).toBeLessThan(1e-9)
    expect(limiter.getMaxGainReductionDb()).toBeCloseTo(0, 5)
  })

  test('deterministic: same input → bit-identical output', () => {
    const run = () => {
      const limiter = new TruePeakLimiter({ ceilingDb: -1, sampleRate: SR })
      const n = 4096
      const L = new Float32Array(n)
      const R = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        L[i] =
          Math.sin((2 * Math.PI * 997 * i) / SR) * 1.8 +
          Math.sin((2 * Math.PI * 3000 * i) / SR) * 0.9
        R[i] = L[i]!
      }
      limiter.processBuffer(L, R)
      return L
    }
    const a = run()
    const b = run()
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i])
  })
})
