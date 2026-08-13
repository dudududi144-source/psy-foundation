/**
 * PhraseMaterial — the real musical material of a phrase, and the
 * transformations that turn P(n) into P(n+1).
 *
 * F20 requirement: phrase development must transform ACTUAL musical material
 * (pitch contour, interval sequence, rhythm pattern), not just parameter
 * deltas. Each operator below produces a new PhraseMaterial that is
 * recognizably derived from the source — motifId lineage is preserved so the
 * transformation chain is auditable, and `materialSimilarity` lets callers
 * prove the transformed phrase is still related to the original.
 *
 * The 10 operators (CONTINUE / DEVELOP / ANSWER / CONTRAST / VARIATE /
 * INTENSIFY / REDUCE / BREAK / RESOLVE / TRANSITION) are dispatched by
 * `applyOperatorToMaterial`. At minimum DEVELOP / VARIATE / ANSWER / RESOLVE
 * transform real note material (intervals, contour, rhythm, register) rather
 * than parameters.
 */

import type { Motif } from './motif-v2.ts'
import type { DevelopmentOperator } from './phrase-development.ts'
import { type Scale, degreeToMidi, getScale, isInScale, scalePcs } from './scales.ts'

/**
 * A phrase's musical material. This is NOT a parameter bag — every field is a
 * direct rendering of the notes that will (or did) play.
 *
 * F21 enrichment: added shape fields (rhythmicCell, intervalCell, contour,
 * accentShape, densityShape, registerShape, harmonicTargetShape,
 * cadenceTarget, phraseArc, developmentHistory) so the material carries
 * intentional internal structure, not just a flat note list. The phrase has
 * a trajectory (OPEN → ESTABLISH → DEVELOP → FOCAL → RELEASE → CADENCE).
 */
export interface PhraseMaterial {
  /** Lineage id. Preserved across transformations so P(n+1) can be traced to P(n). */
  motifId: string
  /** Absolute MIDI per note onset. */
  pitchContour: number[]
  /** Signed semitone delta between consecutive pitches (length = notes - 1). */
  intervalSequence: number[]
  /** Step index (within a bar, 0..stepsPerBar-1) of each onset. */
  rhythmPattern: number[]
  /** Alias for rhythmPattern — the step positions of onsets. */
  onsetPositions: number[]
  /** Velocity 0..1 per onset. */
  accentPattern: number[]
  /** Duration in steps per onset. */
  noteDurations: number[]
  /** Mean MIDI of the material (register center). */
  registerProfile: number
  /** Pitch classes this material emphasizes (for harmonic targeting). */
  harmonicTargets: number[]
  /** Steps per bar the material was rendered against. */
  stepsPerBar: number
  /** Stack of operator names applied to derive this material from the seed. */
  transformHistory: string[]
  // ── F21 SHAPE FIELDS (intentional internal structure) ──
  /** Repeating rhythmic cell (step offsets) that underpins the phrase. */
  rhythmicCell: number[]
  /** Repeating interval cell (semitone deltas) that shapes melodic motion. */
  intervalCell: number[]
  /** Contour shape label: 'ascending' | 'descending' | 'arch' | 'valley' | 'flat' | 'wave'. */
  contour: ContourShape
  /** Accent shape: how accents distribute across the phrase (per-note 0..1). */
  accentShape: AccentShape
  /** Density shape: target note density per bar of the phrase (0..1 per bar). */
  densityShape: number[]
  /** Register shape: target register center per bar of the phrase (MIDI per bar). */
  registerShape: number[]
  /** Harmonic target shape: ordered chord-tone pcs the phrase should target. */
  harmonicTargetShape: number[]
  /** Cadence target pitch class (where the phrase resolves). */
  cadenceTarget: number | null
  /** The phrase's internal trajectory. */
  phraseArc: PhraseArc
  /** Full lineage of development operators applied (across phrases). */
  developmentHistory: DevelopmentHistoryEntry[]
}

/** Contour shape labels for phrase-level melodic design. */
export type ContourShape = 'ascending' | 'descending' | 'arch' | 'valley' | 'flat' | 'wave'

/** Accent shape: how accents distribute across the phrase. */
export interface AccentShape {
  /** Per-note accent weights 0..1. */
  weights: number[]
  /** Where the accent climax falls (0..1 fraction of phrase length). */
  climaxPosition: number
}

/**
 * Phrase arc — the internal trajectory of a phrase. Not every phrase uses the
 * exact same arc, but every phrase has intentional internal structure.
 *
 *   OPEN → ESTABLISH → DEVELOP → FOCAL/CLIMAX → RELEASE → CADENCE
 */
export interface PhraseArc {
  /** Ordered stages of the phrase. */
  stages: PhraseArcStage[]
  /** Bar index (within the phrase) of the focal/climax point. */
  focalBar: number
  /** Bar index of the cadence. */
  cadenceBar: number
  /** Overall tension trajectory: 0..1 per stage. */
  tensionTrajectory: number[]
}

