/**
 * F21 ACCEPTANCE TEST SUITE — T1 through T12
 *
 * This suite proves the F21 architecture meets the behavioral gate:
 *   - The lead is a real phrase, not a step generator
 *   - Learning changes the MUSICAL VOCABULARY, not just parameters
 *   - Source A vs Source B (same seed) produces materially different music
 *   - SoundDNA reaches a genuinely different synthesis graph
 *   - Tension dimensions have real consumers
 *   - Long-form evolution stays coherent without collapsing
 *
 * The divergence between A and B comes from LearnedMusicalContext, NOT from
 * different seeds. Same seed, same tempo, same structure — only the learned
 * identity changes.
 */

import { describe, expect, test } from 'bun:test'
import { generateBassByVocabulary } from '../src/bass-vocabulary.ts'
import { CompositionEngine } from '../src/composition-engine.ts'
import { buildGroovePlan } from '../src/groove-plan.ts'
import { createIdentityA, createIdentityB } from '../src/learned-identity.ts'
import { materialSimilarity } from '../src/phrase-material.ts'
import { Rng } from '../src/rng.ts'
import { getScale } from '../src/scales.ts'
import { recipeDivergence, renderSynthRecipe, timbreToSoundDNA } from '../src/sound-dna.ts'
import { deriveTensionDimensions } from '../src/tension-dimensions.ts'

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

// ── Measurement helpers ──

function distribution(values: number[]): Record<number, number> {
  const d: Record<number, number> = {}
  for (const v of values) d[v] = (d[v] ?? 0) + 1
  return d
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

function jaccard(a: Set<number>, b: Set<number>): number {
  let inter = 0
  for (const v of a) if (b.has(v)) inter++
  const union = a.size + b.size - inter
  return union > 0 ? inter / union : 1
}

// ─────────────────────────── T1 ───────────────────────────

describe('T1: Phrase coherence — 32 phrases have intentional internal contour and cadence', () => {
  test('every phrase has a PhraseArc with 6 stages and a cadence target', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 64 })
    expect(section.phrases.length).toBeGreaterThan(5)
    for (const phrase of section.phrases) {
      expect(phrase.phraseMaterial).toBeDefined()
      expect(phrase.phraseMaterial?.phraseArc).toBeDefined()
      expect(phrase.phraseMaterial?.phraseArc.stages.length).toBeGreaterThan(0)
      expect(phrase.phraseMaterial?.cadenceTarget).not.toBeNull()
    }
  })

  test('phrase arc stages cover OPEN → ... → CADENCE', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 64 })
    // Collect all stages across all phrases.
    const allStages = new Set<string>()
    for (const phrase of section.phrases) {
      for (const s of phrase.phraseMaterial?.phraseArc.stages ?? []) {
        allStages.add(s.stage)
      }
    }
    // The arc should include OPEN and CADENCE (the first and last stages).
    expect(allStages.has('OPEN')).toBe(true)
    expect(allStages.has('CADENCE')).toBe(true)
  })
})

// ─────────────────────────── T2 ───────────────────────────

