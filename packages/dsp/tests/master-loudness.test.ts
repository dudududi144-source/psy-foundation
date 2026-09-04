/**
 * measureLUFS — ITU-R BS.1770-4 conformance + behavior tests.
 *
 * Replaces the fake `LufsMeter` tests removed by DECISIONS_V3 D5 with
 * known-signal LUFS targets (the real ITU meter lives here since D1).
 *
 * Also consolidates the loudness tests that previously lived beside the web
 * copy of the implementation (moved per DECISIONS_V3 D1):
 *   - apps/web/tests/dsp-primitives.test.ts → 'measureLUFS — ITU-R BS.1770-4'
 *   - apps/web/tests/roast-fix.test.ts → K-weighting calibration + truePeakDb
 *
 * ITU calibration anchors (derived, not fabricated):
 *   BS.1770 loudness of an in-phase stereo sine of peak amplitude A at a
 *   frequency where K-weighting ≈ K(f): L = -0.691 + 20·log10(A) + K(f).
 *   The ITU pre-filter (f0 = 1681.97 Hz, G = +4 dB) has K(1 kHz) ≈ +0.44 dB,
 *   so a stereo 1 kHz sine at -20 dBFS (A = 0.1) reads ≈ -20.25 LUFS.
 *   The classic "-23 LUFS" alignment corresponds to a stereo 1 kHz sine at
 *   ≈ -22.75 dBFS — NOT to -20 dBFS (the mission's original pairing was
 *   off by ~2.75 LU; both anchors are asserted below within ±1.5 LU).
 */
import { describe, expect, test } from 'bun:test'
import { lufsToGainOffset, measureLUFS } from '../src/index.ts'

const SR = 44100

/** Fill a stereo buffer with an in-phase sine of the given peak amplitude. */
function stereoSine(freq: number, amplitude: number, n: number): [Float32Array, Float32Array] {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * freq * i) / SR) * amplitude
    L[i] = s
    R[i] = s
  }
  return [L, R]
}

describe('measureLUFS — ITU conformance (D5: real meter)', () => {
  test('stereo 1kHz sine @ -20 dBFS → -20.25 LUFS ±1.5 (BS.1770 formula + K(1kHz))', () => {
    // Expected: -0.691 + 20·log10(0.1) + K(1kHz ≈ +0.44 dB) ≈ -20.25 LUFS.
    const [L, R] = stereoSine(1000, 0.1, SR * 3)
    const res = measureLUFS(L, R, SR)
    expect(Math.abs(res.integratedLUFS - -20.25)).toBeLessThan(1.5)
  })

  test('EBU alignment: stereo 1kHz sine @ -22.75 dBFS → -23 LUFS ±1.5', () => {
    // -23 LUFS is THE R128 program target. The stereo 1 kHz sine that lands
    // on it has peak amplitude ≈ -22.75 dBFS (per the BS.1770 formula above).
    const amplitude = 10 ** (-22.75 / 20)
    const [L, R] = stereoSine(1000, amplitude, SR * 3)
    const res = measureLUFS(L, R, SR)
    expect(Math.abs(res.integratedLUFS - -23)).toBeLessThan(1.5)
  })

  test('monotonicity: +6 dB input → +6 LUFS', () => {
    const [quietL, quietR] = stereoSine(1000, 0.1, SR * 3)
    const [loudL, loudR] = stereoSine(1000, 0.1 * 10 ** (6 / 20), SR * 3)
    const quiet = measureLUFS(quietL, quietR, SR)
    const loud = measureLUFS(loudL, loudR, SR)
    // Identical gating for both passes → the difference must be the exact
    // input gain (+6.0206 dB). Allow 0.5 LU for block-edge effects.
    expect(Math.abs(loud.integratedLUFS - quiet.integratedLUFS - 6)).toBeLessThan(0.5)
  })

  test('relative gate: a -60 dBFS tail does not drag integrated LUFS down more than 0.5 LU', () => {
    const loudSec = 3
    const [lL, lR] = stereoSine(1000, 0.1, SR * loudSec)
    const loudOnly = measureLUFS(lL, lR, SR)

    // Append a 3 s tail at -60 dBFS (0.001 amplitude). Per BS.1770 the
    // relative gate (mean - 10 LU) must exclude the quiet blocks.
    const tail = new Float32Array(SR * 3)
    const L = new Float32Array(SR * loudSec * 2)
    const R = new Float32Array(SR * loudSec * 2)
    L.set(lL)
    R.set(lR)
    for (let i = 0; i < tail.length; i++) {
      const s = Math.sin((2 * Math.PI * 1000 * (SR * loudSec + i)) / SR) * 0.001
      L[SR * loudSec + i] = s
      R[SR * loudSec + i] = s
    }
    const withTail = measureLUFS(L, R, SR)
    const drag = loudOnly.integratedLUFS - withTail.integratedLUFS
    expect(drag).toBeLessThan(0.5)
    // And it must not INCREASE loudness either (sanity).
    expect(drag).toBeGreaterThan(-0.05)
  })

  test('lufsToGainOffset: -10 → -14 LUFS needs -4 dB (0.631 linear)', () => {
    expect(lufsToGainOffset(-10, -14)).toBeCloseTo(10 ** (-4 / 20), 10)
  })
})

// ─── Moved from apps/web/tests/dsp-primitives.test.ts ───────────────────────

