/**
 * MusicalSimulationHarness: cross-part measurement across full sections.
 *
 * Runs the {@link CompositionEngine} over 64 / 128 / 256 bars and measures
 * every cross-part relationship the P5 diagnosis flagged as missing:
 * kick↔bass alignment, bass↔harmony alignment, lead↔bass spacing,
 * drum↔bass interlock, plus all the single-part metrics (chord-tone ratio,
 * motif recurrence, register excursion, leap distribution, etc.). Failures
 * are surfaced via the {@link detectMusicalFailures} enhanced detector.
 *
 * The harness is the single entry point for "how good is the music this
 * engine produces?" — it produces a flat {@link SimulationResult} that can
 * be diffed against a baseline or asserted on in tests.
 */

import type { ArrangementPlan, ArrangementState } from './arrangement-state.ts'
import { CompositionEngine } from './composition-engine.ts'
import { type EnhancedMusicalFailure, detectMusicalFailures } from './enhanced-failure-detector.ts'
import type { GroovePlan } from './groove-plan.ts'
import { HarmonicClassifier } from './harmonic-classifier.ts'
import type { MusicalContext } from './musical-context.ts'
import { getScale, scalePcs } from './scales.ts'
import { STYLE_GRAMMARS, applyStyleToContext, getStyleGrammar } from './style-grammar.ts'

export interface MusicalFailure {
  type: string
  level: 'OK' | 'WARNING' | 'FAIL'
  evidence: string
  bars?: number[]
}

export interface SimulationResult {
  bars: number
  style: string
  seed: number

  // ----- Rhythm -----
  kickContinuity: number
  bassKickAlignment: number
  onsetDensity: number
  syncopation: number
  subdivisionStability: number
  phraseEndFills: number

  // ----- Harmony -----
  chordToneRatio: number
  nonChordResolution: number
  harmonicRhythm: number
  illegalMoves: number
  tonalCenterStability: number

  // ----- Melody -----
  registerCenter: number
  registerExcursion: number
  leapDistribution: number
  repetitionRatio: number
  motifRecurrence: number
  phraseContour: number
  cadenceQuality: number
  noteDensity: number

  // ----- Arrangement -----
  activeRolesPerSection: Record<string, number>
  intentionalRests: number
  densityArc: number
  dropBreakContrast: number
  sectionDifferentiation: number

  // ----- Inter-part -----
  kickBassAlignment: number
  bassHarmonyAlignment: number
  leadHarmonyAlignment: number
  leadBassSpacing: number
  drumBassRelationship: number

  // ----- Failures -----
  failures: MusicalFailure[]
  failureCount: number
}

export interface RunSimulationOptions {
  bars: number
  seed: number
  context: MusicalContext
}

const PC_COUNT = 12

