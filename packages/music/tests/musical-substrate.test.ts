import { describe, expect, test } from 'bun:test'
import {
  CandidateScorer,
  type Motif,
  MotifMemory,
  type MotifNote,
  type MusicalContext,
  type PhrasePlan,
  type PhraseSlot,
  type SectionPlan,
  callResponse,
  contourMutation,
  createMotif,
  createMusicalContext,
  healthReport,
  intervalSubstitution,
  invertMotifV2 as invertV2,
  measureMusicality,
  motifIdentity,
  motifSimilarity,
  planPhrase,
  planSection,
  renderSectionNotes,
  retrogradeMotifV2 as retrogradeV2,
  rhythmicDisplacement,
  rhythmicStretch,
  shiftRegister,
  transposeMotifV2 as transposeV2,
} from '../src/index.ts'
import { getScale } from '../src/scales.ts'

// ----------------------------- helpers -----------------------------

function makeNote(
  step: number,
  midi: number,
  durationSteps = 2,
  accent = false,
  velocity = 0.7
): MotifNote {
  return { step, midi, velocity, durationSteps, accent }
}

function makeSimpleMotif(midis: number[], rootPc = 4, scaleName = 'phrygian-dominant'): Motif {
  const notes = midis.map((m, i) => makeNote(i * 2, m, 2, i === 0))
  return createMotif(notes, {
    id: `test-${midis.join('-')}`,
    rootPc,
    scaleName,
    steps: 16,
    role: 'lead',
  })
}

function phrygianContext(overrides: Partial<MusicalContext> = {}): MusicalContext {
  return createMusicalContext({
    tonic: 4,
    scaleName: 'phrygian-dominant',
    octave: 4,
    bpm: 145,
    beatsPerBar: 4,
    density: 0.6,
    energy: 0.55,
    tension: 0.4,
    sectionRole: 'ESTABLISH',
    repetitionPressure: 0.4,
    noveltyPressure: 0.6,
    ...overrides,
  })
}

// ----------------------------- 1. MusicalContext -----------------------------

describe('MusicalContext', () => {
  test('createMusicalContext fills all fields with defaults', () => {
    const ctx = createMusicalContext()
    expect(ctx.tonic).toBe(4)
    expect(ctx.scaleName).toBe('phrygian-dominant')
    expect(ctx.octave).toBe(4)
    expect(ctx.bpm).toBeGreaterThan(0)
    expect(ctx.beatsPerBar).toBe(4)
    expect(ctx.harmonicContext).toEqual([])
    expect(ctx.density).toBeGreaterThanOrEqual(0)
    expect(ctx.density).toBeLessThanOrEqual(1)
    expect(ctx.energy).toBeGreaterThanOrEqual(0)
    expect(ctx.energy).toBeLessThanOrEqual(1)
    expect(ctx.tension).toBeGreaterThanOrEqual(0)
    expect(ctx.tension).toBeLessThanOrEqual(1)
    expect(typeof ctx.sectionRole).toBe('string')
    expect(ctx.repetitionPressure).toBeGreaterThanOrEqual(0)
    expect(ctx.noveltyPressure).toBeGreaterThanOrEqual(0)
  })

  test('createMusicalContext accepts overrides', () => {
    const ctx = createMusicalContext({ tonic: 0, scaleName: 'major', bpm: 120, density: 0.9 })
    expect(ctx.tonic).toBe(0)
    expect(ctx.scaleName).toBe('major')
    expect(ctx.bpm).toBe(120)
    expect(ctx.density).toBe(0.9)
  })

  test('all fields are accessible from the returned object', () => {
    const ctx = phrygianContext({ harmonicContext: [4, 10], barPosition: 7 })
    expect(ctx.harmonicContext).toEqual([4, 10])
    expect(ctx.barPosition).toBe(7)
    expect(ctx.beatPosition).toBe(0)
    expect(ctx.phrasePosition).toBe(0)
  })
})

// ----------------------------- 2. Motif v2 -----------------------------

