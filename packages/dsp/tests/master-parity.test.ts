/**
 * Master-chain parity tests (DECISIONS_V3 D7 + D3).
 *
 * D7: before the master chain moved from apps/web/src/lib/psy4 into this
 * package, the CURRENT implementations rendered deterministic seeded test
 * signals; the outputs are committed as tests/fixtures/master-parity.json.
 * The moved classes must reproduce them BIT-EXACTLY — except OTT, which was
 * intentionally fixed during the move (D3: per-channel expanders instead of
 * one shared BandExpander per band across L/R).
 *
 * The signal generators and the mulberry32 PRNG below MUST stay in sync with
 * the capture script (see fixture meta.prng) — no Math.random anywhere.
 */
import { describe, expect, test } from 'bun:test'
import { MultibandCompressor, OTT, TruePeakLimiter, measureLUFS } from '../src/index.ts'
import fixture from './fixtures/master-parity.json'

const SR: number = fixture.meta.sampleRate
const N = SR // 1 second
const CAPTURE_LEN: number = fixture.meta.captureLength

// ─── Seeded PRNG (mulberry32) — MUST stay in sync with the capture script ───
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Signal generators — MUST stay in sync with the capture script ─────────

/** (a) 1s psy-like loop: kick-like amplitude pulses + saw tone + shaped noise. */
function psyLoop(seed: number): { L: Float32Array; R: Float32Array } {
  const randL = mulberry32(seed)
  const randR = mulberry32(seed + 1)
  const L = new Float32Array(N)
  const R = new Float32Array(N)

  // One-pole LP state for shaped noise (cutoff ~4 kHz).
  const lpA = 1 - Math.exp((-2 * Math.PI * 4000) / SR)
  let noiseL = 0
  let noiseR = 0

  const kickInterval = 0.5 // seconds (120 BPM feel)
  const kickDecay = 0.08 // time constant
  const sawFreqL = 220
  const sawFreqR = 221 // slight detune → stereo content

  for (let i = 0; i < N; i++) {
    const t = i / SR

    // Kick: 55 Hz sine burst, exp decay, retriggered every kickInterval.
    const phase = t % kickInterval
    const kickEnv = Math.exp(-phase / kickDecay)
    const kick = Math.sin(2 * Math.PI * 55 * phase) * kickEnv * 0.9

    // Naive saw tone.
    const sawL = 2 * ((t * sawFreqL) % 1) - 1
    const sawR = 2 * ((t * sawFreqR) % 1) - 1

    // Shaped noise (one-pole LP of white noise from the seeded PRNG).
    noiseL += lpA * (randL() * 2 - 1 - noiseL)
    noiseR += lpA * (randR() * 2 - 1 - noiseR)

    L[i] = kick + sawL * 0.2 + noiseL * 0.1
    R[i] = kick + sawR * 0.2 + noiseR * 0.1
  }
  return { L, R }
}

/** (b) 1 kHz full-scale sine, stereo (L = R). */
function sine1k(): { L: Float32Array; R: Float32Array } {
  const L = new Float32Array(N)
  const R = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const s = Math.sin((2 * Math.PI * 1000 * i) / SR)
    L[i] = s
    R[i] = s
  }
  return { L, R }
}

/**
 * (c) 1s stereo signal where L and R have clearly different dynamics:
 * L = loud kick-like pulses (0.9 amplitude bursts, mostly silent between),
 * R = steady moderate 200 Hz sine (0.15).
 */