export interface PhraseArcStage {
  /** Stage label. */
  stage: 'OPEN' | 'ESTABLISH' | 'DEVELOP' | 'FOCAL' | 'RELEASE' | 'CADENCE'
  /** Bar range [start, end) within the phrase. */
  barRange: [number, number]
  /** Target density 0..1 for this stage. */
  density: number
  /** Target register center MIDI for this stage. */
  register: number
  /** Target tension 0..1 for this stage. */
  tension: number
}

/** A development history entry — one per operator applied across phrases. */
export interface DevelopmentHistoryEntry {
  /** The operator name. */
  operator: string
  /** Phrase index when applied. */
  phraseIndex: number
  /** Similarity to the source material (0..1). */
  similarity: number
}

export interface MaterialTransformContext {
  /** Tonic pitch class (0..11). */
  tonic: number
  /** Scale name (looked up via getScale). */
  scaleName: string
  /** Resolved scale (caller may pass directly to skip lookup). */
  scale?: Scale
  /** Root MIDI the material should center on (for register/transpose ops). */
  rootMidi: number
  /** Deterministic RNG. */
  rng: { next: () => number; pick: <T>(arr: T[]) => T; int: (min: number, max: number) => number }
  /** How strongly to transform (0..1). Operators scale their mutation by this. */
  variationAmount?: number
  /** Optional cadence target pitch class (used by RESOLVE). */
  cadenceTargetPc?: number
}

/** Snap a MIDI to the nearest in-scale tone within +/- 6 semitones. */
function snapToScale(midi: number, rootPc: number, scale: Scale): number {
  if (isInScale(rootPc, scale, midi)) return midi
  for (let offset = 1; offset <= 6; offset++) {
    if (isInScale(rootPc, scale, midi + offset)) return midi + offset
    if (isInScale(rootPc, scale, midi - offset)) return midi - offset
  }
  return midi
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  let s = 0
  for (const v of values) s += v
  return s / values.length
}

function pcsOf(midis: number[]): number[] {
  const set = new Set<number>()
  for (const m of midis) set.add(((m % 12) + 12) % 12)
  return Array.from(set).sort((a, b) => a - b)
}

function intervalsOf(midis: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < midis.length; i++) {
    const prev = midis[i - 1]
    const cur = midis[i]
    if (prev !== undefined && cur !== undefined) out.push(cur - prev)
  }
  return out
}

/**
 * Extract a PhraseMaterial from a Motif. The material is rendered within a
 * single bar (stepsPerBar); notes whose step exceeds stepsPerBar are wrapped
 * modulo stepsPerBar so the material always fits one bar.
 */
export function motifToPhraseMaterial(motif: Motif, stepsPerBar: number): PhraseMaterial {
  const notes = motif.notes
  const pitchContour: number[] = []
  const rhythmPattern: number[] = []
  const accentPattern: number[] = []
  const noteDurations: number[] = []
  for (const n of notes) {
    pitchContour.push(n.midi)
    rhythmPattern.push(((n.step % stepsPerBar) + stepsPerBar) % stepsPerBar)
    accentPattern.push(n.velocity)
    noteDurations.push(n.durationSteps)
  }
  const intervals = intervalsOf(pitchContour)
  return {
    motifId: motif.id,
    pitchContour,
    intervalSequence: intervals,
    rhythmPattern,
    onsetPositions: rhythmPattern.slice(),
    accentPattern,
    noteDurations,
    registerProfile: mean(pitchContour),
    harmonicTargets: pcsOf(pitchContour),
    stepsPerBar,
    transformHistory: motif.transformHistory.slice(),
    // F21 shape fields (derived from the motif).
    rhythmicCell: deriveRhythmicCell(rhythmPattern),
    intervalCell: deriveIntervalCell(intervals),
    contour: classifyContour(intervals),
    accentShape: { weights: accentPattern.slice(), climaxPosition: findClimax(accentPattern) },
    densityShape: [Math.min(1, pitchContour.length / stepsPerBar)],
    registerShape: [mean(pitchContour)],
    harmonicTargetShape: pcsOf(pitchContour),
    cadenceTarget:
      pitchContour.length > 0
        ? ((pitchContour[pitchContour.length - 1] ?? 0 % 12) + 12) % 12
        : null,
    phraseArc: buildPhraseArc(1, mean(pitchContour), 0.3),
    developmentHistory: [],
  }
}

/** Build an empty PhraseMaterial (used for the first phrase of a section). */
export function emptyPhraseMaterial(motifId: string, stepsPerBar: number): PhraseMaterial {
  return {
    motifId,
    pitchContour: [],
    intervalSequence: [],
    rhythmPattern: [],
    onsetPositions: [],
    accentPattern: [],
    noteDurations: [],
    registerProfile: 0,
    harmonicTargets: [],
    stepsPerBar,
    transformHistory: [],
    rhythmicCell: [],
    intervalCell: [],
    contour: 'flat',
    accentShape: { weights: [], climaxPosition: 0.5 },
    densityShape: [0.3],
    registerShape: [64],
    harmonicTargetShape: [],
    cadenceTarget: null,
    phraseArc: buildPhraseArc(1, 64, 0.3),
    developmentHistory: [],
  }
}

