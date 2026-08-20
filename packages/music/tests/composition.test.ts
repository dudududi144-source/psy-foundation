import { describe, expect, test } from 'bun:test'
import { generateBassBehavior } from '../src/bass-behavior.ts'
import {
  ARRANGEMENT_ROLE_MAP,
  type ArrangementState,
  type ComposedPhrase,
  type ComposedSection,
  CompositionEngine,
  type GroovePlan,
  type MusicalContext,
  STYLE_GRAMMARS,
  applyStyleToContext,
  buildGroovePlan,
  createMusicalContext,
  detectMusicalFailures,
  getStyleGrammar,
  invertPitchPure,
  isAccentStep,
  isKickStep,
  measureBassKickAlignment,
  planArrangement,
  retrogradePure,
  runSimulation,
  runSimulationSuite,
} from '../src/index.ts'
import { createMotif } from '../src/motif-v2.ts'
import { generateMotifV2 } from '../src/phrase-planner.ts'

// ----------------------------- helpers -----------------------------

function phrygianContext(overrides: Partial<MusicalContext> = {}): MusicalContext {
  return createMusicalContext({
    tonic: 4,
    scaleName: 'phrygian-dominant',
    octave: 4,
    bpm: 145,
    beatsPerBar: 4,
    density: 0.5,
    energy: 0.55,
    tension: 0.4,
    sectionRole: 'full-on',
    repetitionPressure: 0.4,
    noveltyPressure: 0.6,
    ...overrides,
  })
}

function makeTestMotif(midis: number[], rootPc = 4): ReturnType<typeof createMotif> {
  const notes = midis.map((m, i) => ({
    step: i * 2,
    midi: m,
    velocity: 0.7,
    durationSteps: 2,
    accent: i === 0,
  }))
  return createMotif(notes, {
    id: `test-${midis.join('-')}`,
    rootPc,
    scaleName: 'phrygian-dominant',
    steps: 16,
    role: 'lead',
  })
}

// ====================== 1. GroovePlan ======================

describe('GroovePlan', () => {
  test('kick skeleton exists, bass alignment defined, accent grid correct', () => {
    const ctx = phrygianContext()
    const groove = buildGroovePlan({ context: ctx, seed: 42, bars: 64 })
    expect(groove.kickSteps.length).toBeGreaterThan(0)
    expect(groove.bassKickAlignment).toMatch(/^(LOCKED|COMPLEMENTARY|INDEPENDENT)$/)
    // Accent grid: beats 1-4 of a 16-step bar = [0, 4, 8, 12].
    expect(groove.accentSteps).toEqual([0, 4, 8, 12])
    expect(groove.subdivision).toBe(4)
    expect(groove.stepsPerBar).toBe(16)
    // isKickStep / isAccentStep helpers agree with the arrays.
    for (const step of groove.kickSteps) {
      expect(isKickStep(groove, step)).toBe(true)
    }
    for (const step of groove.accentSteps) {
      expect(isAccentStep(groove, step)).toBe(true)
    }
    expect(isKickStep(groove, 1)).toBe(false)
  })

  test('four-on-floor style produces kicks on every quarter', () => {
    const ctx = phrygianContext({ sectionRole: 'full-on' })
    const groove = buildGroovePlan({ context: ctx, seed: 1, bars: 32 })
    // full-on uses FOUR_ON_FLOOR → kicks at [0, 4, 8, 12].
    expect(groove.kickSteps).toEqual([0, 4, 8, 12])
  })

  test('dark style produces psy kick (sparser)', () => {
    const ctx = phrygianContext({ sectionRole: 'dark' })
    const groove = buildGroovePlan({ context: ctx, seed: 1, bars: 32 })
    // dark uses PSY_KICK → kicks at [0, 8].
    expect(groove.kickSteps).toEqual([0, 8])
  })

  test('fill bars land at phrase boundaries', () => {
    const ctx = phrygianContext()
    const groove = buildGroovePlan({ context: ctx, seed: 7, bars: 32 })
    // Default phrase length is 8, so fills at bars 7, 15, 23, 31.
    expect(groove.fillBars).toContain(7)
    expect(groove.fillBars).toContain(15)
    expect(groove.fillBars.length).toBeGreaterThan(0)
  })
})

// ====================== 2. ArrangementState ======================

