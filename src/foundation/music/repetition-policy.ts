/**
 * RepetitionPolicy: decide what kind of repetition to apply at each bar.
 *
 * The goal is *purposeful* repetition — the music should establish a motif,
 * transform it a few times, introduce contrast, then return to the original
 * (A → A' → A'' → B → A-return) rather than continually introduce new
 * material (A → B → C → D → E) which the ear perceives as incoherent.
 *
 * The policy reads the section plan's role for the current bar and the
 * recent material history, then emits a {@link RepetitionDecision}. It
 * also exposes {@link RepetitionPolicy.evaluateSequence} to check that a
 * sequence of decisions is healthy.
 */

import type { MotifMemory } from './motif-memory.ts'
import { Rng } from './rng.ts'
import type { SectionPlan, SectionRole } from './section-planner.ts'

export type RepetitionType =
  | 'EXACT_REPEAT'
  | 'TRANSFORMED_REPEAT'
  | 'CALLBACK'
  | 'DEVELOPMENT'
  | 'CONTRAST'
  | 'NEW_MATERIAL'

export interface RepetitionDecision {
  type: RepetitionType
  /** Motif id the decision refers to (for repeats / callbacks). */
  sourceMotifId?: string
  /** Transform name to apply (for transformed repeats / development). */
  transformName?: string
  /** Human-readable rationale. */
  reason: string
}

export interface RepetitionPolicyOptions {
  /** Maximum allowed consecutive EXACT_REPEATs before forcing variation. */
  maxExactRepeats?: number
  /** Minimum bar distance before a motif can callback. */
  minCallbackDistance?: number
  /** Preferred ratio of transformed to exact repeats (0..1). */
  preferTransformedRatio?: number
}

export interface DecideOptions {
  barIndex: number
  sectionPlan: SectionPlan
  memory: MotifMemory
  /** Motif ids played so far, ordered most-recent-first. */
  recentMotifIds: string[]
  seed: number
}

const DEFAULT_MAX_EXACT_REPEATS = 1
const DEFAULT_MIN_CALLBACK_DISTANCE = 4
const DEFAULT_PREFER_TRANSFORMED_RATIO = 0.7

const SECTION_ROLE_REPETITION: Record<SectionRole, RepetitionType> = {
  ESTABLISH: 'NEW_MATERIAL',
  REPEAT_VARIATION: 'TRANSFORMED_REPEAT',
  DEVELOPMENT: 'DEVELOPMENT',
  CONTRAST: 'CONTRAST',
  RETURN: 'CALLBACK',
  ESCALATION: 'TRANSFORMED_REPEAT',
  PEAK: 'DEVELOPMENT',
  RELEASE: 'CALLBACK',
}

const TRANSFORM_PALETTE = [
  'transpose:2',
  'transpose:-2',
  'transpose:5',
  'transpose:-5',
  'shiftRegister:1',
  'shiftRegister:-1',
  'invert',
  'retrograde',
  'rhythmicDisplacement:2',
  'contourMutation:40',
  'callResponse',
]

const DEVELOPMENT_TRANSFORMS = [
  'retrograde',
  'invert',
  'contourMutation:50',
  'intervalSubstitution:30',
  'callResponse',
]

export class RepetitionPolicy {
  private readonly maxExactRepeats: number
  private readonly minCallbackDistance: number
  private readonly preferTransformedRatio: number

  constructor(opts: RepetitionPolicyOptions = {}) {
    this.maxExactRepeats = opts.maxExactRepeats ?? DEFAULT_MAX_EXACT_REPEATS
    this.minCallbackDistance = opts.minCallbackDistance ?? DEFAULT_MIN_CALLBACK_DISTANCE
    this.preferTransformedRatio = opts.preferTransformedRatio ?? DEFAULT_PREFER_TRANSFORMED_RATIO
  }

