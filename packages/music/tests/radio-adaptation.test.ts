import { describe, expect, test } from 'bun:test'
import {
  type AdaptationDivergence,
  type AdaptationReport,
  type AdaptedCompositionIntent,
  type ComposedSection,
  CompositionAdaptation,
  CompositionEngine,
  type MusicalContext,
  type OpportunityMap,
  RADIO_ABSENT,
  RADIO_SCENARIOS,
  type RadioMusicalContext,
  adaptationFitScore,
  adaptationReport,
  adaptationSweep,
  applyAdaptation,
  baseContextForStyle,
  bassCompetition,
  buildOpportunityMap,
  countOccupied,
  countOpen,
  createRadioContext,
  isDense,
  isRadioAbsent,
  measureDivergence,
  scenarioRadioSequence,
} from '../src/index.ts'

// ----------------------------- helpers -----------------------------

function fullOnContext(overrides: Partial<MusicalContext> = {}): MusicalContext {
  return baseContextForStyle('full-on', overrides)
}

function adaptAt(
  adaptation: CompositionAdaptation,
  baseContext: MusicalContext,
  radio: RadioMusicalContext,
  phraseBar = 4
): AdaptedCompositionIntent {
  const opportunities = buildOpportunityMap(radio)
  return adaptation.adapt({
    baseContext,
    radio,
    opportunities,
    currentBar: 0,
    phraseBar,
  })
}

function allPressuresIn01(intent: AdaptedCompositionIntent): boolean {
  const vals = [
    intent.groovePressure,
    intent.bassPressure,
    intent.leadPressure,
    intent.counterPressure,
    intent.texturePressure,
    intent.densityTarget,
    intent.tensionTarget,
    intent.noveltyTarget,
    intent.restPressure,
    intent.confidence,
  ]
  return vals.every((v) => v >= 0 && v <= 1 && !Number.isNaN(v))
}

function composeBase(
  styleName: string,
  seed: number,
  bars: number
): { section: ComposedSection; baseContext: MusicalContext; engine: CompositionEngine } {
  const baseContext = baseContextForStyle(styleName)
  const engine = new CompositionEngine({ seed, context: baseContext })
  const section = engine.composeSection({ bars })
  return { section, baseContext, engine }
}

// ====================== 1. RadioMusicalContext ======================

describe('RadioMusicalContext', () => {
  test('createRadioContext fills defaults and clamps out-of-range values', () => {
    const ctx = createRadioContext({ bpm: 200, bassOccupancy: 1.5, confidence: -0.2 })
    expect(ctx.bpm).toBe(200)
    expect(ctx.bassOccupancy).toBe(1) // clamped
    expect(ctx.confidence).toBe(0) // clamped
    expect(ctx.available).toBe(true)
    expect(ctx.kickOccupancy).toBe(0) // default
    expect(ctx.scale).toBe('phrygian-dominant') // default
  })

  test('RADIO_ABSENT sentinel has available=false and all confidence=0', () => {
    expect(RADIO_ABSENT.available).toBe(false)
    expect(RADIO_ABSENT.confidence).toBe(0)
    expect(RADIO_ABSENT.bpmConfidence).toBe(0)
    expect(RADIO_ABSENT.keyConfidence).toBe(0)
    expect(RADIO_ABSENT.energyConfidence).toBe(0)
    expect(RADIO_ABSENT.styleConfidence).toBe(0)
    expect(isRadioAbsent(RADIO_ABSENT)).toBe(true)
  })

  test('isRadioAbsent returns true for unavailable contexts', () => {
    const absent = createRadioContext({ available: false })
    expect(isRadioAbsent(absent)).toBe(true)
    const present = createRadioContext({ available: true, confidence: 0.5 })
    expect(isRadioAbsent(present)).toBe(false)
  })
})

// ====================== 2. OpportunityMap ======================

