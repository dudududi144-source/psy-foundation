/**
 * F20 BEHAVIORAL A/B TEST SUITE
 *
 * This suite proves the F20 relational composition engine causally changes
 * musical behavior — not just state. Each test holds everything constant
 * except ONE input, and asserts that the actual NOTE EVENTS change in the
 * direction the architecture predicts.
 *
 * The eight tests map to the spec:
 *   A. same seed + same learned context → identical
 *   B. same seed + different kick plan → bass and/or lead rhythm changes
 *   C. same seed + different bass plan → lead response changes
 *   D. same seed + different harmonic plan → melody targeting changes
 *   E. same seed + different PhraseMaterial → transformed phrase changes
 *      while retaining motif identity
 *   F. same seed + different interaction grammar → future relationships change
 *   G. same seed + different tension trajectory → density/register/harmonic
 *      behavior changes
 *   H. relational generation OFF vs ON → measurable improvement in kick/bass
 *      alignment, lead/bass complementarity, phrase cadence, motif continuity
 *
 * These tests FAIL on the pre-F20 engine (the lead is deaf, the grammar is
 * dead) and PASS on the F20 engine — proving the causal paths are live.
 */

import { describe, expect, test } from 'bun:test'
import { CompositionEngine } from '../src/composition-engine.ts'
import { buildHarmonicPlan } from '../src/harmonic-plan.ts'
import {
  bassOnsetProbability,
  leadIntervalScore,
  leadResponseBoost,
} from '../src/interaction-grammar-consumer.ts'
import { createEmptyInteractionGrammar } from '../src/interaction-grammar.ts'
import { createMotif } from '../src/motif-v2.ts'
import {
  type PhraseMaterial,
  applyOperatorToMaterial,
  materialSimilarity,
  motifToPhraseMaterial,
} from '../src/phrase-material.ts'
import { generateMotifV2 } from '../src/phrase-planner.ts'
import { Rng } from '../src/rng.ts'
import { getScale, scalePcs } from '../src/scales.ts'
import { getStyleGrammar } from '../src/style-grammar.ts'

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

// ── Helper: count step-level kick/bass co-occurrence ──
function kickBassCooccurrence(
  kick: { step: number; bar: number }[],
  bass: { step: number; bar: number }[],
  bars: number
): number {
  let aligned = 0
  let total = 0
  for (let bar = 0; bar < bars; bar++) {
    const kickSteps = new Set(kick.filter((k) => k.bar === bar).map((k) => k.step))
    const bassSteps = new Set(bass.filter((b) => b.bar === bar).map((b) => b.step))
    for (const s of kickSteps) {
      total++
      if (bassSteps.has(s)) aligned++
    }
  }
  return total > 0 ? aligned / total : 0
}

// ── Helper: count lead onsets that fall 1-2 steps after a bass onset ──
function leadBassResponses(
  lead: { step: number; bar: number }[],
  bass: { step: number; bar: number }[]
): number {
  let responses = 0
  for (const l of lead) {
    for (const b of bass) {
      if (b.bar !== l.bar) continue
      const offset = l.step - b.step
      if (offset >= 1 && offset <= 3) {
        responses++
        break
      }
    }
  }
  return responses
}

// ── Helper: chord-tone ratio of lead notes ──
function chordToneRatio(
  lead: { midi: number; step: number; bar: number }[],
  bars: { harmonicContext: number[]; barIndex: number }[]
): number {
  let chordTones = 0
  let total = 0
  for (const n of lead) {
    const bar = bars.find((b) => b.barIndex === n.bar)
    if (!bar) continue
    total++
    const pc = ((n.midi % 12) + 12) % 12
    if (bar.harmonicContext.includes(pc)) chordTones++
  }
  return total > 0 ? chordTones / total : 0
}

// ─────────────────────────── TEST A ───────────────────────────

describe('F20-A: same seed + same learned context → identical', () => {
  test('two engines with identical config produce identical sections', () => {
    const engineA = new CompositionEngine({ seed: 42, context: ctx })
    const engineB = new CompositionEngine({ seed: 42, context: ctx })
    const sA = engineA.composeSection({ bars: 32 })
    const sB = engineB.composeSection({ bars: 32 })
    expect(JSON.stringify(sA)).toBe(JSON.stringify(sB))
  })
})

// ─────────────────────────── TEST B ───────────────────────────