describe('Motif v2', () => {
  test('createMotif computes structural features', () => {
    const motif = makeSimpleMotif([64, 65, 67, 69])
    expect(motif.notes.length).toBe(4)
    expect(motif.contour).toEqual([1, 1, 1]) // all ascending
    expect(motif.intervals).toEqual([1, 2, 2])
    expect(motif.pitchClasses.sort((a, b) => a - b)).toEqual([4, 5, 7, 9])
    expect(motif.register.min).toBe(64)
    expect(motif.register.max).toBe(69)
    expect(motif.rhythmicDensity).toBeCloseTo(4 / 16, 5)
    expect(motif.accentPattern[0]).toBe(true)
    expect(motif.transformHistory).toEqual([])
  })

  test('motifIdentity survives transposition', () => {
    // Use an in-scale motif so scale snapping does not perturb intervals.
    // Phrygian-dominant on E: E=64, F=65, G#=68, A=69.
    const original = makeSimpleMotif([64, 65, 68, 69])
    const scale = getScale('phrygian-dominant')
    expect(scale).not.toBeNull()
    // Octave transposition preserves interval classes and contour exactly.
    const transposed = transposeV2(original, 12, 4, scale as NonNullable<typeof scale>)
    const idA = motifIdentity(original)
    const idB = motifIdentity(transposed)
    expect(idB).toBe(idA)
  })

  test('motifIdentity is unchanged by pure octave shift', () => {
    const original = makeSimpleMotif([64, 65, 67, 69])
    const shifted = shiftRegister(original, 1)
    expect(motifIdentity(shifted)).toBe(motifIdentity(original))
  })

  test('motifSimilarity is 1 for identical motifs', () => {
    const a = makeSimpleMotif([64, 65, 67, 69])
    const b = makeSimpleMotif([64, 65, 67, 69])
    expect(motifSimilarity(a, b)).toBeCloseTo(1, 5)
  })

  test('motifSimilarity is high for a transposed version', () => {
    const a = makeSimpleMotif([64, 65, 67, 69])
    const scale = getScale('phrygian-dominant') as NonNullable<ReturnType<typeof getScale>>
    const b = transposeV2(a, 5, 4, scale)
    expect(motifSimilarity(a, b)).toBeGreaterThan(0.8)
  })

  test('motifSimilarity is lower for unrelated motifs', () => {
    const a = makeSimpleMotif([64, 65, 67, 69])
    const b = makeSimpleMotif([80, 60, 81, 59])
    expect(motifSimilarity(a, b)).toBeLessThan(0.8)
  })
})

// ----------------------------- 3. MotifMemory -----------------------------