function asymmetric(seed: number): { L: Float32Array; R: Float32Array } {
  const rand = mulberry32(seed)
  const L = new Float32Array(N)
  const R = new Float32Array(N)
  const kickInterval = 0.5
  const kickDecay = 0.06
  for (let i = 0; i < N; i++) {
    const t = i / SR
    const phase = t % kickInterval
    const kickEnv = Math.exp(-phase / kickDecay)
    const kick = Math.sin(2 * Math.PI * 60 * phase) * kickEnv * 0.9
    // L: pulses + a touch of seeded noise; R: steady tone (very different crest).
    const noise = rand() * 2 - 1
    L[i] = kick + noise * 0.05
    R[i] = Math.sin(2 * Math.PI * 200 * t) * 0.15
  }
  return { L, R }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SEED_ASYM = 31337
const LIMITER_PARAMS = { thresholdDb: -1.5, ceilingDb: -1.5, sampleRate: SR }

/** Round to 1e-9 the same way the capture script did (and normalize -0). */
function r9(x: number): number {
  const v = Math.round(x * 1e9) / 1e9
  return v === 0 ? 0 : v
}

/** Bit-exact comparison of the first CAPTURE_LEN samples against the fixture. */
function expectParity(out: Float32Array, expected: number[], label: string): void {
  expect(out.length).toBeGreaterThanOrEqual(CAPTURE_LEN)
  for (let i = 0; i < CAPTURE_LEN; i++) {
    if (r9(out[i]) !== expected[i]) {
      throw new Error(
        `${label} parity FAILED at sample ${i}: got ${out[i]}, fixture ${expected[i]}`
      )
    }
  }
}

// ─── Parity: limiter (D7 bit-exact) ─────────────────────────────────────────

describe('master parity vs pre-move fixtures (D7)', () => {
  test('TruePeakLimiter reproduces the pre-move output bit-exactly', () => {
    const f = fixture.cases.limiter
    const { L, R } = psyLoop(f.seed)
    const limiter = new TruePeakLimiter({ ...f.params, sampleRate: SR })
    limiter.processBuffer(L, R)
    expectParity(L, f.outputL, 'limiter L')
    expectParity(R, f.outputR, 'limiter R')
    expect(r9(limiter.getMaxGainReductionDb())).toBe(f.maxGainReductionDb)
  })

  test('MultibandCompressor reproduces the pre-move output bit-exactly', () => {
    const f = fixture.cases.multiband
    const { L, R } = psyLoop(f.seed)
    const mb = new MultibandCompressor({ ...f.params, sampleRate: SR })
    mb.processBuffer(L, R)
    expectParity(L, f.outputL, 'multiband L')
    expectParity(R, f.outputR, 'multiband R')
    expect(r9(mb.getLowGainReductionDb())).toBe(f.lowGainReductionDb)
    expect(r9(mb.getMidGainReductionDb())).toBe(f.midGainReductionDb)
    expect(r9(mb.getHighGainReductionDb())).toBe(f.highGainReductionDb)
  })

  test('measureLUFS reproduces the pre-move scalars on the limiter output', () => {
    const f = fixture.cases.loudness
    const { L, R } = psyLoop(f.seed)
    const limiter = new TruePeakLimiter(LIMITER_PARAMS)
    limiter.processBuffer(L, R)
    const res = measureLUFS(L, R, SR)
    // Rounding boundary can straddle ±1 unit in the last (1e-9) place.
    expect(Math.abs(res.integratedLUFS - f.lufs.integratedLUFS)).toBeLessThanOrEqual(2e-9)
    expect(Math.abs(res.momentaryLUFS - f.lufs.momentaryLUFS)).toBeLessThanOrEqual(2e-9)
    expect(Math.abs(res.shortTermLUFS - f.lufs.shortTermLUFS)).toBeLessThanOrEqual(2e-9)
    expect(Math.abs(res.truePeakDb - f.lufs.truePeakDb)).toBeLessThanOrEqual(2e-9)
    expect(Math.abs(res.samplePeakDb - f.lufs.samplePeakDb)).toBeLessThanOrEqual(2e-9)
    expect(Math.abs(res.rangeLU - f.lufs.rangeLU)).toBeLessThanOrEqual(2e-9)
  })

  test('measureLUFS reproduces the pre-move scalars on the 1kHz full-scale sine', () => {
    const f = fixture.cases.loudnessSine
    const { L, R } = sine1k()
    const res = measureLUFS(L, R, SR)
    expect(Math.abs(res.integratedLUFS - f.lufs.integratedLUFS)).toBeLessThanOrEqual(2e-9)
    expect(Math.abs(res.truePeakDb - f.lufs.truePeakDb)).toBeLessThanOrEqual(2e-9)
    expect(Math.abs(res.samplePeakDb - f.lufs.samplePeakDb)).toBeLessThanOrEqual(2e-9)
  })
})

// ─── OTT: the D3 fix (intentional divergence from ottLegacy) ────────────────

describe('OTT per-channel expanders (D3 bug fix, re-baselined by design)', () => {
  test('fixed OTT DIFFERS from the ottLegacy fixture (proof the fix landed)', () => {
    const f = fixture.cases.ottLegacy
    const { L, R } = asymmetric(f.seed)
    const ott = new OTT({ ...f.params, sampleRate: SR })
    ott.processBuffer(L, R)
    let maxDiffL = 0
    let maxDiffR = 0
    for (let i = 0; i < CAPTURE_LEN; i++) {
      maxDiffL = Math.max(maxDiffL, Math.abs((L[i] ?? 0) - f.outputL[i]))
      maxDiffR = Math.max(maxDiffR, Math.abs((R[i] ?? 0) - f.outputR[i]))
    }
    // The old code shared ONE BandExpander per band across L and R
    // (old ott.ts:186-192) — R's sidechain corrupted L's gain. With
    // independent per-channel followers the output on this asymmetric
    // signal must clearly diverge (measured: L ≈ 0.14, R ≈ 0.36).
    expect(maxDiffL).toBeGreaterThan(1e-3)
    expect(maxDiffR).toBeGreaterThan(1e-3)
  })

  test('per-channel independence: L output is bit-identical regardless of R content', () => {
    // THE behavioral proof of D3: L's expansion gain must depend ONLY on L.
    // Run the same L against two completely different R signals — the L
    // output must be bit-identical. (The pre-fix shared-expander code FAILED
    // this: R's envelope leaked into L's gain.)
    const a = asymmetric(SEED_ASYM)
    const b = asymmetric(SEED_ASYM)
    // Replace b's R with loud 1.5 kHz sine — completely different dynamics.
    for (let i = 0; i < N; i++) {
      b.R[i] = Math.sin((2 * Math.PI * 1500 * i) / SR) * 0.8
    }
    const ott1 = new OTT({ sampleRate: SR })
    const ott2 = new OTT({ sampleRate: SR })
    ott1.processBuffer(a.L, a.R)
    ott2.processBuffer(b.L, b.R)
    for (let i = 0; i < N; i++) {
      expect(a.L[i]).toBe(b.L[i]) // bit-exact invariance of L to R
    }
  })

  test('per-channel independence: R output is bit-identical regardless of L content', () => {
    const a = asymmetric(SEED_ASYM)
    const b = asymmetric(SEED_ASYM)
    // Replace b's L with a full-scale square — maximally different dynamics.
    for (let i = 0; i < N; i++) {
      b.L[i] = i % 2 === 0 ? 0.9 : -0.9
    }
    const ott1 = new OTT({ sampleRate: SR })
    const ott2 = new OTT({ sampleRate: SR })
    ott1.processBuffer(a.L, a.R)
    ott2.processBuffer(b.L, b.R)
    for (let i = 0; i < N; i++) {
      expect(a.R[i]).toBe(b.R[i]) // bit-exact invariance of R to L
    }
  })

  test('symmetric input stays symmetric (the fix does not break L=R material)', () => {
    const { L, R } = asymmetric(SEED_ASYM)
    for (let i = 0; i < N; i++) R[i] = L[i] // identical channels
    const ott = new OTT({ sampleRate: SR })
    ott.processBuffer(L, R)
    for (let i = 0; i < N; i++) {
      expect(Math.abs((L[i] ?? 0) - (R[i] ?? 0))).toBeLessThan(1e-9)
    }
  })

  test('asymmetric input keeps its L/R dynamic divergence through OTT', () => {
    // L: 0.9-amplitude pulses; R: steady 0.15 sine. The per-channel
    // expanders must preserve the loud/quiet asymmetry (not average it away
    // through a shared envelope).
    const { L, R } = asymmetric(SEED_ASYM)
    const ott = new OTT({ sampleRate: SR })
    ott.processBuffer(L, R)
    let maxL = 0
    let maxR = 0
    for (let i = 0; i < N; i++) {
      maxL = Math.max(maxL, Math.abs(L[i] ?? 0))
      maxR = Math.max(maxR, Math.abs(R[i] ?? 0))
    }
    expect(maxL).toBeGreaterThan(maxR) // measured: L ≈ 3.96, R ≈ 0.61
    expect(maxL / maxR).toBeGreaterThan(2)
  })
})