describe('OpportunityMap', () => {
  test('SPARSE scenario → all primary roles OPEN', () => {
    const map = buildOpportunityMap(RADIO_SCENARIOS.SPARSE.context)
    expect(map.kick).toBe('OPEN')
    expect(map.bass).toBe('OPEN')
    expect(map.percussion).toBe('OPEN')
    expect(map.lead).toBe('OPEN')
    expect(map.harmony).toBe('OPEN')
    expect(map.counter).toBe('OPEN')
    expect(map.transition).toBe('OPEN')
  })

  test('FULL_DENSE scenario → all primary roles OCCUPIED', () => {
    const map = buildOpportunityMap(RADIO_SCENARIOS.FULL_DENSE.context)
    expect(map.kick).toBe('OCCUPIED')
    expect(map.bass).toBe('OCCUPIED')
    expect(map.percussion).toBe('OCCUPIED')
    expect(map.lead).toBe('OCCUPIED')
    expect(map.harmony).toBe('OCCUPIED')
    expect(isDense(map)).toBe(true)
    expect(countOccupied(map)).toBeGreaterThanOrEqual(5)
  })

  test('BASS_HEAVY scenario → bass OCCUPIED, others mixed', () => {
    const map = buildOpportunityMap(RADIO_SCENARIOS.BASS_HEAVY.context)
    expect(map.bass).toBe('OCCUPIED')
    // Counter and transition are always OPEN.
    expect(map.counter).toBe('OPEN')
    expect(map.transition).toBe('OPEN')
  })

  test('RADIO_ABSENT → everything OPEN', () => {
    const map = buildOpportunityMap(RADIO_ABSENT)
    expect(countOpen(map)).toBe(8)
  })

  test('texture is MEDIUM when radio.energy > 0.5, else OPEN', () => {
    const highEnergy = createRadioContext({ energy: 0.8, available: true, confidence: 0.7 })
    expect(buildOpportunityMap(highEnergy).texture).toBe('MEDIUM')
    const lowEnergy = createRadioContext({ energy: 0.3, available: true, confidence: 0.7 })
    expect(buildOpportunityMap(lowEnergy).texture).toBe('OPEN')
  })
})

// ====================== 3. CompositionAdaptation.adapt shape ======================

describe('CompositionAdaptation.adapt', () => {
  test('returns AdaptedCompositionIntent with all fields 0..1 and finite', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    for (const name of ['SPARSE', 'BASS_HEAVY', 'MELODY_HEAVY', 'FULL_DENSE', 'BREAKDOWN']) {
      const radio = RADIO_SCENARIOS[name]?.context
      if (!radio) continue
      const intent = adaptAt(adaptation, base, radio)
      expect(allPressuresIn01(intent)).toBe(true)
      expect(intent.registerShift).toBeGreaterThanOrEqual(-2)
      expect(intent.registerShift).toBeLessThanOrEqual(2)
      expect(['REUSE', 'VARY', 'NEW', 'NEUTRAL']).toContain(intent.motifPreference)
      expect(['STABLE', 'TENSION', 'NEUTRAL']).toContain(intent.harmonyPreference)
      expect(intent.reasons.length).toBeGreaterThan(0)
      expect(Number.isFinite(intent.confidence)).toBe(true)
    }
  })
})

// ====================== 4. SPARSE scenario ======================

describe('SPARSE scenario adaptation', () => {
  test('foundation adds groove + identity (groovePressure high, bassPressure high)', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const intent = adaptAt(adaptation, base, RADIO_SCENARIOS.SPARSE.context)
    expect(intent.groovePressure).toBeGreaterThan(0.7)
    expect(intent.bassPressure).toBeGreaterThan(0.7)
    expect(intent.restPressure).toBeLessThan(0.3)
    expect(intent.reasons.some((r) => r.includes('sparse'))).toBe(true)
  })
})

// ====================== 5. BASS_HEAVY scenario ======================

describe('BASS_HEAVY scenario adaptation', () => {
  test('bassPressure reduced, counterPressure increased', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const intent = adaptAt(adaptation, base, RADIO_SCENARIOS.BASS_HEAVY.context)
    expect(intent.bassPressure).toBeLessThan(0.5)
    // Counter pressure should be elevated (lead is moderate, but bass occupied
    // shifts the foundation upward).
    const neutral = adaptAt(adaptation, base, RADIO_ABSENT)
    expect(intent.counterPressure).toBeGreaterThanOrEqual(neutral.counterPressure)
    expect(intent.reasons.some((r) => r.includes('bass'))).toBe(true)
  })
})

