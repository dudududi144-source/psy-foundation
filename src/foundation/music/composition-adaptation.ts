/**
 * CompositionAdaptation: the radio-aware adaptation layer.
 *
 * The adaptation layer takes a CompositionPlan + RadioMusicalContext and
 * returns an {@link AdaptedCompositionIntent}. It does NOT compose — it
 * adapts INTENT: which roles to emphasise, what density/tension/novelty to
 * target, which motif transform to prefer, and how strongly to rest.
 *
 * The radio is EVIDENCE, not AUTHORITY. The foundation's own identity (style
 * grammar, motif memory, arrangement plan) always wins. The adaptation only
 * modulates the foundation's intent within the bounds the base composition
 * already permits.
 *
 * Adaptation rules:
 *
 *   LEVEL 1 — ARRANGEMENT (who plays):
 *     - radio bass OCCUPIED  → reduce bassPressure (don't compete)
 *     - radio lead OCCUPIED  → reduce leadPressure, raise counterPressure
 *     - radio kick OCCUPIED  → maintain groovePressure (lock to radio kick)
 *     - all roles OCCUPIED   → raise restPressure (intelligent abstention)
 *
 *   LEVEL 2 — PERFORMANCE (how strongly):
 *     - densityTarget = base × (1 − radio.density × 0.5)   (don't double up)
 *     - tensionTarget = base + radio.energy × 0.2          (match energy)
 *     - low confidence → preserve base (don't adapt)
 *
 *   LEVEL 3 — VARIATION (which transform):
 *     - radio stable (high conf, low syncopation) → REUSE
 *     - radio changing (low conf or high syncopation) → VARY
 *     - NEW material only if confidence > 0.7
 *
 *   LEVEL 4 — MATERIAL (new motifs):
 *     - Only if confidence > 0.7 AND novelty pressure high
 *
 *   CONFIDENCE HANDLING:
 *     - radio.confidence < 0.3    → NEUTRAL intent (preserve base)
 *     - radio.confidence 0.3-0.7  → partial adaptation (blend 50%)
 *     - radio.confidence > 0.7    → strong adaptation
 *
 *   MID-PHRASE STABILITY:
 *     - phraseBar < 4  → defer adaptation (return NEUTRAL)
 *     - phraseBar >= 4 → adapt at next bar boundary
 *
 *   LEARNING:
 *     - {@link CompositionAdaptation.reinforce} records per-role outcomes
 *       and biases future adaptations. A role that produced a negative
 *       outcome gets reduced pressure on the next call.
 */

import type { ComposedBar } from './composition-engine.ts'
import type { MusicalContext } from './musical-context.ts'
import { type OpportunityMap, buildOpportunityMap, isDense } from './opportunity-map.ts'
import type { RadioMusicalContext } from './radio-context.ts'
import { isRadioAbsent } from './radio-context.ts'

export interface AdaptedCompositionIntent {
  // ----- Pressures (0..1 — how much to emphasise each role) -----
  groovePressure: number
  bassPressure: number
  leadPressure: number
  counterPressure: number
  texturePressure: number

  // ----- Targets -----
  /** 0..1 — target density for the foundation's output. */
  densityTarget: number
  /** 0..1 — target tension. */
  tensionTarget: number
  /** 0..1 — target novelty (how much to introduce new material). */
  noveltyTarget: number
  /** -2..+2 octaves — register shift to make space (or fill space). */
  registerShift: number
  /** 0..1 — how much to rest / abstain. */
  restPressure: number

  // ----- Preferences -----
  motifPreference: 'REUSE' | 'VARY' | 'NEW' | 'NEUTRAL'
  harmonyPreference: 'STABLE' | 'TENSION' | 'NEUTRAL'

  // ----- Meta -----
  /** 0..1 — adaptation confidence (mirrors radio.confidence when adapting). */
  confidence: number
  /** Human-readable reasons for each adaptation decision. */
  reasons: string[]
}

export interface AdaptOptions {
  baseContext: MusicalContext
  radio: RadioMusicalContext
  opportunities: OpportunityMap
  currentBar: number
  /** Bar within current phrase (0-7). */
  phraseBar: number
}