  /**
   * Decide what to do at `barIndex`. The decision considers:
   *  - the section slot's role at this bar (mapping to a default RepetitionType)
   *  - the recent material history (recentMotifIds) — for callback source
   *  - the policy's parameters (maxExactRepeats, minCallbackDistance, etc.)
   */
  decide(opts: DecideOptions): RepetitionDecision {
    const { barIndex, sectionPlan, memory, recentMotifIds, seed } = opts
    const rng = new Rng(seed + barIndex * 7919)
    const slot = sectionPlan.slots.find((s) => s.barIndex === barIndex)
    const role: SectionRole = slot?.sectionRole ?? 'ESTABLISH'
    const recent = recentMotifIds.filter((id) => id.length > 0)
    const recentHead = recent[0]
    // The "origin" motif is the first one we ever played (the oldest entry
    // in recentMotifIds). This is the natural callback target.
    const originMotifId = recent.length > 0 ? recent[recent.length - 1] : undefined

    // If we have nothing in memory yet, we must introduce new material.
    if (recent.length === 0 && memory.size === 0) {
      return {
        type: 'NEW_MATERIAL',
        reason: `no material in memory yet; establishing a new motif at bar ${barIndex}`,
      }
    }

    let type: RepetitionType = SECTION_ROLE_REPETITION[role] ?? 'NEW_MATERIAL'

    // Override: if we have already used EXACT_REPEAT too many times in a row,
    // force a transform.
    if (type === 'EXACT_REPEAT' && this.consecutiveExactRepeats(recent) >= this.maxExactRepeats) {
      type = 'TRANSFORMED_REPEAT'
    }

    // Override: if a CALLBACK is requested but the origin is too close in
    // time, fall back to a TRANSFORMED_REPEAT of the most recent material.
    if (type === 'CALLBACK') {
      const distance = originMotifId ? recent.length : 0
      if (distance < this.minCallbackDistance || !originMotifId) {
        type = 'TRANSFORMED_REPEAT'
      }
    }

    // Override: at bar 0 of a section, always establish.
    if (barIndex === 0) {
      type = 'NEW_MATERIAL'
    }

    switch (type) {
      case 'NEW_MATERIAL':
        return {
          type,
          reason: `section role ${role} calls for new material at bar ${barIndex}`,
        }
      case 'EXACT_REPEAT': {
        // Pick the most recently used motif that exists in memory.
        const candidateId = this.pickRecentFromMemory(recent, memory)
        return {
          type,
          sourceMotifId: candidateId ?? recentHead,
          transformName: 'none',
          reason: `exact repeat of ${candidateId ?? recentHead ?? 'last'} at bar ${barIndex} (role ${role})`,
        }
      }
      case 'TRANSFORMED_REPEAT': {
        const candidateId = this.pickRecentFromMemory(recent, memory) ?? recentHead
        const transform = rng.pick(TRANSFORM_PALETTE)
        return {
          type,
          sourceMotifId: candidateId,
          transformName: transform,
          reason: `transformed repeat of ${candidateId} via ${transform} at bar ${barIndex} (role ${role})`,
        }
      }
      case 'DEVELOPMENT': {
        const candidateId = this.pickRecentFromMemory(recent, memory) ?? recentHead
        const transform = rng.pick(DEVELOPMENT_TRANSFORMS)
        return {
          type,
          sourceMotifId: candidateId,
          transformName: transform,
          reason: `deep development of ${candidateId} via ${transform} at bar ${barIndex} (role ${role})`,
        }
      }
      case 'CONTRAST': {
        // Pick a different motif than the most recent — preferably one
        // that hasn't been used recently.
        const allIds = memory.toJSON().map((e) => e.motif.id)
        const fresh = allIds.filter((id) => !recent.slice(0, 3).includes(id))
        const candidateId = fresh.length > 0 ? rng.pick(fresh) : undefined
        return {
          type,
          sourceMotifId: candidateId,
          transformName: candidateId ? undefined : 'none',
          reason: `contrast: introducing ${candidateId ? 'an existing but unused motif' : 'a new motif'} at bar ${barIndex} (role ${role})`,
        }
      }
      case 'CALLBACK': {
        return {
          type,
          sourceMotifId: originMotifId,
          transformName: 'none',
          reason: `callback to origin motif ${originMotifId} at bar ${barIndex} (role ${role})`,
        }
      }
      default:
        return {
          type: 'NEW_MATERIAL',
          reason: `fallback to new material at bar ${barIndex}`,
        }
    }
  }