describe('ArrangementState', () => {
  test('INTRO has kick=OFF, DROP has kick=ON, BREAK has kick=OFF', () => {
    expect(ARRANGEMENT_ROLE_MAP.INTRO.kick).toBe(false)
    expect(ARRANGEMENT_ROLE_MAP.DROP.kick).toBe(true)
    expect(ARRANGEMENT_ROLE_MAP.BREAK.kick).toBe(false)
  })

  test('PEAK has every role active', () => {
    const r = ARRANGEMENT_ROLE_MAP.PEAK
    expect(r.kick && r.bass && r.lead && r.hats && r.percussion).toBe(true)
  })

  test('OUTRO has only texture', () => {
    const r = ARRANGEMENT_ROLE_MAP.OUTRO
    expect(r.texture).toBe(true)
    expect(r.kick || r.bass || r.lead || r.hats || r.percussion).toBe(false)
  })

  test('planArrangement walks through all states in narrative order', () => {
    const ctx = phrygianContext()
    const plan = planArrangement({ bars: 64, seed: 1, context: ctx })
    expect(plan.bars).toBe(64)
    expect(plan.slots.length).toBe(64)
    // First non-INTRO state should be GROOVE; last should be OUTRO.
    const firstState = plan.slots[0]?.state
    const lastState = plan.slots[plan.slots.length - 1]?.state
    expect(firstState).toBe('INTRO')
    expect(lastState).toBe('OUTRO')
    // Every state should appear at least once.
    const allStates = new Set(plan.slots.map((s) => s.state))
    for (const state of Object.keys(ARRANGEMENT_ROLE_MAP) as ArrangementState[]) {
      expect(allStates.has(state)).toBe(true)
    }
  })
})

// ====================== 3. CompositionEngine.composePhrase ======================

describe('CompositionEngine.composePhrase', () => {
  test('produces 8-bar phrase with all parts coordinated', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 42, context: ctx })
    const groove = buildGroovePlan({ context: ctx, seed: 42, bars: 8 })
    const phrase = engine.composePhrase({
      bars: 8,
      arrangementState: 'BUILD',
      groove,
      harmonicContext: [4, 8, 11], // E major triad
    })
    expect(phrase.bars.length).toBe(8)
    // BUILD state activates every role.
    for (const bar of phrase.bars) {
      expect(bar.kickNotes.length).toBeGreaterThan(0)
      expect(bar.bassNotes.length).toBeGreaterThan(0)
      expect(bar.leadNotes.length).toBeGreaterThan(0)
      expect(bar.hatNotes.length).toBeGreaterThan(0)
    }
    // Phrase arc is well-formed.
    expect(phrase.phraseArc.opening).toBe(0)
    expect(phrase.phraseArc.resolution).toBe(7)
    expect(phrase.motifIds.length).toBeGreaterThan(0)
  })

  test('bass aligns with kick on beat 1 (LOCKED)', () => {
    const ctx = phrygianContext({ sectionRole: 'full-on' })
    const engine = new CompositionEngine({ seed: 99, context: ctx })
    const groove = buildGroovePlan({ context: ctx, seed: 99, bars: 8 })
    expect(groove.bassKickAlignment).toBe('LOCKED')
    const phrase = engine.composePhrase({
      bars: 8,
      arrangementState: 'GROOVE',
      groove,
      harmonicContext: [4, 8, 11],
    })
    for (const bar of phrase.bars) {
      // Bass has a note on step 0 (beat 1).
      const bassOnBeat1 = bar.bassNotes.some((b) => b.step === 0)
      expect(bassOnBeat1).toBe(true)
      // Kick includes step 0.
      expect(bar.kickNotes.includes(0)).toBe(true)
    }
  })

  test('lead stays above bass register (no overlap)', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 13, context: ctx })
    const groove = buildGroovePlan({ context: ctx, seed: 13, bars: 8 })
    const phrase = engine.composePhrase({
      bars: 8,
      arrangementState: 'BUILD',
      groove,
      harmonicContext: [4, 8, 11],
    })
    for (const bar of phrase.bars) {
      const bassMax = bar.bassNotes.length > 0 ? Math.max(...bar.bassNotes.map((b) => b.midi)) : 0
      const leadMin = bar.leadNotes.length > 0 ? Math.min(...bar.leadNotes.map((l) => l.midi)) : 128
      expect(leadMin).toBeGreaterThanOrEqual(60)
      expect(bassMax).toBeLessThanOrEqual(59)
      expect(leadMin).toBeGreaterThan(bassMax)
    }
  })

  test('lead max leap enforced', () => {
    const ctx = phrygianContext({ sectionRole: 'full-on' })
    const engine = new CompositionEngine({ seed: 21, context: ctx })
    const grammar = getStyleGrammar('full-on')
    const groove = buildGroovePlan({ context: ctx, seed: 21, bars: 8 })
    const phrase = engine.composePhrase({
      bars: 8,
      arrangementState: 'BUILD',
      groove,
      harmonicContext: [4, 8, 11],
    })
    for (const bar of phrase.bars) {
      const sorted = bar.leadNotes.slice().sort((a, b) => a.step - b.step)
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]
        const cur = sorted[i]
        if (!prev || !cur) continue
        const leap = Math.abs(cur.midi - prev.midi)
        expect(leap).toBeLessThanOrEqual(grammar.maxLeap)
      }
    }
  })

  test('lead motif recurrence exists (not random walk)', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 55, context: ctx })
    const groove = buildGroovePlan({ context: ctx, seed: 55, bars: 8 })
    const phrase = engine.composePhrase({
      bars: 8,
      arrangementState: 'DEVELOPMENT',
      groove,
      harmonicContext: [4, 8, 11],
    })
    // Collect each bar's pitch sequence (sorted MIDI list as string).
    const sequences = phrase.bars.map((bar) =>
      bar.leadNotes
        .slice()
        .sort((a, b) => a.step - b.step)
        .map((n) => n.midi)
        .join(',')
    )
    // At least two bars should share a sequence (within-phrase recurrence).
    const unique = new Set(sequences.filter((s) => s !== ''))
    expect(unique.size).toBeLessThan(sequences.filter((s) => s !== '').length)
    // Every bar uses the same primary motif id.
    expect(phrase.motifIds.length).toBe(1)
  })
})