export interface AdaptSectionOptions {
  baseContext: MusicalContext
  /** Radio context per bar (cycled if shorter than `bars`). */
  radioSequence: RadioMusicalContext[]
  bars: number
}

// --------------------------- helpers ---------------------------

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min
  return Math.max(min, Math.min(max, v))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t)
}

/**
 * Blend factor from radio confidence:
 *   - < 0.3 → 0 (no adaptation, NEUTRAL)
 *   - 0.3..0.7 → 0.5 (partial adaptation)
 *   - > 0.7 → 1.0 (strong adaptation)
 */
function blendFromConfidence(confidence: number): number {
  if (confidence < 0.3) return 0
  if (confidence > 0.7) return 1
  return 0.5
}

/** A NEUTRAL intent — preserves the base composition. */
function neutralIntent(baseContext: MusicalContext, reasons: string[]): AdaptedCompositionIntent {
  return {
    groovePressure: 0.7,
    bassPressure: 0.7,
    leadPressure: 0.7,
    counterPressure: 0.5,
    texturePressure: 0.4,
    densityTarget: baseContext.density,
    tensionTarget: baseContext.tension,
    noveltyTarget: baseContext.noveltyPressure,
    registerShift: 0,
    restPressure: 0.1,
    motifPreference: 'NEUTRAL',
    harmonyPreference: 'NEUTRAL',
    confidence: 0,
    reasons,
  }
}

/**
 * Detect a radio breakdown: low kick + low bass + low energy, with a
 * 'BREAK' section hint AND some harmonic/pad content (medium harmonic
 * occupancy). The foundation should NOT fill the empty space — it should
 * respect the breakdown vibe (reduce kick/bass, expose motif, increase
 * texture).
 *
 * A truly sparse radio (low everything, no harmonic content) is NOT a
 * breakdown — it's an invitation for the foundation to add groove.
 */
function isRadioBreakdown(radio: RadioMusicalContext): boolean {
  if (radio.sectionLikelihood === 'BREAK') return true
  return (
    radio.energy < 0.4 &&
    radio.density < 0.4 &&
    radio.kickOccupancy < 0.3 &&
    radio.bassOccupancy < 0.3 &&
    radio.percussionOccupancy < 0.4 &&
    // Require some harmonic content so a fully silent radio isn't mistaken
    // for a breakdown.
    radio.harmonicOccupancy > 0.3
  )
}

/** Detect a sparse radio: all primary roles OPEN + low energy + not breakdown. */
function isRadioSparse(radio: RadioMusicalContext, opportunities: OpportunityMap): boolean {
  if (isRadioBreakdown(radio)) return false
  return (
    opportunities.kick === 'OPEN' &&
    opportunities.bass === 'OPEN' &&
    opportunities.lead === 'OPEN' &&
    radio.energy < 0.45
  )
}

// --------------------------- CompositionAdaptation ---------------------------

export class CompositionAdaptation {
  /** Per-role learned bias (-1..+1). Negative = reduce pressure. */
  private roleBias: Map<string, number> = new Map()
  /** Per-role outcome counts (for inspection / tests). */
  private roleOutcomes: Map<string, { success: number; fail: number }> = new Map()