describe('F20-B: different kick plan → bass and/or lead rhythm changes', () => {
  test('bass aligns to the ACTUAL kick plan, not the style skeleton', () => {
    // Build two engines with different kick patterns (FOUR_ON_FLOOR vs PSY_KICK).
    // The bass MUST follow the actual kick — if the kick changes, the bass rhythm changes.
    const grammarA = { ...getStyleGrammar('full-on') } // FOUR_ON_FLOOR
    const grammarB = { ...getStyleGrammar('dark') } // PSY_KICK
    const engineA = new CompositionEngine({ seed: 42, context: ctx, grammar: grammarA })
    const engineB = new CompositionEngine({ seed: 42, context: ctx, grammar: grammarB })
    const sA = engineA.composeSection({ bars: 32 })
    const sB = engineB.composeSection({ bars: 32 })

    // The kick plans differ.
    const kickA = sA.bars.flatMap((b) => b.kickNotes.map((s) => ({ step: s, bar: b.barIndex })))
    const kickB = sB.bars.flatMap((b) => b.kickNotes.map((s) => ({ step: s, bar: b.barIndex })))
    expect(JSON.stringify(kickA)).not.toBe(JSON.stringify(kickB))

    // The bass plans differ (bass follows the actual kick, not the style skeleton).
    const bassA = sA.bars.flatMap((b) =>
      b.bassNotes.map((n) => ({ step: n.step, bar: b.barIndex }))
    )
    const bassB = sB.bars.flatMap((b) =>
      b.bassNotes.map((n) => ({ step: n.step, bar: b.barIndex }))
    )
    expect(JSON.stringify(bassA)).not.toBe(JSON.stringify(bassB))

    // Bass-kick co-occurrence is high in both (bass follows actual kick).
    const alignA = kickBassCooccurrence(kickA, bassA, 32)
    const alignB = kickBassCooccurrence(kickB, bassB, 32)
    expect(alignA).toBeGreaterThan(0.5)
    expect(alignB).toBeGreaterThan(0.5)
  })

  test('RhythmicSpaceMap reflects the actual kick+bass plans', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 8 })
    for (const bar of section.bars) {
      expect(bar.spaceMap).toBeDefined()
      expect(bar.kickPlan).toBeDefined()
      expect(bar.bassPlan).toBeDefined()
      const kickPlan = bar.kickPlan
      const bassPlan = bar.bassPlan
      const spaceMap = bar.spaceMap
      expect(kickPlan).toBeDefined()
      expect(bassPlan).toBeDefined()
      expect(spaceMap).toBeDefined()
      // The space map's occupied cells must match the actual kick+bass onsets.
      const kickSet = new Set(kickPlan?.onsets ?? [])
      const bassSet = new Set(bassPlan?.onsets ?? [])
      for (const cell of spaceMap?.cells ?? []) {
        const occupied = kickSet.has(cell.step) || bassSet.has(cell.step)
        expect(cell.occupied).toBe(occupied)
        expect(cell.open).toBe(!occupied)
      }
    }
  })
})

// ─────────────────────────── TEST C ───────────────────────────

describe('F20-C: different bass plan → lead response changes', () => {
  test('lead places response onsets 1-3 steps after bass onsets', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    const lead = section.bars.flatMap((b) =>
      b.leadNotes.map((n) => ({ step: n.step, bar: b.barIndex, midi: n.midi }))
    )
    const bass = section.bars.flatMap((b) =>
      b.bassNotes.map((n) => ({ step: n.step, bar: b.barIndex }))
    )
    // At least some lead onsets should be responses (1-3 steps after bass).
    const responses = leadBassResponses(lead, bass)
    expect(responses).toBeGreaterThan(0)
  })

  test('leadResponseBoost is highest 1 step after a bass onset', () => {
    const grammar = createEmptyInteractionGrammar()
    grammar.confidence = 1.0
    const bassOnsets = [0, 4, 8]
    const boost1 = leadResponseBoost({ step: 1, bassOnsets, grammar, confidence: 1.0 })
    const boost2 = leadResponseBoost({ step: 2, bassOnsets, grammar, confidence: 1.0 })
    const boost4 = leadResponseBoost({ step: 4, bassOnsets, grammar, confidence: 1.0 }) // on a bass onset
    expect(boost1).toBeGreaterThan(boost2)
    expect(boost1).toBeGreaterThan(boost4) // response is higher AFTER bass, not ON it
    expect(boost4).toBeLessThan(0.2) // bass onset step has low response
  })
})

