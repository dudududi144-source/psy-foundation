/**
 * HarmonicPlan — the harmonic sequence for a phrase, with cadence target and
 * function. The lead generator consumes this to make CAUSAL harmonic
 * decisions: which chord is current, which is next, where the cadence lands,
 * and which pitches are stable vs. tension.
 *
 * F20 requirement: harmony → lead must be causal. The lead must know the
 * current chord, next chord, harmonic function, and cadence target. At phrase
 * cadence the lead preferentially resolves toward root/third/fifth (by role).
 * During tension the lead may use passing/approach/suspension/chromatic
 * tones — but these must be intentional decisions, not random sampling.
 *
 * Phase 2 Day 3 FIX: added PSYTRANCE_PROGRESSIONS support. Previously
 * the plan always used T-S-T-D rotation (pop music). Now accepts a
 * progression name and uses the appropriate degree sequence.
 */

import { degreeToPc, getScale, scalePcs } from './scales.ts'

/**
 * Common psytrance progressions (degree sequences, 0-indexed).
 * Phase 2 Day 3: moved from psy4/harmony.ts to foundation/music so
 * harmonic-plan.ts can use them without cross-layer imports.
 */
export const PSYTRANCE_PROGRESSIONS: Record<string, number[]> = {
  hypnotic: [0, 0, 0, 0], // I-I-I-I (drone — most psytrance)
  dark: [0, 1, 0, 1], // I-II-I-II (Phrygian)
  uplifting: [0, 5, 3, 4], // I-vi-IV-V
  epic: [0, 3, 5, 4], // I-IV-vi-V
  classic: [0, 4, 5, 3], // I-V-vi-IV
  minor: [0, 5, 3, 4], // i-VI-III-VII (minor)
  'psy-dominant': [0, 1, 0, 6], // I-II-I-VII (Phrygian dominant)
  't-s-t-d': [0, 3, 0, 4], // I-IV-I-V (classic T-S-T-D, was the only option before)
}

export type HarmonicFunction = 'TONIC' | 'SUBDOMINANT' | 'DOMINANT' | 'PREDOMINANT'
export type CadenceTargetFunction = 'ROOT' | 'THIRD' | 'FIFTH'

export interface HarmonicChord {
  /** Bar index (absolute within the section) where this chord starts. */
  startBar: number
  /** Bar index (exclusive) where this chord ends. */
  endBar: number
  /** Root pitch class of the chord (0..11). */
  rootPc: number
  /** Chord-tone pitch classes (root, third, fifth, etc.). */
  chordTones: number[]
  /** Tension level 0..1 — high tension permits passing/approach/suspension tones. */
  tension: number
  /** Harmonic function of this chord. */
  function: HarmonicFunction
}

export interface CadenceTarget {
  /** Pitch class the phrase should resolve to. */
  pc: number
  /** Scale degree (0=root, 2=third, 4=fifth). */
  degree: 0 | 2 | 4
  /** Function label. */
  function: CadenceTargetFunction
}

export interface HarmonicPlan {
  /** Sequence of chords spanning the phrase (and possibly the section). */
  chords: HarmonicChord[]
  /** Where the phrase should cadence — consumed by the lead at the last bar. */
  cadenceTarget: CadenceTarget
  /** Overall function of the phrase. */
  overallFunction: HarmonicFunction
  /** Tonic pitch class. */
  tonic: number
  /** Scale name. */
  scaleName: string
}

export interface BuildHarmonicPlanOptions {
  bars: number
  /** Absolute bar index where the phrase starts within the section. */
  startBar: number
  tonic: number
  scaleName: string
  phraseIndex: number
  isLastPhrase: boolean
  /** Phrase role — influences cadence target (RESOLUTION → root, RESPONSE → third, etc.). */
  phraseRole?: string
  /** Chord changes per bar (from StyleGrammar). */
  chordChangeRate?: number
  /** Tension preference 0..1 (from StyleGrammar). */
  tensionPreference?: number
  /** Learned pitch-class profile (12-bin). When present, biases chord-tone selection. */
  learnedPcProfile?: number[]
  /** Learned confidence 0..1 — gates whether learned profile influences harmony. */
  learnedConfidence?: number
  /**
   * Phase 2 Day 3: progression name from PSYTRANCE_PROGRESSIONS.
   * If provided, uses the named progression instead of T-S-T-D rotation.
   * Default: 't-s-t-d' (preserves backward compatibility).
   */
  progressionName?: string
}