// ====================== 6. MELODY_HEAVY scenario ======================

describe('MELODY_HEAVY scenario adaptation', () => {
  test('leadPressure reduced, counterPressure increased, restPressure moderate', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const intent = adaptAt(adaptation, base, RADIO_SCENARIOS.MELODY_HEAVY.context)
    expect(intent.leadPressure).toBeLessThan(0.6)
    expect(intent.counterPressure).toBeGreaterThan(0.6)
    // restPressure is moderate (not maxing out, not zero).
    expect(intent.restPressure).toBeLessThan(0.7)
    expect(intent.reasons.some((r) => r.includes('lead'))).toBe(true)
  })
})

// ====================== 7. DENSE scenario ======================

describe('FULL_DENSE scenario adaptation', () => {
  test('restPressure high (intelligent abstention)', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const intent = adaptAt(adaptation, base, RADIO_SCENARIOS.FULL_DENSE.context)
    expect(intent.restPressure).toBeGreaterThan(0.4)
    expect(intent.reasons.some((r) => r.includes('abstention') || r.includes('OCCUPIED'))).toBe(
      true
    )
  })
})

// ====================== 8. BREAKDOWN scenario ======================

describe('BREAKDOWN scenario adaptation', () => {
  test('kick/bass reduced, texture increased', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const intent = adaptAt(adaptation, base, RADIO_SCENARIOS.BREAKDOWN.context)
    expect(intent.groovePressure).toBeLessThan(0.6)
    expect(intent.bassPressure).toBeLessThan(0.6)
    expect(intent.texturePressure).toBeGreaterThan(0.6)
    expect(intent.reasons.some((r) => r.includes('breakdown'))).toBe(true)
  })
})

// ====================== 9. Low confidence → NEUTRAL ======================

describe('Confidence handling', () => {
  test('low confidence (< 0.3) → NEUTRAL intent (preserves base)', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext({ density: 0.55, tension: 0.4 })
    const lowConf = createRadioContext({
      confidence: 0.2,
      bassOccupancy: 0.9,
      energy: 0.9,
      available: true,
    })
    const intent = adaptAt(adaptation, base, lowConf)
    expect(intent.motifPreference).toBe('NEUTRAL')
    expect(intent.harmonyPreference).toBe('NEUTRAL')
    expect(intent.bassPressure).toBe(0.7) // base value
    expect(intent.densityTarget).toBeCloseTo(base.density, 5)
    expect(intent.tensionTarget).toBeCloseTo(base.tension, 5)
    expect(intent.reasons.some((r) => r.includes('insufficient evidence'))).toBe(true)
  })

  test('high confidence (> 0.7) → strong adaptation', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext({ density: 0.5, tension: 0.3 })
    const highConf = createRadioContext({
      confidence: 0.85,
      bassOccupancy: 0.9,
      energy: 0.8,
      density: 0.7,
      available: true,
    })
    const intent = adaptAt(adaptation, base, highConf)
    // Strong adaptation: bassPressure should be heavily reduced.
    expect(intent.bassPressure).toBeLessThan(0.4)
    // densityTarget = base × (1 − radio.density × 0.5) = 0.5 × (1 − 0.35) = 0.325
    expect(intent.densityTarget).toBeLessThan(base.density)
    // tensionTarget = base + radio.energy × 0.2 = 0.3 + 0.16 = 0.46
    expect(intent.tensionTarget).toBeGreaterThan(base.tension)
    expect(intent.confidence).toBeGreaterThan(0.7)
  })

  test('mid confidence (0.3-0.7) → partial adaptation (blend 50%)', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext({ density: 0.6 })
    const midConf = createRadioContext({
      confidence: 0.5,
      bassOccupancy: 0.9,
      density: 0.8,
      available: true,
    })
    const intent = adaptAt(adaptation, base, midConf)
    // Partial: bass pressure should be between strong and neutral.
    // Strong (blend=1) → 0.2; Neutral → 0.7. Partial (blend=0.5) → ~0.45.
    expect(intent.bassPressure).toBeGreaterThan(0.3)
    expect(intent.bassPressure).toBeLessThan(0.7)
  })
})

