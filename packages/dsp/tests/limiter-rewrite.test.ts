/**
 * Master-chain limiter behavior tests (moved from apps/web into the package
 * that owns the implementation — DECISIONS_V3 D1).
 *
 * Sources:
 *   - apps/web/tests/phase1-limiter-rewrite.test.ts (Phase 1.2 audit C3 fix)
 *   - apps/web/tests/phase1-day2.test.ts → TruePeakLimiter describe
 *   - apps/web/tests/dsp-primitives.test.ts → TruePeakLimiter describes
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
import { TruePeakLimiter } from '../src/index.ts'

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
      R[i] = L[i]
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
      R[i] = L[i]
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
      R[i] = L[i]
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
        R[i] = L[i]
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

// ─── Moved from apps/web/tests/phase1-day2.test.ts ──────────────────────────

describe('TruePeakLimiter — Phase 1 Day 2 ISP fix', () => {
  test('output true-peak does not exceed 0 dBFS', () => {
    const limiter = new TruePeakLimiter({
      ceilingDb: -0.2,
      thresholdDb: -0.3,
      sampleRate: SR,
    })

    // Generate loud signal with steep transients
    const n = SR * 0.5
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      // 1kHz at high amplitude + harmonics for steep edges
      const s =
        Math.sin((2 * Math.PI * 1000 * i) / SR) * 1.5 +
        Math.sin((2 * Math.PI * 3000 * i) / SR) * 0.5
      L[i] = s
      R[i] = s
    }

    limiter.processBuffer(L, R)

    // Check sample peak
    let maxSample = 0
    for (let i = 0; i < n; i++) {
      maxSample = Math.max(maxSample, Math.abs(L[i] ?? 0))
    }

    // Phase 1.2 rewrite: the brickwall clip now runs at the ADVERTISED
    // ceiling (-0.2 dB = 0.977 linear), not at ceiling × 0.65 as before
    // (the audit's C3 finding). Sample peak must respect the actual ceiling
    // with a tiny float epsilon — and NOT be squashed to ~0.64 like the old
    // behavior.
    const ceilingLinear = 10 ** (-0.2 / 20)
    expect(maxSample).toBeLessThanOrEqual(ceilingLinear + 1e-6)
    expect(maxSample).toBeGreaterThan(0.9) // headroom is actually used now
  })

  test('limiter does not silence quiet input', () => {
    const limiter = new TruePeakLimiter({
      ceilingDb: -0.5,
      sampleRate: SR,
    })

    const n = SR * 0.5
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      L[i] = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.1
      R[i] = L[i]
    }

    limiter.processBuffer(L, R)

    let energy = 0
    for (let i = 0; i < n; i++) energy += (L[i] ?? 0) ** 2
    const rms = Math.sqrt(energy / n)
    expect(rms).toBeGreaterThan(0.05)
  })

  test('limiter reduces gain on loud input (gainReductionDb < 0)', () => {
    const limiter = new TruePeakLimiter({
      ceilingDb: -1.0,
      thresholdDb: -1.5,
      sampleRate: SR,
    })

    const n = SR * 0.5
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      L[i] = Math.sin((2 * Math.PI * 1000 * i) / SR) * 2.0
      R[i] = L[i]
    }

    limiter.processBuffer(L, R)
    const gr = limiter.getMaxGainReductionDb()
    expect(gr).toBeLessThan(-3) // at least 3 dB of gain reduction
  })
})

// ─── Moved from apps/web/tests/dsp-primitives.test.ts ───────────────────────

describe('TruePeakLimiter — sample peak limiting', () => {
  test('output sample peak does not exceed ceiling (with tolerance)', () => {
    const limiter = new TruePeakLimiter({
      ceilingDb: -0.5, // ~0.944 linear
      releaseMs: 100,
      sampleRate: SR,
    })

    const n = Math.floor(SR * 0.5)
    const inputL = new Float32Array(n)
    const inputR = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      // +6dB over ceiling (amplitude 1.9)
      inputL[i] = Math.sin((2 * Math.PI * 1000 * i) / SR) * 1.9
      inputR[i] = inputL[i]
    }

    // processBuffer modifies in-place
    limiter.processBuffer(inputL, inputR)

    let maxPeak = 0
    for (let i = 0; i < inputL.length; i++) {
      maxPeak = Math.max(maxPeak, Math.abs(inputL[i] ?? 0))
    }

    // Phase 1.2: the limiter clips at the advertised ceiling — well below the
    // +0.2 dB tolerance the old (pre-rewrite) limiter needed.
    expect(maxPeak).toBeLessThanOrEqual(0.944 + 0.2)
  })

  test('limiter does not silence quiet input', () => {
    const limiter = new TruePeakLimiter({
      ceilingDb: -0.5,
      releaseMs: 100,
      sampleRate: SR,
    })

    const n = Math.floor(SR * 0.5)
    const inputL = new Float32Array(n)
    const inputR = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      // Quiet 1kHz at -20dB
      inputL[i] = Math.sin((2 * Math.PI * 1000 * i) / SR) * 0.1
      inputR[i] = inputL[i]
    }

    limiter.processBuffer(inputL, inputR)

    let energy = 0
    for (let i = 0; i < inputL.length; i++) energy += (inputL[i] ?? 0) ** 2
    const rms = Math.sqrt(energy / inputL.length)

    // RMS of -20dB sine is ~0.0707, expect ≥ 0.05
    expect(rms).toBeGreaterThan(0.05)
  })
})

describe('TruePeakLimiter — non-default sample rates (D2: sampleRate required)', () => {
  // Moved from apps/web/tests/phase1-day4.test.ts.
  test('works at 48kHz', () => {
    const sr = 48000
    const limiter = new TruePeakLimiter({
      ceilingDb: -0.5,
      sampleRate: sr,
    })

    const n = sr * 0.1
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      L[i] = Math.sin((2 * Math.PI * 1000 * i) / sr) * 0.5
      R[i] = L[i]
    }

    limiter.processBuffer(L, R)

    let maxPeak = 0
    for (let i = 0; i < n; i++) {
      maxPeak = Math.max(maxPeak, Math.abs(L[i] ?? 0))
    }
    expect(maxPeak).toBeLessThanOrEqual(1.0)
  })

  test('lookahead scales with sampleRate (48kHz vs 96kHz)', () => {
    expect(new TruePeakLimiter({ sampleRate: 48000 }).getLookaheadSamples()).toBe(
      Math.round(0.005 * 48000)
    )
    expect(new TruePeakLimiter({ sampleRate: 96000 }).getLookaheadSamples()).toBe(
      Math.round(0.005 * 96000)
    )
  })
})