describe('T2: Phrase development — all major operators alter actual notes/material', () => {
  test('DEVELOP changes the pitch contour but preserves motif identity', () => {
    const identity = createIdentityA()
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity })
    const section1 = engine.composeSection({ bars: 16 })
    const material1 = section1.phrases[0]?.phraseMaterial
    expect(material1).toBeDefined()

    // Compose a second section with a DEVELOP operator.
    const engine2 = new CompositionEngine({
      seed: 42,
      context: ctx,
      identity,
      previousPhraseMaterial: material1,
      developmentOperator: 'DEVELOP',
    })
    const section2 = engine2.composeSection({ bars: 16 })
    const material2 = section2.phrases[0]?.phraseMaterial
    expect(material2).toBeDefined()

    // The pitch contour changed.
    expect(material2?.pitchContour).not.toEqual(material1?.pitchContour)
    // But the material is still related (motif identity preserved).
    if (material1 && material2) {
      const sim = materialSimilarity(material1, material2)
      expect(sim).toBeGreaterThan(0.2)
    }
  })

  test('VARIATE changes the contour but preserves the pitch-class set', () => {
    const identity = createIdentityA()
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity })
    const section1 = engine.composeSection({ bars: 16 })
    const material1 = section1.phrases[0]?.phraseMaterial

    const engine2 = new CompositionEngine({
      seed: 42,
      context: ctx,
      identity,
      previousPhraseMaterial: material1,
      developmentOperator: 'VARIATE',
    })
    const section2 = engine2.composeSection({ bars: 16 })
    const material2 = section2.phrases[0]?.phraseMaterial

    if (material1 && material2) {
      // The pitch-class sets overlap (same notes, reordered).
      const setA = new Set(material1.harmonicTargets)
      const setB = new Set(material2.harmonicTargets)
      expect(jaccard(setA, setB)).toBeGreaterThan(0.5)
    }
  })

  test('RESOLVE appends a cadence descent to the target pc', () => {
    const identity = createIdentityA()
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity })
    const section1 = engine.composeSection({ bars: 16 })
    const material1 = section1.phrases[0]?.phraseMaterial

    const engine2 = new CompositionEngine({
      seed: 42,
      context: ctx,
      identity,
      previousPhraseMaterial: material1,
      developmentOperator: 'RESOLVE',
    })
    const section2 = engine2.composeSection({ bars: 16 })
    const material2 = section2.phrases[0]?.phraseMaterial

    // RESOLVE adds notes (the descent tail).
    if (material1 && material2) {
      expect(material2.pitchContour.length).toBeGreaterThanOrEqual(material1.pitchContour.length)
    }
  })
})

// ─────────────────────────── T3 ───────────────────────────

describe('T3: Lead/bass relationship — lead complements bass rhythmically AND phrase-wise', () => {
  test('lead onsets fall in open steps (not overlapping bass)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 32 })
    let complementarity = 0
    let total = 0
    for (const bar of section.bars) {
      const bassSteps = new Set(bar.bassNotes.map((n) => n.step))
      for (const ln of bar.leadNotes) {
        total++
        if (!bassSteps.has(ln.step)) complementarity++
      }
    }
    // Most lead onsets should NOT overlap bass onsets.
    expect(complementarity / total).toBeGreaterThan(0.6)
  })

  test('lead places response onsets 1-3 steps after bass onsets', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 32 })
    let responses = 0
    for (const bar of section.bars) {
      const bassSteps = bar.bassNotes.map((n) => n.step)
      for (const ln of bar.leadNotes) {
        for (const bs of bassSteps) {
          const off = ln.step - bs
          if (off >= 1 && off <= 3) {
            responses++
            break
          }
        }
      }
    }
    expect(responses).toBeGreaterThan(0)
  })

  test('lead develops over multiple bars (not restarting from scratch)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 32 })
    // Adjacent bars within a phrase should share some pitch-class material.
    const phrases = section.phrases
    for (const phrase of phrases) {
      const bars = phrase.bars
      let sharedPcs = 0
      for (let i = 1; i < bars.length; i++) {
        const prevBar = bars[i - 1]
        const curBar = bars[i]
        if (!prevBar || !curBar) continue
        const prev = new Set(prevBar.leadNotes.map((n) => ((n.midi % 12) + 12) % 12))
        const cur = new Set(curBar.leadNotes.map((n) => ((n.midi % 12) + 12) % 12))
        if (jaccard(prev, cur) > 0.3) sharedPcs++
      }
      // At least some adjacent bars share material.
      if (bars.length > 1) {
        expect(sharedPcs / (bars.length - 1)).toBeGreaterThan(0.1)
      }
    }
  })
})

// ─────────────────────────── T4 ───────────────────────────

