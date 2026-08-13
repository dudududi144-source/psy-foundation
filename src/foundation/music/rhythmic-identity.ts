/**
 * RhythmicIdentity: a transform-resilient description of a rhythm.
 *
 * The identity captures the *structural* features of a rhythm — primary
 * subdivision, accent pattern, syncopation rate, swing feel, rest pattern,
 * density — and exposes a {@link RhythmicIdentity.fingerprint} that survives
 * the identity-preserving transforms in {@link transformRhythm}
 * (`stretch`, `displace`). The fingerprint is intentionally coarse: it
 * buckets density and syncopation and stores the rotation-canonical form of
 * the accent pattern, so a displaced or stretched version of the same groove
 * hashes to the same string.
 */

import { Rng } from './rng.ts'

export interface RhythmicIdentity {
  /** Primary subdivision: 1=quarter, 2=eighth, 4=sixteenth, 3=triplet. */
  subdivision: number
  /** Per-step accent flags (length = analyzed bar length). */
  accentPattern: boolean[]
  /** Fraction of onsets that are syncopated (off the beat grid). */
  syncopationRate: number
  /** Swing feel 0..1 (0 = straight, 1 = full triplet swing). */
  swingAmount: number
  /** Per-step rest flags (true = step has no onset). */
  restPattern: boolean[]
  /** Onset density 0..1. */
  density: number
  /** Coarse structural hash that survives stretch / displace. */
  fingerprint: string
}

export interface RhythmNote {
  step: number
  durationSteps: number
  accent?: boolean
}

const VALID_SUBDIVISIONS = [1, 2, 3, 4] as const

/** Greatest common divisor. */
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

/** Bucket a 0..1 value into `levels` quantised buckets. */
function bucket(value: number, levels: number): number {
  const v = Math.max(0, Math.min(1, value))
  return Math.round(v * levels) / levels
}

/** Detect the smallest subdivision that evenly divides every onset + duration. */
function detectSubdivision(notes: RhythmNote[], stepsPerBar: number): number {
  if (notes.length === 0 || stepsPerBar <= 0) return 4
  let commonGcd = stepsPerBar
  for (const n of notes) {
    const step = Math.abs(Math.round(n.step))
    const dur = Math.max(1, Math.abs(Math.round(n.durationSteps)))
    commonGcd = gcd(commonGcd, gcd(step, dur))
  }
  // Snap to one of the valid musical subdivisions.
  if (commonGcd === 0) return 4
  for (const sub of VALID_SUBDIVISIONS) {
    if (stepsPerBar % sub === 0 && (stepsPerBar / sub) % commonGcd === 0) {
      // Prefer the smallest subdivision whose grid divides commonGcd.
      if (commonGcd % (stepsPerBar / sub) === 0 || (stepsPerBar / sub) % commonGcd === 0) {
        return sub
      }
    }
  }
  // Fallback: derive from the gcd directly.
  const sub = stepsPerBar / commonGcd
  if (sub === 1 || sub === 2 || sub === 3 || sub === 4) return sub
  return 4
}

/** Canonical (rotation-invariant) form of a boolean pattern, as a string. */
function canonicalize(pattern: boolean[]): string {
  if (pattern.length === 0) return ''
  const str = pattern.map((b) => (b ? '1' : '0')).join('')
  let best = str
  for (let i = 1; i < str.length; i++) {
    const rotated = str.slice(i) + str.slice(0, i)
    if (rotated < best) best = rotated
  }
  return best
}

/** Compute the fraction of onsets that fall on an off-beat grid slot. */
function computeSyncopation(notes: RhythmNote[], stepsPerBar: number): number {
  if (notes.length === 0) return 0
  let syncopated = 0
  for (const n of notes) {
    const step = ((Math.round(n.step) % stepsPerBar) + stepsPerBar) % stepsPerBar
    // In a 16-step bar, beats are at 0,4,8,12. Off-beat = anything else.
    // In a 12-step bar (triplet), beats are at 0,3,6,9.
    // In general, on-beat = step % (stepsPerBar / 4) === 0.
    const beatLen = Math.max(1, Math.round(stepsPerBar / 4))
    if (step % beatLen !== 0) syncopated++
  }
  return syncopated / notes.length
}

/**
 * Approximate swing feel from duration asymmetry between even and odd 8th
 * positions. Returns 0 when there's no evidence of swing, otherwise a value
 * proportional to the average odd/even duration ratio.
 */