// ====================== 11. Mid-phrase change ======================

describe('Mid-phrase stability', () => {
  test('phraseBar < 4 → adaptation deferred (NEUTRAL)', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const radio = RADIO_SCENARIOS.BASS_HEAVY.context
    const opportunities = buildOpportunityMap(radio)
    const intent = adaptation.adapt({
      baseContext: base,
      radio,
      opportunities,
      currentBar: 0,
      phraseBar: 2,
    })
    expect(intent.motifPreference).toBe('NEUTRAL')
    expect(intent.bassPressure).toBe(0.7) // base value
    expect(intent.reasons.some((r) => r.includes('deferring'))).toBe(true)
  })

  test('phraseBar >= 4 → adaptation fires', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const radio = RADIO_SCENARIOS.BASS_HEAVY.context
    const opportunities = buildOpportunityMap(radio)
    const intent = adaptation.adapt({
      baseContext: base,
      radio,
      opportunities,
      currentBar: 0,
      phraseBar: 5,
    })
    // Bass should be reduced (adaptation firing).
    expect(intent.bassPressure).toBeLessThan(0.7)
    expect(intent.reasons.some((r) => r.includes('deferring'))).toBe(false)
  })
})

// ====================== 12. Radio loss → NEUTRAL ======================

describe('Radio loss', () => {
  test('radio loss → composition continues, intent = NEUTRAL', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const intent = adaptAt(adaptation, base, RADIO_ABSENT)
    expect(intent.motifPreference).toBe('NEUTRAL')
    expect(intent.harmonyPreference).toBe('NEUTRAL')
    expect(intent.bassPressure).toBe(0.7)
    expect(intent.reasons.some((r) => r.includes('radio absent'))).toBe(true)
  })
})

// ====================== 13. Radio recovery → gradual adaptation ======================

describe('Radio recovery', () => {
  test('radio recovery: gradual adaptation resumes (low conf → mid conf → high conf)', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    // Lost: RADIO_ABSENT.
    const lost = adaptAt(adaptation, base, RADIO_ABSENT)
    expect(lost.bassPressure).toBe(0.7)
    // Recovering: low confidence.
    const recovering = adaptAt(
      adaptation,
      base,
      createRadioContext({ confidence: 0.2, bassOccupancy: 0.9, available: true })
    )
    expect(recovering.bassPressure).toBe(0.7) // still NEUTRAL
    // Recovered: mid confidence.
    const midRecovery = adaptAt(
      adaptation,
      base,
      createRadioContext({ confidence: 0.5, bassOccupancy: 0.9, available: true })
    )
    expect(midRecovery.bassPressure).toBeLessThan(0.7)
    expect(midRecovery.bassPressure).toBeGreaterThan(0.3)
    // Fully recovered: high confidence.
    const recovered = adaptAt(adaptation, base, RADIO_SCENARIOS.BASS_HEAVY.context)
    expect(recovered.bassPressure).toBeLessThan(midRecovery.bassPressure)
  })
})

// ====================== 14. Same song different radio: identity preserved ======================

describe('Identity preservation across radios', () => {
  test('same seed/style + different radios: form divergence < 0.3, role divergence > 0.3', () => {
    const base = fullOnContext()
    const { section } = composeBase('full-on', 42, 32)
    const adaptation = new CompositionAdaptation()

    // Two different radio contexts, same song.
    const intentA = adaptAt(adaptation, base, RADIO_SCENARIOS.BASS_HEAVY.context)
    const intentB = adaptAt(adaptation, base, RADIO_SCENARIOS.MELODY_HEAVY.context)

    const adaptedA = applyAdaptation(section.bars, intentA)
    const adaptedB = applyAdaptation(section.bars, intentB)

    const div = measureDivergence({ bars: adaptedA }, { bars: adaptedB })
    // Form preserved: same arrangement states across both adaptations.
    expect(div.formDivergence).toBeLessThan(0.3)
    // Roles diverge: different radios → different role activations.
    expect(div.roleDivergence).toBeGreaterThan(0.3)
  })
})