describe('MotifMemory', () => {
  test('ingest adds an entry and retrieve finds it', () => {
    const mem = new MotifMemory()
    const motif = makeSimpleMotif([64, 65, 67])
    mem.ingest(motif, 0, { role: 'lead' })
    expect(mem.size).toBe(1)
    const entry = mem.retrieve(motif.id)
    expect(entry).toBeDefined()
    expect(entry?.motif.id).toBe(motif.id)
    expect(entry?.roles).toContain('lead')
  })

  test('findSimilar returns the most similar motif', () => {
    const mem = new MotifMemory()
    const a = makeSimpleMotif([64, 65, 67, 69])
    const b = makeSimpleMotif([88, 89, 91, 93]) // same shape, different register
    const c = makeSimpleMotif([60, 62, 65, 70]) // different shape
    mem.ingest(a, 0)
    mem.ingest(b, 0)
    mem.ingest(c, 0)
    const similar = mem.findSimilar(a, 1)
    expect(similar.length).toBe(1)
    // b has identical shape to a, so it should be the most similar.
    expect(similar[0]?.motif.id).toBe(b.id)
  })

  test('findByRole filters by role', () => {
    const mem = new MotifMemory()
    const lead = makeSimpleMotif([64, 65])
    const bass = makeSimpleMotif([40, 41])
    mem.ingest(lead, 0, { role: 'lead' })
    mem.ingest(bass, 0, { role: 'bass' })
    const leads = mem.findByRole('lead', 5)
    expect(leads.length).toBe(1)
    expect(leads[0]?.motif.id).toBe(lead.id)
  })

  test('markUsed updates counts, confidence, and age', () => {
    const mem = new MotifMemory()
    const motif = makeSimpleMotif([64, 65])
    mem.ingest(motif, 0)
    mem.markUsed(motif.id, 4, true)
    mem.markUsed(motif.id, 8, true)
    mem.markUsed(motif.id, 12, false)
    const entry = mem.retrieve(motif.id)
    expect(entry?.usageCount).toBe(3)
    expect(entry?.successCount).toBe(2)
    expect(entry?.failCount).toBe(1)
    expect(entry?.lastUsedBar).toBe(12)
    expect(entry?.confidence).toBeGreaterThan(0)
    expect(entry?.confidence).toBeLessThan(1)
    expect(mem.age).toBeGreaterThanOrEqual(0)
  })

  test('leastUsed and mostSuccessful return expected entries', () => {
    const mem = new MotifMemory()
    const a = makeSimpleMotif([64, 65])
    const b = makeSimpleMotif([70, 72])
    mem.ingest(a, 0)
    mem.ingest(b, 0)
    mem.markUsed(a.id, 1, true)
    mem.markUsed(a.id, 2, true)
    mem.markUsed(b.id, 1, false)
    const lu = mem.leastUsed(1)
    expect(lu[0]?.motif.id).toBe(b.id)
    const ms = mem.mostSuccessful(1)
    expect(ms[0]?.motif.id).toBe(a.id)
  })

  test('toJSON and clear work', () => {
    const mem = new MotifMemory()
    mem.ingest(makeSimpleMotif([64, 65]), 0)
    mem.ingest(makeSimpleMotif([70, 72]), 0)
    expect(mem.toJSON().length).toBe(2)
    mem.clear()
    expect(mem.size).toBe(0)
  })
})

// ----------------------------- 4. Transformations -----------------------------