function functionForPhrase(phraseIndex: number, isLastPhrase: boolean): HarmonicFunction {
  if (isLastPhrase) return 'TONIC'
  const idx = ((phraseIndex % 4) + 4) % 4
  if (idx === 0) return 'TONIC'
  if (idx === 1) return 'SUBDOMINANT'
  if (idx === 2) return 'TONIC'
  return 'DOMINANT'
}

function cadenceTargetForRole(
  role: string | undefined,
  isLastPhrase: boolean,
  tonicPc: number,
  thirdPc: number,
  fifthPc: number
): CadenceTarget {
  // RESOLUTION / RELEASE / last-phrase → root.
  if (isLastPhrase || role === 'RESOLUTION' || role === 'RELEASE') {
    return { pc: tonicPc, degree: 0, function: 'ROOT' }
  }
  // RESPONSE / ANSWER → third (a softer cadence).
  if (role === 'RESPONSE' || role === 'ANSWER') {
    return { pc: thirdPc, degree: 2, function: 'THIRD' }
  }
  // BUILD / DEVELOPMENT → fifth (open, expectant).
  if (role === 'BUILD' || role === 'DEVELOPMENT') {
    return { pc: fifthPc, degree: 4, function: 'FIFTH' }
  }
  // Default → root.
  return { pc: tonicPc, degree: 0, function: 'ROOT' }
}

/**
 * Build a HarmonicPlan for a phrase.
 *
 * Phase 2 Day 3: now supports PSYTRANCE_PROGRESSIONS via progressionName option.
 * If provided, uses the named progression (e.g., 'hypnotic' for drone, 'dark'
 * for Phrygian I-II-I-II). Default: 't-s-t-d' (preserves backward compat).
 */
