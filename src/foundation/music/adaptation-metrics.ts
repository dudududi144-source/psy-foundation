/**
 * Adaptation metrics: divergence + reports.
 *
 * {@link measureDivergence} compares two composed-bar streams (base vs
 * adapted) along six orthogonal axes: form, harmony, groove, motif, role,
 * density. The result is an {@link AdaptationDivergence} with each axis in
 * 0..1 (0 = identical, 1 = completely different).
 *
 * {@link adaptationReport} is the convenience entry point: it composes a
 * base section, builds an adaptation intent for the given scenario, applies
 * it, measures divergence, and returns a human-readable report with
 * `whatChanged` / `whyItChanged` strings.
 *
 * Design notes:
 *   - The FORM (arrangement states) and HARMONY (chord contexts) are NEVER
 *     changed by {@link applyAdaptation}, so formDivergence and
 *     harmonyDivergence should always be 0 when comparing a base section to
 *     its adapted version. They become non-zero only when comparing two
 *     adaptations of the same song under different radios — and even then
 *     only if the adaptation changed the form (which it does not).
 *   - ROLE divergence is the key signal that the adaptation is doing work:
 *     different radios should produce > 0.3 role divergence while keeping
 *     form divergence < 0.3 (identity preserved).
 */

import {
  type AdaptedCompositionIntent,
  CompositionAdaptation,
  adaptationFitScore,
  applyAdaptation,
  bassCompetition,
} from './composition-adaptation.ts'
import type { ComposedBar } from './composition-engine.ts'
import { CompositionEngine } from './composition-engine.ts'
import type { MusicalContext } from './musical-context.ts'
import { type OpportunityMap, buildOpportunityMap } from './opportunity-map.ts'
import type { RadioScenario } from './radio-scenarios.ts'
import { RADIO_SCENARIOS } from './radio-scenarios.ts'
import { applyStyleToContext, getStyleGrammar } from './style-grammar.ts'

export interface AdaptationDivergence {
  /** 0..1 — how much the arrangement form (states, phrase structure) changed. */
  formDivergence: number
  /** 0..1 — how much the harmonic context per bar changed. */
  harmonyDivergence: number
  /** 0..1 — how much the kick / groove skeleton changed. */
  grooveDivergence: number
  /** 0..1 — how much the lead motif material changed. */
  motifDivergence: number
  /** 0..1 — how much the role activation per bar changed. */
  roleDivergence: number
  /** 0..1 — average |density difference| per bar. */
  densityDivergence: number
}

export interface AdaptationReport {
  scenario: string
  intent: AdaptedCompositionIntent
  opportunities: OpportunityMap
  divergence: AdaptationDivergence
  whatChanged: string[]
  whyItChanged: string[]
  /** Adaptation fit score (0..1, higher = better fit with radio). */
  fitScore: number
  /** Bass competition score (0..1, lower = less competition). */
  bassCompetition: number
  bars: number
}

// --------------------------- helpers ---------------------------

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function roleSignature(bar: ComposedBar): string {
  const r = bar.roles
  return [
    r.kick ? 'K' : '-',
    r.bass ? 'B' : '-',
    r.lead ? 'L' : '-',
    r.hats ? 'H' : '-',
    r.percussion ? 'P' : '-',
    r.fills ? 'F' : '-',
    r.texture ? 'T' : '-',
  ].join('')
}

function leadSignature(bar: ComposedBar): string {
  return bar.leadNotes
    .slice()
    .sort((a, b) => a.step - b.step)
    .map((n) => `${n.midi}@${n.step}`)
    .join(',')
}

function barDensity(bar: ComposedBar): number {
  return (
    (bar.kickNotes.length + bar.bassNotes.length + bar.leadNotes.length + bar.hatNotes.length) / 16
  )
}

function fractionChanged(a: string, b: string): number {
  return a === b ? 0 : 1
}

// --------------------------- measureDivergence ---------------------------

/**
 * Measure how much `adapted` diverges from `base` along six axes.
 *
 * Both inputs must have the same number of bars. If they differ in length,
 * the comparison is over the shorter sequence (and the divergence is
 * implicitly higher because the longer tail is "missing").
 */
export function measureDivergence(
  base: { bars: ComposedBar[] },
  adapted: { bars: ComposedBar[] }
): AdaptationDivergence {
  const baseBars = base.bars
  const adaptedBars = adapted.bars
  const n = Math.min(baseBars.length, adaptedBars.length)
  if (n === 0) {
    return {
      formDivergence: 0,
      harmonyDivergence: 0,
      grooveDivergence: 0,
      motifDivergence: 0,
      roleDivergence: 0,
      densityDivergence: 0,
    }
  }

  let formChanges = 0
  let harmonyChanges = 0
  let grooveChanges = 0
  let motifChanges = 0
  let roleChanges = 0
  let densityDiffSum = 0

  for (let i = 0; i < n; i++) {
    const b = baseBars[i]
    const a = adaptedBars[i]
    if (!b || !a) continue

    // Form: arrangement state changed?
    if (b.arrangementState !== a.arrangementState) formChanges++

    // Harmony: chord context changed?
    const bHarm = b.harmonicContext.slice().sort().join(',')
    const aHarm = a.harmonicContext.slice().sort().join(',')
    harmonyChanges += fractionChanged(bHarm, aHarm)

    // Groove: kick skeleton changed?
    const bKick = b.kickNotes.slice().sort().join(',')
    const aKick = a.kickNotes.slice().sort().join(',')
    grooveChanges += fractionChanged(bKick, aKick)

    // Motif: lead sequence changed?
    motifChanges += fractionChanged(leadSignature(b), leadSignature(a))

    // Role: role activation changed?
    roleChanges += fractionChanged(roleSignature(b), roleSignature(a))

    // Density: |difference|.
    densityDiffSum += Math.abs(barDensity(b) - barDensity(a))
  }

  // Account for length mismatch as a form divergence.
  const lengthMismatch = Math.abs(baseBars.length - adaptedBars.length)
  const formFromLength = n > 0 ? lengthMismatch / (n + lengthMismatch) : 0

  return {
    formDivergence: clamp01(formChanges / n + formFromLength),
    harmonyDivergence: clamp01(harmonyChanges / n),
    grooveDivergence: clamp01(grooveChanges / n),
    motifDivergence: clamp01(motifChanges / n),
    roleDivergence: clamp01(roleChanges / n),
    densityDivergence: clamp01(densityDiffSum / n),
  }
}

