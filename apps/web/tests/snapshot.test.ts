/**
 * Snapshot test for render determinism.
 *
 * Renders ?bars=8&seed=42 offline (using same config as /api/render-forensic)
 * and verifies the WAV md5 matches the committed baseline.
 *
 * Phase 1 Day 1 baseline: a4368f62fd733ebf6495fb48b0e6e3c3
 *   Set: 2026-08-20 (after StereoWidener fix + MasterChain hard-clip removal)
 *   ffmpeg: -8.6 LUFS, -0.0 dBTP, 2.9 LU LRA
 *
 * Phase 0 Day 2 baseline: 0e1294f1e9f8b5280893ad01f9ca6326
 *   Set: 2026-08-19 (commercial samples replaced with procedural)
 *   ffmpeg: -10.6 LUFS, +0.2 dBTP, 1.9 LU LRA
 *   (Replaced because Phase 1 DSP fixes changed the output.)
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { CompositionEngine, createIdentityA } from '@psy-foundation/music'
import {
  DEFAULT_RENDER_CONFIG,
  encodeWav,
  renderFoundationSection,
} from '../src/lib/psy4/forensic-bridge'

// Set cwd to apps/web so that forensic-bridge's `process.cwd() + '/public/samples'`
// resolves correctly (the render engine reads sample WAVs from public/samples/).
const APPS_WEB_DIR = resolve(import.meta.dir, '..')
process.chdir(APPS_WEB_DIR)

// Phase D baseline (kick 50Hz, bass 0.12s, lead 9000Hz, bus 1.2, full LUFS correction, ISP 0.65)
// Roast-fix baseline (2026-08): K-weighting b1 formula corrected per RBJ cookbook.
// Old: b631454f96dcb4b6d48d8ee8fdd5fddf (with biased K-weighting, ~2 LU low vs ffmpeg).
// b01123b3e7c33a29f3f83671cc02dc4a (with correct K-weighting, ~0.22 LU vs ffmpeg).
// Phase 1.2 baseline (2026-09-04): TruePeakLimiter rewritten (real lookahead,
// clip at the advertised ceiling instead of ceiling×0.65) — audio changed by
// design; see docs/AUDIT_FORENSIC_2026-09-04.md finding C3.
const BASELINE_MD5 = 'a53cfc88fcf598c739a67de43d82e4c7'
const BASELINE_DURATION_SEC = 13.24

// BEST_CONFIG from /api/render-forensic/route.ts
const BEST_CONFIG = {
  ...DEFAULT_RENDER_CONFIG,
  bassGain: 0.8,
  subBassGain: 0.6,
  padGain: 0.7,
}

// MusicalContext — copied from render-forensic/route.ts to match production render
const createContext = (seed: number) => ({
  tonic: 4,
  scaleName: 'phrygian-dominant',
  octave: 4,
  bpm: 145,
  beatsPerBar: 4,
  beatPosition: 0,
  barPosition: 0,
  phrasePosition: 0,
  harmonicContext: [] as number[],
  density: 0.7,
  energy: 0.7,
  tension: 0.3,
  sectionRole: 'full-on' as const,
  repetitionPressure: 0.3,
  noveltyPressure: 0.5,
  seed,
})

describe('render snapshot (Phase 0 baseline)', () => {
  test('?bars=8&seed=42 produces bit-identical WAV to baseline', async () => {
    const ctx = createContext(42)
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })

    const result = await renderFoundationSection(section, {
      useSamples: true,
      bpm: 145,
      config: BEST_CONFIG,
    })

    const wavBuffer = encodeWav(result.samplesL, result.samplesR, result.sampleRate)
    const hash = createHash('md5').update(Buffer.from(wavBuffer)).digest('hex')

    // Bit-identical check
    expect(hash).toBe(BASELINE_MD5)

    // Duration check (within 1 sample tolerance)
    const durationSec = result.samplesL.length / result.sampleRate
    expect(Math.abs(durationSec - BASELINE_DURATION_SEC)).toBeLessThan(0.01)

    // Sample count consistency
    expect(result.samplesL.length).toBe(result.samplesR.length)
    expect(result.sampleRate).toBe(44100)
  })

  test('determinism: same seed → same output (run twice, compare)', async () => {
    const ctx1 = createContext(99)
    const engine1 = new CompositionEngine({ seed: 99, context: ctx1, identity: createIdentityA() })
    const section1 = engine1.composeSection({ bars: 4 })
    const r1 = await renderFoundationSection(section1, {
      useSamples: false,
      bpm: 145,
      config: BEST_CONFIG,
    })

    const ctx2 = createContext(99)
    const engine2 = new CompositionEngine({ seed: 99, context: ctx2, identity: createIdentityA() })
    const section2 = engine2.composeSection({ bars: 4 })
    const r2 = await renderFoundationSection(section2, {
      useSamples: false,
      bpm: 145,
      config: BEST_CONFIG,
    })

    const h1 = createHash('md5')
      .update(Buffer.from(new Float32Array(r1.samplesL)))
      .digest('hex')
    const h2 = createHash('md5')
      .update(Buffer.from(new Float32Array(r2.samplesL)))
      .digest('hex')

    expect(h1).toBe(h2)
  })

  test('render output has non-zero energy (not silenced)', async () => {
    const ctx = createContext(42)
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })

    const result = await renderFoundationSection(section, {
      useSamples: true,
      bpm: 145,
      config: BEST_CONFIG,
    })

    // Compute RMS
    let sumSq = 0
    for (let i = 0; i < result.samplesL.length; i++) {
      const l = result.samplesL[i] ?? 0
      const r = result.samplesR[i] ?? 0
      sumSq += l * l + r * r
    }
    const rms = Math.sqrt(sumSq / (result.samplesL.length * 2))

    // RMS should be non-trivial (not silence)
    expect(rms).toBeGreaterThan(0.001)

    // And not clipping dangerously (max amplitude should be < 2.0)
    let maxPeak = 0
    for (let i = 0; i < result.samplesL.length; i++) {
      maxPeak = Math.max(maxPeak, Math.abs(result.samplesL[i] ?? 0))
    }
    expect(maxPeak).toBeLessThan(2.0)
  })
})