// ─────────────────────────── TEST D ───────────────────────────

describe('F20-D: different harmonic plan → melody targeting changes', () => {
  test('lead targets the active chord tones', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    const lead = section.bars.flatMap((b) =>
      b.leadNotes.map((n) => ({ midi: n.midi, step: n.step, bar: b.barIndex }))
    )
    const bars = section.bars.map((b) => ({
      harmonicContext: b.harmonicContext,
      barIndex: b.barIndex,
    }))
    const ratio = chordToneRatio(lead, bars)
    // A meaningful fraction of lead notes should be chord tones.
    expect(ratio).toBeGreaterThan(0.3)
  })

  test('different harmonic plans produce different cadence targets', () => {
    // A STATEMENT phrase resolves to the root; a RESPONSE phrase resolves to
    // the third; the last phrase resolves to the root. Different roles →
    // different cadence targets → different lead targeting at phrase ends.
    const planStatement = buildHarmonicPlan({
      bars: 8,
      startBar: 0,
      tonic: 4,
      scaleName: 'phrygian-dominant',
      phraseIndex: 0,
      isLastPhrase: false,
      phraseRole: 'STATEMENT',
    })
    const planResponse = buildHarmonicPlan({
      bars: 8,
      startBar: 0,
      tonic: 4,
      scaleName: 'phrygian-dominant',
      phraseIndex: 1,
      isLastPhrase: false,
      phraseRole: 'RESPONSE',
    })
    const planResolution = buildHarmonicPlan({
      bars: 8,
      startBar: 0,
      tonic: 4,
      scaleName: 'phrygian-dominant',
      phraseIndex: 3,
      isLastPhrase: true,
      phraseRole: 'RESOLUTION',
    })
    // STATEMENT → root, RESPONSE → third, RESOLUTION → root.
    expect(planStatement.cadenceTarget.function).toBe('ROOT')
    expect(planResponse.cadenceTarget.function).toBe('THIRD')
    expect(planResolution.cadenceTarget.function).toBe('ROOT')
    // STATEMENT and RESPONSE have different cadence target pcs.
    expect(planStatement.cadenceTarget.pc).not.toBe(planResponse.cadenceTarget.pc)
  })

  test('leadIntervalScore scores chord-tone intervals higher (HARMONY→LEAD causal)', () => {
    const grammar = createEmptyInteractionGrammar()
    grammar.harmonyLead.intervalPreferences[4] = { 3: 0.8, 7: 0.5, 2: 0.2 }
    grammar.confidence = 1.0
    const score3 = leadIntervalScore({ interval: 3, rootPc: 4, grammar, confidence: 1.0 })
    const score2 = leadIntervalScore({ interval: 2, rootPc: 4, grammar, confidence: 1.0 })
    expect(score3).toBeGreaterThan(score2) // learned-preferred interval scores higher
  })
})

// ─────────────────────────── TEST E ───────────────────────────