  /**
   * Adapt a composition plan based on radio context. Returns an intent that
   * modulates the foundation's role pressures, density/tension/novelty
   * targets, motif preference, and rest pressure.
   *
   * The intent is NEUTRAL when:
   *   - radio is absent
   *   - radio.confidence < 0.3
   *   - phraseBar < 4 (mid-phrase stability — defer to next phrase boundary)
   */
  adapt(opts: AdaptOptions): AdaptedCompositionIntent {
    const { baseContext, radio, opportunities, currentBar, phraseBar } = opts
    void currentBar

    // 0. Radio absent → NEUTRAL.
    if (isRadioAbsent(radio)) {
      return neutralIntent(baseContext, ['radio absent — preserving base composition'])
    }

    // 1. Mid-phrase stability: defer adaptation in the first half of a phrase.
    if (phraseBar < 4) {
      return neutralIntent(baseContext, [
        `phraseBar=${phraseBar} < 4 — deferring adaptation to next phrase boundary`,
      ])
    }

    // 2. Low confidence → NEUTRAL (insufficient evidence).
    if (radio.confidence < 0.3) {
      return neutralIntent(baseContext, [
        `radio.confidence=${radio.confidence.toFixed(2)} < 0.3 — insufficient evidence to adapt`,
      ])
    }

    const blend = blendFromConfidence(radio.confidence)
    const reasons: string[] = []

    // ----- LEVEL 1: ARRANGEMENT (role pressures) -----
    let groovePressure = 0.7
    let bassPressure = 0.7
    let leadPressure = 0.7
    let counterPressure = 0.5
    let texturePressure = 0.4
    let restPressure = 0.1

    // Breakdown detection takes precedence — the foundation respects the
    // radio's breakdown vibe rather than filling empty space.
    if (isRadioBreakdown(radio)) {
      groovePressure = lerp(0.7, 0.3, blend)
      bassPressure = lerp(0.7, 0.3, blend)
      leadPressure = lerp(0.7, 0.8, blend)
      texturePressure = lerp(0.4, 0.8, blend)
      reasons.push('radio in breakdown — reducing kick/bass, exposing motif, increasing texture')
    } else if (isRadioSparse(radio, opportunities)) {
      groovePressure = lerp(0.7, 0.9, blend)
      bassPressure = lerp(0.7, 0.85, blend)
      leadPressure = lerp(0.7, 0.75, blend)
      reasons.push('radio sparse — foundation adds groove + identity')
    } else {
      // Standard arrangement rules.
      if (opportunities.bass === 'OCCUPIED') {
        bassPressure = lerp(0.7, 0.2, blend)
        reasons.push('radio bass OCCUPIED — reducing bass pressure')
      } else if (opportunities.bass === 'MEDIUM') {
        bassPressure = lerp(0.7, 0.5, blend)
        reasons.push('radio bass MEDIUM — moderating bass pressure')
      } else {
        bassPressure = lerp(0.7, 0.85, blend)
        reasons.push('radio bass OPEN — foundation adds bass')
      }

      if (opportunities.lead === 'OCCUPIED') {
        leadPressure = lerp(0.7, 0.25, blend)
        counterPressure = lerp(0.5, 0.85, blend)
        reasons.push('radio lead OCCUPIED — reducing lead, raising counter (response/space)')
      } else if (opportunities.lead === 'MEDIUM') {
        leadPressure = lerp(0.7, 0.55, blend)
        counterPressure = lerp(0.5, 0.65, blend)
        reasons.push('radio lead MEDIUM — moderating lead, light counter')
      } else {
        leadPressure = lerp(0.7, 0.8, blend)
        reasons.push('radio lead OPEN — foundation carries lead')
      }

      if (opportunities.kick === 'OCCUPIED') {
        groovePressure = lerp(0.7, 0.8, blend)
        reasons.push('radio kick OCCUPIED — locking groove to radio kick')
      } else if (opportunities.kick === 'OPEN') {
        groovePressure = lerp(0.7, 0.9, blend)
        reasons.push('radio kick OPEN — foundation adds groove')
      } else {
        groovePressure = lerp(0.7, 0.75, blend)
        reasons.push('radio kick MEDIUM — maintaining groove')
      }

      // Texture
      if (opportunities.texture === 'OPEN' && radio.energy < 0.5) {
        texturePressure = lerp(0.4, 0.75, blend)
        reasons.push('texture OPEN + low radio energy — increasing texture')
      } else if (opportunities.texture === 'MEDIUM') {
        texturePressure = lerp(0.4, 0.35, blend)
        reasons.push('texture MEDIUM — moderating texture')
      }
    }

    // Dense: all primary roles OCCUPIED → intelligent abstention.
    if (!isRadioBreakdown(radio) && isDense(opportunities)) {
      restPressure = lerp(0.1, 0.65, blend)
      bassPressure = Math.min(bassPressure, lerp(0.7, 0.25, blend))
      leadPressure = Math.min(leadPressure, lerp(0.7, 0.3, blend))
      reasons.push('all primary roles OCCUPIED — increasing rest pressure (intelligent abstention)')
    }

    // ----- LEVEL 2: PERFORMANCE (targets) -----
    const densityTarget = clamp01(baseContext.density * (1 - radio.density * 0.5 * blend))
    const tensionTarget = clamp01(baseContext.tension + radio.energy * 0.2 * blend)
    reasons.push(
      `densityTarget=${densityTarget.toFixed(2)} (base ${(baseContext.density).toFixed(2)} × (1 − radio.density ${radio.density.toFixed(2)} × 0.5 × blend ${blend}))`
    )
    reasons.push(
      `tensionTarget=${tensionTarget.toFixed(2)} (base ${(baseContext.tension).toFixed(2)} + radio.energy ${radio.energy.toFixed(2)} × 0.2 × blend ${blend})`
    )

    // ----- LEVEL 3: VARIATION (motif preference) -----
    let motifPreference: AdaptedCompositionIntent['motifPreference']
    if (radio.confidence > 0.7 && radio.syncopation < 0.3) {
      motifPreference = 'REUSE'
      reasons.push('radio stable (high confidence, low syncopation) — REUSE motif')
    } else if (radio.confidence < 0.5 || radio.syncopation > 0.5) {
      motifPreference = 'VARY'
      reasons.push('radio changing (low confidence or high syncopation) — VARY motif')
    } else {
      motifPreference = 'NEUTRAL'
      reasons.push('radio middling — NEUTRAL motif preference')
    }

    // ----- LEVEL 4: MATERIAL (new motifs) -----
    // Only allow NEW material if confidence > 0.7 AND novelty pressure high.
    if (radio.confidence > 0.7 && baseContext.noveltyPressure > 0.6) {
      motifPreference = 'NEW'
      reasons.push('high confidence + high novelty — allow NEW material')
    }

    // Novelty target mirrors the motif preference.
    const noveltyTarget =
      motifPreference === 'NEW'
        ? 0.75
        : motifPreference === 'VARY'
          ? 0.55
          : motifPreference === 'REUSE'
            ? 0.3
            : baseContext.noveltyPressure

    // Harmony preference.
    let harmonyPreference: AdaptedCompositionIntent['harmonyPreference']
    if (radio.confidence > 0.7) {
      harmonyPreference = radio.energy > 0.6 ? 'TENSION' : 'STABLE'
      reasons.push(`radio high confidence — harmony ${harmonyPreference}`)
    } else {
      harmonyPreference = 'NEUTRAL'
    }

    // Register shift: if both bass+lead are OCCUPIED, shift up to make room.
    let registerShift = 0
    if (
      opportunities.bass === 'OCCUPIED' &&
      opportunities.lead === 'OCCUPIED' &&
      !isRadioBreakdown(radio)
    ) {
      registerShift = Math.round(lerp(0, 1, blend))
      if (registerShift !== 0)
        reasons.push('bass+lead OCCUPIED — shifting register up to make room')
    } else if (opportunities.bass === 'OCCUPIED' && !isRadioBreakdown(radio)) {
      registerShift = Math.round(lerp(0, 1, blend))
      if (registerShift !== 0) reasons.push('bass OCCUPIED — shifting register up')
    }

    // ----- LEARNED BIAS -----
    // Apply per-role learned bias. Negative bias reduces pressure.
    const bassBias = this.biasFor('bass')
    const leadBias = this.biasFor('lead')
    const grooveBias = this.biasFor('groove')
    const counterBias = this.biasFor('counter')
    const textureBias = this.biasFor('texture')
    if (bassBias !== 0) {
      bassPressure = clamp01(bassPressure + bassBias * 0.4)
      reasons.push(`learned bass bias ${bassBias.toFixed(2)} applied`)
    }
    if (leadBias !== 0) {
      leadPressure = clamp01(leadPressure + leadBias * 0.4)
      reasons.push(`learned lead bias ${leadBias.toFixed(2)} applied`)
    }
    if (grooveBias !== 0) {
      groovePressure = clamp01(groovePressure + grooveBias * 0.3)
      reasons.push(`learned groove bias ${grooveBias.toFixed(2)} applied`)
    }
    if (counterBias !== 0) {
      counterPressure = clamp01(counterPressure + counterBias * 0.4)
      reasons.push(`learned counter bias ${counterBias.toFixed(2)} applied`)
    }
    if (textureBias !== 0) {
      texturePressure = clamp01(texturePressure + textureBias * 0.4)
      reasons.push(`learned texture bias ${textureBias.toFixed(2)} applied`)
    }

    return {
      groovePressure,
      bassPressure,
      leadPressure,
      counterPressure,
      texturePressure,
      densityTarget,
      tensionTarget,
      noveltyTarget,
      registerShift,
      restPressure,
      motifPreference,
      harmonyPreference,
      confidence: radio.confidence,
      reasons,
    }
  }

