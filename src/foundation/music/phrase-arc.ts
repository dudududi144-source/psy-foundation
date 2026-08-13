/**
 * PhraseArc: the dramatic shape of a phrase.
 *
 * A phrase should move through four stages:
 *   START          — establish the material (low density, low tension)
 *   DEVELOPMENT    — push the material forward (rising density / tension)
 *   DESTINATION    — arrive at the peak (highest tension, full density)
 *   CADENCE        — resolve (low tension, low density, stable tones)
 *
 * `buildPhraseArc` constructs an arc for a given bar count and seed;
 * `evaluatePhraseArc` measures how well a realised note sequence actually
 * follows the arc.
 */

import type { MusicalContext } from './musical-context.ts'
import { Rng } from './rng.ts'
import { getScale, scalePcs, stableDegrees } from './scales.ts'

export type PhraseArcStage = 'START' | 'DEVELOPMENT' | 'DESTINATION' | 'CADENCE'

export interface PhraseArcStagePoint {
  barIndex: number
  stage: PhraseArcStage
  tension: number
  density: number
}

export interface PhraseArc {
  stages: PhraseArcStagePoint[]
  peakBar: number
  resolutionBar: number
  openingTension: number
  peakTension: number
  resolutionTension: number
}

export interface BuildPhraseArcOptions {
  bars: number
  seed: number
  context: MusicalContext
}

/** Smoothstep easing in [0, 1]. */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/**
 * Build a phrase arc over `bars` bars. The arc divides the bars into:
 *   - START         — first 1/4 of the phrase (low tension / density)
 *   - DEVELOPMENT   — second quarter (rising)
 *   - DESTINATION   — third quarter (peak)
 *   - CADENCE       — final quarter (resolving)
 *
 * The peak bar sits near the start of the DESTINATION stage; the resolution
 * bar is the final bar. A small jitter from the seed makes different phrases
 * of the same shape land on slightly different bars.
 */
export function buildPhraseArc(opts: BuildPhraseArcOptions): PhraseArc {
  const { bars, seed, context } = opts
  const rng = new Rng(seed)
  if (bars <= 0) {
    return {
      stages: [],
      peakBar: 0,
      resolutionBar: 0,
      openingTension: 0,
      peakTension: 0,
      resolutionTension: 0,
    }
  }
  const stages: PhraseArcStagePoint[] = []
  // Section boundaries (with small seed-driven jitter for natural variation).
  const startEnd = Math.max(1, Math.round(bars * 0.25 + rng.range(-0.5, 0.5)))
  const devEnd = Math.max(startEnd + 1, Math.round(bars * 0.5 + rng.range(-0.5, 0.5)))
  const destEnd = Math.max(devEnd + 1, Math.round(bars * 0.75 + rng.range(-0.5, 0.5)))
  let peakBar = Math.max(startEnd, Math.min(bars - 1, Math.round((devEnd + destEnd) / 2)))
  const resolutionBar = Math.max(0, bars - 1)
  if (peakBar >= resolutionBar) peakBar = Math.max(0, resolutionBar - 1)

  const openingTension = Math.max(0.05, context.tension * 0.4)
  const peakTension = Math.min(1, Math.max(0.6, context.tension + 0.4))
  const resolutionTension = Math.max(0, context.tension * 0.2)

  for (let bar = 0; bar < bars; bar++) {
    let stage: PhraseArcStage
    let tension: number
    let density: number
    if (bar < startEnd) {
      stage = 'START'
      const t = startEnd > 1 ? bar / (startEnd - 1) : 0
      tension = openingTension + 0.1 * smoothstep(t)
      density = 0.3 + 0.15 * smoothstep(t)
    } else if (bar < devEnd) {
      stage = 'DEVELOPMENT'
      const span = Math.max(1, devEnd - startEnd)
      const t = (bar - startEnd) / span
      tension = openingTension + (peakTension - openingTension) * smoothstep(t)
      density = 0.45 + 0.35 * smoothstep(t)
    } else if (bar < destEnd) {
      stage = 'DESTINATION'
      const span = Math.max(1, destEnd - devEnd)
      const t = (bar - devEnd) / span
      // Peak at the middle of DESTINATION, then slightly decay.
      tension = peakTension - 0.05 * Math.abs(t - 0.5) * 2
      density = 0.8 + 0.1 * (1 - Math.abs(t - 0.5) * 2)
    } else {
      stage = 'CADENCE'
      const span = Math.max(1, bars - destEnd)
      const t = (bar - destEnd) / span
      tension = peakTension - (peakTension - resolutionTension) * smoothstep(t)
      density = 0.6 - 0.3 * smoothstep(t)
    }
    stages.push({ barIndex: bar, stage, tension, density })
  }

  return {
    stages,
    peakBar,
    resolutionBar,
    openingTension,
    peakTension,
    resolutionTension,
  }
}