// --------------------------- adaptationReport ---------------------------

/**
 * Build a full adaptation report for a scenario:
 *   1. Compose a base section (using the scenario's style + a seed).
 *   2. Build an opportunity map from the scenario's radio context.
 *   3. Build an AdaptedCompositionIntent (mid-phrase, so phraseBar = 4).
 *   4. Apply the intent to the base bars → adapted bars.
 *   5. Measure divergence between base and adapted.
 *   6. Compute fit score and bass competition.
 *
 * Returns a structured {@link AdaptationReport}.
 */
export function adaptationReport(opts: {
  scenario: RadioScenario
  baseContext: MusicalContext
  seed: number
  bars: number
}): AdaptationReport {
  const { scenario, baseContext, seed, bars } = opts

  // 1. Compose base section.
  const engine = new CompositionEngine({ seed, context: baseContext })
  const section = engine.composeSection({ bars })
  const baseBars = section.bars

  // 2-3. Build adaptation intent (mid-phrase: phraseBar = 4 so adaptation fires).
  const adaptation = new CompositionAdaptation()
  const radio = scenario.context
  const opportunities = buildOpportunityMap(radio)
  const intent = adaptation.adapt({
    baseContext,
    radio,
    opportunities,
    currentBar: 0,
    phraseBar: 4,
  })

  // 4. Apply intent → adapted bars.
  const adaptedBars = applyAdaptation(baseBars, intent)

  // 5. Measure divergence.
  const divergence = measureDivergence({ bars: baseBars }, { bars: adaptedBars })

  // 6. Fit + competition.
  const fitScore = adaptationFitScore({ bars: adaptedBars }, radio)
  const competition = bassCompetition({ bars: adaptedBars }, radio)

  // Build human-readable whatChanged / whyItChanged.
  const whatChanged: string[] = []
  if (divergence.roleDivergence > 0) {
    whatChanged.push(
      `role activation changed in ${(divergence.roleDivergence * 100).toFixed(0)}% of bars`
    )
  }
  if (divergence.grooveDivergence > 0) {
    whatChanged.push(
      `kick skeleton changed in ${(divergence.grooveDivergence * 100).toFixed(0)}% of bars`
    )
  }
  if (divergence.motifDivergence > 0) {
    whatChanged.push(
      `lead motif changed in ${(divergence.motifDivergence * 100).toFixed(0)}% of bars`
    )
  }
  if (divergence.densityDivergence > 0) {
    whatChanged.push(`density shifted by avg ${divergence.densityDivergence.toFixed(2)}`)
  }
  if (whatChanged.length === 0) {
    whatChanged.push('no changes — adaptation preserved the base composition (NEUTRAL)')
  }

  const whyItChanged = intent.reasons.slice()

  return {
    scenario: scenario.name,
    intent,
    opportunities,
    divergence,
    whatChanged,
    whyItChanged,
    fitScore,
    bassCompetition: competition,
    bars,
  }
}

/**
 * Convenience: build a base context for a given style name.
 * Used by tests and reports to construct a sensible base composition.
 */
export function baseContextForStyle(
  styleName: string,
  overrides: Partial<MusicalContext> = {}
): MusicalContext {
  const grammar = getStyleGrammar(styleName)
  const base: MusicalContext = {
    tonic: 4,
    scaleName: grammar.preferredScales[0] ?? 'phrygian-dominant',
    octave: 4,
    bpm: 145,
    beatsPerBar: 4,
    beatPosition: 0,
    barPosition: 0,
    phrasePosition: 0,
    harmonicContext: [],
    density: 0.5,
    energy: 0.55,
    tension: grammar.tensionPreference,
    sectionRole: styleName,
    repetitionPressure: 1 - grammar.motifRecurrenceTarget,
    noveltyPressure: 1 - grammar.motifRecurrenceTarget,
  }
  return applyStyleToContext({ ...base, ...overrides }, grammar)
}

/**
 * Run an adaptation comparison across all built-in scenarios for one style.
 * Returns one report per scenario. Useful for batch experiments / sweeps.
 */
export function adaptationSweep(opts: {
  styleName: string
  seed: number
  bars: number
  scenarios?: string[]
}): AdaptationReport[] {
  const { styleName, seed, bars } = opts
  const scenarioNames = opts.scenarios ?? [
    'SPARSE',
    'BASS_HEAVY',
    'MELODY_HEAVY',
    'FULL_DENSE',
    'BREAKDOWN',
    'ABSENT',
  ]
  const baseContext = baseContextForStyle(styleName)
  const out: AdaptationReport[] = []
  for (const name of scenarioNames) {
    const scenario = RADIO_SCENARIOS[name]
    if (!scenario) continue
    out.push(
      adaptationReport({
        scenario,
        baseContext,
        seed,
        bars,
      })
    )
  }
  return out
}