  /**
   * Batch adapt for a full section. Walks `bars` bars, picking the radio
   * context per bar (cycling the sequence if shorter than `bars`), and
   * returns one {@link AdaptedCompositionIntent} per bar.
   */
  adaptSection(opts: AdaptSectionOptions): AdaptedCompositionIntent[] {
    const { baseContext, radioSequence, bars } = opts
    const out: AdaptedCompositionIntent[] = []
    for (let bar = 0; bar < bars; bar++) {
      const radio = radioSequence[bar % Math.max(1, radioSequence.length)] ?? radioSequence[0]
      if (!radio) {
        out.push(neutralIntent(baseContext, ['no radio in sequence — NEUTRAL']))
        continue
      }
      const opportunities = buildOpportunityMap(radio)
      const phraseBar = bar % 8
      out.push(
        this.adapt({
          baseContext,
          radio,
          opportunities,
          currentBar: bar,
          phraseBar,
        })
      )
    }
    return out
  }

  /**
   * Reinforce a role's adaptation. Success=true increases the role's bias
   * (more pressure next time); failure decreases it (less pressure next
   * time). The update is asymmetric: failures penalise more strongly than
   * successes reward, so a single bad outcome visibly shifts behaviour.
   */
  reinforce(role: string, success: boolean): void {
    const cur = this.roleBias.get(role) ?? 0
    const delta = success ? 0.1 : -0.2
    this.roleBias.set(role, clamp(cur + delta, -1, 1))
    const outcomes = this.roleOutcomes.get(role) ?? { success: 0, fail: 0 }
    if (success) outcomes.success += 1
    else outcomes.fail += 1
    this.roleOutcomes.set(role, outcomes)
  }