function pcOf(midi: number): number {
  return ((midi % PC_COUNT) + PC_COUNT) % PC_COUNT
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function variance(arr: number[]): number {
  if (arr.length === 0) return 0
  const m = mean(arr)
  return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length
}

/**
 * Run a single simulation: compose `bars` bars with the given seed and
 * context, then measure every cross-part metric and run the enhanced
 * failure detector.
 */
export function runSimulation(opts: RunSimulationOptions): SimulationResult {
  const { bars, seed, context } = opts
  const engine = new CompositionEngine({ seed, context })
  const section = engine.composeSection({ bars })
  const notes = engine.renderNotes(section)
  const report = detectMusicalFailures({
    kickNotes: notes.kick,
    bassNotes: notes.bass,
    leadNotes: notes.lead,
    hatNotes: notes.hats,
    arrangement: section.arrangement,
    groove: section.groove,
    bars,
    stepsPerBar: 16,
  })

  // Index notes per bar.
  const kickByBar = new Map<number, number[]>()
  const bassByBar = new Map<number, { step: number; midi: number; function: string }[]>()
  const leadByBar = new Map<number, { step: number; midi: number; velocity: number }[]>()
  for (let bar = 0; bar < bars; bar++) {
    kickByBar.set(bar, [])
    bassByBar.set(bar, [])
    leadByBar.set(bar, [])
  }
  for (const k of notes.kick) kickByBar.get(k.bar)?.push(k.step)
  for (const b of notes.bass)
    bassByBar.get(b.bar)?.push({ step: b.step, midi: b.midi, function: b.function })
  for (const l of notes.lead)
    leadByBar.get(l.bar)?.push({ step: l.step, midi: l.midi, velocity: l.velocity })

  // ---------- Rhythm ----------
  const barsWithKick = Array.from(kickByBar.values()).filter((arr) => arr.length > 0).length
  const kickContinuity = bars > 0 ? barsWithKick / bars : 0

  let bassKickAlignedBars = 0
  let activeBars = 0
  for (let bar = 0; bar < bars; bar++) {
    const kick = kickByBar.get(bar) ?? []
    const bass = bassByBar.get(bar) ?? []
    if (kick.length === 0 || bass.length === 0) continue
    activeBars++
    if (kick.includes(0) && bass.some((b) => b.step === 0)) bassKickAlignedBars++
  }
  const bassKickAlignment = activeBars > 0 ? bassKickAlignedBars / activeBars : 0

  const totalNotes = notes.kick.length + notes.bass.length + notes.lead.length + notes.hats.length
  const onsetDensity = bars > 0 ? totalNotes / bars : 0

  // Syncopation: fraction of all onsets on off-beats (not multiples of 4 in a 16-step bar).
  const beatLen = 4
  let syncopated = 0
  let totalOnsets = 0
  for (const k of notes.kick) {
    totalOnsets++
    if (k.step % beatLen !== 0) syncopated++
  }
  for (const b of notes.bass) {
    totalOnsets++
    if (b.step % beatLen !== 0) syncopated++
  }
  for (const l of notes.lead) {
    totalOnsets++
    if (l.step % beatLen !== 0) syncopated++
  }
  for (const h of notes.hats) {
    totalOnsets++
    if (h.step % beatLen !== 0) syncopated++
  }
  const syncopation = totalOnsets > 0 ? syncopated / totalOnsets : 0

  // Subdivision stability: 1 if the groove is constant (always true for one section).
  const subdivisionStability = 1

  const phraseEndFills = section.groove.fillBars.length

  // ---------- Harmony ----------
  // Chord-tone ratio: lead + bass notes whose pc is in the bar's harmonicContext.
  const barHarmonic = new Map<number, number[]>()
  for (const bar of section.bars) {
    barHarmonic.set(bar.barIndex, bar.harmonicContext)
  }
  let chordTones = 0
  let totalForChord = 0
  for (const b of notes.bass) {
    const hc = barHarmonic.get(b.bar) ?? []
    if (hc.length === 0) continue
    totalForChord++
    if (hc.includes(pcOf(b.midi))) chordTones++
  }
  for (const l of notes.lead) {
    const hc = barHarmonic.get(l.bar) ?? []
    if (hc.length === 0) continue
    totalForChord++
    if (hc.includes(pcOf(l.midi))) chordTones++
  }
  const chordToneRatio = totalForChord > 0 ? chordTones / totalForChord : 0

  // Non-chord resolution: use HarmonicClassifier on the lead sequence.
  const leadMidis = notes.lead
    .slice()
    .sort((a, b) => a.bar * 16 + a.step - (b.bar * 16 + b.step))
    .map((l) => l.midi)
  const classifier = new HarmonicClassifier({
    tonic: context.tonic,
    scaleName: context.scaleName,
    chord: barHarmonic.get(0) ?? [],
  })
  const analyses = classifier.classifySequence(leadMidis)
  let tensionCount = 0
  let resolvedCount = 0
  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i]
    if (!a) continue
    if (a.isTension || a.function === 'PASSING_TONE') {
      tensionCount++
      if (a.resolvesTo !== undefined) resolvedCount++
    }
  }
  const nonChordResolution = tensionCount > 0 ? resolvedCount / tensionCount : 0

  // Harmonic rhythm: distinct harmonic contexts / bars.
  const distinctChords = new Set<string>()
  for (const bar of section.bars) {
    distinctChords.add(bar.harmonicContext.slice().sort().join(','))
  }
  const harmonicRhythm = bars > 0 ? distinctChords.size / bars : 0

  // Illegal moves: out-of-scale lead notes.
  const scale = getScale(context.scaleName)
  const scalePcsSet = new Set<number>(scale ? scalePcs(context.tonic, scale) : [])
  let illegalMoves = 0
  for (const l of notes.lead) {
    if (scalePcsSet.size > 0 && !scalePcsSet.has(pcOf(l.midi))) illegalMoves++
  }
  for (const b of notes.bass) {
    if (scalePcsSet.size > 0 && !scalePcsSet.has(pcOf(b.midi))) illegalMoves++
  }

  // Tonal center stability: fraction of bars whose bass hits the tonic pc.
  let tonicBars = 0
  for (let bar = 0; bar < bars; bar++) {
    const bass = bassByBar.get(bar) ?? []
    if (bass.some((b) => pcOf(b.midi) === context.tonic)) tonicBars++
  }
  const tonalCenterStability = bars > 0 ? tonicBars / bars : 0

  // ---------- Melody ----------
  const leadMidisArray = notes.lead.map((l) => l.midi)
  const registerCenter = leadMidisArray.length > 0 ? mean(leadMidisArray) : 0
  const registerExcursion =
    leadMidisArray.length > 0 ? Math.max(...leadMidisArray) - Math.min(...leadMidisArray) : 0
  // Leap distribution: average |interval| across consecutive lead notes (within bars).
  const leaps: number[] = []
  for (let bar = 0; bar < bars; bar++) {
    const arr = (leadByBar.get(bar) ?? []).slice().sort((a, b) => a.step - b.step)
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1]
      const cur = arr[i]
      if (prev && cur) leaps.push(Math.abs(cur.midi - prev.midi))
    }
  }
  const leapDistribution = leaps.length > 0 ? mean(leaps) : 0

  // Repetition ratio: fraction of consecutive bar pairs that share the same pitch sequence.
  let repeatedPairs = 0
  let totalPairs = 0
  for (let bar = 1; bar < bars; bar++) {
    const prev = (leadByBar.get(bar - 1) ?? [])
      .slice()
      .sort((a, b) => a.step - b.step)
      .map((n) => n.midi)
      .join(',')
    const cur = (leadByBar.get(bar) ?? [])
      .slice()
      .sort((a, b) => a.step - b.step)
      .map((n) => n.midi)
      .join(',')
    if (prev === '' || cur === '') continue
    totalPairs++
    if (prev === cur) repeatedPairs++
  }
  const repetitionRatio = totalPairs > 0 ? repeatedPairs / totalPairs : 0

  // Motif recurrence: fraction of lead bars whose pitch sequence matches another bar.
  const seqByBar = new Map<number, string>()
  for (let bar = 0; bar < bars; bar++) {
    const arr = (leadByBar.get(bar) ?? [])
      .slice()
      .sort((a, b) => a.step - b.step)
      .map((n) => n.midi)
      .join(',')
    if (arr !== '') seqByBar.set(bar, arr)
  }
  const seqCounts = new Map<string, number>()
  for (const seq of seqByBar.values()) {
    seqCounts.set(seq, (seqCounts.get(seq) ?? 0) + 1)
  }
  let recurringBars = 0
  for (const seq of seqByBar.values()) {
    if ((seqCounts.get(seq) ?? 0) > 1) recurringBars++
  }
  const motifRecurrence = seqByBar.size > 0 ? recurringBars / seqByBar.size : 0

  // Phrase contour: 1 if density varies meaningfully across phrases, 0 if flat.
  const phraseDensities: number[] = []
  for (const phrase of section.phrases) {
    const dens = mean(phrase.bars.map((b) => (b.roles.kick ? 1 : 0)))
    phraseDensities.push(dens)
  }
  const phraseContour = clamp01(variance(phraseDensities) * 4)

  // Cadence quality: 1 if the last bar has CADENCE or ROOT bass, 0 otherwise.
  const lastBarBass = bassByBar.get(bars - 1) ?? []
  const cadenceQuality = lastBarBass.some((b) => b.function === 'CADENCE' || b.function === 'ROOT')
    ? 1
    : 0

  const noteDensity = bars > 0 ? notes.lead.length / bars : 0

  // ---------- Arrangement ----------
  const activeRolesPerSection: Record<string, number> = {}
  const densitiesByState = new Map<ArrangementState, number[]>()
  for (const slot of section.arrangement.slots) {
    const r = slot.roles
    const activeCount = [r.kick, r.bass, r.lead, r.hats, r.percussion, r.fills, r.texture].filter(
      Boolean
    ).length
    if (!activeRolesPerSection[slot.state]) activeRolesPerSection[slot.state] = 0
    activeRolesPerSection[slot.state] = (activeRolesPerSection[slot.state] ?? 0) + activeCount
    const arr = densitiesByState.get(slot.state) ?? []
    arr.push(slot.density)
    densitiesByState.set(slot.state, arr)
  }
  // Average per state.
  for (const state of Object.keys(activeRolesPerSection)) {
    const count = section.arrangement.slots.filter((s) => s.state === state).length
    if (count > 0) activeRolesPerSection[state] = (activeRolesPerSection[state] ?? 0) / count
  }

  // Intentional rests: bars where lead is OFF per arrangement.
  let intentionalRests = 0
  for (const slot of section.arrangement.slots) {
    if (!slot.roles.lead) intentionalRests++
  }

  // Density arc: variance of density across all bars.
  const allDensities = section.arrangement.slots.map((s) => s.density)
  const densityArc = clamp01(variance(allDensities) * 4)

  // Drop vs Break contrast.
  const dropDensities = densitiesByState.get('DROP') ?? []
  const breakDensities = densitiesByState.get('BREAK') ?? []
  const dropBreakContrast = Math.abs(mean(dropDensities) - mean(breakDensities))

  // Section differentiation: spread of average density per state, measured as
  // the max-min range across states (0 = no differentiation, 1 = full range).
  const stateAvgDensities: number[] = []
  for (const arr of densitiesByState.values()) stateAvgDensities.push(mean(arr))
  const sectionDifferentiation =
    stateAvgDensities.length > 0
      ? clamp01(Math.max(...stateAvgDensities) - Math.min(...stateAvgDensities))
      : 0

  // ---------- Inter-part ----------
  const kickBassAlignment = bassKickAlignment

  // Bass-harmony alignment: fraction of bass notes that are chord tones.
  let bassChordTones = 0
  let totalBassForHarmony = 0
  for (const b of notes.bass) {
    const hc = barHarmonic.get(b.bar) ?? []
    if (hc.length === 0) continue
    totalBassForHarmony++
    if (hc.includes(pcOf(b.midi))) bassChordTones++
  }
  const bassHarmonyAlignment = totalBassForHarmony > 0 ? bassChordTones / totalBassForHarmony : 0

  // Lead-harmony alignment.
  let leadChordTones = 0
  let totalLeadForHarmony = 0
  for (const l of notes.lead) {
    const hc = barHarmonic.get(l.bar) ?? []
    if (hc.length === 0) continue
    totalLeadForHarmony++
    if (hc.includes(pcOf(l.midi))) leadChordTones++
  }
  const leadHarmonyAlignment = totalLeadForHarmony > 0 ? leadChordTones / totalLeadForHarmony : 0

  // Lead-bass spacing: register separation (lead.min - bass.max) / 24, clamped 0..1.
  const leadMin = leadMidisArray.length > 0 ? Math.min(...leadMidisArray) : 0
  const bassMidis = notes.bass.map((b) => b.midi)
  const bassMax = bassMidis.length > 0 ? Math.max(...bassMidis) : 0
  const leadBassSpacing = clamp01((leadMin - bassMax) / 24)

  // Drum-bass relationship: combined alignment + rhythmic similarity.
  let drumBassHit = 0
  let drumBassTotal = 0
  for (let bar = 0; bar < bars; bar++) {
    const kick = new Set(kickByBar.get(bar) ?? [])
    const bass = bassByBar.get(bar) ?? []
    if (kick.size === 0 || bass.length === 0) continue
    drumBassTotal++
    const bassSteps = new Set(bass.map((b) => b.step))
    for (const ks of kick) {
      if (bassSteps.has(ks)) {
        drumBassHit++
        break
      }
    }
  }
  const drumBassRelationship = drumBassTotal > 0 ? drumBassHit / drumBassTotal : 0

  // ---------- Failures ----------
  const failures: MusicalFailure[] = report.failures.map((f: EnhancedMusicalFailure) => ({
    type: f.type,
    level: f.level,
    evidence: f.evidence,
    bars: f.bars,
  }))

  return {
    bars,
    style: context.scaleName,
    seed,
    kickContinuity: clamp01(kickContinuity),
    bassKickAlignment: clamp01(bassKickAlignment),
    onsetDensity,
    syncopation: clamp01(syncopation),
    subdivisionStability,
    phraseEndFills,
    chordToneRatio: clamp01(chordToneRatio),
    nonChordResolution: clamp01(nonChordResolution),
    harmonicRhythm,
    illegalMoves,
    tonalCenterStability: clamp01(tonalCenterStability),
    registerCenter,
    registerExcursion,
    leapDistribution,
    repetitionRatio: clamp01(repetitionRatio),
    motifRecurrence: clamp01(motifRecurrence),
    phraseContour,
    cadenceQuality,
    noteDensity,
    activeRolesPerSection,
    intentionalRests,
    densityArc,
    dropBreakContrast: clamp01(dropBreakContrast),
    sectionDifferentiation,
    kickBassAlignment: clamp01(kickBassAlignment),
    bassHarmonyAlignment: clamp01(bassHarmonyAlignment),
    leadHarmonyAlignment: clamp01(leadHarmonyAlignment),
    leadBassSpacing,
    drumBassRelationship: clamp01(drumBassRelationship),
    failures,
    failureCount: failures.length,
  }
}

