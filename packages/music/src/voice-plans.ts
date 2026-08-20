/**
 * Voice plans — first-class plan objects for each voice (kick, bass, lead).
 *
 * F20 requirement: the lead must receive the ACTUAL generated kick and bass
 * plans (not just the groove skeleton). These typed plans are produced in the
 * strict order:
 *
 *   1. HarmonicPlan      (harmonic-plan.ts)
 *   2. GroovePlan        (groove-plan.ts — the shared pocket)
 *   3. KickPlan          (derived from groove + learned kick grammar)
 *   4. BassPlan          (derived from groove + KickPlan + HarmonicPlan + grammar)
 *   5. LeadPlan          (derived from ALL prior + RhythmicSpaceMap + PhraseMaterial)
 *
 * The LeadPlan generator explicitly decides per step: where to play, where to
 * leave silence, where to answer bass, where to reinforce kick, where to
 * avoid kick, where to anticipate, where to sustain, where to cadence.
 */

export interface KickPlan {
  /** Step indices within the bar that have a kick onset. */
  onsets: number[]
  /** Velocity 0..1 per onset (aligned with onsets). */
  velocities: number[]
}

export type BassFunction =
  | 'ROOT'
  | 'THIRD'
  | 'FIFTH'
  | 'SEVENTH'
  | 'OCTAVE'
  | 'PASSING'
  | 'APPROACH'
  | 'CADENCE'
  | 'ANTICIPATION'
  | 'ROLL' // Phase A: added for rollingBass16th

export interface BassPlanNote {
  midi: number
  step: number
  durationSteps: number
  function: BassFunction
  /** True if this bass note anticipates a kick (derived from grammar). */
  isAnticipation: boolean
}

export interface BassPlan {
  notes: BassPlanNote[]
  /** Onset step indices (convenience for space-map derivation). */
  onsets: number[]
}

export type LeadRole =
  | 'CALL'
  | 'RESPONSE'
  | 'CONTINUATION'
  | 'CADENCE'
  | 'REST'
  | 'ANTICIPATION'
  | 'SUSTAIN'

export interface LeadPlanNote {
  midi: number
  step: number
  durationSteps: number
  velocity: number
  role: LeadRole
}

export interface LeadPlan {
  notes: LeadPlanNote[]
}

/** Convenience: extract onset steps from a BassPlan. */
export function bassOnsetsOf(plan: BassPlan): number[] {
  return plan.notes.map((n) => n.step)
}

/** Convenience: extract onset steps from a KickPlan. */
export function kickOnsetsOf(plan: KickPlan): number[] {
  return plan.onsets
}

/** Empty plan helpers. */
export function emptyKickPlan(): KickPlan {
  return { onsets: [], velocities: [] }
}
export function emptyBassPlan(): BassPlan {
  return { notes: [], onsets: [] }
}
export function emptyLeadPlan(): LeadPlan {
  return { notes: [] }
}