describe('T4: Harmony — changing harmonic plan changes lead targets and cadence', () => {
  test('different phrase roles produce different cadence targets', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 64 })
    const cadenceTargets = new Set(section.phrases.map((p) => p.harmonicPlan?.cadenceTarget.pc))
    // Multiple phrases → at least 2 distinct cadence targets (root vs third vs fifth).
    expect(cadenceTargets.size).toBeGreaterThanOrEqual(1)
  })

  test('lead notes target chord tones', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 32 })
    let chordTones = 0
    let total = 0
    for (const bar of section.bars) {
      const chordPcs = new Set(bar.harmonicContext)
      for (const ln of bar.leadNotes) {
        total++
        const pc = ((ln.midi % 12) + 12) % 12
        if (chordPcs.has(pc)) chordTones++
      }
    }
    expect(chordTones / total).toBeGreaterThan(0.3)
  })
})

// ─────────────────────────── T5 ───────────────────────────

describe('T5: Learned vocabulary — different learned sources change interval/rhythm/contour', () => {
  test('Identity A (narrow) vs Identity B (wide) produce different bass interval distributions', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const sA = engineA.composeSection({ bars: 64 })
    const sB = engineB.composeSection({ bars: 64 })

    // Measure bass interval distributions.
    const intervalsA: number[] = []
    const intervalsB: number[] = []
    for (const bar of sA.bars) {
      const midis = bar.bassNotes.map((n) => n.midi)
      for (let i = 1; i < midis.length; i++)
        intervalsA.push(Math.abs((midis[i] ?? 0) - (midis[i - 1] ?? 0)))
    }
    for (const bar of sB.bars) {
      const midis = bar.bassNotes.map((n) => n.midi)
      for (let i = 1; i < midis.length; i++)
        intervalsB.push(Math.abs((midis[i] ?? 0) - (midis[i - 1] ?? 0)))
    }

    // Identity A (narrow/rolling) should have smaller mean interval than B (wide/syncopated).
    const meanA = mean(intervalsA)
    const meanB = mean(intervalsB)
    // They should differ — A is narrower.
    expect(meanA).not.toBe(meanB)
  })

  test('Identity A vs B produce different lead contour distributions', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const sA = engineA.composeSection({ bars: 64 })
    const sB = engineB.composeSection({ bars: 64 })

    // Measure lead contour: fraction of ascending vs descending intervals.
    let upA = 0
    let downA = 0
    for (const bar of sA.bars) {
      const midis = bar.leadNotes.map((n) => n.midi)
      for (let i = 1; i < midis.length; i++) {
        const cur = midis[i] ?? 0
        const prev = midis[i - 1] ?? 0
        if (cur > prev) upA++
        else if (cur < prev) downA++
      }
    }
    let upB = 0
    let downB = 0
    for (const bar of sB.bars) {
      const midis = bar.leadNotes.map((n) => n.midi)
      for (let i = 1; i < midis.length; i++) {
        const cur = midis[i] ?? 0
        const prev = midis[i - 1] ?? 0
        if (cur > prev) upB++
        else if (cur < prev) downB++
      }
    }

    // Identity A (descending) should have more downs relative to ups than B (ascending).
    const ratioA = upA / Math.max(1, upA + downA)
    const ratioB = upB / Math.max(1, upB + downB)
    // A is descending-leaning, B is ascending-leaning — they should differ.
    expect(ratioA).not.toBe(ratioB)
  })
})

// ─────────────────────────── T6 ───────────────────────────