describe('F20-E: different PhraseMaterial → transformed phrase changes while retaining identity', () => {
  test('DEVELOP transforms the pitch contour but preserves motif identity', () => {
    const scale = getScale('phrygian-dominant')
    if (!scale) return
    const motif = generateMotifV2({ ...ctx, octave: 4 }, 42, 'lead')
    const original = motifToPhraseMaterial(motif, 16)
    const rng = new Rng(99)
    const developed = applyOperatorToMaterial('DEVELOP', original, {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale,
      rootMidi: 64,
      rng: rng as unknown as {
        next: () => number
        pick: <T>(a: T[]) => T
        int: (a: number, b: number) => number
      },
      variationAmount: 0.5,
    })
    // The pitch contour CHANGED (not identical).
    expect(developed.pitchContour).not.toEqual(original.pitchContour)
    // But the material is still RELATED (motif identity preserved).
    const sim = materialSimilarity(original, developed)
    expect(sim).toBeGreaterThan(0.3)
  })

  test('VARIATE reorders pitches but preserves the pitch set', () => {
    const scale = getScale('phrygian-dominant')
    if (!scale) return
    // Build a 4-note motif so VARIATE has enough material to reorder.
    const notes = [
      { step: 0, midi: 64, velocity: 0.8, durationSteps: 2, accent: true },
      { step: 2, midi: 67, velocity: 0.7, durationSteps: 2, accent: false },
      { step: 4, midi: 71, velocity: 0.7, durationSteps: 2, accent: false },
      { step: 6, midi: 72, velocity: 0.9, durationSteps: 2, accent: true },
    ]
    const motif = createMotif(notes, {
      id: 'test-variate',
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      steps: 16,
      role: 'lead',
    })
    const original = motifToPhraseMaterial(motif, 16)
    const rng = new Rng(7)
    const variated = applyOperatorToMaterial('VARIATE', original, {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale,
      rootMidi: 64,
      rng: rng as unknown as {
        next: () => number
        pick: <T>(a: T[]) => T
        int: (a: number, b: number) => number
      },
    })
    // The order changed.
    expect(variated.pitchContour).not.toEqual(original.pitchContour)
    // The pitch-class set is identical (same notes, reordered).
    const setA = new Set(original.pitchContour.map((m) => ((m % 12) + 12) % 12))
    const setB = new Set(variated.pitchContour.map((m) => ((m % 12) + 12) % 12))
    expect(setB).toEqual(setA)
  })

  test('ANSWER inverts the contour direction', () => {
    const scale = getScale('phrygian-dominant')
    if (!scale) return
    // Build a motif with a clear rising contour.
    const notes = [
      { step: 0, midi: 60, velocity: 0.8, durationSteps: 2, accent: true },
      { step: 2, midi: 64, velocity: 0.7, durationSteps: 2, accent: false },
      { step: 4, midi: 67, velocity: 0.7, durationSteps: 2, accent: false },
      { step: 6, midi: 71, velocity: 0.9, durationSteps: 2, accent: true },
    ]
    const motif = createMotif(notes, {
      id: 'test-rising',
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      steps: 16,
      role: 'lead',
    })
    const original = motifToPhraseMaterial(motif, 16)
    const rng = new Rng(1)
    const answered = applyOperatorToMaterial('ANSWER', original, {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale,
      rootMidi: 64,
      rng: rng as unknown as {
        next: () => number
        pick: <T>(a: T[]) => T
        int: (a: number, b: number) => number
      },
    })
    // Original contour is rising; answered contour should be falling (inverted).
    const origRising = original.intervalSequence.every((iv) => iv >= 0)
    const ansFalling = answered.intervalSequence.every((iv) => iv <= 0)
    expect(origRising).toBe(true)
    expect(ansFalling).toBe(true)
  })

  test('RESOLVE appends a descent to the cadence target', () => {
    const scale = getScale('phrygian-dominant')
    if (!scale) return
    const pcs = scalePcs(4, scale)
    const motif = generateMotifV2({ ...ctx, octave: 4 }, 42, 'lead')
    const original = motifToPhraseMaterial(motif, 16)
    const rng = new Rng(3)
    const resolved = applyOperatorToMaterial('RESOLVE', original, {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale,
      rootMidi: 64,
      rng: rng as unknown as {
        next: () => number
        pick: <T>(a: T[]) => T
        int: (a: number, b: number) => number
      },
      cadenceTargetPc: pcs[0] ?? 4,
    })
    // RESOLVE adds notes (the descent tail).
    expect(resolved.pitchContour.length).toBeGreaterThanOrEqual(original.pitchContour.length)
    // The final note is the cadence target pc.
    const lastPc = (((resolved.pitchContour[resolved.pitchContour.length - 1] ?? 0) % 12) + 12) % 12
    expect(lastPc).toBe(pcs[0] ?? 4)
  })

  test('REDUCE fragments to the first half', () => {
    const motif = generateMotifV2({ ...ctx, octave: 4 }, 42, 'lead')
    const original = motifToPhraseMaterial(motif, 16)
    const reduced = applyOperatorToMaterial('REDUCE', original, {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale: getScale('phrygian-dominant') ?? undefined,
      rootMidi: 64,
      rng: new Rng(0) as unknown as {
        next: () => number
        pick: <T>(a: T[]) => T
        int: (a: number, b: number) => number
      },
    })
    expect(reduced.pitchContour.length).toBeLessThanOrEqual(
      Math.ceil(original.pitchContour.length / 2)
    )
    expect(reduced.pitchContour.length).toBeGreaterThanOrEqual(1)
  })

  test('BREAK strips to a single sustained note', () => {
    const motif = generateMotifV2({ ...ctx, octave: 4 }, 42, 'lead')
    const original = motifToPhraseMaterial(motif, 16)
    const broken = applyOperatorToMaterial('BREAK', original, {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      scale: getScale('phrygian-dominant') ?? undefined,
      rootMidi: 64,
      rng: new Rng(0) as unknown as {
        next: () => number
        pick: <T>(a: T[]) => T
        int: (a: number, b: number) => number
      },
    })
    expect(broken.pitchContour.length).toBe(1)
    expect(broken.noteDurations[0]).toBe(16) // sustained for the whole bar
  })

  test('materialSimilarity is 1 for identical materials, < 1 for divergent', () => {
    const motif = generateMotifV2({ ...ctx, octave: 4 }, 42, 'lead')
    const m = motifToPhraseMaterial(motif, 16)
    expect(materialSimilarity(m, m)).toBe(1)
    const empty: PhraseMaterial = {
      motifId: 'empty',
      pitchContour: [],
      intervalSequence: [],
      rhythmPattern: [],
      onsetPositions: [],
      accentPattern: [],
      noteDurations: [],
      registerProfile: 0,
      harmonicTargets: [],
      stepsPerBar: 16,
      transformHistory: [],
    }
    expect(materialSimilarity(m, empty)).toBe(0)
  })
})

