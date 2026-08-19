/**
 * MotifQualityGate: a quality gate that filters generated motifs.
 *
 * Each motif is scored on seven axes:
 *   - harmonicFit   — notes belong to the context scale / chord
 *   - rhythmicFit   — density matches the context target
 *   - contour       — contour has direction and shape (not flat)
 *   - register      — register is appropriate for the role / context
 *   - identity      — motif has a recognisable structural fingerprint
 *   - novelty       — motif is sufficiently distinct from "obvious" defaults
 *   - tension       — amount of tension is appropriate for the context
 *
 * The final score is a weighted average; motifs with `final >= threshold`
 * pass. {@link MotifQualityGate.diagnose} returns actionable suggestions for
 * motifs that fail.
 */

import { type Motif, motifIdentity } from './motif-v2.ts'
import type { MusicalContext } from './musical-context.ts'
import { type Scale, getScale, isInScale, scalePcs, stableDegrees } from './scales.ts'

export interface MotifQualityAxes {
  harmonicFit: number
  rhythmicFit: number
  contour: number
  register: number
  identity: number
  novelty: number
  tension: number
}

export interface MotifQualityScore {
  motif: Motif
  scores: MotifQualityAxes
  /** 0..1 weighted average. */
  final: number
  /** True if `final >= threshold`. */
  passed: boolean
  /** Human-readable issue descriptions. */
  issues: string[]
}

export interface MotifQualityGateOptions {
  /** Pass threshold (default 0.5). */
  threshold?: number
  /** Optional default context (overridable per call). */
  context?: MusicalContext
  /** Optional per-axis weights (default: balanced). */
  weights?: Partial<MotifQualityAxes>
}

const DEFAULT_WEIGHTS: MotifQualityAxes = {
  harmonicFit: 0.13,
  rhythmicFit: 0.1,
  contour: 0.18,
  register: 0.2,
  identity: 0.15,
  novelty: 0.12,
  tension: 0.12,
}

const DEFAULT_THRESHOLD = 0.5

const PC_COUNT = 12