// ====================== 15. Learning experiment: A (OFF) vs B (ON) ======================

describe('Learning experiment', () => {
  test('Run B (adaptation ON) improves fit over Run A (adaptation OFF)', () => {
    const base = fullOnContext()
    const { section } = composeBase('full-on', 7, 32)
    const radio = RADIO_SCENARIOS.BASS_HEAVY.context

    // Run A: adaptation OFF — apply a NEUTRAL intent (preserve base).
    const neutralIntent: AdaptedCompositionIntent = {
      groovePressure: 0.7,
      bassPressure: 0.7,
      leadPressure: 0.7,
      counterPressure: 0.5,
      texturePressure: 0.4,
      densityTarget: base.density,
      tensionTarget: base.tension,
      noveltyTarget: base.noveltyPressure,
      registerShift: 0,
      restPressure: 0.1,
      motifPreference: 'NEUTRAL',
      harmonyPreference: 'NEUTRAL',
      confidence: 0,
      reasons: ['adaptation OFF — neutral intent'],
    }
    const offBars = applyAdaptation(section.bars, neutralIntent)
    const offFit = adaptationFitScore({ bars: offBars }, radio)

    // Run B: adaptation ON.
    const adaptation = new CompositionAdaptation()
    const onIntent = adaptAt(adaptation, base, radio)
    const onBars = applyAdaptation(section.bars, onIntent)
    const onFit = adaptationFitScore({ bars: onBars }, radio)

    expect(onFit).toBeGreaterThan(offFit)
  })
})

// ====================== 16. Negative learning ======================

describe('Negative learning', () => {
  test('bass-heavy + competing bass → next time less bass competition', () => {
    const base = fullOnContext()
    const { section } = composeBase('full-on', 11, 32)

    // Use a mid-confidence BASS_HEAVY radio so the first adaptation keeps
    // some bass notes (blend = 0.5 → bassPressure ~0.45, above the 0.4
    // silence threshold). This produces measurable bass competition that
    // the learning loop can then penalise.
    const radio = createRadioContext({
      bpm: 145,
      bpmConfidence: 0.8,
      key: 4,
      scale: 'phrygian-dominant',
      keyConfidence: 0.75,
      energy: 0.7,
      density: 0.6,
      energyConfidence: 0.7,
      kickOccupancy: 0.5,
      bassOccupancy: 0.85,
      percussionOccupancy: 0.4,
      leadOccupancy: 0.45,
      harmonicOccupancy: 0.3,
      syncopation: 0.3,
      style: 'full-on',
      styleConfidence: 0.7,
      sectionLikelihood: 'GROOVE',
      confidence: 0.5, // mid confidence → blend = 0.5
      available: true,
    })

    // Run 1: no learning bias.
    const adaptation = new CompositionAdaptation()
    const intent1 = adaptAt(adaptation, base, radio)
    // Mid-confidence BASS_HEAVY → bassPressure ~0.45 (not silenced).
    expect(intent1.bassPressure).toBeGreaterThan(0.4)
    const adapted1 = applyAdaptation(section.bars, intent1)
    const competition1 = bassCompetition({ bars: adapted1 }, radio)
    expect(competition1).toBeGreaterThan(0)

    // Negative outcome: foundation's bass competed with radio's bass.
    adaptation.reinforce('bass', false)
    expect(adaptation.biasFor('bass')).toBeLessThan(0)

    // Run 2: with learned bias.
    const intent2 = adaptAt(adaptation, base, radio)
    const adapted2 = applyAdaptation(section.bars, intent2)
    const competition2 = bassCompetition({ bars: adapted2 }, radio)

    expect(intent2.bassPressure).toBeLessThan(intent1.bassPressure)
    expect(competition2).toBeLessThanOrEqual(competition1)
  })
})

// ====================== 17. Style + radio interaction ======================