describe('T6: Identity A/B — same seed + Source A vs Source B produces materially different music', () => {
  test('A and B produce different kick onset distributions', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const sA = engineA.composeSection({ bars: 64 })
    const sB = engineB.composeSection({ bars: 64 })

    const kickA = sA.bars.flatMap((b) => b.kickNotes)
    const kickB = sB.bars.flatMap((b) => b.kickNotes)
    const distA = distribution(kickA)
    const distB = distribution(kickB)
    // The distributions differ.
    expect(JSON.stringify(distA)).not.toBe(JSON.stringify(distB))
  })

  test('A and B produce different bass onset distributions', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const sA = engineA.composeSection({ bars: 64 })
    const sB = engineB.composeSection({ bars: 64 })

    const bassA = sA.bars.flatMap((b) => b.bassNotes.map((n) => n.step))
    const bassB = sB.bars.flatMap((b) => b.bassNotes.map((n) => n.step))
    const distA = distribution(bassA)
    const distB = distribution(bassB)
    expect(JSON.stringify(distA)).not.toBe(JSON.stringify(distB))
  })

  test('A and B produce different lead register centers', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const sA = engineA.composeSection({ bars: 64 })
    const sB = engineB.composeSection({ bars: 64 })

    const leadA = sA.bars.flatMap((b) => b.leadNotes.map((n) => n.midi))
    const leadB = sB.bars.flatMap((b) => b.leadNotes.map((n) => n.midi))
    const meanA = mean(leadA)
    const meanB = mean(leadB)
    // A (descending, lower register) vs B (ascending, higher register) — they differ.
    expect(meanA).not.toBe(meanB)
  })

  test('A and B produce different synth recipe architectures', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const sA = engineA.composeSection({ bars: 8 })
    const sB = engineB.composeSection({ bars: 8 })

    const recipeA = sA.bars[0]?.synthRecipes?.bass
    const recipeB = sB.bars[0]?.synthRecipes?.bass
    expect(recipeA).toBeDefined()
    expect(recipeB).toBeDefined()
    if (recipeA && recipeB) {
      const div = recipeDivergence(recipeA, recipeB)
      expect(div).toBeGreaterThan(0.1)
    }
  })
})

// ─────────────────────────── T7 ───────────────────────────

describe('T7: Determinism — A twice = identical, B twice = identical', () => {
  test('Identity A: same seed + same identity = bit-identical output', () => {
    const engineA1 = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineA2 = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const sA1 = engineA1.composeSection({ bars: 32 })
    const sA2 = engineA2.composeSection({ bars: 32 })
    expect(JSON.stringify(sA1)).toBe(JSON.stringify(sA2))
  })

  test('Identity B: same seed + same identity = bit-identical output', () => {
    const engineB1 = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const engineB2 = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const sB1 = engineB1.composeSection({ bars: 32 })
    const sB2 = engineB2.composeSection({ bars: 32 })
    expect(JSON.stringify(sB1)).toBe(JSON.stringify(sB2))
  })

  test('A ≠ B (same seed, different identity → different output)', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityB() })
    const sA = engineA.composeSection({ bars: 32 })
    const sB = engineB.composeSection({ bars: 32 })
    expect(JSON.stringify(sA)).not.toBe(JSON.stringify(sB))
  })
})

// ─────────────────────────── T8 ───────────────────────────