function cloneMaterial(src: PhraseMaterial, newId: string, op: string): PhraseMaterial {
  return {
    motifId: newId,
    pitchContour: src.pitchContour.slice(),
    intervalSequence: src.intervalSequence.slice(),
    rhythmPattern: src.rhythmPattern.slice(),
    onsetPositions: src.onsetPositions.slice(),
    accentPattern: src.accentPattern.slice(),
    noteDurations: src.noteDurations.slice(),
    registerProfile: src.registerProfile,
    harmonicTargets: src.harmonicTargets.slice(),
    stepsPerBar: src.stepsPerBar,
    transformHistory: [...src.transformHistory, op],
    rhythmicCell: src.rhythmicCell.slice(),
    intervalCell: src.intervalCell.slice(),
    contour: src.contour,
    accentShape: {
      weights: src.accentShape.weights.slice(),
      climaxPosition: src.accentShape.climaxPosition,
    },
    densityShape: src.densityShape.slice(),
    registerShape: src.registerShape.slice(),
    harmonicTargetShape: src.harmonicTargetShape.slice(),
    cadenceTarget: src.cadenceTarget,
    phraseArc: src.phraseArc,
    developmentHistory: src.developmentHistory.slice(),
  }
}

// ── F21 SHAPE DERIVATION HELPERS ──

/** Derive a repeating rhythmic cell from a rhythm pattern (find the shortest repeating unit). */
function deriveRhythmicCell(rhythmPattern: number[]): number[] {
  if (rhythmPattern.length === 0) return [0]
  if (rhythmPattern.length === 1) return [0]
  const offsets: number[] = []
  for (let i = 1; i < rhythmPattern.length; i++) {
    const cur = rhythmPattern[i] ?? 0
    const first = rhythmPattern[0] ?? 0
    offsets.push(cur - first)
  }
  // If the pattern is short enough, use it directly.
  if (rhythmPattern.length <= 4) return [0, ...offsets]
  // Otherwise look for a repeating cell of length 2-4.
  for (let cellLen = 2; cellLen <= 4; cellLen++) {
    if (rhythmPattern.length >= cellLen * 2) {
      const cell = rhythmPattern.slice(0, cellLen)
      let repeats = true
      for (let i = cellLen; i < rhythmPattern.length; i++) {
        if (rhythmPattern[i] !== cell[i % cellLen]) {
          repeats = false
          break
        }
      }
      if (repeats) {
        const cellOffsets = [0]
        for (let i = 1; i < cellLen; i++) {
          const cur = cell[i] ?? 0
          const first = cell[0] ?? 0
          cellOffsets.push(cur - first)
        }
        return cellOffsets
      }
    }
  }
  return [0, ...offsets]
}

/** Derive a repeating interval cell from an interval sequence. */
function deriveIntervalCell(intervals: number[]): number[] {
  if (intervals.length === 0) return [0]
  if (intervals.length <= 3) return intervals.slice()
  // Look for a repeating cell of length 2-3.
  for (let cellLen = 2; cellLen <= 3; cellLen++) {
    if (intervals.length >= cellLen * 2) {
      const cell = intervals.slice(0, cellLen)
      let repeats = true
      for (let i = cellLen; i < intervals.length; i++) {
        if (intervals[i] !== cell[i % cellLen]) {
          repeats = false
          break
        }
      }
      if (repeats) return cell.slice()
    }
  }
  // Fall back to the first 3 intervals.
  return intervals.slice(0, 3)
}

/** Classify a contour from an interval sequence. */
function classifyContour(intervals: number[]): ContourShape {
  if (intervals.length === 0) return 'flat'
  let up = 0
  let down = 0
  for (const iv of intervals) {
    if (iv > 0) up++
    else if (iv < 0) down++
  }
  if (up === intervals.length) return 'ascending'
  if (down === intervals.length) return 'descending'
  // Arch: rises then falls.
  const midpoint = Math.floor(intervals.length / 2)
  const firstHalfUp = intervals.slice(0, midpoint).filter((iv) => iv > 0).length
  const secondHalfDown = intervals.slice(midpoint).filter((iv) => iv < 0).length
  if (firstHalfUp >= midpoint * 0.6 && secondHalfDown >= (intervals.length - midpoint) * 0.6)
    return 'arch'
  // Valley: falls then rises.
  const firstHalfDown = intervals.slice(0, midpoint).filter((iv) => iv < 0).length
  const secondHalfUp = intervals.slice(midpoint).filter((iv) => iv > 0).length
  if (firstHalfDown >= midpoint * 0.6 && secondHalfUp >= (intervals.length - midpoint) * 0.6)
    return 'valley'
  // Wave: frequent direction changes.
  let changes = 0
  for (let i = 1; i < intervals.length; i++) {
    if (Math.sign(intervals[i] ?? 0) !== Math.sign(intervals[i - 1] ?? 0) && intervals[i] !== 0)
      changes++
  }
  if (changes >= intervals.length * 0.4) return 'wave'
  return 'flat'
}

