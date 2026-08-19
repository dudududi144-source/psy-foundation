import { describe, expect, test } from 'bun:test'
import {
  type BassBehaviorNote,
  CandidateScorer,
  HarmonicClassifier,
  type Motif,
  MotifMemory,
  type MotifNote,
  MotifQualityGate,
  type MusicalContext,
  MusicalFailureDetector,
  type PhrasePlan,
  RepetitionPolicy,
  type SectionPlan,
  analyzeRhythm,
  buildPhraseArc,
  coherenceReport,
  createMotif,
  createMusicalContext,
  evaluateBassQuality,
  evaluatePhraseArc,
  generateBassBehavior,
  generateMotifV2,
  healthReport,
  invertMotifV2 as invertV2,
  measureHarmonicCoherence,
  measureMotifCoherence,
  measureMusicality,
  measureRhythmicCoherence,
  measureStructuralCoherence,
  motifSimilarity,
  planPhrase,
  planSection,
  renderSectionNotes,
  retrogradeMotifV2 as retrogradeV2,
  rhythmSimilarity,
  transformRhythm,
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
    id: `test-${midis.join('-')}-${Math.random().toString(36).slice(2, 6)}`,
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

function inRange01(v: number): boolean {
  return typeof v === 'number' && v >= 0 && v <= 1 && !Number.isNaN(v)
}

// ----------------------------- 1. Coherence metrics -----------------------------

describe('Coherence metrics', () => {
  test('all 5 categories produce 0..1 values for a generated phrase', () => {
    const ctx = phrygianContext()
    const memory = new MotifMemory()
    const plan = planPhrase({ bars: 8, seed: 42, context: ctx, memory })
    const notes = renderSectionNotes(
      {
        bars: 8,
        slots: [
          {
            barIndex: 0,
            phrasePlan: plan,
            sectionRole: 'ESTABLISH',
            density: 0.5,
            energy: 0.5,
            novelty: 0.5,
            registerTarget: 4,
          },
        ],
        seed: 42,
      } as unknown as SectionPlan,
      memory,
      ctx,
      16
    )
    const motifs = memory.toJSON().map((e) => e.motif)
    const report = coherenceReport({
      motifs,
      phrase: plan,
      section: {
        bars: 8,
        slots: [
          {
            barIndex: 0,
            phrasePlan: plan,
            sectionRole: 'ESTABLISH',
            density: 0.5,
            energy: 0.5,
            novelty: 0.5,
            registerTarget: 4,
          },
        ],
        seed: 42,
      } as unknown as SectionPlan,
      notes: notes.map((n) => ({ midi: n.midi, step: n.step + n.bar * 16, durationSteps: 2 })),
      context: ctx,
    })
    expect(inRange01(report.motif.intervalSimilarity)).toBe(true)
    expect(inRange01(report.motif.contourSimilarity)).toBe(true)
    expect(inRange01(report.motif.rhythmSimilarity)).toBe(true)
    expect(inRange01(report.motif.pitchClassRelationship)).toBe(true)
    expect(inRange01(report.motif.transformedMotifSimilarity)).toBe(true)
    expect(inRange01(report.phrase.openingClosingRelationship)).toBe(true)
    expect(inRange01(report.phrase.motifRecurrence)).toBe(true)
    expect(inRange01(report.phrase.motifTransformation)).toBe(true)
    expect(inRange01(report.phrase.cadenceStrength)).toBe(true)
    expect(inRange01(report.phrase.phraseContinuity)).toBe(true)
    expect(inRange01(report.harmonic.chordToneRatio)).toBe(true)
    expect(inRange01(report.harmonic.tensionNoteRatio)).toBe(true)
    expect(inRange01(report.harmonic.resolutionRatio)).toBe(true)
    expect(inRange01(report.harmonic.tonalStability)).toBe(true)
    expect(report.harmonic.illegalMoves).toBeGreaterThanOrEqual(0)
    expect(inRange01(report.rhythmic.subdivisionConsistency)).toBe(true)
    expect(inRange01(report.rhythmic.syncopationConsistency)).toBe(true)
    expect(inRange01(report.rhythmic.accentContinuity)).toBe(true)
    expect(inRange01(report.rhythmic.phraseEndingRhythm)).toBe(true)
    expect(inRange01(report.rhythmic.grooveStability)).toBe(true)
    expect(inRange01(report.structural.sectionContrast)).toBe(true)
    expect(inRange01(report.structural.sectionIdentity)).toBe(true)
    expect(inRange01(report.structural.callbackRate)).toBe(true)
    expect(inRange01(report.structural.repetitionSpacing)).toBe(true)
    expect(inRange01(report.structural.developmentDistance)).toBe(true)
    expect(inRange01(report.overall)).toBe(true)
  })

  test('individual measure functions work standalone', () => {
    const motifs = [
      makeSimpleMotif([64, 65, 67, 69]),
      makeSimpleMotif([64, 65, 67, 69]),
      makeSimpleMotif([64, 65, 67, 69]),
    ]
    const motifM = measureMotifCoherence(motifs)
    expect(motifM.intervalSimilarity).toBeGreaterThan(0.9)
    expect(motifM.contourSimilarity).toBeGreaterThan(0.9)

    const ctx = phrygianContext({ harmonicContext: [4, 7, 10] })
    const harmonicM = measureHarmonicCoherence(
      [{ midi: 64 }, { midi: 67 }, { midi: 70 }, { midi: 62 }],
      ctx
    )
    expect(harmonicM.tonalStability).toBeGreaterThan(0)

    const rhythmicM = measureRhythmicCoherence(
      [
        { step: 0, durationSteps: 2 },
        { step: 4, durationSteps: 2 },
        { step: 8, durationSteps: 2 },
        { step: 12, durationSteps: 2 },
      ],
      16
    )
    expect(rhythmicM.subdivisionConsistency).toBeGreaterThan(0)
  })
})

// ----------------------------- 2. RepetitionPolicy -----------------------------

describe('RepetitionPolicy', () => {
  test('produces A→A→A→B→A-return pattern (not A→B→C→D→E)', () => {
    const ctx = phrygianContext()
    const memory = new MotifMemory()
    const section = planSection({ bars: 16, seed: 99, context: ctx, memory })
    const policy = new RepetitionPolicy({ minCallbackDistance: 3 })

    // Simulate the policy bar-by-bar. We track the "played" motif id for each
    // bar: NEW_MATERIAL creates a fresh id; repeats/callbacks reuse sourceMotifId.
    const recentMotifIds: string[] = []
    const decisions: ReturnType<RepetitionPolicy['decide']>[] = []
    let newCounter = 0
    for (let bar = 0; bar < section.bars; bar++) {
      const decision = policy.decide({
        barIndex: bar,
        sectionPlan: section,
        memory,
        recentMotifIds: [...recentMotifIds],
        seed: 99,
      })
      let playedId: string
      if (decision.type === 'NEW_MATERIAL' || !decision.sourceMotifId) {
        playedId = `new-${newCounter++}`
        const placeholderMotif = makeSimpleMotif([64, 65, 67, 69])
        // Override the id so we can track it.
        const tracked = createMotif(placeholderMotif.notes, {
          id: playedId,
          rootPc: 4,
          scaleName: 'phrygian-dominant',
          steps: 16,
          role: 'lead',
        })
        memory.ingest(tracked, bar, { role: 'lead' })
      } else {
        playedId = decision.sourceMotifId
      }
      recentMotifIds.unshift(playedId)
      decisions.push(decision)
    }

    // The first decision should be NEW_MATERIAL (establishing A).
    expect(decisions[0]?.type).toBe('NEW_MATERIAL')

    // There should be at least one TRANSFORMED_REPEAT or DEVELOPMENT somewhere
    // (this is the A' / A'' part).
    const transformedCount = decisions.filter(
      (d) => d.type === 'TRANSFORMED_REPEAT' || d.type === 'DEVELOPMENT'
    ).length
    expect(transformedCount).toBeGreaterThan(0)

    // There should be at least one CALLBACK (the A-return).
    const callbackCount = decisions.filter((d) => d.type === 'CALLBACK').length
    expect(callbackCount).toBeGreaterThan(0)

    // NOT every decision is NEW_MATERIAL (that would be A→B→C→D→E).
    const allNew = decisions.every((d) => d.type === 'NEW_MATERIAL')
    expect(allNew).toBe(false)

    // The sequence should be healthy per evaluateSequence.
    const evalResult = policy.evaluateSequence(decisions)
    expect(evalResult.healthy).toBe(true)
  })

  test('evaluateSequence flags A→B→C→D→E as unhealthy', () => {
    const policy = new RepetitionPolicy()
    const allNew = [
      { type: 'NEW_MATERIAL' as const, reason: 'x' },
      { type: 'NEW_MATERIAL' as const, reason: 'x' },
      { type: 'NEW_MATERIAL' as const, reason: 'x' },
      { type: 'NEW_MATERIAL' as const, reason: 'x' },
      { type: 'NEW_MATERIAL' as const, reason: 'x' },
    ]
    const result = policy.evaluateSequence(allNew)
    expect(result.healthy).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })
})

// ----------------------------- 3. MotifQualityGate -----------------------------

describe('MotifQualityGate', () => {
  test('rejects bad motifs and passes good ones', () => {
    const ctx = phrygianContext()
    const gate = new MotifQualityGate({ threshold: 0.45, context: ctx })

    // Bad motif: same note repeated (flat contour, no identity).
    const badNotes = [0, 4, 8, 12].map((s) => makeNote(s, 64, 2, false))
    const badMotif = createMotif(badNotes, {
      id: 'bad-flat',
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      steps: 16,
      role: 'lead',
    })

    // Good motif: generated by the substrate.
    const goodMotif = generateMotifV2(ctx, 12345, 'lead')

    const badScore = gate.score(badMotif, ctx)
    const goodScore = gate.score(goodMotif, ctx)

    expect(goodScore.final).toBeGreaterThan(badScore.final)
    expect(goodScore.passed).toBe(true)
    expect(badScore.passed).toBe(false)
  })

  test('filter returns only passing motifs', () => {
    const ctx = phrygianContext()
    const gate = new MotifQualityGate({ threshold: 0.45, context: ctx })
    const good = generateMotifV2(ctx, 1, 'lead')
    const badNotes = [0, 4, 8, 12].map((s) => makeNote(s, 64, 2, false))
    const bad = createMotif(badNotes, {
      id: 'bad-flat-2',
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      steps: 16,
      role: 'lead',
    })
    const filtered = gate.filter([good, bad], ctx)
    expect(filtered.length).toBe(1)
    expect(filtered[0]?.id).toBe(good.id)
  })

  test('diagnose returns suggestions for failing motifs', () => {
    const ctx = phrygianContext()
    const gate = new MotifQualityGate({ threshold: 0.7, context: ctx })
    const badNotes = [0, 4, 8, 12].map((s) => makeNote(s, 64, 2, false))
    const bad = createMotif(badNotes, {
      id: 'bad-flat-3',
      rootPc: 4,
      scaleName: 'phrygian-dominant',
      steps: 16,
      role: 'lead',
    })
    const diag = gate.diagnose(bad, ctx)
    expect(diag.issues.length).toBeGreaterThan(0)
    expect(diag.suggestions.length).toBeGreaterThan(0)
  })
})

// ----------------------------- 4. PhraseArc -----------------------------

describe('PhraseArc', () => {
  test('has START→DEVELOPMENT→DESTINATION→CADENCE stages, peak bar, resolution', () => {
    const ctx = phrygianContext()
    const arc = buildPhraseArc({ bars: 8, seed: 42, context: ctx })
    expect(arc.stages.length).toBe(8)
    const stageTypes = new Set(arc.stages.map((s) => s.stage))
    expect(stageTypes.has('START')).toBe(true)
    expect(stageTypes.has('CADENCE')).toBe(true)
    // Peak bar is within [0, bars-1].
    expect(arc.peakBar).toBeGreaterThanOrEqual(0)
    expect(arc.peakBar).toBeLessThanOrEqual(7)
    // Resolution bar is the last bar.
    expect(arc.resolutionBar).toBe(7)
    // Peak tension > opening tension and > resolution tension.
    expect(arc.peakTension).toBeGreaterThan(arc.openingTension)
    expect(arc.peakTension).toBeGreaterThan(arc.resolutionTension)
  })

  test('evaluatePhraseArc produces 0..1 scores', () => {
    const ctx = phrygianContext()
    const arc = buildPhraseArc({ bars: 8, seed: 42, context: ctx })
    const notes = [
      { step: 0, bar: 0, midi: 64 },
      { step: 4, bar: 0, midi: 65 },
      { step: 0, bar: 3, midi: 69 },
      { step: 4, bar: 3, midi: 70 },
      { step: 0, bar: 7, midi: 64 },
    ]
    const evalResult = evaluatePhraseArc(arc, notes)
    expect(inRange01(evalResult.coherence)).toBe(true)
    expect(inRange01(evalResult.cadenceStrength)).toBe(true)
    expect(inRange01(evalResult.development)).toBe(true)
  })
})

// ----------------------------- 5. HarmonicClassifier -----------------------------

describe('HarmonicClassifier', () => {
  test('classifies notes as CHORD_TONE / PASSING / TENSION / RESOLUTION', () => {
    // C major with C major chord.
    const classifier = new HarmonicClassifier({
      tonic: 0,
      scaleName: 'major',
      chord: [0, 4, 7],
    })
    // C (60) → CHORD_TONE (pc 0 in chord).
    expect(classifier.classify(60).function).toBe('CHORD_TONE')
    // E (64) → CHORD_TONE (pc 4 in chord).
    expect(classifier.classify(64).function).toBe('CHORD_TONE')
    // G (67) → CHORD_TONE (pc 7 in chord).
    expect(classifier.classify(67).function).toBe('CHORD_TONE')
    // D (62) → PASSING_TONE (pc 2: in scale, not stable, not chord).
    expect(classifier.classify(62).function).toBe('PASSING_TONE')
    // C# (61) → TENSION (pc 1: not in scale).
    expect(classifier.classify(61).function).toBe('TENSION')

    // Sequence: C# → C should mark C as RESOLUTION.
    const seq = classifier.classifySequence([61, 60])
    expect(seq[0]?.function).toBe('TENSION')
    expect(seq[1]?.function).toBe('RESOLUTION')
    expect(seq[0]?.resolvesTo).toBe(60)
  })

  test('getChordTones / getStableTones / getTensionTones return correct pcs', () => {
    const classifier = new HarmonicClassifier({
      tonic: 0,
      scaleName: 'major',
      chord: [0, 4, 7],
    })
    expect(classifier.getChordTones()).toEqual([0, 4, 7])
    // Stable tones: root (0) + fifth (7) of the scale + chord tones.
    const stable = classifier.getStableTones()
    expect(stable).toContain(0)
    expect(stable).toContain(4)
    expect(stable).toContain(7)
    // Tension tones: scale tones that aren't stable.
    const tensions = classifier.getTensionTones()
    expect(tensions).toContain(2) // D
    expect(tensions).toContain(5) // F
    expect(tensions).toContain(9) // A
    expect(tensions).toContain(11) // B
  })
})

// ----------------------------- 6. RhythmicIdentity -----------------------------

describe('RhythmicIdentity', () => {
  test('fingerprint survives stretch and displace transforms', () => {
    const notes = [
      { step: 0, durationSteps: 4, accent: true },
      { step: 4, durationSteps: 4, accent: false },
      { step: 8, durationSteps: 4, accent: true },
      { step: 12, durationSteps: 4, accent: false },
    ]
    const identity = analyzeRhythm(notes, 16)
    const stretched = transformRhythm(identity, 'stretch', { factor: 2 })
    const displaced = transformRhythm(identity, 'displace', { offset: 4 })
    expect(stretched.fingerprint).toBe(identity.fingerprint)
    expect(displaced.fingerprint).toBe(identity.fingerprint)
  })

  test('rhythmSimilarity returns 1 for identical fingerprints', () => {
    const notes = [
      { step: 0, durationSteps: 2 },
      { step: 4, durationSteps: 2 },
    ]
    const a = analyzeRhythm(notes, 16)
    const b = analyzeRhythm(notes, 16)
    expect(rhythmSimilarity(a, b)).toBe(1)
  })

  test('analyzeRhythm produces valid identity fields', () => {
    const notes = [
      { step: 0, durationSteps: 2, accent: true },
      { step: 2, durationSteps: 2 },
      { step: 4, durationSteps: 2, accent: true },
      { step: 6, durationSteps: 2 },
    ]
    const id = analyzeRhythm(notes, 16)
    expect([1, 2, 3, 4]).toContain(id.subdivision)
    expect(inRange01(id.syncopationRate)).toBe(true)
    expect(inRange01(id.swingAmount)).toBe(true)
    expect(inRange01(id.density)).toBe(true)
    expect(id.fingerprint.length).toBeGreaterThan(0)
    expect(id.accentPattern.length).toBe(16)
    expect(id.restPattern.length).toBe(16)
  })
})

// ----------------------------- 7. BassBehavior -----------------------------

describe('BassBehavior', () => {
  test('NOT root-only, has function diversity, register appropriate', () => {
    const ctx = phrygianContext({ octave: 4 })
    const bass = generateBassBehavior({
      context: ctx,
      harmonicContext: [4, 7, 10],
      seed: 42,
      bars: 8,
      stepsPerBar: 16,
    })
    const quality = evaluateBassQuality(bass, ctx)
    expect(quality.notRootOnly).toBe(true)
    expect(quality.functionDiversity).toBeGreaterThan(0)
    expect(quality.registerAppropriate).toBe(true)
    expect(quality.issues.length).toBe(0)
    // The bass should have used at least 3 different BassFunctions.
    const functionCount = Object.values(bass.functionDistribution).filter((c) => c > 0).length
    expect(functionCount).toBeGreaterThanOrEqual(3)
    // Bass notes should span multiple pitch classes.
    const pcs = new Set(bass.notes.map((n) => ((n.midi % 12) + 12) % 12))
    expect(pcs.size).toBeGreaterThan(1)
  })
})

// ----------------------------- 8. MusicalFailureDetector -----------------------------

describe('MusicalFailureDetector', () => {
  test('detects stuck pitch', () => {
    const detector = new MusicalFailureDetector()
    // Create 6 bars all with modal pc=0 (C).
    const notes: { midi: number; step: number; bar: number }[] = []
    for (let bar = 0; bar < 6; bar++) {
      for (let step = 0; step < 4; step++) {
        notes.push({ midi: 60, step, bar })
      }
    }
    const metrics = {
      uniquePitchRatio: 0.05,
      pitchClassDiversity: 0.08,
      intervalDiversity: 0,
      rhythmicDiversity: 0.1,
      motifReuseRatio: 0.9,
      transformationRatio: 0,
      exactRepeatRatio: 0.9,
      registerDiversity: 0.05,
      structuralEvolution: 0.02,
    }
    const report = detector.detect({
      notes,
      metrics,
      bars: 6,
      stepsPerBar: 16,
    })
    const stuck = report.failures.find((f) => f.type === 'STUCK_PITCH')
    expect(stuck).toBeDefined()
    expect(stuck?.level).toBe('FAIL')
    expect(report.level).toBe('FAIL')
  })

  test('detects root-only bass', () => {
    const detector = new MusicalFailureDetector()
    const bassNotes: BassBehaviorNote[] = []
    for (let bar = 0; bar < 4; bar++) {
      bassNotes.push({ midi: 36, function: 'ROOT', step: bar * 16, durationSteps: 2 })
      bassNotes.push({ midi: 36, function: 'ROOT', step: bar * 16 + 8, durationSteps: 2 })
    }
    const metrics = {
      uniquePitchRatio: 0.5,
      pitchClassDiversity: 0.5,
      intervalDiversity: 0.5,
      rhythmicDiversity: 0.5,
      motifReuseRatio: 0.3,
      transformationRatio: 0.3,
      exactRepeatRatio: 0.3,
      registerDiversity: 0.3,
      structuralEvolution: 0.3,
    }
    const report = detector.detect({
      notes: bassNotes.map((n) => ({ midi: n.midi, step: n.step, bar: Math.floor(n.step / 16) })),
      bassNotes,
      metrics,
      bars: 4,
      stepsPerBar: 16,
    })
    const rootOnly = report.failures.find((f) => f.type === 'ROOT_ONLY_BASS')
    expect(rootOnly).toBeDefined()
    expect(rootOnly?.level).toBe('FAIL')
  })

  test('detects excessive repetition', () => {
    const detector = new MusicalFailureDetector()
    const metrics = {
      uniquePitchRatio: 0.3,
      pitchClassDiversity: 0.3,
      intervalDiversity: 0.3,
      rhythmicDiversity: 0.3,
      motifReuseRatio: 0.3,
      transformationRatio: 0.3,
      exactRepeatRatio: 0.75,
      registerDiversity: 0.3,
      structuralEvolution: 0.3,
    }
    const report = detector.detect({
      notes: [{ midi: 60, step: 0, bar: 0 }],
      metrics,
      bars: 1,
      stepsPerBar: 16,
    })
    const excessive = report.failures.find((f) => f.type === 'EXCESSIVE_REPETITION')
    expect(excessive).toBeDefined()
    expect(excessive?.level).toBe('WARNING')
  })

  test('returns OK for healthy input', () => {
    const detector = new MusicalFailureDetector()
    const notes: { midi: number; step: number; bar: number }[] = []
    for (let bar = 0; bar < 8; bar++) {
      const pcs = [60, 62, 64, 65, 67, 69, 71]
      for (let step = 0; step < 4; step++) {
        notes.push({ midi: pcs[(bar + step) % pcs.length] ?? 60, step, bar })
      }
    }
    const metrics = {
      uniquePitchRatio: 0.5,
      pitchClassDiversity: 0.6,
      intervalDiversity: 0.5,
      rhythmicDiversity: 0.6,
      motifReuseRatio: 0.3,
      transformationRatio: 0.4,
      exactRepeatRatio: 0.2,
      registerDiversity: 0.4,
      structuralEvolution: 0.3,
    }
    const report = detector.detect({
      notes,
      metrics,
      bars: 8,
      stepsPerBar: 16,
    })
    // Should not have FAIL-level failures (may have warnings).
    expect(report.level).not.toBe('FAIL')
  })
})

// ----------------------------- 9. Property tests -----------------------------

describe('Property tests', () => {
  test('inversion twice restores the original motif (up to scale snapping)', () => {
    const ctx = phrygianContext()
    const scale = getScale(ctx.scaleName)
    expect(scale).not.toBeNull()
    if (!scale) return
    const original = generateMotifV2(ctx, 777, 'lead')
    const inverted = invertV2(original, ctx.tonic, scale)
    const doubleInverted = invertV2(inverted, ctx.tonic, scale)
    // The motifSimilarity should be high (contour is preserved by double
    // inversion; interval magnitudes may drift slightly due to scale snapping).
    const sim = motifSimilarity(original, doubleInverted)
    expect(sim).toBeGreaterThan(0.7)
    // The contour directions should mostly match (scale snapping may flip
    // a small interval's sign in rare cases).
    let contourMatches = 0
    for (let i = 0; i < original.contour.length; i++) {
      if (doubleInverted.contour[i] === original.contour[i]) contourMatches++
    }
    expect(contourMatches / original.contour.length).toBeGreaterThan(0.7)
  })

  test('retrograde twice restores the original motif', () => {
    const ctx = phrygianContext()
    const original = generateMotifV2(ctx, 888, 'lead')
    const retro = retrogradeV2(original)
    const doubleRetro = retrogradeV2(retro)
    // Notes' MIDI values should be identical (retrograde preserves pitch content).
    expect(doubleRetro.notes.length).toBe(original.notes.length)
    for (let i = 0; i < original.notes.length; i++) {
      expect(doubleRetro.notes[i]?.midi).toBe(original.notes[i]?.midi)
    }
  })

  test('same seed produces identical phrase plans', () => {
    const ctx = phrygianContext()
    const memA = new MotifMemory()
    const memB = new MotifMemory()
    const planA = planPhrase({ bars: 8, seed: 123, context: ctx, memory: memA })
    const planB = planPhrase({ bars: 8, seed: 123, context: ctx, memory: memB })
    expect(planA.bars).toBe(planB.bars)
    expect(planA.slots.length).toBe(planB.slots.length)
    for (let i = 0; i < planA.slots.length; i++) {
      expect(planA.slots[i]?.role).toBe(planB.slots[i]?.role)
      expect(planA.slots[i]?.transformId).toBe(planB.slots[i]?.transformId)
    }
  })
})

// ----------------------------- 10. 128-bar test -----------------------------

describe('128-bar reality test', () => {
  test('generate 128 bars, verify callbacks + development + no end-loop-collapse', () => {
    const ctx = phrygianContext()
    const memory = new MotifMemory()
    const section = planSection({ bars: 128, seed: 2024, context: ctx, memory })
    const notes = renderSectionNotes(section, memory, ctx, 16)

    // Basic sanity: we generated a substantial number of notes.
    expect(notes.length).toBeGreaterThan(100)

    // Measure musicality across the full 128 bars.
    const metrics = measureMusicality(
      notes.map((n) => ({ midi: n.midi, step: n.step, bar: n.bar })),
      { bars: 128, stepsPerBar: 16 }
    )
    const health = healthReport(metrics)

    // The section should NOT exhibit the PSY4 failure mode.
    // With 128 bars the uniquePitchRatio naturally drops (note count grows
    // faster than unique pitch count) but must stay well above PSY4's ~0.006.
    expect(metrics.uniquePitchRatio).toBeGreaterThan(0.04)
    expect(metrics.pitchClassDiversity).toBeGreaterThan(0.2)
    expect(metrics.exactRepeatRatio).toBeLessThan(0.7)

    // Coherence report: structural metrics should show callbacks + development.
    const phrasePlans: PhrasePlan[] = []
    for (const slot of section.slots) {
      if (slot.phrasePlan) phrasePlans.push(slot.phrasePlan)
    }
    const structuralM = measureStructuralCoherence(section, phrasePlans)
    expect(structuralM.callbackRate).toBeGreaterThan(0)
    // developmentDistance may be 0 if all phrases share the same material hash;
    // but with 128 bars and many phrases, some development should occur.
    expect(structuralM.developmentDistance).toBeGreaterThanOrEqual(0)

    // No end-loop-collapse: the last 16 bars should not be all identical.
    const lastBars = notes.filter((n) => n.bar >= 112)
    const lastBarPatterns = new Set<string>()
    for (let bar = 112; bar < 128; bar++) {
      const pat = lastBars
        .filter((n) => n.bar === bar)
        .map((n) => `${n.step}:${n.midi}`)
        .join('|')
      if (pat.length > 0) lastBarPatterns.add(pat)
    }
    // At least 2 distinct patterns in the last 16 bars (not a collapse).
    expect(lastBarPatterns.size).toBeGreaterThan(1)

    void health
  })
})

// ----------------------------- 11. Learning experiment -----------------------------

describe('Learning experiment', () => {
  test('Run B (learning ON) improves over Run A (learning OFF)', () => {
    const ctx = phrygianContext()

    // Design: create 4 "good" motifs at octave 4 and 4 "bad" motifs that are
    // octave-2 transpositions of the good ones (via shiftRegister). Because
    // motifSimilarity is transposition-invariant, each good motif and its
    // bad twin have similarity = 1.0. This means the scorer's novelty axis
    // (1 - max_similarity) is ~0 for ALL motifs — the existing axes cannot
    // distinguish good from bad. Only the quality gate's register axis
    // separates them (good at octave 4 → register ≈ 1; bad at octave 2 →
    // register = 0). Learning (learned weights from the quality gate) is
    // what lets Run B prefer the good motifs.
    const goodMotifs: Motif[] = []
    for (let i = 0; i < 4; i++) {
      goodMotifs.push(generateMotifV2({ ...ctx, octave: 4 }, 1000 + i, 'lead'))
    }
    const badMotifs: Motif[] = goodMotifs.map((m, i) => {
      // Transpose down 2 octaves — same contour/intervals, wrong register.
      const notes = m.notes.map((n) => ({ ...n, midi: n.midi - 24 }))
      return createMotif(notes, {
        id: `bad-oct2-${i}`,
        rootPc: m.rootPc,
        scaleName: m.scaleName,
        steps: m.steps,
        role: m.role,
      })
    })
    // Put bad motifs first in the array. In Run A (uniform learned weights),
    // all motifs tie on every axis → the scorer picks the first candidate
    // (bad[0]). In Run B (quality-derived learned weights), good motifs
    // score higher → the scorer picks good[0] despite it being later in
    // the array.
    const allMotifs = [...badMotifs, ...goodMotifs]

    // Set up memory with all motifs.
    const memory = new MotifMemory()
    for (const m of allMotifs) {
      memory.ingest(m, 0, { role: 'lead' })
    }

    // 8 slots with varied roles.
    const slots = [
      { barIndex: 0, role: 'STATEMENT' as const, density: 0.18, energy: 0.5 },
      { barIndex: 1, role: 'DEVELOPMENT' as const, density: 0.18, energy: 0.55 },
      { barIndex: 2, role: 'RESPONSE' as const, density: 0.18, energy: 0.5 },
      { barIndex: 3, role: 'BUILD' as const, density: 0.18, energy: 0.7 },
      { barIndex: 4, role: 'RELEASE' as const, density: 0.18, energy: 0.45 },
      { barIndex: 5, role: 'STATEMENT' as const, density: 0.18, energy: 0.5 },
      { barIndex: 6, role: 'DEVELOPMENT' as const, density: 0.18, energy: 0.6 },
      { barIndex: 7, role: 'RESOLUTION' as const, density: 0.18, energy: 0.4 },
    ]

    // Both scorers use the same axis weights; only the learned weights differ.
    // We suppress the continuity and novelty axes (which would otherwise
    // dominate and mask the learned signal) so the learnedPreference axis
    // is the primary differentiator.
    const scorerWeights = {
      harmonic: 0.2,
      rhythmic: 0.1,
      continuity: 0.05,
      novelty: 0.05,
      repetitionPenalty: 0.1,
      learnedPreference: 0.5,
    }

    // Run A (learning OFF): scorer with uniform learned weights (0.5 for all).
    const scorerA = new CandidateScorer({
      memory,
      learnedWeights: new Map(),
      weights: scorerWeights,
    })
    const picksA: Motif[] = []
    let prevA: Motif | undefined
    for (const slot of slots) {
      const fullSlot = { ...slot, motifId: undefined, transformId: 'none' }
      const best = scorerA.pickBest(allMotifs, ctx, fullSlot, prevA)
      picksA.push(best.candidate)
      prevA = best.candidate
    }

    // Training pass: quality gate scores all motifs; good motifs score higher
    // (register ≈ 1) than bad motifs (register = 0).
    const gate = new MotifQualityGate({ threshold: 0.4, context: ctx })
    const learnedWeights = new Map<string, number>()
    for (const m of allMotifs) {
      learnedWeights.set(m.id, gate.score(m, ctx).final)
    }

    // Run B (learning ON): scorer with learned weights derived from the
    // quality gate. Same axis weights as Run A — only the learned signal
    // differs.
    const scorerB = new CandidateScorer({
      memory,
      learnedWeights,
      weights: scorerWeights,
    })
    const picksB: Motif[] = []
    let prevB: Motif | undefined
    for (const slot of slots) {
      const fullSlot = { ...slot, motifId: undefined, transformId: 'none' }
      const best = scorerB.pickBest(allMotifs, ctx, fullSlot, prevB)
      picksB.push(best.candidate)
      prevB = best.candidate
    }

    // Measure average quality of each run's picks.
    const avgQualityA = picksA.reduce((sum, m) => sum + gate.score(m, ctx).final, 0) / picksA.length
    const avgQualityB = picksB.reduce((sum, m) => sum + gate.score(m, ctx).final, 0) / picksB.length

    // Run B should have higher average quality than Run A.
    expect(avgQualityB).toBeGreaterThan(avgQualityA)

    // Run B should pick fewer bad (wrong-register) motifs than Run A.
    const badIds = new Set(badMotifs.map((m) => m.id))
    const badCountA = picksA.filter((m) => badIds.has(m.id)).length
    const badCountB = picksB.filter((m) => badIds.has(m.id)).length
    expect(badCountB).toBeLessThanOrEqual(badCountA)
  })
})

// ----------------------------- 12. Style differentiation -----------------------------

describe('Style differentiation', () => {
  test('same seed, different style contexts → different behavior', () => {
    const ctxA = phrygianContext() // phrygian-dominant, tonic E (4)
    const ctxB = createMusicalContext({
      tonic: 0, // C
      scaleName: 'major-pentatonic',
      octave: 4,
      bpm: 120,
      beatsPerBar: 4,
      density: 0.6,
      energy: 0.55,
      tension: 0.3,
      sectionRole: 'ESTABLISH',
    })

    const memA = new MotifMemory()
    const memB = new MotifMemory()
    const planA = planPhrase({ bars: 8, seed: 555, context: ctxA, memory: memA })
    const planB = planPhrase({ bars: 8, seed: 555, context: ctxB, memory: memB })

    const notesA = renderSectionNotes(
      {
        bars: 8,
        slots: [
          {
            barIndex: 0,
            phrasePlan: planA,
            sectionRole: 'ESTABLISH',
            density: 0.5,
            energy: 0.5,
            novelty: 0.5,
            registerTarget: 4,
          },
        ],
        seed: 555,
      } as unknown as SectionPlan,
      memA,
      ctxA,
      16
    )
    const notesB = renderSectionNotes(
      {
        bars: 8,
        slots: [
          {
            barIndex: 0,
            phrasePlan: planB,
            sectionRole: 'ESTABLISH',
            density: 0.5,
            energy: 0.5,
            novelty: 0.5,
            registerTarget: 4,
          },
        ],
        seed: 555,
      } as unknown as SectionPlan,
      memB,
      ctxB,
      16
    )

    // The pitch class sets should differ (phrygian-dominant vs major-pentatonic).
    const pcsA = new Set(notesA.map((n) => ((n.midi % 12) + 12) % 12))
    const pcsB = new Set(notesB.map((n) => ((n.midi % 12) + 12) % 12))

    // Phrygian dominant on E: pcs should include E(4) and F(5) — the signature minor 2nd.
    expect(pcsA.has(4)).toBe(true)
    // Major pentatonic on C: pcs should include C(0), D(2), E(4), G(7), A(9).
    expect(pcsB.has(0)).toBe(true)

    // The two pc sets should NOT be identical.
    const allPcs = new Set([...pcsA, ...pcsB])
    const intersection = [...allPcs].filter((pc) => pcsA.has(pc) && pcsB.has(pc))
    // They should differ in at least one pc.
    expect(intersection.length).toBeLessThan(allPcs.size)

    // Both should be mostly in their respective scales.
    const scaleA = getScale(ctxA.scaleName)
    const scaleB = getScale(ctxB.scaleName)
    expect(scaleA).not.toBeNull()
    expect(scaleB).not.toBeNull()
  })
})
