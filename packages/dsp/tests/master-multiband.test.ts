/**
 * MultibandCompressor behavior tests (moved from apps/web into the package
 * that owns the implementation — DECISIONS_V3 D1).
 *
 * Sources:
 *   - apps/web/tests/dsp-primitives.test.ts → 'MultibandCompressor — 3-band LR4'
 *   - apps/web/tests/phase1-day4.test.ts → 48kHz test
 */
import { describe, expect, test } from 'bun:test'
import { MultibandCompressor } from '../src/index.ts'

const SR = 44100

describe('MultibandCompressor — 3-band LR4', () => {
  test('processes stereo input without crash', () => {
    const mb = new MultibandCompressor({
      sampleRate: SR,
      lowCrossoverHz: 200,
      midCrossoverHz: 2000,
    })

    const n = 1024
    const inputL = new Float32Array(n)
    const inputR = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      inputL[i] = Math.sin((2 * Math.PI * 100 * i) / SR) * 0.5
      inputR[i] = Math.sin((2 * Math.PI * 100 * i) / SR) * 0.5
    }

    // processBuffer modifies in-place
    mb.processBuffer(inputL, inputR)

    // Output should have non-zero energy (not silenced)
    let energy = 0
    for (let i = 0; i < n; i++) energy += (inputL[i] ?? 0) ** 2
    expect(energy / n).toBeGreaterThan(0.0001)
  })

  test('L and R outputs are identical for identical channels (independent per-channel state)', () => {
    const mb = new MultibandCompressor({ sampleRate: SR })
    const n = 4096
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const s = Math.sin((2 * Math.PI * 100 * i) / SR) * 0.5
      L[i] = s
      R[i] = s
    }
    mb.processBuffer(L, R)
    for (let i = 0; i < n; i++) {
      expect(Math.abs((L[i] ?? 0) - (R[i] ?? 0))).toBeLessThan(1e-9)
    }
  })

  test('works at 48kHz (moved from phase1-day4)', () => {
    const sr = 48000
    const mb = new MultibandCompressor({
      sampleRate: sr,
      lowCrossoverHz: 200,
      midCrossoverHz: 2000,
    })

    const n = 1024
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      L[i] = Math.sin((2 * Math.PI * 100 * i) / sr) * 0.5
      R[i] = L[i]
    }

    mb.processBuffer(L, R)

    let energy = 0
    for (let i = 0; i < n; i++) energy += (L[i] ?? 0) ** 2
    expect(energy / n).toBeGreaterThan(0.0001)
  })
})