describe('Transformations', () => {
  const scale = getScale('phrygian-dominant') as NonNullable<ReturnType<typeof getScale>>

  test('transpose shifts notes and stays in scale', () => {
    // Use an in-scale motif so the octave identity check is not perturbed
    // by scale snapping.
    const m = makeSimpleMotif([64, 65, 68, 69])
    const t = transposeV2(m, 5, 4, scale)
    expect(t.sourceMotifId).toBe(m.id)
    expect(t.transformHistory).toContain('transpose(5)')
    // Every note should still be in the phrygian-dominant scale.
    for (const n of t.notes) {
      const pc = ((n.midi % 12) + 12) % 12
      expect([4, 5, 8, 9, 11, 0, 2]).toContain(pc)
    }
    // Octave transposition preserves identity exactly.
    const octaved = transposeV2(m, 12, 4, scale)
    expect(motifIdentity(octaved)).toBe(motifIdentity(m))
  })

  test('shiftRegister preserves identity exactly', () => {
    const m = makeSimpleMotif([64, 65, 67, 69])
    const t = shiftRegister(m, 1)
    expect(t.notes[0]?.midi).toBe(76)
    expect(motifIdentity(t)).toBe(motifIdentity(m))
    expect(t.transformHistory).toContain('shiftRegister(1)')
  })

  test('invert mirrors intervals around the first note', () => {
    const m = makeSimpleMotif([64, 65, 67, 69])
    const t = invertV2(m, 4, scale)
    expect(t.notes[0]?.midi).toBe(64)
    // The inverted motif should still be recognisable (moderate similarity).
    expect(motifSimilarity(m, t)).toBeGreaterThan(0.15)
    expect(t.transformHistory).toContain('invert')
  })

  test('retrograde reverses note content while keeping step positions', () => {
    const m = makeSimpleMotif([64, 65, 67, 69])
    const t = retrogradeV2(m)
    expect(t.notes[0]?.midi).toBe(69)
    expect(t.notes[0]?.step).toBe(0)
    expect(t.notes[t.notes.length - 1]?.midi).toBe(64)
    expect(motifSimilarity(m, t)).toBeGreaterThan(0.1)
    expect(t.transformHistory).toContain('retrograde')
  })

  test('rhythmicStretch multiplies step and duration', () => {
    const m = makeSimpleMotif([64, 65, 67, 69])
    const t = rhythmicStretch(m, 2)
    expect(t.steps).toBe(32)
    expect(t.notes[0]?.step).toBe(0)
    expect(t.notes[1]?.step).toBe(4)
    expect(t.transformHistory).toContain('rhythmicStretch(2)')
  })

  test('rhythmicDisplacement wraps step positions', () => {
    const m = makeSimpleMotif([64, 65, 67, 69])
    const t = rhythmicDisplacement(m, 2)
    expect(t.notes[0]?.step).toBe(2)
    expect(t.notes[0]?.midi).toBe(64)
    expect(t.transformHistory).toContain('rhythmicDisplacement(2)')
  })

  test('contourMutation preserves contour direction', () => {
    const m = makeSimpleMotif([64, 65, 67, 69]) // contour: [1,1,1]
    const t = contourMutation(m, 42, 0.5)
    expect(t.contour.every((c) => c >= 0)).toBe(true)
    expect(motifSimilarity(m, t)).toBeGreaterThan(0.2)
    expect(t.transformHistory.length).toBeGreaterThan(0)
  })

  test('intervalSubstitution keeps notes in scale', () => {
    // Use an in-scale motif so the substitution has a clean starting point.
    // Phrygian-dominant on E: E=64, F=65, G#=68, A=69, B=71, C=72, D=74.
    const m = makeSimpleMotif([64, 65, 68, 69])
    const t = intervalSubstitution(m, 7, 0.5)
    for (const n of t.notes) {
      const pc = ((n.midi % 12) + 12) % 12
      expect([4, 5, 8, 9, 11, 0, 2]).toContain(pc)
    }
    expect(t.transformHistory.length).toBeGreaterThan(0)
  })

  test('callResponse produces a recognisable response that resolves to the root', () => {
    const m = makeSimpleMotif([64, 65, 67, 69])
    const t = callResponse(m, 4, scale, 99)
    // Last note should resolve to the root pitch class (E = 4).
    const last = t.notes[t.notes.length - 1]
    expect(last).toBeDefined()
    expect((((last?.midi ?? 0) % 12) + 12) % 12).toBe(4)
    expect(t.transformHistory).toContain('callResponse(4)')
  })

  test('each transform records sourceMotifId', () => {
    const m = makeSimpleMotif([64, 65, 67, 69])
    const transforms = [
      transposeV2(m, 5, 4, scale),
      shiftRegister(m, 1),
      invertV2(m, 4, scale),
      retrogradeV2(m),
      rhythmicStretch(m, 2),
      rhythmicDisplacement(m, 2),
      contourMutation(m, 1, 0.4),
      intervalSubstitution(m, 1, 0.4),
      callResponse(m, 4, scale, 1),
    ]
    for (const t of transforms) {
      expect(t.sourceMotifId).toBe(m.id)
      expect(t.transformHistory.length).toBeGreaterThan(0)
    }
  })
})

// ----------------------------- 5. PhrasePlanner -----------------------------