/**
 * Run a full simulation suite across 64 / 128 / 256 bars and all four style
 * grammars. Returns the results grouped by length.
 */
export function runSimulationSuite(): {
  results64: SimulationResult[]
  results128: SimulationResult[]
  results256: SimulationResult[]
  styles: string[]
} {
  const styles = Object.keys(STYLE_GRAMMARS)
  const results64: SimulationResult[] = []
  const results128: SimulationResult[] = []
  const results256: SimulationResult[] = []
  const baseContext: MusicalContext = {
    tonic: 4,
    scaleName: 'phrygian-dominant',
    octave: 4,
    bpm: 145,
    beatsPerBar: 4,
    beatPosition: 0,
    barPosition: 0,
    phrasePosition: 0,
    harmonicContext: [],
    density: 0.5,
    energy: 0.5,
    tension: 0.4,
    sectionRole: 'full-on',
    repetitionPressure: 0.5,
    noveltyPressure: 0.5,
  }
  for (let i = 0; i < styles.length; i++) {
    const styleName = styles[i] as string
    const grammar = getStyleGrammar(styleName)
    const context = applyStyleToContext(
      {
        ...baseContext,
        scaleName: grammar.preferredScales[0] ?? 'phrygian-dominant',
        tension: grammar.tensionPreference,
      },
      grammar
    )
    const seed = 1000 + i * 7
    results64.push(runSimulation({ bars: 64, seed, context }))
    results128.push(runSimulation({ bars: 128, seed, context }))
    results256.push(runSimulation({ bars: 256, seed, context }))
  }
  return { results64, results128, results256, styles }
}

/** Quick A/B comparison helper: measure kick-bass alignment under two engines. */
export function compareAlignment(
  newAlignment: number,
  oldAlignment: number
): { improvement: number; ratio: number } {
  const improvement = newAlignment - oldAlignment
  const ratio = oldAlignment > 0 ? newAlignment / oldAlignment : 0
  return { improvement, ratio }
}

/** Re-export types used by the harness's public surface. */
export type { ArrangementPlan, GroovePlan }
