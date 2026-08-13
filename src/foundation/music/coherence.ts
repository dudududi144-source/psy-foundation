/**
 * Coherence metrics across five musical dimensions.
 *
 * The metrics are intentionally lightweight (no DSP, no learning): they
 * answer "does this music hang together?" from structural features that
 * can be computed from a flat list of notes plus a {@link MusicalContext}.
 *
 * Each metric is normalised into [0, 1] where 1 = maximally coherent and
 * 0 = maximally incoherent. {@link coherenceReport} combines all five
 * categories into an overall score.
 */

import { HarmonicClassifier } from './harmonic-classifier.ts'
import { type Motif, motifSimilarity } from './motif-v2.ts'
import type { MusicalContext } from './musical-context.ts'
import type { PhrasePlan } from './phrase-planner.ts'
import { type Scale, getScale, scalePcs, stableDegrees } from './scales.ts'
import type { SectionPlan } from './section-planner.ts'

// ---------------- interfaces ----------------

export interface MotifCoherenceMetrics {
  /** 0..1 — how similar interval sequences are within a motif set. */
  intervalSimilarity: number
  /** 0..1 — contour direction consistency across motifs. */
  contourSimilarity: number
  /** 0..1 — rhythm / accent pattern consistency across motifs. */
  rhythmSimilarity: number
  /** 0..1 — pitch classes form a coherent set (shared tonal center). */
  pitchClassRelationship: number
  /** 0..1 — transformed motifs retain their source's identity. */
  transformedMotifSimilarity: number
}

export interface PhraseCoherenceMetrics {
  /** 0..1 — does the phrase open and close on related material? */
  openingClosingRelationship: number
  /** 0..1 — motifs return within the phrase. */
  motifRecurrence: number
  /** 0..1 — transformations of motifs appear. */
  motifTransformation: number
  /** 0..1 — phrase ending resolves. */
  cadenceStrength: number
  /** 0..1 — bars connect smoothly. */
  phraseContinuity: number
}

export interface HarmonicCoherenceMetrics {
  /** 0..1 — fraction of notes that are chord tones (or stable scale tones). */
  chordToneRatio: number
  /** 0..1 — fraction of tension notes. */
  tensionNoteRatio: number
  /** 0..1 — tension notes that resolve by step to a stable tone. */
  resolutionRatio: number
  /** 0..1 — how stable the tonal center is (in-scale ratio). */
  tonalStability: number
  /** Count of harmonically weak moves (large out-of-scale leaps). */
  illegalMoves: number
}

export interface RhythmicCoherenceMetrics {
  /** 0..1 — subdivision pattern is consistent across bars. */
  subdivisionConsistency: number
  /** 0..1 — syncopation pattern is consistent across bars. */
  syncopationConsistency: number
  /** 0..1 — accents form a stable pattern across bars. */
  accentContinuity: number
  /** 0..1 — phrase endings are rhythmically clear. */
  phraseEndingRhythm: number
  /** 0..1 — groove (density) is stable across bars. */
  grooveStability: number
}

export interface StructuralCoherenceMetrics {
  /** 0..1 — sections are distinct (different density / energy profile). */
  sectionContrast: number
  /** 0..1 — each section has internal identity (low within-section variance). */
  sectionIdentity: number
  /** 0..1 — earlier material returns later. */
  callbackRate: number
  /** 0..1 — repetitions are well-spaced (not bunched). */
  repetitionSpacing: number
  /** 0..1 — how far material develops from the section's origin. */
  developmentDistance: number
}

export interface CoherenceReport {
  motif: MotifCoherenceMetrics
  phrase: PhraseCoherenceMetrics
  harmonic: HarmonicCoherenceMetrics
  rhythmic: RhythmicCoherenceMetrics
  structural: StructuralCoherenceMetrics
  /** 0..1 weighted average of all five categories. */
  overall: number
}

const PC_COUNT = 12

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length
  return Math.sqrt(v)
}