/** Find the climax position (fraction 0..1) in an accent pattern. */
function findClimax(accents: number[]): number {
  if (accents.length === 0) return 0.5
  let maxIdx = 0
  let maxVal = -1
  for (let i = 0; i < accents.length; i++) {
    if (accents[i] ?? 0 > maxVal) {
      maxVal = accents[i] ?? 0
      maxIdx = i
    }
  }
  return accents.length > 1 ? maxIdx / (accents.length - 1) : 0.5
}

/**
 * Build a PhraseArc for a phrase of `bars` bars. The arc has 6 stages
 * (OPEN → ESTABLISH → DEVELOP → FOCAL → RELEASE → CADENCE) distributed across
 * the bars. The focal/climax point falls around 60-70% of the phrase.
 */
export function buildPhraseArc(
  bars: number,
  registerCenter: number,
  baseTension: number
): PhraseArc {
  const stages: PhraseArcStage[] = []
  const focalBar = Math.max(1, Math.floor(bars * 0.6))
  const cadenceBar = bars - 1
  // Distribute bars across stages proportionally.
  const fractions = [0.1, 0.2, 0.25, 0.15, 0.15, 0.15] // OPEN, ESTABLISH, DEVELOP, FOCAL, RELEASE, CADENCE
  const labels: PhraseArcStage['stage'][] = [
    'OPEN',
    'ESTABLISH',
    'DEVELOP',
    'FOCAL',
    'RELEASE',
    'CADENCE',
  ]
  let cursor = 0
  const tensionTrajectory: number[] = []
  for (let i = 0; i < 6; i++) {
    const len = Math.max(1, Math.round(bars * (fractions[i] ?? 0.15)))
    const start = Math.min(cursor, bars - 1)
    const end = Math.min(cursor + len, bars)
    const stageTension =
      i === 3
        ? Math.min(1, baseTension + 0.4)
        : i === 5
          ? baseTension * 0.2
          : baseTension + i * 0.05
    const stageDensity = i === 0 ? 0.3 : i === 5 ? 0.4 : Math.min(0.9, 0.4 + i * 0.1)
    const stageRegister =
      i === 3 ? registerCenter + 4 : i === 5 ? registerCenter - 2 : registerCenter + (i - 2) * 2
    const label = labels[i] ?? 'DEVELOP'
    stages.push({
      stage: label,
      barRange: [start, end],
      density: stageDensity,
      register: stageRegister,
      tension: Math.max(0, Math.min(1, stageTension)),
    })
    tensionTrajectory.push(Math.max(0, Math.min(1, stageTension)))
    cursor = end
    // Don't break early — always add all 6 stages. For short phrases, stages
    // may share the same bar range, but all labels are present.
  }
  // Ensure the last stage is always CADENCE (even for 1-bar phrases).
  if (stages.length > 0 && stages[stages.length - 1]?.stage !== 'CADENCE') {
    stages.push({
      stage: 'CADENCE',
      barRange: [Math.max(0, bars - 1), bars],
      density: 0.4,
      register: registerCenter - 2,
      tension: Math.max(0, Math.min(1, baseTension * 0.2)),
    })
    tensionTrajectory.push(Math.max(0, Math.min(1, baseTension * 0.2)))
  }
  return { stages, focalBar, cadenceBar, tensionTrajectory }
}

/** Get the arc stage active at a given bar index within the phrase. */
export function arcStageAt(arc: PhraseArc, bar: number): PhraseArcStage | null {
  for (const s of arc.stages) {
    if (bar >= s.barRange[0] && bar < s.barRange[1]) return s
  }
  return arc.stages[arc.stages.length - 1] ?? null
}

// ─────────────────────────── OPERATORS ───────────────────────────

/**
 * CONTINUE — return the material unchanged (lineage only).
 * The phrase reiterates the previous identity.
 */
export function continueMaterial(src: PhraseMaterial): PhraseMaterial {
  return cloneMaterial(src, `${src.motifId}:continue`, 'CONTINUE')
}

/**
 * DEVELOP — mutate the last interval so the contour evolves while keeping the
 * opening intact. Example: A B C D (intervals [x,y,z]) → A B D E where the
 * last step is displaced by one scale degree. Also nudges the second-to-last
 * note occasionally to keep the development from being a single-note change.
 *
 * This is real MOTIF DEVELOPMENT: the pitch contour changes, but the opening
 * shape is preserved so the result is recognizably the same motif.
 */