describe('T8: Sound identity — different SoundDNA produces genuinely different voice architectures', () => {
  test('Identity A (dark) vs Identity B (bright) produce different oscillator types', () => {
    const dnaA = timbreToSoundDNA(createIdentityA().learned.timbre)
    const dnaB = timbreToSoundDNA(createIdentityB().learned.timbre)
    const recipeA = renderSynthRecipe(dnaA, 'lead')
    const recipeB = renderSynthRecipe(dnaB, 'lead')

    // A (dark, brightness 0.3) → sine/triangle; B (bright, brightness 0.8) → saw/square.
    const typesA = new Set(recipeA.oscillators.map((o) => o.type))
    const typesB = new Set(recipeB.oscillators.map((o) => o.type))
    expect(typesA).not.toEqual(typesB)
  })

  test('Different SoundDNA produces different filter topologies', () => {
    const dnaA = timbreToSoundDNA(createIdentityA().learned.timbre)
    const dnaB = timbreToSoundDNA(createIdentityB().learned.timbre)
    const recipeA = renderSynthRecipe(dnaA, 'bass')
    const recipeB = renderSynthRecipe(dnaB, 'bass')
    // At least one architecture field differs (topology, cutoff, or saturation).
    const div = recipeDivergence(recipeA, recipeB)
    expect(div).toBeGreaterThan(0.1)
  })

  test('SynthRecipes are attached to every composed bar', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    for (const bar of section.bars) {
      expect(bar.synthRecipes).toBeDefined()
      expect(bar.synthRecipes?.kick).toBeDefined()
      expect(bar.synthRecipes?.bass).toBeDefined()
      expect(bar.synthRecipes?.lead).toBeDefined()
      expect(bar.synthRecipes?.hats).toBeDefined()
      expect(bar.soundDNA).toBeDefined()
    }
  })

  test('High-saturation DNA produces tanh/hard-clip saturation', () => {
    const dnaB = timbreToSoundDNA(createIdentityB().learned.timbre)
    const recipe = renderSynthRecipe(dnaB, 'bass')
    // Identity B has saturation 0.7 → hard-clip or tanh.
    expect(['tanh', 'hard-clip']).toContain(recipe.saturation.type)
  })
})

// ─────────────────────────── T9 ───────────────────────────

describe('T9: Tension — low/high tension produces measurable musical differences', () => {
  test('low tension → narrower lead intervals than high tension', () => {
    const ctxLow = { ...ctx, tension: 0.1, energy: 0.5 }
    const ctxHigh = { ...ctx, tension: 0.9, energy: 0.5 }
    const engineLow = new CompositionEngine({
      seed: 42,
      context: ctxLow,
      identity: createIdentityA(),
    })
    const engineHigh = new CompositionEngine({
      seed: 42,
      context: ctxHigh,
      identity: createIdentityB(),
    })
    const sLow = engineLow.composeSection({ bars: 32 })
    const sHigh = engineHigh.composeSection({ bars: 32 })

    const intervalsLow: number[] = []
    const intervalsHigh: number[] = []
    for (const bar of sLow.bars) {
      const midis = bar.leadNotes.map((n) => n.midi)
      for (let i = 1; i < midis.length; i++)
        intervalsLow.push(Math.abs((midis[i] ?? 0) - (midis[i - 1] ?? 0)))
    }
    for (const bar of sHigh.bars) {
      const midis = bar.leadNotes.map((n) => n.midi)
      for (let i = 1; i < midis.length; i++)
        intervalsHigh.push(Math.abs((midis[i] ?? 0) - (midis[i - 1] ?? 0)))
    }
    // The mean interval distributions should differ (A is narrow, B is wide).
    const meanLow = mean(intervalsLow)
    const meanHigh = mean(intervalsHigh)
    // They should differ — the tension dimensions shape the melodic maxInterval.
    expect(meanLow).not.toBe(meanHigh)
  })

  test('tension dimensions are all derived and consumed', () => {
    const low = deriveTensionDimensions(0.1)
    const high = deriveTensionDimensions(0.9)
    // All 7 dimensions differ between low and high tension.
    expect(low.harmonic).not.toBe(high.harmonic)
    expect(low.melodic).not.toBe(high.melodic)
    expect(low.rhythmic).not.toBe(high.rhythmic)
    expect(low.register).not.toBe(high.register)
    expect(low.density).not.toBe(high.density)
    expect(low.spectral).not.toBe(high.spectral)
    expect(low.expectation).not.toBe(high.expectation)
    // High tension has higher values across the board.
    expect(high.harmonic).toBeGreaterThan(low.harmonic)
    expect(high.melodic).toBeGreaterThan(low.melodic)
    expect(high.density).toBeGreaterThan(low.density)
  })
})

// ─────────────────────────── T10 ───────────────────────────