// ---------------- motif coherence ----------------

/**
 * Measure motif coherence across a set of motifs. A single-motif set is
 * trivially coherent (all metrics return 1).
 */
export function measureMotifCoherence(motifs: Motif[]): MotifCoherenceMetrics {
  if (motifs.length === 0) {
    return zeroMotif()
  }
  if (motifs.length === 1) {
    return {
      intervalSimilarity: 1,
      contourSimilarity: 1,
      rhythmSimilarity: 1,
      pitchClassRelationship: 1,
      transformedMotifSimilarity: 1,
    }
  }
  const pairwiseSim: number[] = []
  const contourAgreements: number[] = []
  const accentAgreements: number[] = []
  const pcJaccards: number[] = []
  for (let i = 0; i < motifs.length; i++) {
    for (let j = i + 1; j < motifs.length; j++) {
      const a = motifs[i] as Motif
      const b = motifs[j] as Motif
      pairwiseSim.push(motifSimilarity(a, b))
      contourAgreements.push(contourAgreement(a.contour, b.contour))
      accentAgreements.push(accentAgreement(a.accentPattern, b.accentPattern))
      pcJaccards.push(pcJaccard(a.pitchClasses, b.pitchClasses))
    }
  }
  // transformedMotifSimilarity: average similarity between transformed motifs
  // and their sources (when the source is present in the set).
  const idToMotif = new Map<string, Motif>(motifs.map((m) => [m.id, m]))
  const transformedSims: number[] = []
  for (const m of motifs) {
    if (m.sourceMotifId && idToMotif.has(m.sourceMotifId)) {
      const source = idToMotif.get(m.sourceMotifId)
      if (source) transformedSims.push(motifSimilarity(source, m))
    }
  }
  return {
    intervalSimilarity: clamp01(mean(pairwiseSim)),
    contourSimilarity: clamp01(mean(contourAgreements)),
    rhythmSimilarity: clamp01(mean(accentAgreements)),
    pitchClassRelationship: clamp01(mean(pcJaccards)),
    transformedMotifSimilarity: transformedSims.length > 0 ? clamp01(mean(transformedSims)) : 1,
  }
}

function contourAgreement(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0.5
  const len = Math.min(a.length, b.length)
  let hits = 0
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) hits++
  }
  return hits / len
}

function accentAgreement(a: boolean[], b: boolean[]): number {
  if (a.length === 0 || b.length === 0) return 0.5
  const len = Math.min(a.length, b.length)
  let hits = 0
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) hits++
  }
  return hits / len
}

function pcJaccard(a: number[], b: number[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const x of setA) if (setB.has(x)) inter++
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : inter / union
}

function zeroMotif(): MotifCoherenceMetrics {
  return {
    intervalSimilarity: 0,
    contourSimilarity: 0,
    rhythmSimilarity: 0,
    pitchClassRelationship: 0,
    transformedMotifSimilarity: 0,
  }
}

// ---------------- phrase coherence ----------------

/**
 * Measure phrase coherence from a {@link PhrasePlan} and the motifs the
 * plan references (looked up by id via the plan's slots).
 */
