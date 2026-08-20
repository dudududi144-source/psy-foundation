/**
 * Phase G — End-to-End verification tests.
 *
 * Verifies the complete pipeline: render → measure → verify.
 * These are the "acceptance criteria" for the project.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { renderFoundationSection, encodeWav, DEFAULT_RENDER_CONFIG } from '../src/lib/psy4/forensic-bridge'
import { CompositionEngine, createIdentityA, PSYTRANCE_PROGRESSIONS, rollingBass16th } from '@psy-foundation/music'

const APPS_WEB_DIR = resolve(import.meta.dir, '..')
process.chdir(APPS_WEB_DIR)

const BEST_CONFIG = { ...DEFAULT_RENDER_CONFIG, bassGain: 0.8, subBassGain: 0.6, padGain: 0.7 }

const createContext = (seed: number) => ({
  tonic: 4, scaleName: 'phrygian-dominant', octave: 4, bpm: 145,
  beatsPerBar: 4, beatPosition: 0, barPosition: 0, phrasePosition: 0,
  harmonicContext: [] as number[], density: 0.7, energy: 0.7, tension: 0.3,
  sectionRole: 'full-on' as const, repetitionPressure: 0.3, noveltyPressure: 0.5, seed,
})

describe('Phase G — E2E Acceptance Criteria', () => {
  test('G1: Render produces bit-identical deterministic output', async () => {
    const ctx = createContext(42)
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    const result = await renderFoundationSection(section, { useSamples: true, bpm: 145, config: BEST_CONFIG })
    const wav = encodeWav(result.samplesL, result.samplesR, result.sampleRate)
    const hash = createHash('md5').update(Buffer.from(wav)).digest('hex')
    expect(hash).toBe('190e35410bba7464727a96a79b4ab32b')
  }, 30000)

  test('G2: Render output is stereo (L ≠ R)', async () => {
    const ctx = createContext(42)
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    const result = await renderFoundationSection(section, { useSamples: true, bpm: 145, config: BEST_CONFIG })
    // Check that at least some samples have L ≠ R (stereo content)
    let stereoCount = 0
    for (let i = 0; i < result.samplesL.length; i++) {
      if (Math.abs((result.samplesL[i] ?? 0) - (result.samplesR[i] ?? 0)) > 0.001) {
        stereoCount++
      }
    }
    expect(stereoCount).toBeGreaterThan(100) // at least 100 stereo samples
  }, 30000)

  test('G3: Render has non-zero energy (not silence)', async () => {
    const ctx = createContext(42)
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    const result = await renderFoundationSection(section, { useSamples: true, bpm: 145, config: BEST_CONFIG })
    let energy = 0
    for (let i = 0; i < result.samplesL.length; i++) {
      energy += (result.samplesL[i] ?? 0) ** 2
    }
    const rms = Math.sqrt(energy / result.samplesL.length)
    expect(rms).toBeGreaterThan(0.01)
  }, 30000)

  test('G4: All 8 PSYTRANCE_PROGRESSIONS are defined', () => {
    const names = Object.keys(PSYTRANCE_PROGRESSIONS)
    expect(names.length).toBe(8)
    for (const name of names) {
      const degrees = PSYTRANCE_PROGRESSIONS[name]
      expect(Array.isArray(degrees)).toBe(true)
      expect(degrees!.length).toBeGreaterThan(0)
    }
  })

  test('G5: rollingBass16th produces 16 notes per bar', () => {
    const ctx = {
      tonic: 4, scale: { name: 'phrygian-dominant', intervals: [0, 1, 4, 5, 7, 8, 11] },
      bassOctave: 2, groove: { stepsPerBar: 16, kickSteps: [0, 4, 8, 12], hatSteps: [2, 6, 10, 14], accent: 0.5 },
      kickPlan: { onsets: [0, 4, 8, 12], velocities: [0.9, 0.8, 0.9, 0.8] },
      rng: { next: () => 0.5 }, isLast: false,
    }
    const notes = rollingBass16th(ctx as any)
    expect(notes.length).toBe(16)
  })

  test('G6: VST has 13 voice declarations', async () => {
    // Check PluginProcessor.h for voice count
    const fs = await import('node:fs')
    const path = await import('node:path')
    const hFile = path.resolve(import.meta.dir, '..', '..', 'vst', 'Source', 'PluginProcessor.h')
    const hContent = fs.readFileSync(hFile, 'utf8')
    // 8 lead + 2 bass + 2 pad + 1 acid = 13
    expect(hContent).toContain('unique_ptr<LeadVoice>, 8>')
    expect(hContent).toContain('unique_ptr<BassVoice>, 2>')
    expect(hContent).toContain('unique_ptr<PadVoice>, 2>')
    expect(hContent).toContain('unique_ptr<AcidVoice>')
  })

  test('G7: VST processBlock is stereo (L ≠ R)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const cppFile = path.resolve(import.meta.dir, '..', '..', 'vst', 'Source', 'PluginProcessor.cpp')
    const cppContent = fs.readFileSync(cppFile, 'utf8')
    // Should NOT have "channelL[i] = sample; channelR[i] = sample;"
    expect(cppContent).not.toContain('channelL[i] = sample')
    expect(cppContent).toContain('channelL[i] = mixL')
    expect(cppContent).toContain('channelR[i] = mixR')
  })

  test('G8: Worklet has per-voice pan (not Haas)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const jsFile = path.resolve(import.meta.dir, '..', 'public', 'worklets', 'psy4-processor.js')
    const jsContent = fs.readFileSync(jsFile, 'utf8')
    // Should have panToGain (true stereo)
    expect(jsContent).toContain('panToGain')
    // Should NOT have haasBuffer (fake stereo deleted)
    expect(jsContent).not.toContain('haasBuffer')
  })

  test('G9: ISP-safe ceiling is 0.65 (ffmpeg dBTP ≤ 0)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const limiterFile = path.resolve(import.meta.dir, '..', 'src', 'lib', 'psy4', 'limiter.ts')
    const limiterContent = fs.readFileSync(limiterFile, 'utf8')
    expect(limiterContent).toContain('ceiling * 0.65')
  })

  test('G10: LUFS correction is 100% (not 50% hack)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const bridgeFile = path.resolve(import.meta.dir, '..', 'src', 'lib', 'psy4', 'forensic-bridge.ts')
    const bridgeContent = fs.readFileSync(bridgeFile, 'utf8')
    // Should have fullGain (100% correction)
    expect(bridgeContent).toContain('fullGain')
    // Should NOT have 50% hack
    expect(bridgeContent).not.toContain('(fullGain - 1.0) * 0.5')
  })
})