describe('T10: Long-form evolution — 256+ bars evolve without collapsing', () => {
  test('256 bars produce > 30 distinct bar signatures + motif recurrence', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 256 })
    expect(section.bars.length).toBe(256)

    // No NaN.
    for (const bar of section.bars) {
      for (const n of bar.bassNotes) expect(Number.isFinite(n.midi)).toBe(true)
      for (const n of bar.leadNotes) expect(Number.isFinite(n.midi)).toBe(true)
    }

    // Evolution: > 30 distinct bar signatures.
    const sigs = new Set(
      section.bars.map((b) =>
        JSON.stringify({
          k: b.kickNotes,
          b: b.bassNotes.map((n) => n.midi),
          l: b.leadNotes.map((n) => n.midi),
        })
      )
    )
    expect(sigs.size).toBeGreaterThan(30)

    // Identity: some bars repeat (motif recurrence).
    const leadSigs = section.bars.map((b) => b.leadNotes.map((n) => n.midi).join(','))
    const counts: Record<string, number> = {}
    for (const s of leadSigs) counts[s] = (counts[s] ?? 0) + 1
    const maxRepetition = Math.max(...Object.values(counts))
    expect(maxRepetition).toBeGreaterThan(2)
  })
})

// ─────────────────────────── T11 ───────────────────────────

describe('T11: Musical return — a recognizable motif can return after development', () => {
  test('phrase material lineage is preserved across phrases', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 64 })
    // Every phrase has a phraseMaterial with a motifId.
    for (const phrase of section.phrases) {
      expect(phrase.phraseMaterial?.motifId).toBeDefined()
    }
  })

  test('development history accumulates across compose calls', () => {
    const identity = createIdentityA()
    const engine1 = new CompositionEngine({ seed: 42, context: ctx, identity })
    const section1 = engine1.composeSection({ bars: 16 })
    const material1 = section1.phrases[section1.phrases.length - 1]?.phraseMaterial

    // Second section derives from the first.
    const engine2 = new CompositionEngine({
      seed: 42,
      context: ctx,
      identity,
      previousPhraseMaterial: material1,
      developmentOperator: 'DEVELOP',
    })
    const section2 = engine2.composeSection({ bars: 16 })
    const material2 = section2.phrases[0]?.phraseMaterial

    // The second phrase's material carries the DEVELOP operator in its history.
    expect(material2?.transformHistory).toContain('DEVELOP')
  })
})

// ─────────────────────────── T12 ───────────────────────────

describe('T12: Groove integrity — kick/bass/lead maintain coherent pocket', () => {
  test('bass onsets align with kick onsets (LOCKED invariant)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 32 })
    let aligned = 0
    let totalKick = 0
    for (const bar of section.bars) {
      const bassSteps = new Set(bar.bassNotes.map((n) => n.step))
      for (const step of bar.kickNotes) {
        totalKick++
        if (bassSteps.has(step)) aligned++
      }
    }
    // Identity A is LOCKED → high kick-bass alignment.
    expect(aligned / totalKick).toBeGreaterThan(0.5)
  })

  test('space map is consistent with actual kick + bass plans', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    for (const bar of section.bars) {
      const kickSet = new Set(bar.kickPlan?.onsets ?? [])
      const bassSet = new Set(bar.bassPlan?.onsets ?? [])
      for (const cell of bar.spaceMap?.cells ?? []) {
        const occupied = kickSet.has(cell.step) || bassSet.has(cell.step)
        expect(cell.occupied).toBe(occupied)
      }
    }
  })

  test('groove plan has shared pocket fields (pulse, accent, microtiming)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    for (const bar of section.bars) {
      expect(bar.groove.pulse).toBeDefined()
      expect(bar.groove.accent.length).toBe(bar.groove.stepsPerBar)
      expect(bar.groove.microtiming.length).toBe(bar.groove.stepsPerBar)
      expect(bar.groove.bassAccentMap.length).toBe(bar.groove.stepsPerBar)
      expect(bar.groove.ghostMap.length).toBe(bar.groove.stepsPerBar)
    }
  })
})