describe('measureLUFS — ITU-R BS.1770-4 (moved)', () => {
  test('997Hz sine at -3dBFS measures around -6 LUFS', () => {
    const freq = 997
    const duration = 2.0
    const n = Math.floor(duration * SR)

    const left = new Float32Array(n)
    const right = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      // -3 dBFS peak = 0.7079 amplitude
      const s = Math.sin((2 * Math.PI * freq * i) / SR) * 0.7079
      left[i] = s
      right[i] = s
    }

    const result = measureLUFS(left, right, SR)
    // Reference: -3.01 LUFS for stereo 997Hz sine at -3 dBFS
    // Allow ±2.0 tolerance (K-weighting approximation + gating edge effects)
    expect(result.integratedLUFS).toBeGreaterThan(-6.0)
    expect(result.integratedLUFS).toBeLessThan(-1.0)
  })

  test('quiet signal measures lower LUFS than loud signal', () => {
    const duration = 2.0
    const n = Math.floor(duration * SR)

    const loudL = new Float32Array(n)
    const loudR = new Float32Array(n)
    const quietL = new Float32Array(n)
    const quietR = new Float32Array(n)

    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * 440 * i) / SR
      loudL[i] = Math.sin(t) * 0.5
      loudR[i] = Math.sin(t) * 0.5
      quietL[i] = Math.sin(t) * 0.05 // 20dB quieter
      quietR[i] = Math.sin(t) * 0.05
    }

    const loudLufs = measureLUFS(loudL, loudR, SR)
    const quietLufs = measureLUFS(quietL, quietR, SR)

    // Quiet should be at least 15 LU lower
    expect(quietLufs.integratedLUFS).toBeLessThan(loudLufs.integratedLUFS - 15)
  })
})

// ─── Moved from apps/web/tests/roast-fix.test.ts ────────────────────────────

describe('K-weighting calibration (RBJ cookbook, moved)', () => {
  /**
   * Compute the integrated-LUFS reading for a mono sine (signal on L only, R silent).
   * Returns the K-weighting gain at `freq` in dB:
   *   gain_dB = measured_LUFS - input_LUFS_no_K
   *   input_LUFS_no_K = -0.691 + 10·log10(RMS²)
   */
  function kGainDb(freq: number, amplitude = 0.1, durationSec = 3.0): number {
    const n = Math.floor(durationSec * SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) L[i] = Math.sin((2 * Math.PI * freq * i) / SR) * amplitude
    const res = measureLUFS(L, R, SR)
    const rms = amplitude / Math.SQRT2
    const inputLufsNoK = -0.691 + 10 * Math.log10(rms * rms)
    return res.integratedLUFS - inputLufsNoK
  }

  test('ITU calibration: mono 997 Hz @ -23 dBFS RMS within 1 LU of -23', () => {
    const amplitude = Math.SQRT2 * 10 ** (-23 / 20) // peak such that RMS = 10^(-23/20)
    const n = Math.floor(3 * SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) L[i] = Math.sin((2 * Math.PI * 997 * i) / SR) * amplitude
    const res = measureLUFS(L, R, SR)
    expect(Math.abs(res.integratedLUFS - -23)).toBeLessThan(1.0)
  })

  test('K-gain at 1682 Hz corner ≈ +2 dB', () => {
    const gain = kGainDb(1682)
    expect(gain).toBeGreaterThan(1.5)
    expect(gain).toBeLessThan(2.5)
  })

  test('K-gain at 10000 Hz plateau ≈ +4 dB', () => {
    const gain = kGainDb(10000)
    expect(gain).toBeGreaterThan(3.5)
    expect(gain).toBeLessThan(4.5)
  })

  test('K-gain at 100 Hz RLB transition ≈ -1 dB', () => {
    const gain = kGainDb(100)
    // The RLB high-pass (f0=38 Hz, Q=0.5) starts cutting below ~100 Hz.
    // At 100 Hz the curve is in the transition; gain should be near 0 dB to -2 dB.
    expect(gain).toBeGreaterThan(-3.0)
    expect(gain).toBeLessThan(0.5)
  })
})

describe('truePeakDb is 4x-oversampled (Roast Fix 3, moved)', () => {
  test('truePeakDb >= samplePeakDb for all signals', () => {
    // Pure sine (minimal ISP)
    const [L, R] = stereoSine(440, 0.3, SR * 2)
    const result = measureLUFS(L, R, SR)
    expect(result.truePeakDb).toBeGreaterThanOrEqual(result.samplePeakDb)
  })

  test('truePeakDb > samplePeakDb for signal with inter-sample peaks', () => {
    // Square wave at 2000 Hz — steep edges create inter-sample peaks;
    // the Catmull-Rom must detect the overshoot.
    const [L, R] = stereoSine(2000, 0.5, SR)
    for (let i = 0; i < L.length; i++) {
      L[i] = 0.5 * Math.sign(Math.sin((2 * Math.PI * 2000 * i) / SR))
      R[i] = L[i]
    }
    const result = measureLUFS(L, R, SR)
    expect(result.truePeakDb).toBeGreaterThanOrEqual(result.samplePeakDb)
    expect(result.truePeakDb).toBeGreaterThan(result.samplePeakDb + 0.01)
  })

  test('truePeakDb is finite (no NaN/Inf)', () => {
    const [L, R] = stereoSine(1000, 0.5, SR)
    const result = measureLUFS(L, R, SR)
    expect(Number.isFinite(result.truePeakDb)).toBe(true)
    expect(Number.isFinite(result.samplePeakDb)).toBe(true)
  })

  test('samplePeakDb matches max |sample|', () => {
    const L = new Float32Array(1000)
    const R = new Float32Array(1000)
    for (let i = 0; i < 1000; i++) {
      L[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / SR)
      R[i] = -0.3
    }
    const result = measureLUFS(L, R, SR)
    // Max |sample| = 0.5 (from L channel) → 20*log10(0.5) = -6.02 dBFS
    expect(result.samplePeakDb).toBeCloseTo(20 * Math.log10(0.5), 1)
  })
})
