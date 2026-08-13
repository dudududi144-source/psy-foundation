/**
 * MusicalFailureDetector: detect known musical failure modes.
 *
 * Surfaces failures as a {@link MusicalFailureReport} with severity levels
 * (OK / WARNING / FAIL). Detection rules are calibrated against the PSY4
 * failure mode (stuck pitch, root-only bass, no cadence, etc.) and the
 * {@link MusicalityMetrics} / {@link CoherenceReport} produced elsewhere
 * in the substrate.
 */

import type { BassNote } from './bass-behavior.ts'
import type { CoherenceReport } from './coherence.ts'
import type { MusicalityMetrics } from './diversity.ts'

export type FailureLevel = 'OK' | 'WARNING' | 'FAIL'

export interface MusicalFailure {
  /** Failure type identifier (e.g. 'STUCK_PITCH'). */
  type: string
  level: FailureLevel
  /** Human-readable evidence string. */
  evidence: string
  /** Bars affected (if known). */
  bars?: number[]
}

export interface MusicalFailureReport {
  /** Worst level across all failures. */
  level: FailureLevel
  failures: MusicalFailure[]
  summary: string
}

export interface FailureDetectOptions {
  notes: { midi: number; step: number; bar: number }[]
  bassNotes?: BassNote[]
  metrics: MusicalityMetrics
  coherence?: CoherenceReport
  bars: number
  stepsPerBar: number
}

const PC_COUNT = 12

const LEVEL_RANK: Record<FailureLevel, number> = {
  OK: 0,
  WARNING: 1,
  FAIL: 2,
}

export class MusicalFailureDetector {
  /**
   * Detect failures across the inputs. Each rule produces zero or one
   * {@link MusicalFailure}; the worst level across all failures becomes
   * the report's overall `level`.
   */
  detect(opts: FailureDetectOptions): MusicalFailureReport {
    const { notes, bassNotes, metrics, coherence, bars, stepsPerBar } = opts
    const failures: MusicalFailure[] = []
    // ----- STUCK_PITCH -----
    const stuck = this.detectStuckPitch(notes, bars)
    if (stuck) failures.push(stuck)
    // ----- ROOT_ONLY_BASS -----
    if (bassNotes) {
      const rootOnly = this.detectRootOnlyBass(bassNotes)
      if (rootOnly) failures.push(rootOnly)
    }
    // ----- NO_CADENCE -----
    if (coherence) {
      const noCadence = this.detectNoCadence(coherence)
      if (noCadence) failures.push(noCadence)
    }
    // ----- EXCESSIVE_REPETITION -----
    if (metrics.exactRepeatRatio > 0.6) {
      failures.push({
        type: 'EXCESSIVE_REPETITION',
        level: 'WARNING',
        evidence: `exactRepeatRatio=${metrics.exactRepeatRatio.toFixed(2)} (>0.60)`,
      })
    }
    // ----- NO_VARIATION -----
    if (metrics.motifReuseRatio > 0.8 && metrics.transformationRatio < 0.1) {
      failures.push({
        type: 'NO_VARIATION',
        level: 'FAIL',
        evidence: `motifReuseRatio=${metrics.motifReuseRatio.toFixed(2)} (>0.80) AND transformationRatio=${metrics.transformationRatio.toFixed(2)} (<0.10)`,
      })
    }
    // ----- EXCESSIVE_VARIATION -----
    if (coherence && coherence.structural.callbackRate === 0) {
      failures.push({
        type: 'EXCESSIVE_VARIATION',
        level: 'WARNING',
        evidence: 'callbackRate=0 (no motif returns across the section)',
      })
    }
    // ----- HARMONIC_CONFLICT -----
    if (coherence && coherence.harmonic.illegalMoves > 5) {
      failures.push({
        type: 'HARMONIC_CONFLICT',
        level: 'WARNING',
        evidence: `illegalMoves=${coherence.harmonic.illegalMoves} (>5)`,
      })
    }
    // ----- REGISTER_JUMP -----
    const jump = this.detectRegisterJump(notes, bars, stepsPerBar)
    if (jump) failures.push(jump)
    // ----- RHYTHM_COLLAPSE -----
    if (metrics.rhythmicDiversity < 0.1) {
      failures.push({
        type: 'RHYTHM_COLLAPSE',
        level: 'FAIL',
        evidence: `rhythmicDiversity=${metrics.rhythmicDiversity.toFixed(2)} (<0.10)`,
      })
    }
    // ----- STRUCTURAL_FLATNESS -----
    if (metrics.structuralEvolution < 0.05) {
      failures.push({
        type: 'STRUCTURAL_FLATNESS',
        level: 'WARNING',
        evidence: `structuralEvolution=${metrics.structuralEvolution.toFixed(2)} (<0.05)`,
      })
    }
    const level = this.worstLevel(failures)
    const summary = this.summarise(failures, level)
    return { level, failures, summary }
  }

  // ---------------- rule implementations ----------------