export function developMaterial(
  src: PhraseMaterial,
  ctx: MaterialTransformContext
): PhraseMaterial {
  const scale = ctx.scale ?? getScale(ctx.scaleName)
  if (src.pitchContour.length < 2 || !scale)
    return cloneMaterial(src, `${src.motifId}:develop`, 'DEVELOP')
  const pcs = scalePcs(ctx.tonic, scale)
  const out = cloneMaterial(src, `${src.motifId}:develop`, 'DEVELOP')
  const variation = ctx.variationAmount ?? 0.3

  // Mutate the last interval: shift the last note by one scale degree in the
  // direction of the existing contour (or up if flat).
  const lastIdx = src.pitchContour.length - 1
  const prevMidi = src.pitchContour[lastIdx - 1] ?? ctx.rootMidi
  const curMidi = src.pitchContour[lastIdx] ?? ctx.rootMidi
  const dir = curMidi >= prevMidi ? 1 : -1
  // Pick the next scale degree in `dir`.
  const curPc = ((curMidi % 12) + 12) % 12
  const curDegIdx = pcs.indexOf(curPc)
  const nextDegIdx = curDegIdx >= 0 ? (curDegIdx + dir + pcs.length) % pcs.length : 0
  const nextPc = pcs[nextDegIdx] ?? curPc
  // Construct the new midi: keep the octave of curMidi, change the pc, nudge by dir*12 if variation is high.
  let newMidi = curMidi - curPc + nextPc
  if (ctx.rng.next() < variation * 0.5) newMidi += dir * 12
  newMidi = snapToScale(newMidi, ctx.tonic, scale)
  out.pitchContour[lastIdx] = newMidi

  // Occasionally mutate the second-to-last note too (smaller displacement).
  if (src.pitchContour.length >= 3 && ctx.rng.next() < variation * 0.6) {
    const idx = src.pitchContour.length - 2
    const base = src.pitchContour[idx] ?? ctx.rootMidi
    const step = ctx.rng.pick([1, -1, 2, -2])
    out.pitchContour[idx] = snapToScale(base + step, ctx.tonic, scale)
  }

  out.intervalSequence = intervalsOf(out.pitchContour)
  out.registerProfile = mean(out.pitchContour)
  out.harmonicTargets = pcsOf(out.pitchContour)
  return out
}

/**
 * VARIATE — reorder notes (swap two adjacent positions) so the pitch sequence
 * shuffles while preserving the set of pitches and the rhythm. Example:
 * A B C D → A C B D. The contour changes but the material is the same set of
 * notes — a recognizable variant.
 */
export function variateMaterial(
  src: PhraseMaterial,
  ctx: MaterialTransformContext
): PhraseMaterial {
  if (src.pitchContour.length < 3) return cloneMaterial(src, `${src.motifId}:variate`, 'VARIATE')
  const out = cloneMaterial(src, `${src.motifId}:variate`, 'VARIATE')
  // Swap two adjacent notes (not the first — keep the opening stable).
  const i = 1 + Math.floor(ctx.rng.next() * (src.pitchContour.length - 2))
  const j = i + 1
  const tmp = out.pitchContour[i]
  out.pitchContour[i] = out.pitchContour[j] as number
  out.pitchContour[j] = tmp as number
  // Also swap the accent/duration so the rhythm+rhythm tags stay aligned to
  // the pitches (the rhythm PATTERN is preserved — only pitches reorder).
  const tmpV = out.accentPattern[i]
  out.accentPattern[i] = out.accentPattern[j] as number
  out.accentPattern[j] = tmpV as number
  const tmpD = out.noteDurations[i]
  out.noteDurations[i] = out.noteDurations[j] as number
  out.noteDurations[j] = tmpD as number
  out.intervalSequence = intervalsOf(out.pitchContour)
  out.registerProfile = mean(out.pitchContour)
  out.harmonicTargets = pcsOf(out.pitchContour)
  return out
}

/**
 * ANSWER — contour inversion (mirror intervals around the first note). The
 * rhythm is preserved; the pitch contour flips direction. A rising motif
 * becomes a falling one — the classic "answer" to a "call".
 */
export function answerMaterial(src: PhraseMaterial, ctx: MaterialTransformContext): PhraseMaterial {
  const scale = ctx.scale ?? getScale(ctx.scaleName)
  if (src.pitchContour.length < 2 || !scale)
    return cloneMaterial(src, `${src.motifId}:answer`, 'ANSWER')
  const out = cloneMaterial(src, `${src.motifId}:answer`, 'ANSWER')
  const first = src.pitchContour[0] ?? ctx.rootMidi
  for (let i = 1; i < src.pitchContour.length; i++) {
    const offset = (src.pitchContour[i] ?? first) - first
    out.pitchContour[i] = snapToScale(first - offset, ctx.tonic, scale)
  }
  out.intervalSequence = intervalsOf(out.pitchContour)
  out.registerProfile = mean(out.pitchContour)
  out.harmonicTargets = pcsOf(out.pitchContour)
  return out
}

/**
 * CONTRAST — introduce new material (new motifId) while staying in the same
 * scale. Generates a fresh short contour from scale degrees. The motifId is
 * NEW (lineage reset) because the material is intentionally different.
 */