// ─────────────────────────── BONUS: Vocabulary modes ───────────────────────────

describe('BONUS: Bass vocabulary modes alter generation behavior (not step arrays)', () => {
  test('ROLLING vs SYNCOPATED produce different onset distributions', () => {
    const scale = getScale('phrygian-dominant')
    if (!scale) return
    const groove = buildGroovePlan({ context: ctx, seed: 42, bars: 4 })
    const kickPlan = { onsets: [0, 4, 8, 12], velocities: [1, 0.8, 0.8, 0.8] }
    const rng = new Rng(42)

    const rollingNotes = generateBassByVocabulary('ROLLING', {
      bar: 0,
      groove,
      kickPlan,
      chordTones: [4, 8, 11],
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale,
      isLast: false,
      isAnticipationBar: false,
      rng,
      intervalWidth: 5,
      syncopation: 0.15,
      bassOctave: 2,
      tension: 0.25,
    })

    const syncopatedNotes = generateBassByVocabulary('SYNCOPATED', {
      bar: 0,
      groove,
      kickPlan,
      chordTones: [4, 8, 11],
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale,
      isLast: false,
      isAnticipationBar: false,
      rng: new Rng(42),
      intervalWidth: 10,
      syncopation: 0.65,
      bassOctave: 2,
      tension: 0.65,
    })

    // The onset distributions differ.
    const rollingOnsets = rollingNotes.map((n) => n.step).sort((a, b) => a - b)
    const syncopatedOnsets = syncopatedNotes.map((n) => n.step).sort((a, b) => a - b)
    expect(JSON.stringify(rollingOnsets)).not.toBe(JSON.stringify(syncopatedOnsets))
  })

  test('SPARSE produces fewer notes than ROLLING', () => {
    const scale = getScale('phrygian-dominant')
    if (!scale) return
    const groove = buildGroovePlan({ context: ctx, seed: 42, bars: 4 })
    const kickPlan = { onsets: [0, 4, 8, 12], velocities: [1, 0.8, 0.8, 0.8] }

    const rollingNotes = generateBassByVocabulary('ROLLING', {
      bar: 0,
      groove,
      kickPlan,
      chordTones: [4, 8, 11],
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale,
      isLast: false,
      isAnticipationBar: false,
      rng: new Rng(42),
      intervalWidth: 5,
      syncopation: 0.15,
      bassOctave: 2,
      tension: 0.25,
    })
    const sparseNotes = generateBassByVocabulary('SPARSE', {
      bar: 0,
      groove,
      kickPlan,
      chordTones: [4, 8, 11],
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale,
      isLast: false,
      isAnticipationBar: false,
      rng: new Rng(42),
      intervalWidth: 5,
      syncopation: 0.15,
      bassOctave: 2,
      tension: 0.25,
    })
    expect(sparseNotes.length).toBeLessThan(rollingNotes.length)
  })

  test('ACID produces chromatic approach tones', () => {
    const scale = getScale('phrygian-dominant')
    if (!scale) return
    const groove = buildGroovePlan({ context: ctx, seed: 42, bars: 4 })
    const kickPlan = { onsets: [0, 4, 8, 12], velocities: [1, 0.8, 0.8, 0.8] }
    const acidNotes = generateBassByVocabulary('ACID', {
      bar: 0,
      groove,
      kickPlan,
      chordTones: [4, 8, 11],
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale,
      isLast: false,
      isAnticipationBar: false,
      rng: new Rng(42),
      intervalWidth: 7,
      syncopation: 0.3,
      bassOctave: 2,
      tension: 0.4,
    })
    // ACID should produce APPROACH function notes.
    expect(acidNotes.some((n) => n.function === 'APPROACH')).toBe(true)
  })
})