  /**
   * Evaluate whether a sequence of decisions is healthy. Health checks:
   *  - at least one callback in a long sequence (>8 bars)
   *  - not too many consecutive EXACT_REPEATs
   *  - not too many consecutive NEW_MATERIAL (no repetition = no coherence)
   *  - some transformed repeats (development)
   */
  evaluateSequence(decisions: RepetitionDecision[]): { healthy: boolean; issues: string[] } {
    const issues: string[] = []
    if (decisions.length === 0) {
      return { healthy: false, issues: ['empty decision sequence'] }
    }
    // Consecutive EXACT_REPEAT count.
    let maxConsecutiveExact = 0
    let run = 0
    for (const d of decisions) {
      if (d.type === 'EXACT_REPEAT') {
        run++
        if (run > maxConsecutiveExact) maxConsecutiveExact = run
      } else {
        run = 0
      }
    }
    if (maxConsecutiveExact > this.maxExactRepeats) {
      issues.push(
        `${maxConsecutiveExact} consecutive EXACT_REPEAT decisions (max allowed: ${this.maxExactRepeats})`
      )
    }
    // Consecutive NEW_MATERIAL count.
    let maxConsecutiveNew = 0
    run = 0
    for (const d of decisions) {
      if (d.type === 'NEW_MATERIAL') {
        run++
        if (run > maxConsecutiveNew) maxConsecutiveNew = run
      } else {
        run = 0
      }
    }
    if (maxConsecutiveNew > 4) {
      issues.push(
        `${maxConsecutiveNew} consecutive NEW_MATERIAL decisions — music will feel incoherent (no repetition)`
      )
    }
    // At least one callback in a long sequence.
    const callbackCount = decisions.filter((d) => d.type === 'CALLBACK').length
    if (decisions.length >= 8 && callbackCount === 0) {
      issues.push(`no CALLBACK in ${decisions.length} decisions — earlier material never returns`)
    }
    // Some transformed repeats.
    const transformedCount = decisions.filter(
      (d) => d.type === 'TRANSFORMED_REPEAT' || d.type === 'DEVELOPMENT'
    ).length
    if (decisions.length >= 4 && transformedCount === 0) {
      issues.push('no transformed repeats — material never develops')
    }
    // All NEW_MATERIAL.
    const allNew = decisions.every((d) => d.type === 'NEW_MATERIAL')
    if (allNew && decisions.length >= 4) {
      issues.push('every decision is NEW_MATERIAL — A→B→C→D→E pattern (no coherence)')
    }
    return { healthy: issues.length === 0, issues }
  }

  // ---------------- helpers ----------------

  /** Count consecutive EXACT_REPEAT entries at the head of the recent list. */
  private consecutiveExactRepeats(recent: string[]): number {
    // We can't tell from the IDs alone what type was used; the policy
    // approximates this by counting identical IDs at the head.
    if (recent.length === 0) return 0
    let count = 0
    const head = recent[0]
    for (const id of recent) {
      if (id === head) count++
      else break
    }
    return Math.max(0, count - 1)
  }

  /** Pick the most recent motif ID that actually exists in memory. */
  private pickRecentFromMemory(recent: string[], memory: MotifMemory): string | undefined {
    for (const id of recent) {
      if (memory.retrieve(id)) return id
    }
    return undefined
  }
}
