/**
 * Phase 1.3 + 1.7 (PLAN_V3_MASTER) — packages-side fixes.
 *
 * 1.3: MoogLadder stability — the per-stage loop is only stable for
 *      p ≤ 2/(1+k); above that the tanh saturation turned divergence into
 *      limit cycles above ~3.5 kHz (audit finding: unstable filter).
 * 1.7: render determinism — hats/kick-click used Math.random(), so the same
 *      section never rendered identically (audit finding: determinism has
 *      two holes in packages). Both render paths are now seeded.
 */
import { describe, expect, test } from 'bun:test'
import { MoogLadder } from '@psy-foundation/dsp'
import { renderSection } from '../src/audio/audio-renderer.ts'
import { CompositionEngine, createIdentityA } from '../src/index.ts'
import type { MusicalContext } from '../src/index.ts'

const SR = 44100

describe('MoogLadder stability (audit fix 1.3)', () => {
  test('finite and bounded across the full cutoff × resonance sweep', () => {
    const cutoffs = [20, 100, 1000, 3500, 8000, 14000, 20000, 22050]
    const resonances = [0, 0.3, 0.6, 0.85, 1.0]
    for (const hz of cutoffs) {
      for (const res of resonances) {
        const f = new MoogLadder(SR, hz, res)
        let maxAbs = 0
        let finite = true
        // Feed a full-scale impulse burst then a sine — worst-case excitation.
        for (let i = 0; i < 2000; i++) {
          const x = i < 4 ? (i % 2 === 0 ? 1 : -1) : Math.sin((2 * Math.PI * 1000 * i) / SR)
          const y = f.process(x)
          if (!Number.isFinite(y)) {
            finite = false
            break
          }
          maxAbs = Math.max(maxAbs, Math.abs(y))
        }
        expect(finite).toBe(true)
        // tanh saturation bounds each stage; the old bug produced limit
        // cycles well above 1.0 at high cutoff × resonance.
        expect(maxAbs).toBeLessThan(4)
      }
    }
  })

  test('non-finite input does not poison the state', () => {
    const f = new MoogLadder(SR, 1000, 0.5)
    f.process(0.5)
    const poisoned = f.process(Number.NaN)
    expect(Number.isFinite(poisoned)).toBe(true)
    // State intact — output recovers to a normal filtered value.
    const after = f.process(0.5)
    expect(Number.isFinite(after)).toBe(true)
    expect(Math.abs(after)).toBeGreaterThan(0)
  })

  test('low-resonance cutoff sweep still attenuates (behavior preserved)', () => {
    // At res 0, 200 Hz cutoff on a 4 kHz tone should attenuate strongly.
    const f = new MoogLadder(SR, 200, 0)
    for (let i = 0; i < 500; i++) f.process(0) // settle
    let maxAbs = 0
    for (let i = 0; i < SR; i++) {
      const y = f.process(Math.sin((2 * Math.PI * 4000 * i) / SR))
      if (i > SR / 2) maxAbs = Math.max(maxAbs, Math.abs(y))
    }
    expect(maxAbs).toBeLessThan(0.2)
  })
})

describe('renderSection determinism (audit fix 1.7)', () => {
  function compose(seed: number) {
    const ctx: MusicalContext = {
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
    const engine = new CompositionEngine({ seed, context: ctx, identity: createIdentityA() })
    return engine.composeSection({ bars: 4 })
  }

  test('same section renders bit-identically (was Math.random-poisoned)', () => {
    const section = compose(42)
    const a = renderSection(section).pcm
    const b = renderSection(section).pcm
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i])
  })

  test('different seeds render differently', () => {
    const a = renderSection(compose(42)).pcm
    const b = renderSection(compose(99)).pcm
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
    expect(diff).toBeGreaterThan(0)
  })

  test('output is bounded and finite', () => {
    const { pcm } = renderSection(compose(7))
    for (let i = 0; i < pcm.length; i += 97) {
      expect(Number.isFinite(pcm[i]!)).toBe(true)
      expect(Math.abs(pcm[i]!)).toBeLessThanOrEqual(1)
    }
  })
})