describe('Style + radio interaction', () => {
  test('FULL_ON + SPARSE ≠ DARK + SPARSE (style grammar preserved)', () => {
    const fullOnSparse = adaptationReport({
      scenario: RADIO_SCENARIOS.SPARSE,
      baseContext: baseContextForStyle('full-on'),
      seed: 42,
      bars: 16,
    })
    const darkSparse = adaptationReport({
      scenario: RADIO_SCENARIOS.SPARSE,
      baseContext: baseContextForStyle('dark'),
      seed: 42,
      bars: 16,
    })
    // The intents should differ because the base contexts differ
    // (different density / tension / novelty targets).
    expect(fullOnSparse.intent.densityTarget).not.toEqual(darkSparse.intent.densityTarget)
    expect(fullOnSparse.intent.tensionTarget).not.toEqual(darkSparse.intent.tensionTarget)
    // Both should be valid.
    expect(allPressuresIn01(fullOnSparse.intent)).toBe(true)
    expect(allPressuresIn01(darkSparse.intent)).toBe(true)
  })

  test('adaptation sweep across all styles produces stable output', () => {
    const styles = ['full-on', 'progressive', 'dark', 'acid']
    for (const style of styles) {
      const reports = adaptationSweep({ styleName: style, seed: 100, bars: 16 })
      for (const r of reports) {
        expect(allPressuresIn01(r.intent)).toBe(true)
        expect(r.divergence.formDivergence).toBeLessThanOrEqual(1)
        expect(Number.isFinite(r.fitScore)).toBe(true)
      }
    }
  })
})

// ====================== 18. 64-bar: stable coherent output ======================

describe('64-bar adaptation', () => {
  test('each scenario produces stable coherent output (no NaN, finite pressures)', () => {
    for (const name of ['SPARSE', 'BASS_HEAVY', 'MELODY_HEAVY', 'FULL_DENSE', 'BREAKDOWN']) {
      const scenario = RADIO_SCENARIOS[name]
      if (!scenario) continue
      const report = adaptationReport({
        scenario,
        baseContext: fullOnContext(),
        seed: 42,
        bars: 64,
      })
      expect(report.bars).toBe(64)
      expect(allPressuresIn01(report.intent)).toBe(true)
      for (const key of Object.keys(report.divergence) as (keyof AdaptationDivergence)[]) {
        const v = report.divergence[key]
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
        expect(Number.isFinite(v)).toBe(true)
      }
      expect(Number.isFinite(report.fitScore)).toBe(true)
    }
  })
})

// ====================== 19. 128-bar: 4 styles × 4 scenarios × 3 seeds ======================

describe('128-bar stress test', () => {
  test('4 styles × 4 scenarios × 3 seeds: no collapse', () => {
    const styles = ['full-on', 'progressive', 'dark', 'acid']
    const scenarios = ['SPARSE', 'BASS_HEAVY', 'MELODY_HEAVY', 'FULL_DENSE']
    const seeds = [1, 42, 99]
    let count = 0
    for (const style of styles) {
      for (const scenarioName of scenarios) {
        for (const seed of seeds) {
          const scenario = RADIO_SCENARIOS[scenarioName]
          if (!scenario) continue
          const report = adaptationReport({
            scenario,
            baseContext: baseContextForStyle(style),
            seed,
            bars: 128,
          })
          expect(report.bars).toBe(128)
          expect(allPressuresIn01(report.intent)).toBe(true)
          // No collapse: form divergence should be tiny (we never change form).
          expect(report.divergence.formDivergence).toBeLessThan(0.3)
          // Fit score finite.
          expect(Number.isFinite(report.fitScore)).toBe(true)
          count++
        }
      }
    }
    expect(count).toBe(styles.length * scenarios.length * seeds.length)
  })
})

// ====================== 20. Determinism ======================