export function measurePhraseCoherence(
  phrase: PhrasePlan,
  motifs: Motif[]
): PhraseCoherenceMetrics {
  if (phrase.slots.length === 0) {
    return zeroPhrase()
  }
  const motifById = new Map<string, Motif>(motifs.map((m) => [m.id, m]))
  const slots = phrase.slots
  // openingClosingRelationship: similarity between first and last bar's motif.
  const firstMotif = slots[0]?.motifId ? motifById.get(slots[0].motifId) : undefined
  const lastMotif = slots[slots.length - 1]?.motifId
    ? motifById.get(slots[slots.length - 1].motifId ?? '')
    : undefined
  const openingClosing =
    firstMotif && lastMotif
      ? motifSimilarity(firstMotif, lastMotif)
      : firstMotif || lastMotif
        ? 0.5
        : 0
  // motifRecurrence: fraction of bars whose motifId appeared in an earlier bar.
  const seen = new Set<string>()
  let recurring = 0
  for (const slot of slots) {
    if (!slot.motifId) continue
    if (seen.has(slot.motifId)) recurring++
    else seen.add(slot.motifId)
  }
  const motifRecurrence = slots.length > 0 ? recurring / slots.length : 0
  // motifTransformation: fraction of bars with a non-trivial transform.
  const transformed = slots.filter(
    (s) => s.transformId && s.transformId !== 'none' && s.transformId !== ''
  ).length
  const motifTransformation = slots.length > 0 ? transformed / slots.length : 0
  // cadenceStrength: does the final bar's motif end on a stable tone?
  const lastSlot = slots[slots.length - 1]
  let cadenceStrength = 0.5
  if (lastSlot?.motifId) {
    const lastM = motifById.get(lastSlot.motifId)
    if (lastM && lastM.notes.length > 0) {
      const lastNote = lastM.notes[lastM.notes.length - 1]
      const scale = getScale(lastM.scaleName)
      if (scale && lastNote) {
        const stablePcs = new Set(stablePcsFor(lastM.rootPc, scale))
        const pc = ((lastNote.midi % PC_COUNT) + PC_COUNT) % PC_COUNT
        cadenceStrength = stablePcs.has(pc) ? 1 : 0.4
      }
    }
  }
  // phraseContinuity: average similarity between consecutive bars' motifs.
  const continuities: number[] = []
  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1]?.motifId ? motifById.get(slots[i - 1].motifId ?? '') : undefined
    const cur = slots[i]?.motifId ? motifById.get(slots[i].motifId ?? '') : undefined
    if (prev && cur) continuities.push(motifSimilarity(prev, cur))
  }
  const phraseContinuity = continuities.length > 0 ? clamp01(mean(continuities)) : 0.5
  return {
    openingClosingRelationship: clamp01(openingClosing),
    motifRecurrence: clamp01(motifRecurrence),
    motifTransformation: clamp01(motifTransformation),
    cadenceStrength: clamp01(cadenceStrength),
    phraseContinuity,
  }
}

function zeroPhrase(): PhraseCoherenceMetrics {
  return {
    openingClosingRelationship: 0,
    motifRecurrence: 0,
    motifTransformation: 0,
    cadenceStrength: 0,
    phraseContinuity: 0,
  }
}

function stablePcsFor(tonic: number, scale: Scale): number[] {
  const pcs = scalePcs(tonic, scale)
  const degrees = stableDegrees(scale)
  const out: number[] = []
  for (const d of degrees) {
    const pc = pcs[d % pcs.length]
    if (pc !== undefined) out.push(pc)
  }
  if (!out.includes(tonic % PC_COUNT)) out.push(tonic % PC_COUNT)
  return out
}

// ---------------- harmonic coherence ----------------

/**
 * Measure harmonic coherence from a flat list of notes and a
 * {@link MusicalContext}. Uses {@link HarmonicClassifier} for note
 * classification.
 */