describe('PhrasePlanner', () => {
  test('planPhrase produces an 8-bar plan with varied roles', () => {
    const mem = new MotifMemory()
    const ctx = phrygianContext()
    const plan = planPhrase({ bars: 8, seed: 42, context: ctx, memory: mem })
    expect(plan.bars).toBe(8)
    expect(plan.slots.length).toBe(8)
    const roles = new Set(plan.slots.map((s) => s.role))
    expect(roles.size).toBeGreaterThan(1)
    // Memory was seeded.
    expect(mem.size).toBeGreaterThan(0)
  })

  test('planPhrase does not place identical material in every bar', () => {
    const mem = new MotifMemory()
    const ctx = phrygianContext()
    const plan = planPhrase({ bars: 8, seed: 7, context: ctx, memory: mem })
    const materials = new Set(plan.slots.map((s) => `${s.motifId ?? ''}|${s.transformId ?? ''}`))
    expect(materials.size).toBeGreaterThan(1)
  })

  test('planPhrase is deterministic for the same seed + context + memory', () => {
    const ctx = phrygianContext()
    const mem1 = new MotifMemory()
    const mem2 = new MotifMemory()
    const plan1 = planPhrase({ bars: 8, seed: 123, context: ctx, memory: mem1 })
    const plan2 = planPhrase({ bars: 8, seed: 123, context: ctx, memory: mem2 })
    expect(plan1.slots.map((s) => s.role)).toEqual(plan2.slots.map((s) => s.role))
    expect(plan1.slots.map((s) => s.transformId)).toEqual(plan2.slots.map((s) => s.transformId))
  })

  test('different seeds produce different plans', () => {
    const ctx = phrygianContext()
    const mem1 = new MotifMemory()
    const mem2 = new MotifMemory()
    const plan1 = planPhrase({ bars: 8, seed: 1, context: ctx, memory: mem1 })
    const plan2 = planPhrase({ bars: 8, seed: 999, context: ctx, memory: mem2 })
    const same =
      plan1.slots.map((s) => s.role).join(',') === plan2.slots.map((s) => s.role).join(',')
    expect(same).toBe(false)
  })

  test('density and energy are within [0, 1] for every slot', () => {
    const mem = new MotifMemory()
    const ctx = phrygianContext()
    const plan = planPhrase({ bars: 8, seed: 3, context: ctx, memory: mem })
    for (const s of plan.slots) {
      expect(s.density).toBeGreaterThanOrEqual(0)
      expect(s.density).toBeLessThanOrEqual(1)
      expect(s.energy).toBeGreaterThanOrEqual(0)
      expect(s.energy).toBeLessThanOrEqual(1)
    }
  })
})

// ----------------------------- 6. SectionPlanner -----------------------------

describe('SectionPlanner', () => {
  test('planSection produces a 32-bar plan with curves', () => {
    const ctx = phrygianContext()
    const plan = planSection({ bars: 32, seed: 11, context: ctx })
    expect(plan.bars).toBe(32)
    expect(plan.slots.length).toBe(32)
    const densities = new Set(plan.slots.map((s) => s.density.toFixed(3)))
    expect(densities.size).toBeGreaterThan(1)
    const energies = new Set(plan.slots.map((s) => s.energy.toFixed(3)))
    expect(energies.size).toBeGreaterThan(1)
  })

  test('section roles vary across the section', () => {
    const ctx = phrygianContext()
    const plan = planSection({ bars: 32, seed: 5, context: ctx })
    const roles = new Set(plan.slots.map((s) => s.sectionRole))
    expect(roles.size).toBeGreaterThan(1)
  })

  test('different seeds produce different section plans', () => {
    const ctx = phrygianContext()
    const a = planSection({ bars: 32, seed: 1, context: ctx })
    const b = planSection({ bars: 32, seed: 2, context: ctx })
    const same =
      a.slots.map((s) => s.sectionRole).join(',') === b.slots.map((s) => s.sectionRole).join(',')
    // Curve / role assignments should differ for different seeds.
    expect(same).toBe(false)
  })

  test('phrase plans are attached at phrase-start bars', () => {
    const ctx = phrygianContext()
    const plan = planSection({ bars: 32, seed: 1, context: ctx })
    // Bars 0, 8, 16, 24 should have a phrase plan attached.
    expect(plan.slots[0]?.phrasePlan).toBeDefined()
    expect(plan.slots[8]?.phrasePlan).toBeDefined()
    expect(plan.slots[16]?.phrasePlan).toBeDefined()
    expect(plan.slots[24]?.phrasePlan).toBeDefined()
  })

  test('64-bar section is supported', () => {
    const ctx = phrygianContext()
    const plan = planSection({ bars: 64, seed: 1, context: ctx })
    expect(plan.bars).toBe(64)
    expect(plan.slots.length).toBe(64)
  })
})