// ====================== 4. Arrangement creates intentional silence ======================

describe('Arrangement silence', () => {
  test('some bars have lead OFF (intentional silence)', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 7, context: ctx })
    const section = engine.composeSection({ bars: 64 })
    const leadOffBars = section.bars.filter((b) => b.leadNotes.length === 0)
    expect(leadOffBars.length).toBeGreaterThan(0)
    // Specifically: INTRO and OUTRO bars should have lead OFF.
    const introBars = section.bars.filter((b) => b.arrangementState === 'INTRO')
    for (const bar of introBars) {
      expect(bar.leadNotes.length).toBe(0)
    }
    const breakBars = section.bars.filter((b) => b.arrangementState === 'BREAK')
    expect(breakBars.length).toBeGreaterThan(0)
  })
})

// ====================== 5. Style differentiation ======================

describe('Style differentiation', () => {
  test('full-on vs progressive vs dark vs acid produce different groove/harmony/melody', () => {
    const styles = ['full-on', 'progressive', 'dark', 'acid']
    const grooves = new Map<string, GroovePlan>()
    const scales = new Map<string, string>()
    const tessituras = new Map<string, number>()
    for (const style of styles) {
      const grammar = getStyleGrammar(style)
      const ctx = applyStyleToContext(phrygianContext({ sectionRole: style }), grammar)
      const groove = buildGroovePlan({ context: ctx, seed: 1, bars: 32, grammar })
      grooves.set(style, groove)
      scales.set(style, ctx.scaleName)
      tessituras.set(style, grammar.tessituraCenter)
    }
    // Different kick patterns.
    const kickSigs = new Set(Array.from(grooves.values()).map((g) => g.kickSteps.join(',')))
    expect(kickSigs.size).toBeGreaterThan(1)
    // Different scales.
    const scaleSet = new Set(scales.values())
    expect(scaleSet.size).toBeGreaterThan(1)
    // Different tessituras.
    const tessSet = new Set(tessituras.values())
    expect(tessSet.size).toBeGreaterThan(1)
    // Specific checks: dark uses PSY_KICK (sparser), full-on uses FOUR_ON_FLOOR.
    expect(grooves.get('dark')?.kickSteps).toEqual([0, 8])
    expect(grooves.get('full-on')?.kickSteps).toEqual([0, 4, 8, 12])
    // acid uses BROKEN kick.
    expect(grooves.get('acid')?.kickSteps).not.toEqual([0, 4, 8, 12])
  })
})

