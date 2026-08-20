/**
 * Phase 3 Day 3 — Multi-seed determinism tests (reduced count for performance).
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { renderFoundationSection, encodeWav, DEFAULT_RENDER_CONFIG } from '../src/lib/psy4/forensic-bridge'
import { CompositionEngine, createIdentityA } from '@psy-foundation/music'

const APPS_WEB_DIR = resolve(import.meta.dir, '..')
process.chdir(APPS_WEB_DIR)

const BEST_CONFIG = {
  ...DEFAULT_RENDER_CONFIG,
  bassGain: 0.8,
  subBassGain: 0.6,
  padGain: 0.7,
}

const createContext = (seed: number) => ({
  tonic: 4, scaleName: 'phrygian-dominant', octave: 4, bpm: 145,
  beatsPerBar: 4, beatPosition: 0, barPosition: 0, phrasePosition: 0,
  harmonicContext: [] as number[], density: 0.7, energy: 0.7, tension: 0.3,
  sectionRole: 'full-on' as const, repetitionPressure: 0.3, noveltyPressure: 0.5, seed,
})

async function renderHash(bars: number, seed: number): Promise<string> {
  const ctx = createContext(seed)
  const engine = new CompositionEngine({ seed, context: ctx, identity: createIdentityA() })
  const section = engine.composeSection({ bars })
  const result = await renderFoundationSection(section, {
    useSamples: false, bpm: 145, config: BEST_CONFIG,
  })
  return createHash('md5').update(Buffer.from(new Float32Array(result.samplesL).buffer)).digest('hex')
}

describe('Phase 3 Day 3 — determinism (reduced: 4 tests)', () => {
  test('seed=42 bars=4 → deterministic', async () => {
    const h1 = await renderHash(4, 42)
    const h2 = await renderHash(4, 42)
    expect(h1).toBe(h2)
  }, 30000)

  test('seed=99 bars=4 → deterministic', async () => {
    const h1 = await renderHash(4, 99)
    const h2 = await renderHash(4, 99)
    expect(h1).toBe(h2)
  }, 30000)

  test('different seeds produce different output', async () => {
    const h1 = await renderHash(4, 42)
    const h2 = await renderHash(4, 99)
    expect(h1).not.toBe(h2)
  }, 30000)

  test('bars=8 produces more samples than bars=4', async () => {
    const ctx = createContext(42)
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const s4 = engine.composeSection({ bars: 4 })
    const r4 = await renderFoundationSection(s4, { useSamples: false, bpm: 145, config: BEST_CONFIG })
    const s8 = engine.composeSection({ bars: 8 })
    const r8 = await renderFoundationSection(s8, { useSamples: false, bpm: 145, config: BEST_CONFIG })
    expect(r8.samplesL.length).toBeGreaterThan(r4.samplesL.length)
  }, 30000)
})