export function contrastMaterial(
  src: PhraseMaterial,
  ctx: MaterialTransformContext
): PhraseMaterial {
  const scale = ctx.scale ?? getScale(ctx.scaleName)
  if (!scale) return cloneMaterial(src, `${src.motifId}:contrast`, 'CONTRAST')
  const pcs = scalePcs(ctx.tonic, scale)
  const len = Math.max(3, Math.min(6, src.pitchContour.length || 4))
  const pitchContour: number[] = []
  let cur = ctx.rootMidi
  for (let i = 0; i < len; i++) {
    const pc = ctx.rng.pick(pcs)
    const oct = 4 + (ctx.rng.next() < 0.3 ? 1 : 0)
    const candidate = degreeToMidi(
      ctx.tonic,
      scale,
      pcs.indexOf(pc) >= 0 ? pcs.indexOf(pc) : 0,
      oct
    )
    pitchContour.push(snapToScale(candidate, ctx.tonic, scale))
    cur = candidate
  }
  void cur
  const rhythmPattern: number[] = []
  const accentPattern: number[] = []
  const noteDurations: number[] = []
  let step = 0
  for (let i = 0; i < len; i++) {
    rhythmPattern.push(step % src.stepsPerBar)
    accentPattern.push(i === 0 ? 0.9 : 0.5 + ctx.rng.next() * 0.3)
    noteDurations.push(ctx.rng.pick([1, 1, 2]))
    step += ctx.rng.pick([1, 2, 2])
  }
  const intervals = intervalsOf(pitchContour)
  return {
    motifId: `${src.motifId}:contrast-${Date.now().toString(36)}`,
    pitchContour,
    intervalSequence: intervals,
    rhythmPattern,
    onsetPositions: rhythmPattern.slice(),
    accentPattern,
    noteDurations,
    registerProfile: mean(pitchContour),
    harmonicTargets: pcsOf(pitchContour),
    stepsPerBar: src.stepsPerBar,
    transformHistory: [...src.transformHistory, 'CONTRAST'],
    // F21 shape fields.
    rhythmicCell: deriveRhythmicCell(rhythmPattern),
    intervalCell: deriveIntervalCell(intervals),
    contour: classifyContour(intervals),
    accentShape: { weights: accentPattern.slice(), climaxPosition: findClimax(accentPattern) },
    densityShape: [Math.min(1, pitchContour.length / src.stepsPerBar)],
    registerShape: [mean(pitchContour)],
    harmonicTargetShape: pcsOf(pitchContour),
    cadenceTarget:
      pitchContour.length > 0
        ? ((pitchContour[pitchContour.length - 1] ?? 0 % 12) + 12) % 12
        : null,
    phraseArc: buildPhraseArc(1, mean(pitchContour), 0.3),
    developmentHistory: src.developmentHistory.slice(),
  }
}

/**
 * INTENSIFY — rhythmic augmentation: subdivide longer notes into shorter ones
 * so density rises. Pitches are preserved (a note may repeat). The contour is
 * unchanged but the rhythm becomes busier — the musical "intensification".
 */
export function intensifyMaterial(
  src: PhraseMaterial,
  ctx: MaterialTransformContext
): PhraseMaterial {
  if (src.pitchContour.length === 0)
    return cloneMaterial(src, `${src.motifId}:intensify`, 'INTENSIFY')
  const out = cloneMaterial(src, `${src.motifId}:intensify`, 'INTENSIFY')
  const newPitches: number[] = []
  const newRhythm: number[] = []
  const newAccent: number[] = []
  const newDurations: number[] = []
  for (let i = 0; i < src.pitchContour.length; i++) {
    const midi = src.pitchContour[i] as number
    const step = src.rhythmPattern[i] as number
    const dur = src.noteDurations[i] as number
    const vel = src.accentPattern[i] as number
    newPitches.push(midi)
    newRhythm.push(step)
    newAccent.push(vel)
    newDurations.push(Math.max(1, Math.floor(dur / 2)))
    // If the original note was long enough, add a repeated note (rhythmic subdivision).
    if (dur >= 2 && ctx.rng.next() < (ctx.variationAmount ?? 0.5) + 0.3) {
      const subStep = (step + Math.floor(dur / 2)) % src.stepsPerBar
      newPitches.push(midi)
      newRhythm.push(subStep)
      newAccent.push(vel * 0.7)
      newDurations.push(Math.max(1, dur - Math.floor(dur / 2)))
    }
  }
  out.pitchContour = newPitches
  out.rhythmPattern = newRhythm
  out.onsetPositions = newRhythm.slice()
  out.accentPattern = newAccent
  out.noteDurations = newDurations
  out.intervalSequence = intervalsOf(newPitches)
  out.registerProfile = mean(newPitches)
  out.harmonicTargets = pcsOf(newPitches)
  return out
}

/**
 * REDUCE — fragment: keep only the first half of the material. Creates space.
 * Example: A B C D → A B. The opening identity is preserved.
 */