  /** Current learned bias for a role (-1..+1). */
  biasFor(role: string): number {
    return this.roleBias.get(role) ?? 0
  }

  /** Outcomes recorded for a role (for inspection / tests). */
  outcomesFor(role: string): { success: number; fail: number } {
    return this.roleOutcomes.get(role) ?? { success: 0, fail: 0 }
  }

  /** Reset all learned bias (for fresh experiments). */
  reset(): void {
    this.roleBias.clear()
    this.roleOutcomes.clear()
  }
}

// --------------------------- applyAdaptation ---------------------------

/**
 * Apply an {@link AdaptedCompositionIntent} to composed bars, producing
 * adapted bars. This does NOT recompose — it filters / drops / adds notes
 * based on the intent's pressures and targets.
 *
 * The arrangement state and harmonic context are NEVER changed (form
 * preservation). Only the role activations and note counts are modulated.
 */
export function applyAdaptation(
  bars: ComposedBar[],
  intent: AdaptedCompositionIntent
): ComposedBar[] {
  return bars.map((bar) => {
    const roles = { ...bar.roles }
    const kickNotes = bar.kickNotes.slice()
    const bassNotes = bar.bassNotes.slice()
    const leadNotes = bar.leadNotes.slice()
    const hatNotes = bar.hatNotes.slice()

    // Role pressures below 0.4 → silence that role.
    if (intent.groovePressure < 0.4 && roles.kick) {
      roles.kick = false
      kickNotes.length = 0
    }
    if (intent.bassPressure < 0.4 && roles.bass) {
      roles.bass = false
      bassNotes.length = 0
    }
    if (intent.leadPressure < 0.4 && roles.lead) {
      roles.lead = false
      leadNotes.length = 0
    }
    if (intent.texturePressure < 0.3 && roles.hats) {
      roles.hats = false
      hatNotes.length = 0
    }
    // High texture pressure → add offbeat hats if none present.
    if (intent.texturePressure > 0.6 && hatNotes.length === 0) {
      roles.hats = true
      hatNotes.push(2, 6, 10, 14)
    }

    // Rest pressure: probabilistically silence lead/bass in some bars.
    // Deterministic by barIndex so the same intent + bars always produce
    // the same adapted output.
    if (intent.restPressure > 0.3) {
      const phase = bar.barIndex % 4
      if (intent.restPressure > 0.5 && phase === 2) {
        // Strong rest: silence lead.
        roles.lead = false
        leadNotes.length = 0
      }
      if (intent.restPressure > 0.6 && phase === 0) {
        // Very strong rest: silence bass too.
        roles.bass = false
        bassNotes.length = 0
      }
    }

    // Density target: scale note counts if target is far below the bar's
    // natural density. (We only thin — we never add notes here, since
    // adding would require recomposition.)
    const currentDensity =
      (kickNotes.length + bassNotes.length + leadNotes.length + hatNotes.length) / 16
    if (intent.densityTarget < currentDensity - 0.1) {
      // Thin lead by dropping every other note.
      if (leadNotes.length > 2) {
        leadNotes.splice(1, Math.floor(leadNotes.length / 2))
      }
    }

    // Register shift: transpose lead notes by N octaves.
    if (intent.registerShift !== 0 && leadNotes.length > 0) {
      const shiftSemi = intent.registerShift * 12
      for (const n of leadNotes) {
        n.midi = n.midi + shiftSemi
        // Clamp back into lead tessitura (MIDI 60-84).
        while (n.midi < 60) n.midi += 12
        while (n.midi > 84) n.midi -= 12
      }
    }

    return {
      ...bar,
      kickNotes,
      bassNotes,
      leadNotes,
      hatNotes,
      roles,
    }
  })
}