// ====================== 6. Simulations ======================

describe('64-bar simulation', () => {
  test('kick continuity >0.8, bass-kick alignment >0.7, no LEAD_REGISTER_ESCAPE', () => {
    const ctx = phrygianContext()
    const result = runSimulation({ bars: 64, seed: 42, context: ctx })
    expect(result.bars).toBe(64)
    expect(result.kickContinuity).toBeGreaterThan(0.8)
    expect(result.bassKickAlignment).toBeGreaterThan(0.7)
    const escapeFailures = result.failures.filter((f) => f.type === 'LEAD_REGISTER_ESCAPE')
    expect(escapeFailures.length).toBe(0)
    // No NaN in any numeric metric.
    expect(Number.isFinite(result.kickContinuity)).toBe(true)
    expect(Number.isFinite(result.registerCenter)).toBe(true)
    expect(Number.isFinite(result.leapDistribution)).toBe(true)
  })
})

describe('128-bar simulation', () => {
  test('section differentiation >0.3, callbacks exist, no end-loop-collapse', () => {
    const ctx = phrygianContext()
    const result = runSimulation({ bars: 128, seed: 99, context: ctx })
    expect(result.bars).toBe(128)
    expect(result.sectionDifferentiation).toBeGreaterThan(0.3)
    // Check for callbacks: re-run engine and inspect phrases for shared motif ids.
    const engine = new CompositionEngine({ seed: 99, context: ctx })
    const section = engine.composeSection({ bars: 128 })
    const motifIds = section.phrases
      .map((p) => p.motifIds[0])
      .filter((id) => id !== undefined) as string[]
    const uniqueIds = new Set(motifIds)
    // At least one phrase callbacks to an earlier one (motifId repeats).
    expect(uniqueIds.size).toBeLessThan(motifIds.length)
    // Last phrase callbacks to the first.
    expect(section.phrases[section.phrases.length - 1]?.callbackTo).toBeDefined()
    // No end-loop-collapse: the last 8 lead-bearing bars have at least 2
    // distinct pitch sequences (i.e., the section doesn't end with the same
    // bar repeating). We skip bars where lead is intentionally OFF (e.g.,
    // OUTRO texture-only bars) since those are silent by design.
    const leadBearingBars = section.bars.filter((b) => b.leadNotes.length > 0)
    const last8 = leadBearingBars.slice(-8)
    expect(last8.length).toBeGreaterThan(0)
    const lastSeqs = new Set(
      last8.map((bar) =>
        bar.leadNotes
          .slice()
          .sort((a, b) => a.step - b.step)
          .map((n) => n.midi)
          .join(',')
      )
    )
    expect(lastSeqs.size).toBeGreaterThan(1)
  })
})

describe('256-bar simulation', () => {
  test('stable, no NaN, no infinite loops', () => {
    const ctx = phrygianContext()
    const result = runSimulation({ bars: 256, seed: 314, context: ctx })
    expect(result.bars).toBe(256)
    // All numeric metrics are finite.
    const numericKeys: (keyof typeof result)[] = [
      'kickContinuity',
      'bassKickAlignment',
      'onsetDensity',
      'syncopation',
      'subdivisionStability',
      'phraseEndFills',
      'chordToneRatio',
      'nonChordResolution',
      'harmonicRhythm',
      'illegalMoves',
      'tonalCenterStability',
      'registerCenter',
      'registerExcursion',
      'leapDistribution',
      'repetitionRatio',
      'motifRecurrence',
      'phraseContour',
      'cadenceQuality',
      'noteDensity',
      'intentionalRests',
      'densityArc',
      'dropBreakContrast',
      'sectionDifferentiation',
      'kickBassAlignment',
      'bassHarmonyAlignment',
      'leadHarmonyAlignment',
      'leadBassSpacing',
      'drumBassRelationship',
      'failureCount',
    ]
    for (const key of numericKeys) {
      const v = result[key] as number
      expect(Number.isFinite(v)).toBe(true)
    }
    // The simulation suite runs without error.
    const suite = runSimulationSuite()
    expect(suite.results64.length).toBeGreaterThan(0)
    expect(suite.results128.length).toBeGreaterThan(0)
    expect(suite.results256.length).toBeGreaterThan(0)
    expect(suite.styles.length).toBe(4)
  })
})