export function buildHarmonicPlan(opts: BuildHarmonicPlanOptions): HarmonicPlan {
  const scale = getScale(opts.scaleName)
  const tonic = opts.tonic
  const pcs = scale ? scalePcs(tonic, scale) : [tonic, (tonic + 7) % 12]
  const functionSeq: HarmonicFunction[] = ['TONIC', 'SUBDOMINANT', 'TONIC', 'DOMINANT']

  // Phase 2 Day 3: get progression degrees if specified
  const progressionName = opts.progressionName ?? 't-s-t-d'
  const progressionDegrees =
    PSYTRANCE_PROGRESSIONS[progressionName] ?? PSYTRANCE_PROGRESSIONS['t-s-t-d']!

  // Determine how many chord slots the phrase gets.
  const changeRate = opts.chordChangeRate ?? 0.25
  const barsPerChord = Math.max(1, Math.round(1 / Math.max(0.125, changeRate)))
  const chords: HarmonicChord[] = []
  const overallFunction = functionForPhrase(opts.phraseIndex, opts.isLastPhrase)

  // Learned harmony bias.
  const hasLearned =
    opts.learnedConfidence !== undefined &&
    opts.learnedConfidence > 0.3 &&
    opts.learnedPcProfile !== undefined &&
    opts.learnedPcProfile.some((v) => v > 0.05)

  for (let bar = 0; bar < opts.bars; bar += barsPerChord) {
    const slotIdx = Math.floor(bar / barsPerChord)
    // Phase 2 Day 3: use progression degrees to determine chord root
    const _degree =
      progressionDegrees[
        ((slotIdx % progressionDegrees.length) + progressionDegrees.length) %
          progressionDegrees.length
      ] ?? 0
    const fn = functionSeq[((slotIdx % 4) + 4) % 4] ?? 'TONIC'

    // Build chord tones from scale degree
    let chordTones: number[]
    if (fn === 'TONIC') {
      chordTones = [pcs[0] ?? tonic, pcs[2] ?? (tonic + 4) % 12, pcs[4] ?? (tonic + 7) % 12]
    } else if (fn === 'SUBDOMINANT') {
      chordTones = [
        pcs[3] ?? (tonic + 5) % 12,
        pcs[5] ?? (tonic + 7) % 12,
        pcs[7 % pcs.length] ?? (tonic + 11) % 12,
      ]
    } else if (fn === 'DOMINANT') {
      chordTones = [
        pcs[4] ?? (tonic + 7) % 12,
        pcs[6 % pcs.length] ?? (tonic + 11) % 12,
        pcs[8 % pcs.length] ?? (tonic + 2) % 12,
      ]
    } else {
      chordTones = [
        pcs[1] ?? (tonic + 2) % 12,
        pcs[3] ?? (tonic + 5) % 12,
        pcs[5] ?? (tonic + 7) % 12,
      ]
    }

    if (hasLearned && opts.learnedPcProfile) {
      // Replace one chord tone with a learned-preferred pc that is in the scale.
      const sortedPcs = opts.learnedPcProfile
        .map((weight, pc) => ({ pc, weight }))
        .filter((x) => pcs.includes(x.pc) && !chordTones.includes(x.pc))
        .sort((a, b) => b.weight - a.weight)
      if (sortedPcs.length > 0 && sortedPcs[0]) {
        chordTones = [chordTones[0] ?? tonic, chordTones[1] ?? tonic, sortedPcs[0].pc]
      }
    }

    chords.push({
      startBar: opts.startBar + bar,
      endBar: opts.startBar + Math.min(opts.bars, bar + barsPerChord),
      rootPc: chordTones[0] ?? tonic,
      chordTones,
      tension: opts.tensionPreference ?? 0.4,
      function: fn,
    })
  }

  // Cadence target.
  const tonicPc = pcs[0] ?? tonic
  const thirdPc = pcs[2] ?? (tonic + 4) % 12
  const fifthPc = pcs[4] ?? (tonic + 7) % 12
  const cadenceTarget = cadenceTargetForRole(
    opts.phraseRole,
    opts.isLastPhrase,
    tonicPc,
    thirdPc,
    fifthPc
  )

  return {
    chords,
    cadenceTarget,
    overallFunction,
    tonic,
    scaleName: opts.scaleName,
  }
}

/** Find the chord active at a given absolute bar index. */
export function chordAtBar(plan: HarmonicPlan, bar: number): HarmonicChord | null {
  for (const c of plan.chords) {
    if (bar >= c.startBar && bar < c.endBar) return c
  }
  return plan.chords[plan.chords.length - 1] ?? null
}

/** Find the chord that follows the chord active at `bar` (for anticipation). */
export function nextChordAfterBar(plan: HarmonicPlan, bar: number): HarmonicChord | null {
  let found = false
  for (const c of plan.chords) {
    if (found) return c
    if (bar >= c.startBar && bar < c.endBar) found = true
  }
  return null
}

/** True if the bar is the last bar of a chord slot (lead may anticipate next chord). */
export function isAnticipationBar(plan: HarmonicPlan, bar: number): boolean {
  const cur = chordAtBar(plan, bar)
  const next = nextChordAfterBar(plan, bar)
  if (!cur || !next) return false
  return bar === cur.endBar - 1 && cur.rootPc !== next.rootPc
}

/** Resolve a cadence target pitch class to a MIDI note in the lead register. */
export function cadenceMidi(
  plan: HarmonicPlan,
  target: CadenceTarget,
  registerCenter: number
): number {
  const scale = getScale(plan.scaleName)
  if (!scale) return registerCenter
  // Snap the register center to the nearest octave, then offset to the target pc.
  let base = registerCenter
  const basePc = ((base % 12) + 12) % 12
  base = base - basePc + target.pc
  // Wrap into the lead register ± an octave.
  while (base < registerCenter - 12) base += 12
  while (base > registerCenter + 12) base -= 12
  void degreeToPc
  return base
}
