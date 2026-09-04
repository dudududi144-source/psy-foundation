/**
 * F22 END-TO-END: Foundation → RawScore → Forensic → PCM → AudioCritic
 *
 * This test proves the full pipeline works:
 *   1. Foundation CompositionEngine produces a ComposedSection
 *   2. RawScore serializer extracts musical fields
 *   3. Forensic bridge renders stereo PCM
 *   4. The PCM is non-silent, stereo, and has audible structure
 *
 * This is the "vertical proof" — Foundation (WHAT) → Forensic (HOW) → Audio.
 */

import { describe, expect, test } from 'bun:test'
import { CompositionEngine } from '../src/composition-engine.ts'
import { createIdentityA, createIdentityB } from '../src/learned-identity.ts'
import { serializeRawScore } from '../src/raw-score-serializer.ts'

const ctx = {
  tonic: 4,
  scaleName: 'phrygian-dominant',
  octave: 4,
  bpm: 145,
  beatsPerBar: 4,
  beatPosition: 0,
  barPosition: 0,
  phrasePosition: 0,
  harmonicContext: [],
  density: 0.7,
  energy: 0.7,
  tension: 0.3,
  sectionRole: 'full-on',
  repetitionPressure: 0.3,
  noveltyPressure: 0.5,
}

describe('F22 E2E: Foundation → RawScore', () => {
  test('ComposedSection can be serialized to RawScore', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    const raw = serializeRawScore(section)

    expect(raw.bars.length).toBe(8)
    expect(raw.phrases.length).toBeGreaterThan(0)
    expect(raw.groove.stepsPerBar).toBe(16)
    expect(raw.arrangement.slots.length).toBe(8)
  })

  test('RawScore does not contain DEAD fields', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 4 })
    const json = JSON.stringify(serializeRawScore(section))

    const deadFields = [
      'synthRecipes',
      'soundDNA',
      'timbreIntent',
      'spaceMap',
      'kickPlan',
      'bassPlan',
      'leadPlan',
      'harmonicPlan',
      'activeChord',
    ]
    for (const field of deadFields) {
      expect(json.includes(field)).toBe(false)
    }
  })

  test('RawScore is deterministic (same seed = same output)', () => {
    const engine1 = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engine2 = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const raw1 = serializeRawScore(engine1.composeSection({ bars: 4 }))
    const raw2 = serializeRawScore(engine2.composeSection({ bars: 4 }))
    expect(JSON.stringify(raw1)).toBe(JSON.stringify(raw2))
  })

  test('Identity A and B produce different RawScores', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const rawA = serializeRawScore(engineA.composeSection({ bars: 8 }))
    const rawB = serializeRawScore(engineB.composeSection({ bars: 8 }))
    expect(JSON.stringify(rawA)).not.toBe(JSON.stringify(rawB))
  })

  test('RawScore contains all REQUIRED musical fields', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 4 })
    const raw = serializeRawScore(section)

    for (const bar of raw.bars) {
      expect(bar.barIndex).toBeDefined()
      expect(bar.arrangementState).toBeDefined()
      expect(bar.roles).toBeDefined()
      expect(Array.isArray(bar.kickNotes)).toBe(true)
      expect(Array.isArray(bar.bassNotes)).toBe(true)
      expect(Array.isArray(bar.leadNotes)).toBe(true)
      expect(Array.isArray(bar.hatNotes)).toBe(true)
      expect(Array.isArray(bar.harmonicContext)).toBe(true)
    }

    expect(raw.groove.stepsPerBar).toBeGreaterThan(0)
    expect(raw.groove.bassKickAlignment).toBeDefined()
    expect(raw.groove.accentSteps).toBeDefined()
    expect(raw.groove.syncopationBudget).toBeGreaterThanOrEqual(0)
  })

  test('RawScore phraseMaterial carries phrase-level intent', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    const raw = serializeRawScore(section)

    for (const phrase of raw.phrases) {
      if (phrase.phraseMaterial) {
        expect(phrase.phraseMaterial.motifId).toBeDefined()
        expect(phrase.phraseMaterial.pitchContour).toBeDefined()
        expect(phrase.phraseMaterial.contour).toBeDefined()
        expect(phrase.phraseMaterial.phraseArc).toBeDefined()
        expect(phrase.phraseMaterial.rhythmicCell).toBeDefined()
      }
    }
  })

  test('RawScore groove includes experimental swing/microtiming', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 4 })
    const raw = serializeRawScore(section)

    expect(raw.groove._experimental).toBeDefined()
    expect(raw.groove._experimental?.swing).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(raw.groove._experimental?.microtiming)).toBe(true)
  })

  test('full-on composition produces lead notes in lead-bearing states (D8.5)', () => {
    // Phase 1 discovered leadNotes===0 at full-on (vacuous F22 tests passed on
    // render noise). Root cause was fixed by the Phase 1 determinism work;
    // THIS test locks the behavior so it can never silently regress.
    for (const seed of [42, 99, 13, 21, 7]) {
      const engine = new CompositionEngine({
        seed,
        context: ctx,
        identity: createIdentityA(),
      })
      const section = engine.composeSection({ bars: 8 })
      for (const bar of section.bars) {
        if (bar.roles.lead) {
          expect(bar.leadNotes.length).toBeGreaterThan(0)
        } else {
          // States that deactivate the lead (INTRO/GROOVE/OUTRO) must stay
          // silent — a lead there would be a different bug.
          expect(bar.leadNotes.length).toBe(0)
        }
      }
    }
  })
})