// ====================== 7. Failure detector ======================

describe('Enhanced failure detector', () => {
  test('detects KICK_MISSING in a section where kick is absent in DROP', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 1, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    // Sabotage: remove all kicks from DROP bars.
    const sabotagedKick = section.bars
      .filter((b) => b.arrangementState !== 'DROP')
      .flatMap((b) => b.kickNotes.map((step) => ({ step, bar: b.barIndex })))
    const notes = engine.renderNotes(section)
    const report = detectMusicalFailures({
      kickNotes: sabotagedKick,
      bassNotes: notes.bass,
      leadNotes: notes.lead,
      hatNotes: notes.hats,
      arrangement: section.arrangement,
      groove: section.groove,
      bars: 32,
      stepsPerBar: 16,
    })
    const kickMissing = report.failures.find((f) => f.type === 'KICK_MISSING')
    expect(kickMissing).toBeDefined()
    expect(kickMissing?.level).toBe('FAIL')
  })

  test('detects BASS_UNCOUPLED when bass skips beat 1', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 1, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    const notes = engine.renderNotes(section)
    // Sabotage: remove bass notes on step 0 from most bars.
    const sabotagedBass = notes.bass
      .filter((b) => b.step !== 0)
      .map((b) => ({ midi: b.midi, step: b.step, bar: b.bar, function: b.function }))
    const report = detectMusicalFailures({
      kickNotes: notes.kick,
      bassNotes: sabotagedBass,
      leadNotes: notes.lead,
      hatNotes: notes.hats,
      arrangement: section.arrangement,
      groove: section.groove,
      bars: 32,
      stepsPerBar: 16,
    })
    const uncoupled = report.failures.find((f) => f.type === 'BASS_UNCOUPLED')
    expect(uncoupled).toBeDefined()
    expect(uncoupled?.level).toBe('FAIL')
  })

  test('detects LEAD_REGISTER_ESCAPE when lead goes above MIDI 84', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 1, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    const notes = engine.renderNotes(section)
    // Sabotage: bump every lead note to MIDI 96.
    const sabotagedLead = notes.lead.map((l) => ({ ...l, midi: 96 }))
    const report = detectMusicalFailures({
      kickNotes: notes.kick,
      bassNotes: notes.bass,
      leadNotes: sabotagedLead,
      hatNotes: notes.hats,
      arrangement: section.arrangement,
      groove: section.groove,
      bars: 32,
      stepsPerBar: 16,
    })
    const escapeFailure = report.failures.find((f) => f.type === 'LEAD_REGISTER_ESCAPE')
    expect(escapeFailure).toBeDefined()
    expect(escapeFailure?.level).toBe('WARNING')
  })

  test('clean composition produces no FAIL-level failures', () => {
    const ctx = phrygianContext()
    const result = runSimulation({ bars: 64, seed: 42, context: ctx })
    const failLevel = result.failures.filter((f) => f.level === 'FAIL')
    expect(failLevel.length).toBe(0)
  })
})

// ====================== 8. Determinism ======================

describe('Determinism', () => {
  test('same seed produces identical output', () => {
    const ctx = phrygianContext()
    const engine1 = new CompositionEngine({ seed: 42, context: ctx })
    const engine2 = new CompositionEngine({ seed: 42, context: ctx })
    const s1 = engine1.composeSection({ bars: 32 })
    const s2 = engine2.composeSection({ bars: 32 })
    expect(s1.bars.length).toBe(s2.bars.length)
    for (let i = 0; i < s1.bars.length; i++) {
      const b1 = s1.bars[i]
      const b2 = s2.bars[i]
      expect(b1?.kickNotes).toEqual(b2?.kickNotes)
      expect(b1?.bassNotes.map((n) => n.midi)).toEqual(b2?.bassNotes.map((n) => n.midi))
      expect(b1?.leadNotes.map((n) => n.midi)).toEqual(b2?.leadNotes.map((n) => n.midi))
    }
  })

  test('different seeds produce different output', () => {
    const ctx = phrygianContext()
    const engine1 = new CompositionEngine({ seed: 1, context: ctx })
    const engine2 = new CompositionEngine({ seed: 2, context: ctx })
    const s1 = engine1.composeSection({ bars: 32 })
    const s2 = engine2.composeSection({ bars: 32 })
    const seq1 = s1.bars.map((b) => b.leadNotes.map((n) => n.midi).join(',')).join('|')
    const seq2 = s2.bars.map((b) => b.leadNotes.map((n) => n.midi).join(',')).join('|')
    expect(seq1).not.toBe(seq2)
  })
})

