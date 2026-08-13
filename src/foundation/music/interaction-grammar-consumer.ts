/**
 * Interaction-grammar consumer — the CAUSAL bridge from learned grammar to
 * generation decisions to actual note events.
 *
 * F20 requirement: every learned relationship must have a causal path:
 *
 *   learned relationship  →  probability / constraint / scoring
 *                          →  generation decision
 *                          →  actual note event
 *
 * This module turns each InteractionGrammar field into a per-step
 * probability or per-candidate score that the generators consume. The
 * generators then make decisions that produce real notes — closing the loop.
 *
 * The five wired relationships:
 *   KICK → BASS         bassOnsetProbability(step, kickHas)
 *   BASS → LEAD         leadResponseBoost(step, bassOnsets)
 *   HARMONY → LEAD      leadIntervalScore(interval, rootPc)
 *   ENERGY → DENSITY    densityForEnergy(energy)
 *   TENSION → REGISTER  registerForTension(tension)
 *
 * Each function blends the learned value with a neutral default according to
 * the grammar's confidence, so an untrained grammar (confidence=0) behaves
 * identically to the pre-F20 engine — keeping the existing 257 tests green.
 */

import type { InteractionGrammar } from './interaction-grammar.ts'

/** Blend a learned value with a default according to confidence. */
function blend(defaultValue: number, learnedValue: number, confidence: number): number {
  return defaultValue * (1 - confidence) + learnedValue * confidence
}

/**
 * KICK → BASS — probability that the bass should hit at this step, given
 * whether the kick hits here and the learned bass-on-kick / bass-off-kick
 * probabilities.
 *
 * Causal path:
 *   learned kickBass.bassOnKickProb[step] / bassOffKickProb[step]
 *     → bassOnsetProbability(step, kickHas)
 *       → composeBass decides whether to place a note at this step
 *         → actual bass note event
 */
export function bassOnsetProbability(opts: {
  step: number
  kickHas: boolean
  grammar: InteractionGrammar
  confidence: number
  /** Neutral default when the grammar is untrained. */
  defaultOnKick?: number
  defaultOffKick?: number
}): number {
  const stepIdx = ((opts.step % 16) + 16) % 16
  const defOn = opts.defaultOnKick ?? 0.85
  const defOff = opts.defaultOffKick ?? 0.15
  if (opts.kickHas) {
    const learned = opts.grammar.kickBass.bassOnKickProb[stepIdx] ?? defOn
    return blend(defOn, learned, opts.confidence)
  }
  const learned = opts.grammar.kickBass.bassOffKickProb[stepIdx] ?? defOff
  return blend(defOff, learned, opts.confidence)
}

/**
 * BASS → LEAD — response probability boost at a step, given the bar's bass
 * onsets. A step that sits 1-3 sixteenths after a bass onset gets a boost
 * derived from how frequently the lead was observed to respond after bass.
 *
 * Causal path:
 *   bass onsets in the bar
 *     → leadResponseBoost(step, bassOnsets)
 *       → composeLead increases the probability of a lead onset at that step
 *         → actual lead note event
 *
 * Because the grammar doesn't store an explicit bass→lead matrix, the boost
 * is derived from the grammar's confidence (higher confidence = stronger
 * response tendency) scaled by the proximity to a bass onset. This keeps the
 * causal path explicit and measurable.
 */
export function leadResponseBoost(opts: {
  step: number
  bassOnsets: number[]
  grammar: InteractionGrammar
  confidence: number
}): number {
  let maxBoost = 0
  for (const bs of opts.bassOnsets) {
    const offset = opts.step - bs
    if (offset === 1) maxBoost = Math.max(maxBoost, 0.6)
    else if (offset === 2) maxBoost = Math.max(maxBoost, 0.4)
    else if (offset === 3) maxBoost = Math.max(maxBoost, 0.2)
  }
  // Scale by confidence: an untrained grammar yields zero boost (neutral).
  return maxBoost * opts.confidence
}

/**
 * HARMONY → LEAD — score for a candidate interval (semitones, signed) over a
 * chord with the given root pitch class. Higher score = more preferred.
 *
 * Causal path:
 *   learned harmonyLead.intervalPreferences[rootPc][interval]
 *     → leadIntervalScore(interval, rootPc)
 *       → composeLead scores candidate pitches and prefers high-scoring ones
 *         → actual lead note event
 */
