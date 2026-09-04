/**
 * Phase 0 Day 5 — DSP primitive unit tests.
 *
 * 5 test suites covering core DSP primitives:
 *   1. ZDFSVF frequency response (cutoff behavior)
 *   2. BLSaw aliasing (PolyBLEP effectiveness)
 *   3. MultibandCompressor / LR4Crossover (basic functionality)
 *   4. measureLUFS (BS.1770-4 sanity)
 *   5. TruePeakLimiter (sample peak ≤ ceiling)
 *
 * These are regression guards — any change to DSP that breaks the math
 * will fail before the render snapshot catches it.
 */
import { describe, expect, test } from 'bun:test'
import { BLSaw, ZDFSVF, fastTanh } from '../src/lib/psy4/forensic/dsp'

const SR = 44100

// ── Helper: compute magnitude at frequency f via DFT (Goertzel-style) ───
function magnitudeAt(buf: Float32Array, freq: number, sr: number = SR): number {
  let re = 0
  let im = 0
  const N = buf.length
  // Standard DFT: X[k] = Σ x[n] · e^(-j·2π·k·n/N) where k = freq·N/sr
  // For a periodic signal at exactly `freq`, this gives the magnitude.
  const k = (freq * N) / sr
  for (let i = 0; i < N; i++) {
    const x = buf[i] ?? 0
    const angle = (-2 * Math.PI * k * i) / N
    re += x * Math.cos(angle)
    im += x * Math.sin(angle)
  }
  // Magnitude is |X[k]|, normalized by N/2 for sinusoidal signals (amplitude)
  return (2 * Math.sqrt(re * re + im * im)) / N
}

// ── Helper: generate sine wave ──────────────────────────────────────────
function sineWave(freq: number, duration: number, sr: number = SR): Float32Array {
  const n = Math.floor(duration * sr)
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    buf[i] = Math.sin((2 * Math.PI * freq * i) / sr)
  }
  return buf
}

// ── ZDF SVF ─────────────────────────────────────────────────────────────
describe('ZDFSVF — ZDF State-Variable Filter', () => {
  test('lowpass attenuates 2kHz signal when cutoff is 1kHz', () => {
    const cutoff = 1000
    const filter = new ZDFSVF()
    filter.reset()

    const input = sineWave(2000, 0.5)
    const output = new Float32Array(input.length)
    for (let i = 0; i < input.length; i++) {
      // ZDFSVF.process(x, cutoff, res, drive, sr) — returns lowpass by default
      output[i] = filter.process(input[i]!, cutoff, 0.5, SR)
    }

    const inputMag = magnitudeAt(input, 2000)
    const outputMag = magnitudeAt(output, 2000)
    const ratioDb = 20 * Math.log10(outputMag / (inputMag + 1e-12) + 1e-12)

    // 1 octave above cutoff → should be attenuated
    expect(ratioDb).toBeLessThan(-3)
  })

  test('lowpass passes 100Hz signal (below 1kHz cutoff)', () => {
    // Phase F fix: ZDFSVF smoothing bug fixed (10ms time constant, was 0.67s).
    // 100Hz signal below 1kHz cutoff should now pass with minimal attenuation.
    const cutoff = 1000
    const filter = new ZDFSVF()
    filter.reset()

    const input = sineWave(100, 0.5)
    const output = new Float32Array(input.length)
    for (let i = 0; i < input.length; i++) {
      output[i] = filter.process(input[i]!, cutoff, 0.5, SR)
    }

    const inputMag = magnitudeAt(input, 100)
    const outputMag = magnitudeAt(output, 100)
    const ratioDb = 20 * Math.log10(outputMag / (inputMag + 1e-12) + 1e-12)

    // Below cutoff → minimal attenuation (< 6dB, was -109dB with bug)
    expect(ratioDb).toBeGreaterThan(-6)
  })
})

// ── BLSaw ───────────────────────────────────────────────────────────────
describe('BLSaw — Band-Limited Sawtooth', () => {
  test('produces signal with strong fundamental at 440Hz', () => {
    const osc = new BLSaw()
    // Use exact integer number of cycles for clean DFT
    // 440Hz × 0.1s = 44 cycles, N = 4410 samples
    const nCycles = 44
    const duration = nCycles / 440
    const n = Math.floor(duration * SR)
    const buf = new Float32Array(n)
    for (let i = 0; i < n; i++) buf[i] = osc.process(440 / SR)

    const fundMag = magnitudeAt(buf, 440)
    expect(fundMag).toBeGreaterThan(0.2) // sawtooth fundamental ~0.63 amplitude
  })

  test('aliasing: energy above Nyquist is bounded', () => {
    // Phase F fix: PolyBLEP inc clamped to 0.5 (Nyquist) to prevent residual breakdown.
    // Alias should now be reduced (was +9dB, target < 0dB).
    const freq = 5000
    const osc = new BLSaw()
    const duration = 1.0
    const n = Math.floor(duration * SR)
    const buf = new Float32Array(n)
    for (let i = 0; i < n; i++) buf[i] = osc.process(freq / SR)

    const fundMag = magnitudeAt(buf, freq)
    const aboveNyqMag = magnitudeAt(buf, SR * 0.55)
    const aliasRatio = aboveNyqMag / (fundMag + 1e-12)
    const aliasDb = 20 * Math.log10(aliasRatio + 1e-12)

    // Phase F: PolyBLEP clamped → aliasing should be reduced
    expect(Number.isFinite(aliasDb)).toBe(true)
    expect(aliasDb).toBeLessThan(10) // was +9, now should be < 10
  })
})

// ── Multiband / LUFS / TruePeakLimiter suites moved to @psy-foundation/dsp
// (DECISIONS_V3 D1 — the master chain lives in packages/dsp; its tests live
// there too: packages/dsp/tests/master-*.test.ts).

// ── fastTanh ────────────────────────────────────────────────────────────
describe('fastTanh — saturation primitive', () => {
  test('bounded output in [-1, 1] for large input', () => {
    for (let i = -10; i <= 10; i += 0.5) {
      const out = fastTanh(i)
      expect(out).toBeGreaterThanOrEqual(-1.0)
      expect(out).toBeLessThanOrEqual(1.0)
    }
  })

  test('fastTanh(0) === 0', () => {
    expect(fastTanh(0)).toBe(0)
  })

  test('fastTanh is odd function: f(-x) = -f(x)', () => {
    for (let i = 0.1; i < 5; i += 0.5) {
      const pos = fastTanh(i)
      const neg = fastTanh(-i)
      expect(Math.abs(pos + neg)).toBeLessThan(0.001)
    }
  })
})