// ====================== 9. Transform involutions ======================

describe('Transform involutions', () => {
  test('invertPitchPure twice returns the original motif (pitch identity)', () => {
    const motif = makeTestMotif([64, 67, 71, 72, 69, 65])
    const inverted = invertPitchPure(motif)
    const doubleInverted = invertPitchPure(inverted)
    // Pitch content (MIDI values) should match the original.
    expect(doubleInverted.notes.map((n) => n.midi)).toEqual(motif.notes.map((n) => n.midi))
    // Step positions preserved.
    expect(doubleInverted.notes.map((n) => n.step)).toEqual(motif.notes.map((n) => n.step))
  })

  test('retrogradePure twice returns the original motif', () => {
    const motif = makeTestMotif([64, 67, 71, 72, 69, 65])
    const retro = retrogradePure(motif)
    const doubleRetro = retrogradePure(retro)
    expect(doubleRetro.notes.map((n) => n.midi)).toEqual(motif.notes.map((n) => n.midi))
    expect(doubleRetro.notes.map((n) => n.step)).toEqual(motif.notes.map((n) => n.step))
  })

  test('retrogradePure is an involution on engine-generated motifs', () => {
    const ctx = phrygianContext()
    const motif = generateMotifV2(ctx, 123, 'lead')
    const retro = retrogradePure(motif)
    const doubleRetro = retrogradePure(retro)
    expect(doubleRetro.notes.map((n) => n.midi)).toEqual(motif.notes.map((n) => n.midi))
  })
})

// ====================== 10. A/B comparison ======================

describe('A/B comparison: new architecture vs old', () => {
  // Comprehensive kick-bass alignment: fraction of kick steps that have a
  // co-occurring bass note. The old bass-behavior generates notes from a
  // fixed K-B-B-B grammar ([0, 8, 12, 15]) that doesn't know the kick
  // pattern; the new CompositionEngine reads the groove and aligns the
  // bass to the kick (LOCKED) or to the gaps (COMPLEMENTARY — still hits
  // step 0, which is always a kick step).
  function kickBassCooccurrence(
    kick: { step: number; bar: number }[],
    bass: { step: number; bar: number }[],
    bars: number
  ): number {
    let total = 0
    let hit = 0
    for (let bar = 0; bar < bars; bar++) {
      const kickSteps = new Set(kick.filter((k) => k.bar === bar).map((k) => k.step))
      const bassSteps = new Set(bass.filter((b) => b.bar === bar).map((b) => b.step))
      if (kickSteps.size === 0) continue
      for (const ks of kickSteps) {
        total++
        if (bassSteps.has(ks)) hit++
      }
    }
    return total > 0 ? hit / total : 0
  }

  test('new CompositionEngine has higher kick-bass alignment than old bass-behavior', () => {
    // Use a custom grammar: BROKEN kick ([0, 3, 6, 10]) with LOCKED bass.
    // The old K-B-B-B bass ([0, 8, 12, 15]) only co-occurs with the kick on
    // step 0, so old alignment = 1/4 = 0.25.
    // The new LOCKED bass hits every kick step (ROOT on 0, 3, 6, 10), so
    // new alignment = 4/4 = 1.0 — a 4x improvement.
    const ctx = phrygianContext({ sectionRole: 'acid' })
    const baseGrammar = getStyleGrammar('acid')
    const grammar = { ...baseGrammar, bassAlignment: 'LOCKED' as const }
    const groove = buildGroovePlan({ context: ctx, seed: 1, bars: 32, grammar })
    expect(groove.kickSteps).toEqual([0, 3, 6, 10])
    expect(groove.bassKickAlignment).toBe('LOCKED')

    // --- OLD architecture: bass generated independently of kick ---
    const oldBassBehavior = generateBassBehavior({
      context: ctx,
      harmonicContext: [4, 8, 11],
      seed: 1,
      bars: 32,
      stepsPerBar: 16,
    })
    const oldBassNotes = oldBassBehavior.notes.map((n) => ({
      midi: n.midi,
      step: n.step % 16,
      bar: Math.floor(n.step / 16),
      function: n.function,
    }))
    const oldKickNotes: { step: number; bar: number }[] = []
    for (let bar = 0; bar < 32; bar++) {
      for (const step of groove.kickSteps) {
        oldKickNotes.push({ step, bar })
      }
    }
    const oldAlignment = kickBassCooccurrence(oldKickNotes, oldBassNotes, 32)

    // --- NEW architecture: bass composed against the groove ---
    const engine = new CompositionEngine({ seed: 1, context: ctx, grammar })
    const section = engine.composeSection({ bars: 32 })
    const notes = engine.renderNotes(section)
    const newAlignment = kickBassCooccurrence(
      notes.kick,
      notes.bass.map((b) => ({ step: b.step, bar: b.bar })),
      32
    )

    // The new architecture should produce strictly higher kick-bass alignment
    // than the old independent-bass grammar.
    expect(newAlignment).toBeGreaterThan(oldAlignment)
    // Sanity: new alignment should be at least 2x the old.
    expect(newAlignment / Math.max(oldAlignment, 0.01)).toBeGreaterThan(2)
  })

  test('measureBassKickAlignment utility reports the expected ratio', () => {
    const bass = [
      { step: 0, bar: 0 },
      { step: 0, bar: 1 },
      { step: 4, bar: 2 }, // bar 2 has no beat-1 bass
    ]
    const kick = [
      { step: 0, bar: 0 },
      { step: 0, bar: 1 },
      { step: 0, bar: 2 },
      { step: 0, bar: 3 }, // bar 3 has no bass
    ]
    // 2 bars (0, 1) out of 4 have both bass+kick on beat 1.
    const alignment = measureBassKickAlignment(bass, kick, 4)
    expect(alignment).toBeCloseTo(0.5, 5)
  })
})