export function reduceMaterial(src: PhraseMaterial): PhraseMaterial {
  if (src.pitchContour.length <= 1) return cloneMaterial(src, `${src.motifId}:reduce`, 'REDUCE')
  const keep = Math.max(1, Math.ceil(src.pitchContour.length / 2))
  const out = cloneMaterial(src, `${src.motifId}:reduce`, 'REDUCE')
  out.pitchContour = src.pitchContour.slice(0, keep)
  out.rhythmPattern = src.rhythmPattern.slice(0, keep)
  out.onsetPositions = src.onsetPositions.slice(0, keep)
  out.accentPattern = src.accentPattern.slice(0, keep)
  out.noteDurations = src.noteDurations.slice(0, keep)
  out.intervalSequence = intervalsOf(out.pitchContour)
  out.registerProfile = mean(out.pitchContour)
  out.harmonicTargets = pcsOf(out.pitchContour)
  return out
}

/**
 * BREAK — strip to a single sustained note (the first pitch). The most
 * extreme reduction — used at breakdown points.
 */
export function breakMaterial(src: PhraseMaterial): PhraseMaterial {
  if (src.pitchContour.length === 0) return cloneMaterial(src, `${src.motifId}:break`, 'BREAK')
  const out = cloneMaterial(src, `${src.motifId}:break`, 'BREAK')
  out.pitchContour = [src.pitchContour[0] as number]
  out.rhythmPattern = [0]
  out.onsetPositions = [0]
  out.accentPattern = [0.9]
  out.noteDurations = [src.stepsPerBar]
  out.intervalSequence = []
  out.registerProfile = out.pitchContour[0] as number
  out.harmonicTargets = pcsOf(out.pitchContour)
  return out
}

/**
 * RESOLVE — append a stepwise descent to the cadence target pitch class.
 * The motif's identity is preserved (opening notes unchanged) but a resolving
 * tail is added that lands on the cadence target (root/third/fifth). This is
 * the musical "resolution" at a phrase cadence.
 */
export function resolveMaterial(
  src: PhraseMaterial,
  ctx: MaterialTransformContext
): PhraseMaterial {
  const scale = ctx.scale ?? getScale(ctx.scaleName)
  if (!scale || src.pitchContour.length === 0)
    return cloneMaterial(src, `${src.motifId}:resolve`, 'RESOLVE')
  const pcs = scalePcs(ctx.tonic, scale)
  const targetPc = ctx.cadenceTargetPc ?? pcs[0] ?? ctx.tonic
  const out = cloneMaterial(src, `${src.motifId}:resolve`, 'RESOLVE')
  // Start the descent from the last pitch.
  let cur = src.pitchContour[src.pitchContour.length - 1] ?? ctx.rootMidi
  let step = ((src.rhythmPattern[src.rhythmPattern.length - 1] ?? 0) + 2) % src.stepsPerBar
  // Walk down by scale degrees until we land on the target pc.
  let guard = 0
  while (((cur % 12) + 12) % 12 !== targetPc && guard < 8) {
    const curPc = ((cur % 12) + 12) % 12
    const curDegIdx = pcs.indexOf(curPc)
    const nextDegIdx = curDegIdx >= 0 ? (curDegIdx - 1 + pcs.length) % pcs.length : 0
    const nextPc = pcs[nextDegIdx] ?? targetPc
    cur = cur - curPc + nextPc
    cur = snapToScale(cur, ctx.tonic, scale)
    out.pitchContour.push(cur)
    out.rhythmPattern.push(step)
    out.onsetPositions.push(step)
    out.accentPattern.push(0.7)
    out.noteDurations.push(1)
    step = (step + 1) % src.stepsPerBar
    guard++
  }
  // Final cadence note — emphasize.
  out.pitchContour.push(cur)
  out.rhythmPattern.push(step)
  out.onsetPositions.push(step)
  out.accentPattern.push(1.0)
  out.noteDurations.push(2)
  out.intervalSequence = intervalsOf(out.pitchContour)
  out.registerProfile = mean(out.pitchContour)
  out.harmonicTargets = pcsOf(out.pitchContour)
  return out
}

/**
 * TRANSITION — bridge: generate a short connecting motif that walks from the
 * last pitch of the source toward the root. Used at section boundaries.
 */