  /** STUCK_PITCH: same pitch class for >4 consecutive bars → FAIL. */
  private detectStuckPitch(
    notes: { midi: number; step: number; bar: number }[],
    bars: number
  ): MusicalFailure | null {
    if (bars <= 4) return null
    // Per-bar: collect the modal pitch class.
    const barModalPc = new Map<number, number>()
    for (let bar = 0; bar < bars; bar++) {
      const counts = new Map<number, number>()
      for (const n of notes) {
        if (n.bar !== bar) continue
        const pc = ((n.midi % PC_COUNT) + PC_COUNT) % PC_COUNT
        counts.set(pc, (counts.get(pc) ?? 0) + 1)
      }
      let bestPc = -1
      let bestCount = 0
      for (const [pc, c] of counts) {
        if (c > bestCount) {
          bestCount = c
          bestPc = pc
        }
      }
      if (bestPc >= 0) barModalPc.set(bar, bestPc)
    }
    // Find longest run of consecutive bars sharing the same modal pc.
    let longestRun = 0
    let runStart = -1
    let curPc = -1
    let curStart = -1
    let curLen = 0
    for (let bar = 0; bar < bars; bar++) {
      const pc = barModalPc.get(bar) ?? -1
      if (pc === curPc && pc !== -1) {
        curLen++
      } else {
        curPc = pc
        curStart = bar
        curLen = 1
      }
      if (curLen > longestRun) {
        longestRun = curLen
        runStart = curStart
      }
    }
    if (longestRun > 4) {
      const affectedBars: number[] = []
      for (let i = 0; i < longestRun; i++) affectedBars.push((runStart ?? 0) + i)
      return {
        type: 'STUCK_PITCH',
        level: 'FAIL',
        evidence: `modal pitch class repeats for ${longestRun} consecutive bars (pc=${curPc})`,
        bars: affectedBars,
      }
    }
    return null
  }

  /** ROOT_ONLY_BASS: bass only uses the root pitch class → FAIL. */
  private detectRootOnlyBass(bassNotes: BassNote[]): MusicalFailure | null {
    if (bassNotes.length === 0) return null
    const pcs = new Set<number>()
    for (const n of bassNotes) {
      pcs.add(((n.midi % PC_COUNT) + PC_COUNT) % PC_COUNT)
    }
    if (pcs.size <= 1) {
      return {
        type: 'ROOT_ONLY_BASS',
        level: 'FAIL',
        evidence: `bass uses only ${pcs.size} pitch class(es) (root-only)`,
      }
    }
    return null
  }

  /** NO_CADENCE: phrase doesn't resolve (cadenceStrength < 0.3) → WARNING. */
  private detectNoCadence(coherence: CoherenceReport): MusicalFailure | null {
    if (coherence.phrase.cadenceStrength < 0.3) {
      return {
        type: 'NO_CADENCE',
        level: 'WARNING',
        evidence: `cadenceStrength=${coherence.phrase.cadenceStrength.toFixed(2)} (<0.30)`,
      }
    }
    return null
  }

  /** REGISTER_JUMP: register changes >2 octaves between consecutive bars → WARNING. */
  private detectRegisterJump(
    notes: { midi: number; step: number; bar: number }[],
    bars: number,
    stepsPerBar: number
  ): MusicalFailure | null {
    void stepsPerBar
    const barCenter = new Map<number, number>()
    for (let bar = 0; bar < bars; bar++) {
      const barNotes = notes.filter((n) => n.bar === bar)
      if (barNotes.length === 0) continue
      const avg = barNotes.reduce((a, b) => a + b.midi, 0) / barNotes.length
      barCenter.set(bar, avg)
    }
    const sortedBars = Array.from(barCenter.keys()).sort((a, b) => a - b)
    for (let i = 1; i < sortedBars.length; i++) {
      const prev = barCenter.get(sortedBars[i - 1] ?? 0) ?? 0
      const cur = barCenter.get(sortedBars[i] ?? 0) ?? 0
      if (Math.abs(cur - prev) > 24) {
        // 24 semitones = 2 octaves
        return {
          type: 'REGISTER_JUMP',
          level: 'WARNING',
          evidence: `register jump of ${Math.abs(cur - prev).toFixed(1)} semitones between bars ${sortedBars[i - 1]} and ${sortedBars[i]}`,
          bars: [sortedBars[i - 1] ?? 0, sortedBars[i] ?? 0],
        }
      }
    }
    return null
  }

  // ---------------- helpers ----------------

  private worstLevel(failures: MusicalFailure[]): FailureLevel {
    let worst: FailureLevel = 'OK'
    for (const f of failures) {
      if (LEVEL_RANK[f.level] > LEVEL_RANK[worst]) worst = f.level
    }
    return worst
  }

  private summarise(failures: MusicalFailure[], level: FailureLevel): string {
    if (failures.length === 0) return 'OK — no failures detected'
    const failCount = failures.filter((f) => f.level === 'FAIL').length
    const warnCount = failures.filter((f) => f.level === 'WARNING').length
    const parts: string[] = []
    if (failCount > 0) parts.push(`${failCount} FAIL`)
    if (warnCount > 0) parts.push(`${warnCount} WARNING`)
    return `${level} — ${parts.join(', ')} (${failures.length} total)`
  }
}