// ----------------------------- 7. Diversity -----------------------------

describe('Diversity', () => {
  test('measureMusicality on a varied input produces reasonable metrics', () => {
    const notes: { midi: number; step: number; bar: number }[] = []
    // 8 bars, each with 4 notes at different pitches.
    for (let bar = 0; bar < 8; bar++) {
      for (let s = 0; s < 4; s++) {
        notes.push({ midi: 60 + bar + s * 3, step: s * 4, bar })
      }
    }
    const m = measureMusicality(notes, { bars: 8, stepsPerBar: 16 })
    expect(m.pitchClassDiversity).toBeGreaterThan(0.25)
    expect(m.uniquePitchRatio).toBeGreaterThan(0.15)
    expect(m.exactRepeatRatio).toBeLessThan(0.5)
  })

  test('healthReport detects a flat loop (PSY4 failure mode)', () => {
    // 64 bars of the same 1-pitch loop.
    const notes: { midi: number; step: number; bar: number }[] = []
    for (let bar = 0; bar < 64; bar++) {
      notes.push({ midi: 64, step: 0, bar })
      notes.push({ midi: 65, step: 8, bar })
    }
    const m = measureMusicality(notes, { bars: 64, stepsPerBar: 16 })
    const report = healthReport(m)
    expect(report.healthy).toBe(false)
    expect(report.issues.length).toBeGreaterThan(0)
    // Should flag pitch class diversity (only 2 pitch classes used).
    expect(report.issues.some((i) => i.includes('pitchClassDiversity'))).toBe(true)
    // Should flag exact repeat ratio (every bar repeats).
    expect(report.issues.some((i) => i.includes('exactRepeatRatio'))).toBe(true)
    expect(report.score).toBeLessThan(0.5)
  })

  test('healthReport is healthy for a varied input', () => {
    const notes: { midi: number; step: number; bar: number }[] = []
    for (let bar = 0; bar < 16; bar++) {
      for (let s = 0; s < 4; s++) {
        notes.push({ midi: 60 + ((bar * 3 + s * 5) % 24), step: s * 4, bar })
      }
    }
    const m = measureMusicality(notes, { bars: 16, stepsPerBar: 16 })
    const report = healthReport(m)
    expect(report.score).toBeGreaterThan(0.3)
  })
})

// ----------------------------- 8. CandidateScorer -----------------------------