// --------------------------- fit / competition metrics ---------------------------

/**
 * Measure how well the adapted bars fit with the radio. Higher = better fit.
 *
 * For each bar:
 *   - For each role, the foundation's pressure (note count normalised)
 *     should be the complement of the radio's occupancy. If the radio is
 *     heavily occupying a role, the foundation should be sparse there (and
 *     vice versa).
 *   - The fit score for a role is 1 - |foundationPressure - (1 - occupancy)|.
 *
 * Returns the mean across all bars and roles.
 */
export function adaptationFitScore(
  adapted: { bars: ComposedBar[] },
  radio: RadioMusicalContext
): number {
  if (!radio.available || adapted.bars.length === 0) return 0.5

  let totalScore = 0
  let samples = 0

  for (const bar of adapted.bars) {
    // Bass: foundation bass density should be ~ (1 - radio.bassOccupancy).
    const bassPressure = Math.min(1, bar.bassNotes.length / 4)
    const bassFit = 1 - Math.abs(bassPressure - (1 - radio.bassOccupancy))
    totalScore += bassFit
    samples++

    // Lead: foundation lead density should be ~ (1 - radio.leadOccupancy).
    const leadPressure = Math.min(1, bar.leadNotes.length / 4)
    const leadFit = 1 - Math.abs(leadPressure - (1 - radio.leadOccupancy))
    totalScore += leadFit
    samples++

    // Kick: foundation kick should match radio kick occupancy (lock to it).
    const kickPressure = bar.kickNotes.length > 0 ? Math.min(1, bar.kickNotes.length / 4) : 0
    const kickFit = 1 - Math.abs(kickPressure - radio.kickOccupancy)
    totalScore += kickFit
    samples++
  }

  return samples > 0 ? clamp01(totalScore / samples) : 0.5
}

/**
 * Measure bass competition: how much the foundation's bass overlaps with
 * the radio's bass occupancy. Higher = MORE competition (bad).
 *
 * Returns 0 if the radio has no bass occupancy (no competition possible).
 */
export function bassCompetition(
  adapted: { bars: ComposedBar[] },
  radio: RadioMusicalContext
): number {
  if (radio.bassOccupancy < 0.3 || adapted.bars.length === 0) return 0
  let competition = 0
  for (const bar of adapted.bars) {
    if (bar.bassNotes.length > 0) {
      // Foundation bass density (0..1) × radio bass occupancy.
      const bassDensity = Math.min(1, bar.bassNotes.length / 4)
      competition += bassDensity * radio.bassOccupancy
    }
  }
  return clamp01(competition / adapted.bars.length)
}