export function measureHarmonicCoherence(
  notes: { midi: number }[],
  context: MusicalContext
): HarmonicCoherenceMetrics {
  if (notes.length === 0) {
    return {
      chordToneRatio: 0,
      tensionNoteRatio: 0,
      resolutionRatio: 0,
      tonalStability: 0,
      illegalMoves: 0,
    }
  }
  const classifier = new HarmonicClassifier({
    tonic: context.tonic,
    scaleName: context.scaleName,
    chord: context.harmonicContext,
  })
  const analyses = classifier.classifySequence(notes.map((n) => n.midi))
  let chordTones = 0
  let tensionNotes = 0
  let inScale = 0
  let resolvedTensions = 0
  let illegalMoves = 0
  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i]
    if (!a) continue
    if (a.isChordTone || a.isStable) chordTones++
    if (a.isTension || a.function === 'PASSING_TONE') tensionNotes++
    if (a.isScaleTone || a.isStable) inScale++
    // Resolutions: count a tension note whose `resolvesTo` is set.
    if ((a.isTension || a.function === 'PASSING_TONE') && a.resolvesTo !== undefined) {
      resolvedTensions++
    }
    // Illegal moves: a leap (> 7 semitones) to an out-of-scale note.
    if (i > 0) {
      const prev = analyses[i - 1]
      if (prev) {
        const leap = Math.abs(a.note - prev.note)
        if (leap > 7 && !a.isScaleTone) illegalMoves++
      }
    }
  }
  const total = notes.length
  const chordToneRatio = chordTones / total
  const tensionNoteRatio = tensionNotes / total
  const resolutionRatio = tensionNotes > 0 ? resolvedTensions / tensionNotes : 1
  const tonalStability = inScale / total
  return {
    chordToneRatio: clamp01(chordToneRatio),
    tensionNoteRatio: clamp01(tensionNoteRatio),
    resolutionRatio: clamp01(resolutionRatio),
    tonalStability: clamp01(tonalStability),
    illegalMoves,
  }
}

// ---------------- rhythmic coherence ----------------

/**
 * Measure rhythmic coherence from a list of notes with step / duration
 * information. Notes are grouped by bar (using `stepsPerBar`) and per-bar
 * rhythmic features are computed; coherence is then the consistency of
 * those features across bars.
 */
export function measureRhythmicCoherence(
  notes: { step: number; durationSteps: number }[],
  stepsPerBar: number
): RhythmicCoherenceMetrics {
  if (notes.length === 0 || stepsPerBar <= 0) {
    return zeroRhythmic()
  }
  // Group by bar (assumes notes' step values are absolute or within-bar; we
  // treat them as within-bar and bucket the first bar only when no `bar`
  // field is available. Callers wanting multi-bar analysis should pass
  // notes whose `step` is the absolute step across the whole piece.)
  const bars = bucketByBar(notes, stepsPerBar)
  if (bars.length === 0) return zeroRhythmic()
  // Per-bar features.
  const subdivisions: number[] = []
  const syncopations: number[] = []
  const accentSets: Set<number>[] = []
  const densities: number[] = []
  const beatLen = Math.max(1, Math.round(stepsPerBar / 4))
  for (const barNotes of bars) {
    subdivisions.push(detectSubdiv(barNotes, stepsPerBar))
    let syncopated = 0
    const accents = new Set<number>()
    let onsets = 0
    for (const n of barNotes) {
      const step = ((Math.round(n.step) % stepsPerBar) + stepsPerBar) % stepsPerBar
      onsets++
      if (step % beatLen !== 0) syncopated++
      // We don't have accent info here; approximate via velocity heuristic.
      // Treat the first onset in each beat as "accented".
      const beat = Math.floor(step / beatLen)
      if (step % beatLen === 0) accents.add(beat)
    }
    syncopations.push(onsets > 0 ? syncopated / onsets : 0)
    accentSets.push(accents)
    densities.push(onsets / stepsPerBar)
  }
  // subdivisionConsistency: fraction of bars whose subdivision matches the modal.
  const subMode = mode(subdivisions)
  const subdivisionConsistency =
    subdivisions.length > 0
      ? subdivisions.filter((s) => s === subMode).length / subdivisions.length
      : 1
  // syncopationConsistency: 1 - normalised standard deviation.
  const syncStd = stdDev(syncopations)
  const syncopationConsistency = clamp01(1 - syncStd * 2)
  // accentContinuity: average Jaccard of consecutive bars' accent sets.
  const accentJaccards: number[] = []
  for (let i = 1; i < accentSets.length; i++) {
    accentJaccards.push(setJaccard(accentSets[i - 1], accentSets[i]))
  }
  const accentContinuity = accentJaccards.length > 0 ? clamp01(mean(accentJaccards)) : 1
  // phraseEndingRhythm: how distinct the last bar's density is from the
  // average — a clear ending usually has lower density.
  const avgDensity = mean(densities)
  const lastDensity = densities[densities.length - 1] ?? avgDensity
  const endingDrop = Math.max(0, avgDensity - lastDensity)
  const phraseEndingRhythm = clamp01(0.5 + endingDrop)
  // grooveStability: 1 - normalised density stddev.
  const grooveStability = clamp01(1 - stdDev(densities) * 2)
  return {
    subdivisionConsistency,
    syncopationConsistency,
    accentContinuity,
    phraseEndingRhythm,
    grooveStability,
  }
}