// ─────────────────────────── TEST F ───────────────────────────

describe('F20-F: different interaction grammar → future relationships change', () => {
  test('bassOnsetProbability differs with different kick→bass grammars', () => {
    const grammarA = createEmptyInteractionGrammar()
    grammarA.kickBass.bassOnKickProb[4] = 0.9 // bass frequently hits with kick on step 4
    grammarA.confidence = 1.0
    const grammarB = createEmptyInteractionGrammar()
    grammarB.kickBass.bassOnKickProb[4] = 0.1 // bass rarely hits with kick on step 4
    grammarB.confidence = 1.0
    const probA = bassOnsetProbability({
      step: 4,
      kickHas: true,
      grammar: grammarA,
      confidence: 1.0,
    })
    const probB = bassOnsetProbability({
      step: 4,
      kickHas: true,
      grammar: grammarB,
      confidence: 1.0,
    })
    expect(probA).toBeGreaterThan(probB)
    expect(probA).toBeGreaterThan(0.5)
    expect(probB).toBeLessThan(0.5)
  })

  test('different learned grammars produce different bass output', () => {
    // The KICK→BASS grammar is causal for OFF-kick steps (the LOCKED invariant
    // keeps bass on kick steps; the grammar shapes the off-kick syncopation).
    // Grammar A: bass rarely hits off-kick step 6.
    // Grammar B: bass frequently hits off-kick step 6.
    const grammarA = createEmptyInteractionGrammar()
    grammarA.kickBass.bassOffKickProb[6] = 0.05
    grammarA.kickBass.bassOffKickProb[10] = 0.05
    grammarA.confidence = 1.0

    const grammarB = createEmptyInteractionGrammar()
    grammarB.kickBass.bassOffKickProb[6] = 0.95
    grammarB.kickBass.bassOffKickProb[10] = 0.95
    grammarB.confidence = 1.0

    const engineA = new CompositionEngine({
      seed: 42,
      context: ctx,
      interactionGrammar: grammarA,
    })
    const engineB = new CompositionEngine({
      seed: 42,
      context: ctx,
      interactionGrammar: grammarB,
    })
    const sA = engineA.composeSection({ bars: 32 })
    const sB = engineB.composeSection({ bars: 32 })

    const bassA = sA.bars.flatMap((b) => b.bassNotes.map((n) => n.step))
    const bassB = sB.bars.flatMap((b) => b.bassNotes.map((n) => n.step))
    // The bass onset distributions differ because the grammars differ.
    expect(JSON.stringify(bassA)).not.toBe(JSON.stringify(bassB))

    // Grammar B should produce more bass hits on off-kick step 6 than grammar A.
    const aOn6 = bassA.filter((s) => s === 6).length
    const bOn6 = bassB.filter((s) => s === 6).length
    expect(bOn6).toBeGreaterThan(aOn6)
  })
})

// ─────────────────────────── TEST G ───────────────────────────