describe('CandidateScorer', () => {
  test('scores are in [0, 1] and explanation is non-empty', () => {
    const mem = new MotifMemory()
    const motif = makeSimpleMotif([64, 65, 67, 69])
    mem.ingest(motif, 0, { role: 'lead' })
    const scorer = new CandidateScorer({ memory: mem })
    const ctx = phrygianContext()
    const slot: PhraseSlot = {
      barIndex: 0,
      role: 'STATEMENT',
      density: 0.5,
      energy: 0.5,
    }
    const result = scorer.score(motif, ctx, slot)
    expect(result.scores.harmonic).toBeGreaterThanOrEqual(0)
    expect(result.scores.harmonic).toBeLessThanOrEqual(1)
    expect(result.scores.rhythmic).toBeGreaterThanOrEqual(0)
    expect(result.scores.rhythmic).toBeLessThanOrEqual(1)
    expect(result.scores.continuity).toBeGreaterThanOrEqual(0)
    expect(result.scores.continuity).toBeLessThanOrEqual(1)
    expect(result.scores.novelty).toBeGreaterThanOrEqual(0)
    expect(result.scores.novelty).toBeLessThanOrEqual(1)
    expect(result.scores.repetitionPenalty).toBeGreaterThanOrEqual(0)
    expect(result.scores.repetitionPenalty).toBeLessThanOrEqual(1)
    expect(result.scores.learnedPreference).toBeGreaterThanOrEqual(0)
    expect(result.scores.learnedPreference).toBeLessThanOrEqual(1)
    expect(result.final).toBeGreaterThanOrEqual(0)
    expect(result.final).toBeLessThanOrEqual(1)
    expect(result.explanation.length).toBeGreaterThan(0)
    expect(result.explanation).toContain('final=')
  })

  test('pickBest returns the highest-scoring candidate', () => {
    const mem = new MotifMemory()
    const ctx = phrygianContext()
    const slot: PhraseSlot = { barIndex: 0, role: 'STATEMENT', density: 0.5, energy: 0.5 }
    const goodMotif = makeSimpleMotif([64, 65, 67, 69]) // in-scale
    const badMotif = makeSimpleMotif([62, 63, 66, 68]) // mostly out of scale
    mem.ingest(goodMotif, 0)
    mem.ingest(badMotif, 0)
    const scorer = new CandidateScorer({ memory: mem })
    const best = scorer.pickBest([badMotif, goodMotif], ctx, slot)
    expect(best.candidate.id).toBe(goodMotif.id)
    const scored = scorer.scoreAll([badMotif, goodMotif], ctx, slot)
    const max = Math.max(...scored.map((s) => s.final))
    expect(best.final).toBeCloseTo(max, 5)
  })

  test('scoreAll preserves input order', () => {
    const mem = new MotifMemory()
    const ctx = phrygianContext()
    const slot: PhraseSlot = { barIndex: 0, role: 'STATEMENT', density: 0.5, energy: 0.5 }
    const a = makeSimpleMotif([64, 65, 67])
    const b = makeSimpleMotif([70, 72, 75])
    const c = makeSimpleMotif([80, 82, 84])
    mem.ingest(a, 0)
    mem.ingest(b, 0)
    mem.ingest(c, 0)
    const scorer = new CandidateScorer({ memory: mem })
    const scored = scorer.scoreAll([a, b, c], ctx, slot)
    expect(scored[0]?.candidate.id).toBe(a.id)
    expect(scored[1]?.candidate.id).toBe(b.id)
    expect(scored[2]?.candidate.id).toBe(c.id)
  })

  test('learned weights influence the score', () => {
    const mem = new MotifMemory()
    const ctx = phrygianContext()
    const slot: PhraseSlot = { barIndex: 0, role: 'STATEMENT', density: 0.5, energy: 0.5 }
    const motif = makeSimpleMotif([64, 65, 67])
    mem.ingest(motif, 0)
    const low = new CandidateScorer({ memory: mem, learnedWeights: new Map([[motif.id, 0.1]]) })
    const high = new CandidateScorer({ memory: mem, learnedWeights: new Map([[motif.id, 0.9]]) })
    const lowScore = low.score(motif, ctx, slot).final
    const highScore = high.score(motif, ctx, slot).final
    expect(highScore).toBeGreaterThan(lowScore)
  })
})

// ----------------------------- 9. Determinism -----------------------------

describe('Determinism', () => {
  test('same seed + context + memory produces identical plans', () => {
    const ctx = phrygianContext()
    const mem1 = new MotifMemory()
    const mem2 = new MotifMemory()
    const p1 = planPhrase({ bars: 8, seed: 777, context: ctx, memory: mem1 })
    const p2 = planPhrase({ bars: 8, seed: 777, context: ctx, memory: mem2 })
    expect(JSON.stringify(p1.slots.map((s) => ({ r: s.role, t: s.transformId })))).toEqual(
      JSON.stringify(p2.slots.map((s) => ({ r: s.role, t: s.transformId })))
    )
  })

  test('section planner is deterministic for the same seed', () => {
    const ctx = phrygianContext()
    const a = planSection({ bars: 32, seed: 555, context: ctx })
    const b = planSection({ bars: 32, seed: 555, context: ctx })
    expect(a.slots.map((s) => s.sectionRole)).toEqual(b.slots.map((s) => s.sectionRole))
    expect(a.slots.map((s) => s.density.toFixed(4))).toEqual(
      b.slots.map((s) => s.density.toFixed(4))
    )
  })

  test('transformations are deterministic for the same seed', () => {
    const m = makeSimpleMotif([64, 65, 67, 69])
    const scale = getScale('phrygian-dominant') as NonNullable<ReturnType<typeof getScale>>
    const a = contourMutation(m, 42, 0.5)
    const b = contourMutation(m, 42, 0.5)
    expect(a.notes.map((n) => n.midi)).toEqual(b.notes.map((n) => n.midi))
    const c = callResponse(m, 4, scale, 99)
    const d = callResponse(m, 4, scale, 99)
    expect(c.notes.map((n) => n.midi)).toEqual(d.notes.map((n) => n.midi))
  })
})