export interface PhraseArcEvaluation {
  /** 0..1 — does the phrase broadly follow the arc shape? */
  coherence: number
  /** 0..1 — does the final bar resolve (low tension / stable tones)? */
  cadenceStrength: number
  /** 0..1 — does the phrase develop (tension rises then falls)? */
  development: number
}

const PC_COUNT = 12

/** Evaluate how well a realised note sequence follows a {@link PhraseArc}. */
export function evaluatePhraseArc(
  arc: PhraseArc,
  notes: { step: number; bar: number; midi: number }[]
): PhraseArcEvaluation {
  if (arc.stages.length === 0 || notes.length === 0) {
    return { coherence: 0, cadenceStrength: 0, development: 0 }
  }
  const bars = arc.stages.length
  // Per-bar measured density and tension proxy.
  const densityByBar = new Array<number>(bars).fill(0)
  const registerByBar = new Array<number>(bars).fill(0)
  const countsByBar = new Array<number>(bars).fill(0)
  for (const n of notes) {
    if (n.bar < 0 || n.bar >= bars) continue
    countsByBar[n.bar]++
    registerByBar[n.bar] += n.midi
  }
  for (let bar = 0; bar < bars; bar++) {
    const c = countsByBar[bar] ?? 0
    densityByBar[bar] = c > 0 ? Math.min(1, c / 8) : 0
    registerByBar[bar] = c > 0 ? registerByBar[bar] / c : 0
  }
  // Coherence: correlation between measured density and arc density.
  let coherence = pearsonCorrelation(
    densityByBar,
    arc.stages.map((s) => s.density)
  )
  coherence = Math.max(0, Math.min(1, 0.5 + 0.5 * coherence))
  // Development: how much does the tension proxy rise then fall?
  // Tension proxy: register height + density.
  const tensionProxy = arc.stages.map((_s, i) => {
    const reg = registerByBar[i] ?? 0
    const den = densityByBar[i] ?? 0
    return den + reg / 128
  })
  const peakIdx = argMax(tensionProxy)
  const before = tensionProxy.slice(0, peakIdx)
  const after = tensionProxy.slice(peakIdx + 1)
  const risingEnergy = before.length > 0 ? Math.max(0, before[before.length - 1] - before[0]) : 0
  const fallingEnergy = after.length > 0 ? Math.max(0, after[0] - after[after.length - 1]) : 0
  const totalRange = Math.max(...tensionProxy) - Math.min(...tensionProxy)
  const development =
    totalRange > 0 ? Math.max(0, Math.min(1, (risingEnergy + fallingEnergy) / (2 * totalRange))) : 0
  // Cadence strength: does the final bar sit on stable tones with low density?
  const finalBarNotes = notes.filter((n) => n.bar === arc.resolutionBar)
  const finalScale = arc.stages[arc.stages.length - 1]
  void finalScale
  let stableHits = 0
  for (const n of finalBarNotes) {
    const pc = ((n.midi % PC_COUNT) + PC_COUNT) % PC_COUNT
    // We don't have the scale here; approximate stability by rootPc = first note pc.
    if (finalBarNotes.length > 0) {
      const firstPc = ((finalBarNotes[0].midi % PC_COUNT) + PC_COUNT) % PC_COUNT
      const dist = Math.min((pc - firstPc + 12) % 12, (firstPc - pc + 12) % 12)
      if (dist <= 2 || dist === 7) stableHits++
    }
  }
  const cadenceStrength = finalBarNotes.length > 0 ? stableHits / finalBarNotes.length : 0
  return { coherence, cadenceStrength, development }
}

/** Pearson correlation coefficient in [-1, 1]. Returns 0 for degenerate input. */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    sa += a[i] ?? 0
    sb += b[i] ?? 0
  }
  const ma = sa / n
  const mb = sb / n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - ma
    const db = (b[i] ?? 0) - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  if (va === 0 || vb === 0) return 0
  return cov / Math.sqrt(va * vb)
}

/** Index of the maximum value in an array (ties broken by first occurrence). */
function argMax(arr: number[]): number {
  if (arr.length === 0) return 0
  let best = 0
  for (let i = 1; i < arr.length; i++) {
    if ((arr[i] ?? 0) > (arr[best] ?? 0)) best = i
  }
  return best
}

/** Helper: extract the scale's stable pitch classes for a context. */
export function arcStablePcs(context: MusicalContext): number[] {
  const scale = getScale(context.scaleName)
  if (!scale) return [context.tonic % PC_COUNT]
  const pcs = scalePcs(context.tonic, scale)
  const degrees = stableDegrees(scale)
  const out: number[] = []
  for (const d of degrees) {
    const pc = pcs[d % pcs.length]
    if (pc !== undefined) out.push(pc)
  }
  return out
}