function zeroRhythmic(): RhythmicCoherenceMetrics {
  return {
    subdivisionConsistency: 0,
    syncopationConsistency: 0,
    accentContinuity: 0,
    phraseEndingRhythm: 0,
    grooveStability: 0,
  }
}

function bucketByBar(
  notes: { step: number; durationSteps: number }[],
  stepsPerBar: number
): { step: number; durationSteps: number }[][] {
  const bars = new Map<number, { step: number; durationSteps: number }[]>()
  for (const n of notes) {
    const bar = Math.floor(n.step / stepsPerBar)
    if (!bars.has(bar)) bars.set(bar, [])
    bars.get(bar)?.push(n)
  }
  return Array.from(bars.values()).sort((a, b) => {
    // Preserve insertion order by minimum step.
    const aMin = a.length > 0 ? Math.min(...a.map((x) => x.step)) : 0
    const bMin = b.length > 0 ? Math.min(...b.map((x) => x.step)) : 0
    return aMin - bMin
  })
}

function detectSubdiv(
  barNotes: { step: number; durationSteps: number }[],
  stepsPerBar: number
): number {
  if (barNotes.length === 0) return 4
  let commonGcd = stepsPerBar
  for (const n of barNotes) {
    const s = Math.abs(Math.round(n.step))
    const d = Math.max(1, Math.abs(Math.round(n.durationSteps)))
    commonGcd = gcd(commonGcd, gcd(s, d))
  }
  const sub = stepsPerBar / Math.max(1, commonGcd)
  if (sub === 1 || sub === 2 || sub === 3 || sub === 4) return sub
  return 4
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function mode(arr: number[]): number {
  if (arr.length === 0) return 0
  const counts = new Map<number, number>()
  for (const x of arr) counts.set(x, (counts.get(x) ?? 0) + 1)
  let best = arr[0] ?? 0
  let bestCount = 0
  for (const [k, c] of counts) {
    if (c > bestCount) {
      bestCount = c
      best = k
    }
  }
  return best
}

function setJaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// ---------------- structural coherence ----------------

/**
 * Measure structural coherence from a {@link SectionPlan} and the phrase
 * plans it embeds. Captures section contrast / identity, callback rate,
 * repetition spacing and development distance.
 */
export function measureStructuralCoherence(
  sectionPlan: SectionPlan,
  phrasePlans: PhrasePlan[]
): StructuralCoherenceMetrics {
  const slots = sectionPlan.slots
  if (slots.length === 0) {
    return zeroStructural()
  }
  // Split section into halves (by bar count) to measure contrast / identity.
  const half = Math.floor(slots.length / 2)
  const firstHalf = slots.slice(0, half)
  const secondHalf = slots.slice(half)
  const firstDens = mean(firstHalf.map((s) => s.density))
  const secondDens = mean(secondHalf.map((s) => s.density))
  const firstEnergy = mean(firstHalf.map((s) => s.energy))
  const secondEnergy = mean(secondHalf.map((s) => s.energy))
  const firstNovelty = mean(firstHalf.map((s) => s.novelty))
  const secondNovelty = mean(secondHalf.map((s) => s.novelty))
  const contrastDens = clamp01(Math.abs(firstDens - secondDens) * 2)
  const contrastEnergy = clamp01(Math.abs(firstEnergy - secondEnergy) * 2)
  const contrastNovelty = clamp01(Math.abs(firstNovelty - secondNovelty) * 2)
  const sectionContrast = clamp01((contrastDens + contrastEnergy + contrastNovelty) / 3)
  // sectionIdentity: low variance within each half → high identity.
  const firstVar =
    (stdDev(firstHalf.map((s) => s.density)) + stdDev(firstHalf.map((s) => s.energy))) / 2
  const secondVar =
    (stdDev(secondHalf.map((s) => s.density)) + stdDev(secondHalf.map((s) => s.energy))) / 2
  const sectionIdentity = clamp01(1 - (firstVar + secondVar))
  // callbackRate: fraction of phrases whose motifs include at least one id
  // that appeared in an earlier phrase.
  const seenMotifIds = new Set<string>()
  let callbacks = 0
  for (const plan of phrasePlans) {
    let hasCallback = false
    for (const slot of plan.slots) {
      if (!slot.motifId) continue
      if (seenMotifIds.has(slot.motifId)) hasCallback = true
      seenMotifIds.add(slot.motifId)
    }
    if (hasCallback) callbacks++
  }
  const callbackRate = phrasePlans.length > 0 ? callbacks / phrasePlans.length : 0
  // repetitionSpacing: how well-spaced are occurrences of the same motif id.
  const occurrences = new Map<string, number[]>()
  for (const plan of phrasePlans) {
    for (const slot of plan.slots) {
      if (!slot.motifId) continue
      if (!occurrences.has(slot.motifId)) occurrences.set(slot.motifId, [])
      occurrences.get(slot.motifId)?.push(slot.barIndex)
    }
  }
  const spacingScores: number[] = []
  for (const idxs of occurrences.values()) {
    if (idxs.length < 2) continue
    const gaps: number[] = []
    for (let i = 1; i < idxs.length; i++) {
      gaps.push(idxs[i] - idxs[i - 1])
    }
    // Well-spaced = consistent gaps (low coefficient of variation).
    const m = mean(gaps)
    const sd = stdDev(gaps)
    const cv = m > 0 ? sd / m : 1
    spacingScores.push(clamp01(1 - cv))
  }
  const repetitionSpacing = spacingScores.length > 0 ? clamp01(mean(spacingScores)) : 1
  // developmentDistance: how much pitch-class material changes from the
  // first phrase to the last phrase (set distance).
  if (phrasePlans.length < 2) {
    return {
      sectionContrast,
      sectionIdentity,
      callbackRate,
      repetitionSpacing,
      developmentDistance: 0,
    }
  }
  const firstPlan = phrasePlans[0]
  const lastPlan = phrasePlans[phrasePlans.length - 1]
  const firstPcs = phrasePcs(firstPlan)
  const lastPcs = phrasePcs(lastPlan)
  const union = new Set<number>([...firstPcs, ...lastPcs])
  let diff = 0
  for (const pc of union) {
    if (firstPcs.has(pc) !== lastPcs.has(pc)) diff++
  }
  const developmentDistance = union.size > 0 ? clamp01(diff / union.size) : 0
  return {
    sectionContrast,
    sectionIdentity,
    callbackRate,
    repetitionSpacing,
    developmentDistance,
  }
}

function phrasePcs(plan: PhrasePlan): Set<number> {
  // We don't have motif bodies here; we approximate using the transform id
  // sequence (different transform sequences ⇒ different development). For a
  // true PC distance we'd need the motifs themselves; callers wanting that
  // precision should compute it separately. Here we synthesise a "pc set"
  // from the bar indices that have motifIds — i.e. material identity rather
  // than pitch content. The metric is still meaningful: it captures how much
  // the *material set* changes from the first to the last phrase.
  const out = new Set<number>()
  for (const slot of plan.slots) {
    if (slot.motifId) {
      // Hash the motif id into a 0..11 bin.
      let h = 0
      for (let i = 0; i < slot.motifId.length; i++) {
        h = (h * 31 + slot.motifId.charCodeAt(i)) >>> 0
      }
      out.add(h % PC_COUNT)
    }
  }
  return out
}

function zeroStructural(): StructuralCoherenceMetrics {
  return {
    sectionContrast: 0,
    sectionIdentity: 0,
    callbackRate: 0,
    repetitionSpacing: 0,
    developmentDistance: 0,
  }
}

// ---------------- combined report ----------------

export interface CoherenceReportOptions {
  motifs: Motif[]
  phrase: PhrasePlan
  section: SectionPlan
  notes: { midi: number; step: number; durationSteps?: number }[]
  context: MusicalContext
  /** Optional phrase plans across the whole section (for structural metrics). */
  phrasePlans?: PhrasePlan[]
}

/**
 * Build a {@link CoherenceReport} from the inputs. The overall score is a
 * weighted average of the five categories' internal averages.
 */
export function coherenceReport(opts: CoherenceReportOptions): CoherenceReport {
  const { motifs, phrase, section, notes, context } = opts
  const motifM = measureMotifCoherence(motifs)
  const phraseM = measurePhraseCoherence(phrase, motifs)
  // Harmonic metrics use the flat note list.
  const harmonicM = measureHarmonicCoherence(
    notes.map((n) => ({ midi: n.midi })),
    context
  )
  // Rhythmic metrics use step + duration.
  const rhythmicM = measureRhythmicCoherence(
    notes.map((n) => ({ step: n.step, durationSteps: n.durationSteps ?? 2 })),
    context.beatsPerBar * 4 // assume 16 steps per bar for a 4/4 context
  )
  // Structural metrics use the section + phrase plans.
  const phrasePlans = opts.phrasePlans ?? collectPhrasePlans(section)
  const structuralM = measureStructuralCoherence(section, phrasePlans)
  // Per-category averages (each metric already in [0,1] except harmonic.illegalMoves).
  const motifAvg = avg([
    motifM.intervalSimilarity,
    motifM.contourSimilarity,
    motifM.rhythmSimilarity,
    motifM.pitchClassRelationship,
    motifM.transformedMotifSimilarity,
  ])
  const phraseAvg = avg([
    phraseM.openingClosingRelationship,
    phraseM.motifRecurrence,
    phraseM.motifTransformation,
    phraseM.cadenceStrength,
    phraseM.phraseContinuity,
  ])
  const harmonicAvg = avg([
    harmonicM.chordToneRatio,
    1 - harmonicM.tensionNoteRatio,
    harmonicM.resolutionRatio,
    harmonicM.tonalStability,
    clamp01(1 - harmonicM.illegalMoves / 20),
  ])
  const rhythmicAvg = avg([
    rhythmicM.subdivisionConsistency,
    rhythmicM.syncopationConsistency,
    rhythmicM.accentContinuity,
    rhythmicM.phraseEndingRhythm,
    rhythmicM.grooveStability,
  ])
  const structuralAvg = avg([
    structuralM.sectionContrast,
    structuralM.sectionIdentity,
    structuralM.callbackRate,
    structuralM.repetitionSpacing,
    structuralM.developmentDistance,
  ])
  const overall = clamp01(
    0.18 * motifAvg +
      0.22 * phraseAvg +
      0.22 * harmonicAvg +
      0.18 * rhythmicAvg +
      0.2 * structuralAvg
  )
  return {
    motif: motifM,
    phrase: phraseM,
    harmonic: harmonicM,
    rhythmic: rhythmicM,
    structural: structuralM,
    overall,
  }
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

/** Extract phrase plans from a section plan's slots. */
function collectPhrasePlans(section: SectionPlan): PhrasePlan[] {
  const out: PhrasePlan[] = []
  for (const slot of section.slots) {
    if (slot.phrasePlan) out.push(slot.phrasePlan)
  }
  return out
}