describe('Determinism', () => {
  test('same seed + same radio = same adaptation', () => {
    const base = fullOnContext()
    const { section } = composeBase('full-on', 42, 32)
    const adaptation1 = new CompositionAdaptation()
    const adaptation2 = new CompositionAdaptation()
    const radio = RADIO_SCENARIOS.MELODY_HEAVY.context

    const intent1 = adaptAt(adaptation1, base, radio)
    const intent2 = adaptAt(adaptation2, base, radio)
    expect(intent1).toEqual(intent2)

    const adapted1 = applyAdaptation(section.bars, intent1)
    const adapted2 = applyAdaptation(section.bars, intent2)
    expect(adapted1).toEqual(adapted2)
  })

  test('adaptSection is deterministic for the same input', () => {
    const base = fullOnContext()
    const adaptation1 = new CompositionAdaptation()
    const adaptation2 = new CompositionAdaptation()
    const radioSeq = scenarioRadioSequence('BASS_HEAVY', 16)
    const intents1 = adaptation1.adaptSection({
      baseContext: base,
      radioSequence: radioSeq,
      bars: 16,
    })
    const intents2 = adaptation2.adaptSection({
      baseContext: base,
      radioSequence: radioSeq,
      bars: 16,
    })
    expect(intents1).toEqual(intents2)
  })
})

// ====================== 21. Performance ======================

describe('Performance', () => {
  test('adaptation < 10ms per bar', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const radio = RADIO_SCENARIOS.FULL_DENSE.context
    const opportunities = buildOpportunityMap(radio)
    // Warm up.
    adaptation.adapt({ baseContext: base, radio, opportunities, currentBar: 0, phraseBar: 4 })
    const start = performance.now()
    const iterations = 100
    for (let i = 0; i < iterations; i++) {
      adaptation.adapt({
        baseContext: base,
        radio,
        opportunities,
        currentBar: i,
        phraseBar: 4,
      })
    }
    const elapsed = performance.now() - start
    const perBar = elapsed / iterations
    expect(perBar).toBeLessThan(10)
  })

  test('64-bar adaptation (compose + adapt + apply) < 500ms', () => {
    const base = fullOnContext()
    const radio = RADIO_SCENARIOS.FULL_DENSE.context
    const start = performance.now()
    const { section } = composeBase('full-on', 42, 64)
    const adaptation = new CompositionAdaptation()
    const intent = adaptAt(adaptation, base, radio)
    applyAdaptation(section.bars, intent)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(500)
  })
})

// ====================== Additional: AdaptationReport shape ======================

describe('adaptationReport', () => {
  test('returns a full AdaptationReport with whatChanged and whyItChanged', () => {
    const report: AdaptationReport = adaptationReport({
      scenario: RADIO_SCENARIOS.BASS_HEAVY,
      baseContext: fullOnContext(),
      seed: 42,
      bars: 32,
    })
    expect(report.scenario).toBe('BASS_HEAVY')
    expect(report.bars).toBe(32)
    expect(report.whatChanged.length).toBeGreaterThan(0)
    expect(report.whyItChanged.length).toBeGreaterThan(0)
    expect(report.opportunities).toBeDefined()
    expect(report.divergence).toBeDefined()
    expect(Number.isFinite(report.fitScore)).toBe(true)
    expect(Number.isFinite(report.bassCompetition)).toBe(true)
  })

  test('measureDivergence on identical bars returns all-zero', () => {
    const { section } = composeBase('full-on', 1, 16)
    const div = measureDivergence({ bars: section.bars }, { bars: section.bars })
    expect(div.formDivergence).toBe(0)
    expect(div.harmonyDivergence).toBe(0)
    expect(div.grooveDivergence).toBe(0)
    expect(div.motifDivergence).toBe(0)
    expect(div.roleDivergence).toBe(0)
    expect(div.densityDivergence).toBe(0)
  })

  test('adaptSection returns one intent per bar with mid-phrase stability', () => {
    const adaptation = new CompositionAdaptation()
    const base = fullOnContext()
    const radioSeq = scenarioRadioSequence('BASS_HEAVY', 16)
    const intents = adaptation.adaptSection({
      baseContext: base,
      radioSequence: radioSeq,
      bars: 16,
    })
    expect(intents.length).toBe(16)
    // Bars 0-3 (phraseBar < 4) should be NEUTRAL — preserve base.
    expect(intents[0]?.motifPreference).toBe('NEUTRAL')
    expect(intents[3]?.motifPreference).toBe('NEUTRAL')
    expect(intents[0]?.bassPressure).toBe(0.7) // base value
    // Bars 4-7 (phraseBar >= 4) should adapt — bassPressure should drop
    // below the base 0.7 because BASS_HEAVY radio has high bass occupancy.
    expect(intents[4]?.bassPressure).toBeLessThan(0.7)
    expect(intents[4]?.reasons.some((r) => r.includes('bass'))).toBe(true)
    // Bar 8 starts a new phrase (phraseBar = 0) → NEUTRAL again.
    expect(intents[8]?.motifPreference).toBe('NEUTRAL')
    expect(intents[8]?.bassPressure).toBe(0.7)
  })
})