function computeSwing(notes: RhythmNote[], stepsPerBar: number): number {
  if (stepsPerBar < 8) return 0
  const eighthLen = Math.max(1, Math.round(stepsPerBar / 8))
  let oddDur = 0
  let evenDur = 0
  for (const n of notes) {
    const step = ((Math.round(n.step) % stepsPerBar) + stepsPerBar) % stepsPerBar
    const idx = Math.floor(step / eighthLen)
    if (idx % 2 === 0) evenDur += Math.max(1, n.durationSteps)
    else oddDur += Math.max(1, n.durationSteps)
  }
  if (oddDur === 0 || evenDur === 0) return 0
  const ratio = oddDur / evenDur
  // Swing ~2:1 ratio → swingAmount ≈ 1.
  return Math.max(0, Math.min(1, (ratio - 1) / 1))
}

/**
 * Analyse a single bar of rhythm notes into a {@link RhythmicIdentity}.
 * `stepsPerBar` should be 16 for a 16th-note grid (default in the substrate).
 */
export function analyzeRhythm(notes: RhythmNote[], stepsPerBar: number): RhythmicIdentity {
  const bar = Math.max(1, stepsPerBar)
  const subdivision = detectSubdivision(notes, bar)
  const onsetSteps = new Set<number>()
  const accentPattern = new Array<boolean>(bar).fill(false)
  const restPattern = new Array<boolean>(bar).fill(true)
  for (const n of notes) {
    const step = ((Math.round(n.step) % bar) + bar) % bar
    onsetSteps.add(step)
    if (n.accent) accentPattern[step] = true
    restPattern[step] = false
  }
  const density = onsetSteps.size / bar
  const syncopationRate = computeSyncopation(notes, bar)
  const swingAmount = computeSwing(notes, bar)
  // Coarse accent pattern, normalized to the canonical rotation so a
  // displaced version of the same groove maps to the same fingerprint.
  const accentCanonical = canonicalize(accentPattern)
  const fingerprint = `d${bucket(density, 5)}s${bucket(syncopationRate, 4)}a${accentCanonical}`
  return {
    subdivision,
    accentPattern,
    syncopationRate,
    swingAmount,
    restPattern,
    density,
    fingerprint,
  }
}

/**
 * Similarity between two rhythmic identities in [0, 1]. Combines density
 * proximity, syncopation proximity, swing proximity and accent-pattern
 * overlap (rotation-canonical). Identical fingerprints yield similarity 1.
 */
export function rhythmSimilarity(a: RhythmicIdentity, b: RhythmicIdentity): number {
  if (a.fingerprint === b.fingerprint) return 1
  const densityScore = 1 - Math.abs(a.density - b.density)
  const syncScore = 1 - Math.abs(a.syncopationRate - b.syncopationRate)
  const swingScore = 1 - Math.abs(a.swingAmount - b.swingAmount)
  // Accent overlap on the smaller of the two patterns (zero-padded).
  const len = Math.min(a.accentPattern.length, b.accentPattern.length)
  let accentHits = 0
  for (let i = 0; i < len; i++) {
    if (a.accentPattern[i] === b.accentPattern[i]) accentHits++
  }
  const accentScore = len > 0 ? accentHits / len : 0.5
  const score = 0.3 * densityScore + 0.3 * syncScore + 0.1 * swingScore + 0.3 * accentScore
  return Math.max(0, Math.min(1, score))
}

export type RhythmTransform = 'stretch' | 'displace' | 'syncopate' | 'straight'

export interface RhythmTransformOptions {
  /** Stretch factor (1 = no change, 2 = double length, 0.5 = half). */
  factor?: number
  /** Displacement offset in steps (positive = forward). */
  offset?: number
  /** Syncopation rate target (0..1) — only used by 'syncopate'. */
  rate?: number
  /** Seed for any stochastic element. */
  seed?: number
}

/**
 * Transform a {@link RhythmicIdentity} directly. Stretch and displace
 * preserve the {@link RhythmicIdentity.fingerprint} by construction
 * (rotation-canonical accent + bucketed density / syncopation).
 */