// ====================== 11. ComposedSection sanity ======================

describe('ComposedSection sanity', () => {
  test('32-bar section has phrases, arrangement, and groove', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 1, context: ctx })
    const section: ComposedSection = engine.composeSection({ bars: 32 })
    expect(section.bars.length).toBe(32)
    expect(section.phrases.length).toBeGreaterThan(0)
    expect(section.arrangement.bars).toBe(32)
    expect(section.groove.kickSteps.length).toBeGreaterThan(0)
    // Each phrase should have 8 bars.
    for (const phrase of section.phrases) {
      expect(phrase.bars.length).toBeLessThanOrEqual(8)
      expect(phrase.bars.length).toBeGreaterThan(0)
    }
  })

  test('renderNotes produces flat arrays per part', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 1, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    const notes = engine.renderNotes(section)
    expect(notes.kick.length).toBeGreaterThan(0)
    expect(notes.bass.length).toBeGreaterThan(0)
    expect(notes.lead.length).toBeGreaterThan(0)
    expect(notes.hats.length).toBeGreaterThan(0)
    // Every note has a valid bar index.
    for (const k of notes.kick) expect(k.bar).toBeGreaterThanOrEqual(0)
    for (const b of notes.bass) expect(b.bar).toBeGreaterThanOrEqual(0)
    for (const l of notes.lead) expect(l.bar).toBeGreaterThanOrEqual(0)
    for (const h of notes.hats) expect(h.bar).toBeGreaterThanOrEqual(0)
  })

  test('STYLE_GRAMMARS has all four styles', () => {
    expect(Object.keys(STYLE_GRAMMARS).sort()).toEqual(['acid', 'dark', 'full-on', 'progressive'])
  })

  test('phrase callbackTo is set on the last phrase', () => {
    const ctx = phrygianContext()
    const engine = new CompositionEngine({ seed: 5, context: ctx })
    const section = engine.composeSection({ bars: 32 })
    const lastPhrase: ComposedPhrase | undefined = section.phrases[section.phrases.length - 1]
    expect(lastPhrase?.callbackTo).toBeDefined()
    // The callback target should be the first phrase's motif.
    const firstPhrase = section.phrases[0]
    expect(firstPhrase?.motifIds[0]).toBe(lastPhrase?.callbackTo)
  })
})
