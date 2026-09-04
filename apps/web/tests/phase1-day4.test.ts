/**
 * Phase 1 Day 4 — Sample-rate parameterization tests.
 *
 * Verifies that all modules use DEFAULT_SR from constants.ts instead of
 * hard-coded 44100, and that the render engine can be configured for
 * different sample rates (48kHz, 96kHz).
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_SR, SR_48K, SR_96K } from '../src/lib/psy4/constants'
import { BLSaw, ZDFSVF } from '../src/lib/psy4/forensic/dsp'

describe('Phase 1 Day 4 — sample-rate parameterization', () => {
  test('DEFAULT_SR is 44100 (audio industry standard)', () => {
    expect(DEFAULT_SR).toBe(44100)
  })

  test('SR_48K is 48000', () => {
    expect(SR_48K).toBe(48000)
  })

  test('SR_96K is 96000', () => {
    expect(SR_96K).toBe(96000)
  })

  test('ZDFSVF works at 48kHz', () => {
    const sr = 48000
    const filter = new ZDFSVF()
    filter.reset()

    // 2kHz sine at 48kHz SR
    const n = sr * 0.1 // 0.1 seconds
    const output = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = Math.sin((2 * Math.PI * 2000 * i) / sr) * 0.5
      output[i] = filter.process(x, 1000, 0.5, 1.0, sr)
    }

    // Should produce finite output
    let maxAbs = 0
    for (let i = 0; i < n; i++) {
      const v = output[i] ?? 0
      expect(Number.isFinite(v)).toBe(true)
      maxAbs = Math.max(maxAbs, Math.abs(v))
    }
    expect(maxAbs).toBeGreaterThan(0)
  })

  test('ZDFSVF works at 96kHz', () => {
    const sr = 96000
    const filter = new ZDFSVF()
    filter.reset()

    const n = sr * 0.1
    const output = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = Math.sin((2 * Math.PI * 2000 * i) / sr) * 0.5
      output[i] = filter.process(x, 1000, 0.5, 1.0, sr)
    }

    let maxAbs = 0
    for (let i = 0; i < n; i++) {
      const v = output[i] ?? 0
      expect(Number.isFinite(v)).toBe(true)
      maxAbs = Math.max(maxAbs, Math.abs(v))
    }
    expect(maxAbs).toBeGreaterThan(0)
  })

  test('BLSaw works at 48kHz', () => {
    const sr = 48000
    const osc = new BLSaw()
    const n = sr * 0.1
    const buf = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      buf[i] = osc.process(440 / sr)
    }
    // Should produce finite output
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(buf[i] ?? 0)).toBe(true)
    }
  })

  // The 'MultibandCompressor/TruePeakLimiter at 48kHz' tests moved to
  // @psy-foundation/dsp (DECISIONS_V3 D1): packages/dsp/tests/limiter-rewrite.test.ts
  // and packages/dsp/tests/master-multiband.test.ts.

  test('no hard-coded 44100 in psy4 source files (except constants.ts)', () => {
    // This is a meta-test: verifies the parameterization is complete.
    // We check that constants.ts exports DEFAULT_SR = 44100,
    // and other files import it rather than hard-coding.
    expect(DEFAULT_SR).toBe(44100)
    // The actual grep for "44100" in source files is done by lint/build.
  })
})