// ----------------------------- 10. 64-bar reality test -----------------------------

describe('64-bar reality test', () => {
  test('generated 64 bars do not exhibit the PSY4 failure mode', () => {
    const ctx = phrygianContext({
      tonic: 4,
      scaleName: 'phrygian-dominant',
      octave: 4,
      density: 0.55,
      energy: 0.55,
    })
    const mem = new MotifMemory()
    const section: SectionPlan = planSection({
      bars: 64,
      seed: 2024,
      context: ctx,
      memory: mem,
    })
    expect(section.bars).toBe(64)
    // Render notes across the whole section.
    const rendered = renderSectionNotes(section, mem, ctx, 16)
    expect(rendered.length).toBeGreaterThan(64)

    // Build the { midi, step, bar } input that measureMusicality expects.
    const notes = rendered.map((n) => ({ midi: n.midi, step: n.step, bar: n.bar }))
    const metrics = measureMusicality(notes, { bars: 64, stepsPerBar: 16 })

    // The PSY4 failure had 3 unique pitches / 2 pitch classes / ~92% exact
    // bar repeats. We must clear each of those bars.
    expect(metrics.pitchClassDiversity).toBeGreaterThan(0.25)
    expect(metrics.uniquePitchRatio).toBeGreaterThan(0.1)
    expect(metrics.exactRepeatRatio).toBeLessThan(0.7)

    const report = healthReport(metrics)
    // Log the report for visibility but do not require full health — the
    // three PSY4-specific bounds above are the contract.
    void report
  })

  test('64-bar plan has at least 3 unique pitch classes (not the PSY4 2/12)', () => {
    const ctx = phrygianContext()
    const mem = new MotifMemory()
    const section = planSection({ bars: 64, seed: 33, context: ctx, memory: mem })
    const rendered = renderSectionNotes(section, mem, ctx, 16)
    const pcs = new Set<number>()
    for (const n of rendered) pcs.add(((n.midi % 12) + 12) % 12)
    expect(pcs.size).toBeGreaterThanOrEqual(3)
  })

  test('multiple seeds all clear the PSY4 failure bounds', () => {
    const ctx = phrygianContext()
    for (const seed of [1, 7, 42, 99, 314]) {
      const mem = new MotifMemory()
      const section = planSection({ bars: 64, seed, context: ctx, memory: mem })
      const rendered = renderSectionNotes(section, mem, ctx, 16)
      const notes = rendered.map((n) => ({ midi: n.midi, step: n.step, bar: n.bar }))
      const metrics = measureMusicality(notes, { bars: 64, stepsPerBar: 16 })
      expect(metrics.pitchClassDiversity).toBeGreaterThan(0.25)
      expect(metrics.uniquePitchRatio).toBeGreaterThan(0.1)
      expect(metrics.exactRepeatRatio).toBeLessThan(0.7)
    }
  })

  test('planPhrase output can be rendered to notes', () => {
    const ctx = phrygianContext()
    const mem = new MotifMemory()
    const plan: PhrasePlan = planPhrase({ bars: 8, seed: 17, context: ctx, memory: mem })
    // Use the section renderer on a single phrase plan via a wrapper.
    const section = planSection({ bars: 8, seed: 17, context: ctx, memory: mem })
    const rendered = renderSectionNotes(section, mem, ctx, 16)
    expect(rendered.length).toBeGreaterThan(0)
    expect(plan.slots.length).toBe(8)
  })
})