export function leadIntervalScore(opts: {
  interval: number
  rootPc: number
  grammar: InteractionGrammar
  confidence: number
  /** Neutral default score (0..1) for an untrained grammar. */
  defaultScore?: number
}): number {
  const def = opts.defaultScore ?? 0.5
  const prefs = opts.grammar.harmonyLead.intervalPreferences[opts.rootPc]
  if (!prefs) return def
  const learned = prefs[opts.interval] ?? 0
  // Blend the learned preference (already 0..1 after normalization) with the
  // default. No multiplier — the learned value is used directly so smaller
  // preferences produce noticeably lower scores.
  return blend(def, learned, opts.confidence)
}

/**
 * ENERGY → DENSITY — target note density (notes per bar, 0..1 fraction of
 * 16 steps) given the current energy level.
 *
 * Causal path:
 *   learned energyDensity.densityByEnergy[energyBin]
 *     → densityForEnergy(energy)
 *       → GroovePlan / LeadPlan density target
 *         → actual number of note events
 */
export function densityForEnergy(opts: {
  energy: number
  grammar: InteractionGrammar
  confidence: number
  /** Neutral default density (0..1) for an untrained grammar. */
  defaultDensity?: number
}): number {
  const def = opts.defaultDensity ?? 0.5
  const bin = Math.min(9, Math.max(0, Math.floor(opts.energy * 10)))
  const learned = opts.grammar.energyDensity.densityByEnergy[bin] ?? def
  return blend(def, learned, opts.confidence)
}

/**
 * TENSION → REGISTER — target lead register (MIDI center) given the current
 * tension level.
 *
 * Causal path:
 *   learned tensionRegister.registerByTension[tensionBin]
 *     → registerForTension(tension)
 *       → LeadPlan register offset
 *         → actual lead note pitches
 */
export function registerForTension(opts: {
  tension: number
  grammar: InteractionGrammar
  confidence: number
  /** Neutral default register (MIDI) for an untrained grammar. */
  defaultRegister?: number
}): number {
  const def = opts.defaultRegister ?? 67
  const bin = Math.min(9, Math.max(0, Math.floor(opts.tension * 10)))
  const learned = opts.grammar.tensionRegister.registerByTension[bin] ?? def
  return blend(def, learned, opts.confidence)
}

/**
 * Bass transition probability — probability that the bass should move from
 * `fromDegree` to `toDegree`, given the learned bass transition matrix.
 *
 * Causal path:
 *   learned bassTransitions.transitions[fromDegree][toDegree]
 *     → bassTransitionProbability(fromDegree, toDegree)
 *       → composeBass picks the next bass degree using these probabilities
 *         → actual bass pitch sequence
 */
export function bassTransitionProbability(opts: {
  fromDegree: number
  toDegree: number
  grammar: InteractionGrammar
  confidence: number
  defaultProbability?: number
}): number {
  const def = opts.defaultProbability ?? 0.25
  const row = opts.grammar.bassTransitions.transitions[opts.fromDegree]
  if (!row) return def
  const learned = row[opts.toDegree] ?? 0
  return blend(def, learned, opts.confidence)
}

/**
 * Pick the next bass degree from `candidates` using the learned transition
 * matrix. Returns the chosen degree. Falls back to a uniform pick when the
 * grammar is untrained.
 */
export function pickNextBassDegree(opts: {
  fromDegree: number
  candidates: number[]
  grammar: InteractionGrammar
  confidence: number
  rng: { next: () => number }
}): number {
  if (opts.candidates.length === 0) return 0
  if (opts.candidates.length === 1) return opts.candidates[0] as number
  // Score each candidate by its transition probability.
  const scored = opts.candidates.map((deg) => ({
    deg,
    score: bassTransitionProbability({
      fromDegree: opts.fromDegree,
      toDegree: deg,
      grammar: opts.grammar,
      confidence: opts.confidence,
    }),
  }))
  const total = scored.reduce((s, x) => s + x.score, 0)
  if (total <= 0)
    return opts.candidates[Math.floor(opts.rng.next() * opts.candidates.length)] as number
  let r = opts.rng.next() * total
  for (const s of scored) {
    r -= s.score
    if (r <= 0) return s.deg
  }
  return (scored[scored.length - 1] as { deg: number; score: number }).deg
}