/** Standard "trivial" motif identities to flag as low-novelty. */
const TRIVIAL_IDENTITIES = new Set<string>(['c:|i:|a:', 'c:0,0,0,0|i:p0,p0,p0,p0|a:10000'])

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export class MotifQualityGate {
  private readonly threshold: number
  private readonly defaultContext?: MusicalContext
  private readonly weights: MotifQualityAxes

  constructor(opts: MotifQualityGateOptions = {}) {
    this.threshold = opts.threshold ?? DEFAULT_THRESHOLD
    this.defaultContext = opts.context
    this.weights = { ...DEFAULT_WEIGHTS, ...opts.weights }
  }

  /** Score a single motif. */
  score(motif: Motif, context?: MusicalContext): MotifQualityScore {
    const ctx = context ?? this.defaultContext
    const scores = this.scoreAxes(motif, ctx)
    let final =
      scores.harmonicFit * this.weights.harmonicFit +
      scores.rhythmicFit * this.weights.rhythmicFit +
      scores.contour * this.weights.contour +
      scores.register * this.weights.register +
      scores.identity * this.weights.identity +
      scores.novelty * this.weights.novelty +
      scores.tension * this.weights.tension
    // Hard gate: single-pitch-class motifs are structurally trivial and must
    // not pass regardless of how well they score on harmonic / register axes.
    if (motif.pitchClasses.length < 2) {
      final = Math.min(final, 0.35)
    }
    const issues = this.collectIssues(scores, motif, ctx)
    return {
      motif,
      scores,
      final: clamp01(final),
      passed: final >= this.threshold,
      issues,
    }
  }

  /** Score every motif (preserves input order). */
  scoreAll(motifs: Motif[], context?: MusicalContext): MotifQualityScore[] {
    return motifs.map((m) => this.score(m, context))
  }

  /** Filter to only motifs whose `final >= threshold`. */
  filter(motifs: Motif[], context?: MusicalContext): Motif[] {
    return this.scoreAll(motifs, context)
      .filter((s) => s.passed)
      .map((s) => s.motif)
  }

  /**
   * Diagnose why a motif failed and produce actionable suggestions. Always
   * returns both lists (empty when the motif is healthy).
   */
  diagnose(motif: Motif, context?: MusicalContext): { issues: string[]; suggestions: string[] } {
    const score = this.score(motif, context)
    const suggestions: string[] = []
    for (const issue of score.issues) {
      const s = this.suggest(issue)
      if (s) suggestions.push(s)
    }
    return { issues: score.issues, suggestions }
  }

  // ---------------- axis scorers ----------------

  private scoreAxes(motif: Motif, context?: MusicalContext): MotifQualityAxes {
    return {
      harmonicFit: this.scoreHarmonic(motif, context),
      rhythmicFit: this.scoreRhythmic(motif, context),
      contour: this.scoreContour(motif),
      register: this.scoreRegister(motif, context),
      identity: this.scoreIdentity(motif),
      novelty: this.scoreNovelty(motif),
      tension: this.scoreTension(motif, context),
    }
  }

  /** Harmonic: fraction of notes in the context scale (+ chord bonus). */
  private scoreHarmonic(motif: Motif, context?: MusicalContext): number {
    if (!context) return 0.7
    const scale = getScale(context.scaleName)
    if (!scale) return 0.5
    if (motif.notes.length === 0) return 0
    let inScale = 0
    let chordHits = 0
    const chordPcs = new Set(context.harmonicContext)
    for (const n of motif.notes) {
      if (isInScale(context.tonic, scale, n.midi)) inScale++
      const pc = ((n.midi % PC_COUNT) + PC_COUNT) % PC_COUNT
      if (chordPcs.has(pc)) chordHits++
    }
    const base = inScale / motif.notes.length
    const chordBonus = chordPcs.size > 0 ? 0.15 * (chordHits / motif.notes.length) : 0
    return clamp01(base + chordBonus)
  }

  /** Rhythmic: how close is the motif's density to the context target? */
  private scoreRhythmic(motif: Motif, context?: MusicalContext): number {
    const target = context?.density ?? 0.5
    const actual = motif.rhythmicDensity
    return clamp01(1 - Math.abs(target - actual))
  }

  /** Contour: directional variety — flat or all-same-direction is penalised. */
  private scoreContour(motif: Motif): number {
    if (motif.contour.length === 0) return 0
    // All-same-note motif (flat): every interval is 0 → worst contour.
    const allFlat = motif.intervals.every((iv) => iv === 0)
    if (allFlat) return 0.05
    const ups = motif.contour.filter((c) => c > 0).length
    const downs = motif.contour.filter((c) => c < 0).length
    const same = motif.contour.filter((c) => c === 0).length
    const total = motif.contour.length
    // Reward balanced direction changes; penalise flat or one-directional.
    const directionBalance = 1 - Math.abs(ups - downs) / total
    const flatnessPenalty = same / total
    // Interval variety: distinct absolute interval magnitudes.
    const uniqueIntervals = new Set(motif.intervals.map(Math.abs)).size
    const intervalVariety = Math.min(1, uniqueIntervals / 4)
    return clamp01(0.5 * directionBalance + 0.3 * intervalVariety - 0.3 * flatnessPenalty + 0.2)
  }

  /** Register: motif sits in the context's target octave band. */
  private scoreRegister(motif: Motif, context?: MusicalContext): number {
    if (motif.notes.length === 0) return 0
    const targetOctave = context?.octave ?? 4
    const targetCenter = 12 * (targetOctave + 1) + (context?.tonic ?? 0)
    const actualCenter = (motif.register.min + motif.register.max) / 2
    const dist = Math.abs(actualCenter - targetCenter)
    // 12 semitones off = 0; 0 off = 1.
    return clamp01(1 - dist / 12)
  }

  /** Identity: motif has a non-trivial fingerprint. */
  private scoreIdentity(motif: Motif): number {
    const fp = motifIdentity(motif)
    if (TRIVIAL_IDENTITIES.has(fp)) return 0.1
    // Single-pitch-class motif has no real identity.
    if (motif.pitchClasses.length <= 1) return 0.1
    if (motif.contour.length < 2) return 0.2
    if (motif.intervals.length < 2) return 0.3
    // Reward distinct interval classes and accent variety.
    const uniqueClasses = new Set(motif.intervals.map((iv) => ((iv % 12) + 12) % 12)).size
    const accentVariety = motif.accentPattern.filter((b) => b).length > 0 ? 0.3 : 0
    return clamp01(0.5 + 0.04 * uniqueClasses + accentVariety)
  }

  /** Novelty: motif's interval + contour signature isn't trivial. */
  private scoreNovelty(motif: Motif): number {
    if (motif.intervals.length === 0) return 0.2
    // Single-pitch-class motifs are trivially non-novel.
    if (motif.pitchClasses.length <= 1) return 0.1
    // Penalise motifs whose intervals are all the same magnitude.
    const magnitudes = new Set(motif.intervals.map(Math.abs))
    const uniqueRatio = magnitudes.size / Math.max(1, motif.intervals.length)
    // Penalise motifs that span only 1 pitch class.
    const pcCount = motif.pitchClasses.length
    return clamp01(0.4 + 0.4 * uniqueRatio + 0.05 * Math.min(5, pcCount))
  }

  /** Tension: amount of tension fits the context. */
  private scoreTension(motif: Motif, context?: MusicalContext): number {
    if (!context) return 0.5
    const scale = getScale(context.scaleName)
    if (!scale || motif.notes.length === 0) return 0.5
    const stablePcs = new Set(this.stablePcs(context.tonic, scale))
    let stable = 0
    for (const n of motif.notes) {
      const pc = ((n.midi % PC_COUNT) + PC_COUNT) % PC_COUNT
      if (stablePcs.has(pc)) stable++
    }
    const stableRatio = stable / motif.notes.length
    const targetTension = clamp01(context.tension)
    // We want stableRatio ≈ 1 - targetTension.
    const fit = 1 - Math.abs(stableRatio - (1 - targetTension))
    return clamp01(fit)
  }

  /** Stable pitch classes for a context. */
  private stablePcs(tonic: number, scale: Scale): number[] {
    const pcs = scalePcs(tonic, scale)
    const degrees = stableDegrees(scale)
    const out: number[] = []
    for (const d of degrees) {
      const pc = pcs[d % pcs.length]
      if (pc !== undefined) out.push(pc)
    }
    return out
  }

  // ---------------- diagnostics ----------------

  private collectIssues(
    scores: MotifQualityAxes,
    motif: Motif,
    context?: MusicalContext
  ): string[] {
    const issues: string[] = []
    if (scores.harmonicFit < 0.5) {
      const outOfScale = this.outOfScaleCount(motif, context)
      issues.push(
        `harmonicFit low (${scores.harmonicFit.toFixed(2)}; ${outOfScale} notes out of scale)`
      )
    }
    if (scores.rhythmicFit < 0.4) {
      issues.push(
        `rhythmicFit low (${scores.rhythmicFit.toFixed(2)}; density ${motif.rhythmicDensity.toFixed(2)} vs target ${context?.density?.toFixed(2) ?? '?'})`
      )
    }
    if (scores.contour < 0.4) {
      issues.push(`contour weak (${scores.contour.toFixed(2)}; flat or one-directional)`)
    }
    if (scores.register < 0.4) {
      issues.push(`register inappropriate (${scores.register.toFixed(2)})`)
    }
    if (scores.identity < 0.4) {
      issues.push(`identity weak (${scores.identity.toFixed(2)}; trivial fingerprint)`)
    }
    if (scores.novelty < 0.4) {
      issues.push(`novelty low (${scores.novelty.toFixed(2)}; intervals too uniform)`)
    }
    if (scores.tension < 0.4) {
      issues.push(`tension inappropriate (${scores.tension.toFixed(2)} vs context)`)
    }
    return issues
  }

  private outOfScaleCount(motif: Motif, context?: MusicalContext): number {
    if (!context) return 0
    const scale = getScale(context.scaleName)
    if (!scale) return 0
    let count = 0
    for (const n of motif.notes) {
      if (!isInScale(context.tonic, scale, n.midi)) count++
    }
    return count
  }

  private suggest(issue: string): string | null {
    if (issue.startsWith('harmonicFit'))
      return 'snap notes to the context scale (use transpose with snapToScale)'
    if (issue.startsWith('rhythmicFit'))
      return 'adjust rhythmicDensity via rhythmicStretch or rhythmicDisplacement'
    if (issue.startsWith('contour'))
      return 'invert, retrograde, or apply contourMutation to introduce direction changes'
    if (issue.startsWith('register'))
      return 'use shiftRegister to move the motif into the context octave'
    if (issue.startsWith('identity'))
      return 'add accent variety or vary intervals via intervalSubstitution'
    if (issue.startsWith('novelty'))
      return 'introduce distinct interval magnitudes via intervalSubstitution'
    if (issue.startsWith('tension'))
      return 'mix stable and unstable scale degrees (root/third/fifth vs passing tones)'
    return null
  }
}