// ====================== Additional: OpportunityMap utilities ======================

describe('OpportunityMap utilities', () => {
  test('countOccupied and countOpen are consistent', () => {
    const map: OpportunityMap = buildOpportunityMap(RADIO_SCENARIOS.FULL_DENSE.context)
    const occupied = countOccupied(map)
    const open = countOpen(map)
    expect(occupied + open).toBeLessThanOrEqual(8)
    expect(occupied).toBeGreaterThan(0)
  })

  test('isDense only true when all primary roles OCCUPIED', () => {
    expect(isDense(buildOpportunityMap(RADIO_SCENARIOS.FULL_DENSE.context))).toBe(true)
    expect(isDense(buildOpportunityMap(RADIO_SCENARIOS.SPARSE.context))).toBe(false)
    expect(isDense(buildOpportunityMap(RADIO_SCENARIOS.BASS_HEAVY.context))).toBe(false)
  })
})

// ====================== Additional: applyAdaptation ======================

describe('applyAdaptation', () => {
  test('low bassPressure silences bass role; high texturePressure adds hats', () => {
    const { section } = composeBase('full-on', 5, 16)
    const intent: AdaptedCompositionIntent = {
      groovePressure: 0.7,
      bassPressure: 0.2, // below 0.4 → silence
      leadPressure: 0.7,
      counterPressure: 0.5,
      texturePressure: 0.8, // above 0.6 → add hats where empty
      densityTarget: 0.5,
      tensionTarget: 0.4,
      noveltyTarget: 0.5,
      registerShift: 0,
      restPressure: 0.1,
      motifPreference: 'NEUTRAL',
      harmonyPreference: 'NEUTRAL',
      confidence: 0.7,
      reasons: [],
    }
    const adapted = applyAdaptation(section.bars, intent)
    for (const bar of adapted) {
      expect(bar.bassNotes.length).toBe(0)
      expect(bar.roles.bass).toBe(false)
    }
  })

  test('high restPressure silences lead/bass in some bars', () => {
    const { section } = composeBase('full-on', 5, 16)
    const intent: AdaptedCompositionIntent = {
      groovePressure: 0.7,
      bassPressure: 0.7,
      leadPressure: 0.7,
      counterPressure: 0.5,
      texturePressure: 0.4,
      densityTarget: 0.5,
      tensionTarget: 0.4,
      noveltyTarget: 0.5,
      registerShift: 0,
      restPressure: 0.7, // high
      motifPreference: 'NEUTRAL',
      harmonyPreference: 'NEUTRAL',
      confidence: 0.7,
      reasons: [],
    }
    const adapted = applyAdaptation(section.bars, intent)
    const leadSilencedCount = adapted.filter((b) => b.roles.lead === false).length
    expect(leadSilencedCount).toBeGreaterThan(0)
  })

  test('form (arrangement state) is preserved across all adaptations', () => {
    const { section } = composeBase('full-on', 5, 32)
    const adaptation = new CompositionAdaptation()
    for (const name of ['SPARSE', 'BASS_HEAVY', 'MELODY_HEAVY', 'FULL_DENSE', 'BREAKDOWN']) {
      const scenario = RADIO_SCENARIOS[name]
      if (!scenario) continue
      const intent = adaptAt(adaptation, fullOnContext(), scenario.context)
      const adapted = applyAdaptation(section.bars, intent)
      for (let i = 0; i < adapted.length; i++) {
        const orig = section.bars[i]
        const adp = adapted[i]
        if (!orig || !adp) continue
        expect(adp.arrangementState).toBe(orig.arrangementState)
        expect(adp.harmonicContext).toEqual(orig.harmonicContext)
      }
    }
  })
})