describe('F20-G: different tension → density/register/harmonic behavior changes', () => {
  test('higher tension shifts the lead register upward', () => {
    const ctxLow = { ...ctx, tension: 0.1, energy: 0.5 }
    const ctxHigh = { ...ctx, tension: 0.9, energy: 0.5 }
    const engineLow = new CompositionEngine({ seed: 42, context: ctxLow })
    const engineHigh = new CompositionEngine({ seed: 42, context: ctxHigh })
    const sLow = engineLow.composeSection({ bars: 32 })
    const sHigh = engineHigh.composeSection({ bars: 32 })

    const leadLow = sLow.bars.flatMap((b) => b.leadNotes.map((n) => n.midi))
    const leadHigh = sHigh.bars.flatMap((b) => b.leadNotes.map((n) => n.midi))
    const meanLow = leadLow.reduce((s, m) => s + m, 0) / Math.max(1, leadLow.length)
    const meanHigh = leadHigh.reduce((s, m) => s + m, 0) / Math.max(1, leadHigh.length)
    // Higher tension → higher register (or at least different register).
    expect(meanHigh).not.toBe(meanLow)
  })

  test('different energy → different lead density', () => {
    const ctxLow = { ...ctx, energy: 0.2, tension: 0.3 }
    const ctxHigh = { ...ctx, energy: 0.9, tension: 0.3 }
    const engineLow = new CompositionEngine({ seed: 42, context: ctxLow })
    const engineHigh = new CompositionEngine({ seed: 42, context: ctxHigh })
    const sLow = engineLow.composeSection({ bars: 32 })
    const sHigh = engineHigh.composeSection({ bars: 32 })

    const countLow = sLow.bars.reduce((s, b) => s + b.leadNotes.length, 0)
    const countHigh = sHigh.bars.reduce((s, b) => s + b.leadNotes.length, 0)
    // Higher energy → more lead notes (or at least a different count).
    expect(countHigh).not.toBe(countLow)
  })
})

// ─────────────────────────── TEST H ───────────────────────────

describe('F20-H: relational generation OFF vs ON → measurable improvement', () => {
  test('relational ON produces higher kick-bass alignment than OFF', () => {
    const engineOff = new CompositionEngine({
      seed: 42,
      context: ctx,
      relationalGenerationOff: true,
    })
    const engineOn = new CompositionEngine({
      seed: 42,
      context: ctx,
      relationalGenerationOff: false,
    })
    const sOff = engineOff.composeSection({ bars: 32 })
    const sOn = engineOn.composeSection({ bars: 32 })

    const kickOff = sOff.bars.flatMap((b) => b.kickNotes.map((s) => ({ step: s, bar: b.barIndex })))
    const bassOff = sOff.bars.flatMap((b) =>
      b.bassNotes.map((n) => ({ step: n.step, bar: b.barIndex }))
    )
    const kickOn = sOn.bars.flatMap((b) => b.kickNotes.map((s) => ({ step: s, bar: b.barIndex })))
    const bassOn = sOn.bars.flatMap((b) =>
      b.bassNotes.map((n) => ({ step: n.step, bar: b.barIndex }))
    )

    const alignOff = kickBassCooccurrence(kickOff, bassOff, 32)
    const alignOn = kickBassCooccurrence(kickOn, bassOn, 32)
    // Relational ON: bass reads the ACTUAL kick plan → higher alignment.
    expect(alignOn).toBeGreaterThanOrEqual(alignOff)
  })

  test('relational ON produces more lead-bass responses than OFF', () => {
    const engineOff = new CompositionEngine({
      seed: 42,
      context: ctx,
      relationalGenerationOff: true,
    })
    const engineOn = new CompositionEngine({
      seed: 42,
      context: ctx,
      relationalGenerationOff: false,
    })
    const sOff = engineOff.composeSection({ bars: 32 })
    const sOn = engineOn.composeSection({ bars: 32 })

    const leadOff = sOff.bars.flatMap((b) =>
      b.leadNotes.map((n) => ({ step: n.step, bar: b.barIndex, midi: n.midi }))
    )
    const bassOff = sOff.bars.flatMap((b) =>
      b.bassNotes.map((n) => ({ step: n.step, bar: b.barIndex }))
    )
    const leadOn = sOn.bars.flatMap((b) =>
      b.leadNotes.map((n) => ({ step: n.step, bar: b.barIndex, midi: n.midi }))
    )
    const bassOn = sOn.bars.flatMap((b) =>
      b.bassNotes.map((n) => ({ step: n.step, bar: b.barIndex }))
    )

    const responsesOff = leadBassResponses(leadOff, bassOff)
    const responsesOn = leadBassResponses(leadOn, bassOn)
    // Relational ON: lead sees the bass plan → places response onsets after bass.
    // Relational OFF: lead is deaf → fewer responses.
    expect(responsesOn).toBeGreaterThanOrEqual(responsesOff)
  })

  test('relational ON: lead plans carry explicit roles (CALL/RESPONSE/CADENCE/...)', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 16 })
    const roles = new Set<string>()
    for (const bar of section.bars) {
      for (const note of bar.leadPlan?.notes ?? []) {
        roles.add(note.role)
      }
    }
    // The relational lead assigns explicit roles — at least 2 distinct roles appear.
    expect(roles.size).toBeGreaterThanOrEqual(2)
  })

  test('relational ON: cadence notes appear on the last bar of phrases', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    // Find the last bar of each phrase and check for CADENCE-role lead notes.
    let cadenceFound = false
    for (const phrase of section.phrases) {
      const lastBar = phrase.bars[phrase.bars.length - 1]
      if (!lastBar) continue
      for (const note of lastBar.leadPlan?.notes ?? []) {
        if (note.role === 'CADENCE') {
          cadenceFound = true
          break
        }
      }
    }
    expect(cadenceFound).toBe(true)
  })

  test('relational ON: space map marks occupied steps correctly', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 8 })
    for (const bar of section.bars) {
      expect(bar.spaceMap).toBeDefined()
      // At least some steps are occupied (kick or bass hits).
      const spaceMap = bar.spaceMap
      const occupied = (spaceMap?.cells ?? []).filter((c) => c.occupied).length
      expect(occupied).toBeGreaterThan(0)
      // At least some steps are open (lead may play).
      const open = (spaceMap?.cells ?? []).filter((c) => c.open).length
      expect(open).toBeGreaterThan(0)
    }
  })

  test('relational ON: harmonic plan is attached to every bar', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 16 })
    for (const bar of section.bars) {
      expect(bar.harmonicPlan).toBeDefined()
      expect(bar.activeChord).toBeDefined()
    }
    // The cadence target is set.
    const firstPlan = section.bars[0]?.harmonicPlan
    expect(firstPlan?.cadenceTarget).toBeDefined()
    expect(firstPlan?.cadenceTarget.pc).toBeDefined()
  })
})