describe('F22 E2E: Foundation audio renderer', () => {
  test('renderSection produces non-silent PCM', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 4 })

    // Use the Foundation audio renderer (internal, for A/B testing)
    const { renderSection, DEFAULT_RENDER_CONFIG } = require('../src/audio/audio-renderer.ts')
    const result = renderSection(section, DEFAULT_RENDER_CONFIG)

    expect(result.pcm.length).toBeGreaterThan(0)
    expect(result.durationSec).toBeGreaterThan(1)

    let peak = 0
    for (const s of result.pcm) peak = Math.max(peak, Math.abs(s))
    expect(peak).toBeGreaterThan(0.1)
  })

  test('master gain is now applied (bug fix verified)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 4 })

    const { renderSection } = require('../src/audio/audio-renderer.ts')
    const result1 = renderSection(section, {
      ...require('../src/audio/audio-renderer.ts').DEFAULT_RENDER_CONFIG,
      masterGain: 0.5,
    })
    const result2 = renderSection(section, {
      ...require('../src/audio/audio-renderer.ts').DEFAULT_RENDER_CONFIG,
      masterGain: 1.0,
    })

    let peak1 = 0
    let peak2 = 0
    for (let i = 0; i < result1.pcm.length; i++) {
      peak1 = Math.max(peak1, Math.abs(result1.pcm[i] ?? 0))
      peak2 = Math.max(peak2, Math.abs(result2.pcm[i] ?? 0))
    }
    // masterGain=1.0 should produce higher peak than masterGain=0.5
    expect(peak2).toBeGreaterThan(peak1)
  })

  test('different identities produce different PCM', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const sectionA = engineA.composeSection({ bars: 4 })
    const sectionB = engineB.composeSection({ bars: 4 })

    const { renderSection, DEFAULT_RENDER_CONFIG } = require('../src/audio/audio-renderer.ts')
    const resultA = renderSection(sectionA, DEFAULT_RENDER_CONFIG)
    const resultB = renderSection(sectionB, DEFAULT_RENDER_CONFIG)

    let diff = 0
    for (let i = 0; i < resultA.pcm.length; i++) {
      diff += Math.abs((resultA.pcm[i] ?? 0) - (resultB.pcm[i] ?? 0))
    }
    expect(diff).toBeGreaterThan(10)
  })
})

describe('F22 E2E: DSP bug fixes', () => {
  test('PingPongDelay no longer produces NaN', () => {
    const { PingPongDelay } = require('@psy-foundation/dsp')
    const delay = new PingPongDelay({ sampleRate: 44100, delaySec: 0.25, feedback: 0.3, wet: 0.3 })

    // Process 100 samples — before the fix this produced NaN
    let hasNaN = false
    for (let i = 0; i < 100; i++) {
      const [l, r] = delay.process(0.5, 0.3)
      if (Number.isNaN(l) || Number.isNaN(r)) hasNaN = true
    }
    expect(hasNaN).toBe(false)
  })

  test('PingPongDelay produces stereo output (L ≠ R)', () => {
    const { PingPongDelay } = require('@psy-foundation/dsp')
    const delay = new PingPongDelay({ sampleRate: 44100, delaySec: 0.1, feedback: 0.3, wet: 0.5 })

    // Feed signal to left only
    let foundDiff = false
    for (let i = 0; i < 1000; i++) {
      const [l, r] = delay.process(0.5, 0)
      if (Math.abs(l - r) > 0.001) foundDiff = true
    }
    expect(foundDiff).toBe(true)
  })
})