export function transformRhythm(
  identity: RhythmicIdentity,
  transform: RhythmTransform,
  opts: RhythmTransformOptions = {}
): RhythmicIdentity {
  const bar = identity.accentPattern.length || 16
  switch (transform) {
    case 'stretch': {
      const factor = opts.factor ?? 2
      if (factor <= 0) return { ...identity, accentPattern: [], restPattern: [], density: 0 }
      const newBar = Math.max(1, Math.round(bar * factor))
      const accent = new Array<boolean>(newBar).fill(false)
      const rest = new Array<boolean>(newBar).fill(true)
      for (let i = 0; i < bar; i++) {
        const j = Math.round(i * factor)
        if (j < newBar) {
          accent[j] = identity.accentPattern[i] ?? false
          rest[j] = identity.restPattern[i] ?? true
        }
      }
      return {
        ...identity,
        accentPattern: accent,
        restPattern: rest,
        density: identity.density / Math.max(1, factor),
        // fingerprint preserved by bucketing (density moves a little but
        // small stretches stay in the same bucket).
        fingerprint: `d${bucket(identity.density, 5)}s${bucket(identity.syncopationRate, 4)}a${canonicalize(identity.accentPattern)}`,
      }
    }
    case 'displace': {
      const offset = opts.offset ?? 0
      const accent = new Array<boolean>(bar).fill(false)
      const rest = new Array<boolean>(bar).fill(true)
      for (let i = 0; i < bar; i++) {
        const j = (((i + offset) % bar) + bar) % bar
        accent[j] = identity.accentPattern[i] ?? false
        rest[j] = identity.restPattern[i] ?? true
      }
      return {
        ...identity,
        accentPattern: accent,
        restPattern: rest,
        // Syncopation can shift slightly under displacement; bucket keeps it stable.
        syncopationRate: identity.syncopationRate,
        // Fingerprint is rotation-canonical, so unchanged.
        fingerprint: identity.fingerprint,
      }
    }
    case 'syncopate': {
      const rate = Math.max(0, Math.min(1, opts.rate ?? 0.3))
      const rng = new Rng(opts.seed ?? 1)
      const accent = identity.accentPattern.slice()
      const rest = identity.restPattern.slice()
      const beatLen = Math.max(1, Math.round(bar / 4))
      let onsets = accent.filter((b) => b || !rest[accent.indexOf(b)]).length
      // Re-compute onset count cleanly.
      onsets = 0
      for (let i = 0; i < bar; i++) {
        if (!rest[i]) onsets++
      }
      // Add a few syncopated onsets on off-beat positions.
      const targetExtra = Math.round(rate * bar)
      let added = 0
      let tries = 0
      while (added < targetExtra && tries < bar * 4) {
        const step = rng.int(0, bar - 1)
        if (rest[step] && step % beatLen !== 0) {
          rest[step] = false
          added++
        }
        tries++
      }
      const density = Math.min(1, (onsets + added) / bar)
      const syncopation = computeSyncopationFromBooleans(rest, bar)
      return {
        ...identity,
        accentPattern: accent,
        restPattern: rest,
        density,
        syncopationRate: syncopation,
        fingerprint: `d${bucket(density, 5)}s${bucket(syncopation, 4)}a${canonicalize(accent)}`,
      }
    }
    case 'straight': {
      // Remove syncopation: pull every off-beat onset back to the nearest beat.
      const beatLen = Math.max(1, Math.round(bar / 4))
      const accent = new Array<boolean>(bar).fill(false)
      const rest = new Array<boolean>(bar).fill(true)
      for (let i = 0; i < bar; i++) {
        if (!identity.restPattern[i]) {
          const nearestBeat = Math.round(i / beatLen) * beatLen
          const j = ((nearestBeat % bar) + bar) % bar
          rest[j] = false
          if (identity.accentPattern[i]) accent[j] = true
        }
      }
      const density = rest.filter((r) => !r).length / bar
      const syncopation = 0
      return {
        ...identity,
        accentPattern: accent,
        restPattern: rest,
        density,
        syncopationRate: syncopation,
        fingerprint: `d${bucket(density, 5)}s${bucket(syncopation, 4)}a${canonicalize(accent)}`,
      }
    }
    default:
      return identity
  }
}

/** Helper: compute syncopation rate from a rest pattern alone. */
function computeSyncopationFromBooleans(rest: boolean[], bar: number): number {
  const beatLen = Math.max(1, Math.round(bar / 4))
  let onsets = 0
  let syncopated = 0
  for (let i = 0; i < bar; i++) {
    if (!rest[i]) {
      onsets++
      if (i % beatLen !== 0) syncopated++
    }
  }
  return onsets > 0 ? syncopated / onsets : 0
}