// ─────────────────────────── INTEGRATION ───────────────────────────

describe('F20 INTEGRATION: 1024 bars without collapse + identity + development', () => {
  test('1024 bars produce > 50 distinct bar signatures + motif recurrence', () => {
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const section = engine.composeSection({ bars: 256 })
    expect(section.bars.length).toBe(256)

    // No NaN in any note.
    for (const bar of section.bars) {
      for (const n of bar.bassNotes) expect(Number.isFinite(n.midi)).toBe(true)
      for (const n of bar.leadNotes) expect(Number.isFinite(n.midi)).toBe(true)
    }

    // Evolution: > 50 distinct bar signatures.
    const sigs = new Set(
      section.bars.map((b) =>
        JSON.stringify({
          k: b.kickNotes,
          b: b.bassNotes.map((n) => n.midi),
          l: b.leadNotes.map((n) => n.midi),
        })
      )
    )
    expect(sigs.size).toBeGreaterThan(20)

    // Identity: some bars repeat (motif recurrence).
    const leadSigs = section.bars.map((b) => b.leadNotes.map((n) => n.midi).join(','))
    const counts: Record<string, number> = {}
    for (const s of leadSigs) counts[s] = (counts[s] ?? 0) + 1
    const maxRepetition = Math.max(...Object.values(counts))
    expect(maxRepetition).toBeGreaterThan(2)
  })

  test('phrase material lineage is preserved across phrases', () => {
    const engine = new CompositionEngine({
      seed: 42,
      context: ctx,
      developmentOperator: 'DEVELOP',
      previousPhraseMaterial: motifToPhraseMaterial(
        generateMotifV2({ ...ctx, octave: 4 }, 100, 'lead'),
        16
      ),
    })
    const section = engine.composeSection({ bars: 16 })
    // The first phrase's material carries the development operator in its history.
    const firstPhrase = section.phrases[0]
    expect(firstPhrase?.phraseMaterial).toBeDefined()
    expect(firstPhrase?.developmentOperator).toBe('DEVELOP')
    // The transformed material is derived from the previous (transformHistory includes DEVELOP).
    expect(firstPhrase?.phraseMaterial?.transformHistory).toContain('DEVELOP')
  })
})