export function transitionMaterial(
  src: PhraseMaterial,
  ctx: MaterialTransformContext
): PhraseMaterial {
  const scale = ctx.scale ?? getScale(ctx.scaleName)
  if (!scale) return cloneMaterial(src, `${src.motifId}:transition`, 'TRANSITION')
  const pcs = scalePcs(ctx.tonic, scale)
  const out = cloneMaterial(src, `${src.motifId}:transition`, 'TRANSITION')
  let cur = src.pitchContour[src.pitchContour.length - 1] ?? ctx.rootMidi
  let step = ((src.rhythmPattern[src.rhythmPattern.length - 1] ?? 0) + 2) % src.stepsPerBar
  // Walk by scale degrees toward the root pc.
  const rootPc = pcs[0] ?? ctx.tonic
  let guard = 0
  while (((cur % 12) + 12) % 12 !== rootPc && guard < 6) {
    const curPc = ((cur % 12) + 12) % 12
    const curDegIdx = pcs.indexOf(curPc)
    const dir = curDegIdx > 0 ? -1 : 0
    const nextDegIdx = curDegIdx >= 0 ? (curDegIdx + dir + pcs.length) % pcs.length : 0
    const nextPc = pcs[nextDegIdx] ?? rootPc
    cur = cur - curPc + nextPc
    cur = snapToScale(cur, ctx.tonic, scale)
    out.pitchContour.push(cur)
    out.rhythmPattern.push(step)
    out.onsetPositions.push(step)
    out.accentPattern.push(0.6)
    out.noteDurations.push(1)
    step = (step + 1) % src.stepsPerBar
    guard++
  }
  out.intervalSequence = intervalsOf(out.pitchContour)
  out.registerProfile = mean(out.pitchContour)
  out.harmonicTargets = pcsOf(out.pitchContour)
  return out
}

/**
 * Dispatch a development operator against a PhraseMaterial. At minimum
 * DEVELOP / VARIATE / ANSWER / RESOLVE transform real note material; the
 * remaining operators also transform material (CONTINUE is identity).
 */
export function applyOperatorToMaterial(
  op: DevelopmentOperator,
  src: PhraseMaterial,
  ctx: MaterialTransformContext
): PhraseMaterial {
  switch (op) {
    case 'CONTINUE':
      return continueMaterial(src)
    case 'DEVELOP':
      return developMaterial(src, ctx)
    case 'ANSWER':
      return answerMaterial(src, ctx)
    case 'CONTRAST':
      return contrastMaterial(src, ctx)
    case 'VARIATE':
      return variateMaterial(src, ctx)
    case 'INTENSIFY':
      return intensifyMaterial(src, ctx)
    case 'REDUCE':
      return reduceMaterial(src)
    case 'BREAK':
      return breakMaterial(src)
    case 'RESOLVE':
      return resolveMaterial(src, ctx)
    case 'TRANSITION':
      return transitionMaterial(src, ctx)
    default:
      return continueMaterial(src)
  }
}

// ─────────────────────────── SIMILARITY ───────────────────────────

/**
 * Structural similarity in [0, 1] between two PhraseMaterials. Combines:
 *  - contour direction agreement (fraction of matching interval signs)
 *  - interval-class agreement (fraction of matching signed interval classes mod 12)
 *  - pitch-class set overlap (Jaccard of harmonicTargets)
 *
 * Returns 1 for identical materials, lower for divergent. Used by the A/B
 * test suite to prove a transformed phrase is still recognizably related to
 * its source (motif identity is preserved through development).
 */
export function materialSimilarity(a: PhraseMaterial, b: PhraseMaterial): number {
  if (a.pitchContour.length === 0 && b.pitchContour.length === 0) return 1
  if (a.pitchContour.length === 0 || b.pitchContour.length === 0) return 0

  // Contour direction agreement.
  const dirA = a.intervalSequence.map((iv) => (iv > 0 ? 1 : iv < 0 ? -1 : 0))
  const dirB = b.intervalSequence.map((iv) => (iv > 0 ? 1 : iv < 0 ? -1 : 0))
  const minLen = Math.min(dirA.length, dirB.length)
  let dirMatch = 0
  for (let i = 0; i < minLen; i++) {
    if (dirA[i] === dirB[i]) dirMatch++
  }
  const contourScore = minLen > 0 ? dirMatch / minLen : 0.5

  // Interval-class agreement (signed mod 12).
  const icA = a.intervalSequence.map((iv) => {
    const cls = ((iv % 12) + 12) % 12
    return iv < 0 ? -cls : cls
  })
  const icB = b.intervalSequence.map((iv) => {
    const cls = ((iv % 12) + 12) % 12
    return iv < 0 ? -cls : cls
  })
  const minIc = Math.min(icA.length, icB.length)
  let icMatch = 0
  for (let i = 0; i < minIc; i++) {
    if (icA[i] === icB[i]) icMatch++
  }
  const intervalScore = minIc > 0 ? icMatch / minIc : 0.5

  // Pitch-class set overlap (Jaccard).
  const setA = new Set(a.harmonicTargets)
  const setB = new Set(b.harmonicTargets)
  let inter = 0
  for (const pc of setA) if (setB.has(pc)) inter++
  const union = setA.size + setB.size - inter
  const pcScore = union > 0 ? inter / union : 1

  return 0.4 * contourScore + 0.35 * intervalScore + 0.25 * pcScore
}

/** True if `b` is recognizably derived from `a` (similarity above threshold). */
export function isMaterialRelated(a: PhraseMaterial, b: PhraseMaterial, threshold = 0.4): boolean {
  return materialSimilarity(a, b) >= threshold
}
