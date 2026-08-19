/**
 * EnhancedMusicalFailureDetector: inter-part failure detection.
 *
 * The original {@link MusicalFailureDetector} looks at single-part metrics
 * (stuck pitch, root-only bass, etc.). This enhanced detector adds
 * CROSS-PART failures: KICK_MISSING, BASS_UNCOUPLED, LEAD_REGISTER_ESCAPE,
 * PARTS_NOT_INTERLOCKED, etc. These are the failures the P5 architecture
 * diagnosis identified — they only become visible when you look at how
 * the parts relate to each other, not at any single part in isolation.
 *
 * The detector takes the rendered notes for every part plus the
 * {@link ArrangementPlan} and {@link GroovePlan}, so it can check rules
 * like "kick absent in a DROP section" or "bass doesn't align with kick
 * on beat 1".
 */

import type { ArrangementPlan, ArrangementState } from './arrangement-state.ts'
import type { GroovePlan } from './groove-plan.ts'

export type MusicalFailureType =
  | 'KICK_MISSING'
  | 'KICK_DROPOUT'
  | 'BASS_UNCOUPLED'
  | 'BASS_ROOT_SPAM'
  | 'LEAD_REGISTER_ESCAPE'
  | 'LEAD_HIGH_NOTE_SPAM'
  | 'LEAD_NO_IDENTITY'
  | 'LEAD_TOO_DENSE'
  | 'LEAD_TOO_SPARSE'
  | 'RANDOM_WALK_MELODY'
  | 'HARMONY_IGNORED'
  | 'STYLE_COLLAPSE'
  | 'SECTION_COLLAPSE'
  | 'ARRANGEMENT_COLLAPSE'
  | 'GROOVE_COLLAPSE'
  | 'EXCESSIVE_VARIATION'
  | 'ZERO_VARIATION'
  | 'NO_CADENCE'
  | 'NO_SPACE'
  | 'PARTS_NOT_INTERLOCKED'

export type FailureLevel = 'OK' | 'WARNING' | 'FAIL'

export interface EnhancedMusicalFailure {
  type: MusicalFailureType
  level: FailureLevel
  evidence: string
  bars?: number[]
}

export interface EnhancedFailureReport {
  level: FailureLevel
  failures: EnhancedMusicalFailure[]
  summary: string
}

export interface EnhancedFailureDetectOptions {
  kickNotes: { step: number; bar: number }[]
  bassNotes: { midi: number; step: number; bar: number; function: string }[]
  leadNotes: { midi: number; step: number; bar: number; velocity: number }[]
  hatNotes: { step: number; bar: number }[]
  arrangement: ArrangementPlan
  groove: GroovePlan
  bars: number
  stepsPerBar: number
}

const LEVEL_RANK: Record<FailureLevel, number> = {
  OK: 0,
  WARNING: 1,
  FAIL: 2,
}

const PC_COUNT = 12

function pcOf(midi: number): number {
  return ((midi % PC_COUNT) + PC_COUNT) % PC_COUNT
}

/**
 * Detect cross-part and inter-part musical failures. Each rule produces
 * zero or one {@link EnhancedMusicalFailure}; the worst level across all
 * failures becomes the report's overall `level`.
 */
export function detectMusicalFailures(opts: EnhancedFailureDetectOptions): EnhancedFailureReport {
  const { kickNotes, bassNotes, leadNotes, hatNotes, arrangement, groove, bars, stepsPerBar } = opts
  void hatNotes // reserved for future rules
  void stepsPerBar // reserved for future rules

  const failures: EnhancedMusicalFailure[] = []

  // Index notes per bar for quick lookup.
  const kickByBar = new Map<number, Set<number>>()
  const bassByBar = new Map<number, { step: number; midi: number; function: string }[]>()
  const leadByBar = new Map<number, { step: number; midi: number; velocity: number }[]>()
  for (let bar = 0; bar < bars; bar++) {
    kickByBar.set(bar, new Set())
    bassByBar.set(bar, [])
    leadByBar.set(bar, [])
  }
  for (const k of kickNotes) {
    const set = kickByBar.get(k.bar)
    if (set) set.add(k.step)
  }
  for (const b of bassNotes) {
    const arr = bassByBar.get(b.bar)
    if (arr) arr.push({ step: b.step, midi: b.midi, function: b.function })
  }
  for (const l of leadNotes) {
    const arr = leadByBar.get(l.bar)
    if (arr) arr.push({ step: l.step, midi: l.midi, velocity: l.velocity })
  }

  // ----- KICK_MISSING: kick absent in a DROP or GROOVE section → FAIL -----
  {
    const affected: number[] = []
    for (const slot of arrangement.slots) {
      const state: ArrangementState = slot.state
      if (state !== 'DROP' && state !== 'GROOVE' && state !== 'PEAK') continue
      const set = kickByBar.get(slot.barIndex)
      if (!set || set.size === 0) affected.push(slot.barIndex)
    }
    if (affected.length > 0) {
      failures.push({
        type: 'KICK_MISSING',
        level: 'FAIL',
        evidence: `kick absent in ${affected.length} DROP/GROOVE/PEAK bar(s): ${affected.slice(0, 8).join(',')}${affected.length > 8 ? '…' : ''}`,
        bars: affected,
      })
    }
  }

  // ----- KICK_DROPOUT: kick missing for >2 consecutive bars in active section → WARNING -----
  {
    let runStart = -1
    let runLen = 0
    const affected: number[] = []
    for (let bar = 0; bar < bars; bar++) {
      const slot = arrangement.slots.find((s) => s.barIndex === bar)
      const kickActive = slot?.roles.kick ?? false
      const set = kickByBar.get(bar)
      const hasKick = set !== undefined && set.size > 0
      if (kickActive && !hasKick) {
        if (runStart < 0) runStart = bar
        runLen++
      } else {
        if (runLen > 2) {
          for (let i = runStart; i < bar; i++) affected.push(i)
        }
        runStart = -1
        runLen = 0
      }
    }
    if (runLen > 2) {
      for (let i = runStart; i < bars; i++) affected.push(i as number)
    }
    if (affected.length > 0) {
      failures.push({
        type: 'KICK_DROPOUT',
        level: 'WARNING',
        evidence: `kick missing for >2 consecutive active bars: ${affected.slice(0, 8).join(',')}${affected.length > 8 ? '…' : ''}`,
        bars: affected,
      })
    }
  }

  // ----- BASS_UNCOUPLED: bass doesn't align with kick on beat 1 >50% of bars → FAIL -----
  {
    let alignedBars = 0
    let barsWithBass = 0
    const affected: number[] = []
    for (let bar = 0; bar < bars; bar++) {
      const bassInBar = bassByBar.get(bar) ?? []
      if (bassInBar.length === 0) continue
      barsWithBass++
      const bassOnBeat1 = bassInBar.some((b) => b.step === 0)
      const kickSet = kickByBar.get(bar)
      const kickOnBeat1 = kickSet?.has(0) ?? false
      // If kick is OFF this bar, we don't count it (no kick to align with).
      if (!kickOnBeat1) continue
      if (bassOnBeat1) alignedBars++
      else affected.push(bar)
    }
    const totalActiveBars = barsWithBass > 0 ? barsWithBass : 1
    const ratio = alignedBars / totalActiveBars
    if (ratio < 0.5 && affected.length > 0) {
      failures.push({
        type: 'BASS_UNCOUPLED',
        level: 'FAIL',
        evidence: `bass aligns with kick on beat 1 in only ${(ratio * 100).toFixed(1)}% of bars (${alignedBars}/${totalActiveBars})`,
        bars: affected.slice(0, 16),
      })
    }
  }

  // ----- BASS_ROOT_SPAM: bass only uses root pitch class → WARNING -----
  {
    const bassPcs = new Set<number>()
    let bassCount = 0
    let rootCount = 0
    const rootPc = pcOf(arrangement.slots[0]?.barIndex ?? 0)
    // We don't have tonic directly; derive from bass function labels.
    for (const b of bassNotes) {
      bassPcs.add(pcOf(b.midi))
      bassCount++
      if (b.function === 'ROOT') rootCount++
    }
    if (bassPcs.size === 1 && bassCount > 0) {
      failures.push({
        type: 'BASS_ROOT_SPAM',
        level: 'WARNING',
        evidence: `bass uses only 1 pitch class (root-only): pc=${Array.from(bassPcs).join(',')}`,
      })
    }
    void rootPc
    void rootCount
  }

  // ----- LEAD_REGISTER_ESCAPE: lead goes above MIDI 84 → WARNING -----
  {
    const affected: number[] = []
    let maxMidi = 0
    for (const l of leadNotes) {
      if (l.midi > 84) {
        affected.push(l.bar)
        if (l.midi > maxMidi) maxMidi = l.midi
      }
    }
    if (affected.length > 0) {
      failures.push({
        type: 'LEAD_REGISTER_ESCAPE',
        level: 'WARNING',
        evidence: `lead reaches MIDI ${maxMidi} (>84) in ${affected.length} note(s)`,
        bars: Array.from(new Set(affected)).slice(0, 8),
      })
    }
  }
  if (leadNotes.length > 0) {
    const highCount = leadNotes.filter((l) => l.midi > 79).length
    const ratio = highCount / leadNotes.length
    if (ratio > 0.3) {
      failures.push({
        type: 'LEAD_HIGH_NOTE_SPAM',
        level: 'WARNING',
        evidence: `${(ratio * 100).toFixed(1)}% of lead notes above MIDI 79 (${highCount}/${leadNotes.length})`,
      })
    }
  }

  // ----- LEAD_TOO_DENSE: >16 lead notes per bar → WARNING -----
  {
    const affected: number[] = []
    for (let bar = 0; bar < bars; bar++) {
      const arr = leadByBar.get(bar) ?? []
      if (arr.length > 16) affected.push(bar)
    }
    if (affected.length > 0) {
      failures.push({
        type: 'LEAD_TOO_DENSE',
        level: 'WARNING',
        evidence: `${affected.length} bar(s) with >16 lead notes`,
        bars: affected.slice(0, 8),
      })
    }
  }

  // ----- LEAD_TOO_SPARSE: <2 lead notes per bar in BUILD/DEVELOPMENT → WARNING -----
  {
    const affected: number[] = []
    for (const slot of arrangement.slots) {
      if (slot.state !== 'BUILD' && slot.state !== 'DEVELOPMENT') continue
      if (!slot.roles.lead) continue
      const arr = leadByBar.get(slot.barIndex) ?? []
      if (arr.length < 2) affected.push(slot.barIndex)
    }
    if (affected.length > 0) {
      failures.push({
        type: 'LEAD_TOO_SPARSE',
        level: 'WARNING',
        evidence: `${affected.length} BUILD/DEVELOPMENT bar(s) with <2 lead notes`,
        bars: affected.slice(0, 8),
      })
    }
  }

  // ----- LEAD_NO_IDENTITY / RANDOM_WALK_MELODY -----
  // Detect motif recurrence: do any two bars share the same pitch sequence?
  {
    const sequenceByBar = new Map<number, string>()
    for (let bar = 0; bar < bars; bar++) {
      const arr = leadByBar.get(bar) ?? []
      if (arr.length === 0) continue
      const seq = arr
        .slice()
        .sort((a, b) => a.step - b.step)
        .map((n) => `${n.midi}`)
        .join(',')
      sequenceByBar.set(bar, seq)
    }
    const seqCounts = new Map<string, number>()
    for (const seq of sequenceByBar.values()) {
      seqCounts.set(seq, (seqCounts.get(seq) ?? 0) + 1)
    }
    const recurringBars = Array.from(sequenceByBar.entries()).filter(
      ([, seq]) => (seqCounts.get(seq) ?? 0) > 1
    ).length
    const totalLeadBars = sequenceByBar.size
    const recurrenceRatio = totalLeadBars > 0 ? recurringBars / totalLeadBars : 0

    // Pitch diversity: distinct pitch classes in lead.
    const leadPcs = new Set<number>()
    for (const l of leadNotes) leadPcs.add(pcOf(l.midi))

    if (recurrenceRatio === 0 && totalLeadBars > 4) {
      // No recurrence AND high diversity → random walk.
      if (leadPcs.size >= 5) {
        failures.push({
          type: 'RANDOM_WALK_MELODY',
          level: 'FAIL',
          evidence: `no motif recurrence across ${totalLeadBars} lead bars AND ${leadPcs.size} distinct pitch classes`,
        })
      } else {
        failures.push({
          type: 'LEAD_NO_IDENTITY',
          level: 'WARNING',
          evidence: `no motif recurrence across ${totalLeadBars} lead bars`,
        })
      }
    }
  }

  // ----- HARMONY_IGNORED: <40% chord tones → WARNING -----
  // We don't have a single chord for the whole section; use the harmonic
  // context embedded in each bar via the arrangement slot's groove. As a
  // proxy, check that lead notes mostly fall on scale tones (we don't have
  // the scale here, so we use a simpler heuristic: lead pitch-class
  // diversity should be reasonable — not 1, not 12).
  {
    const leadPcs = new Set<number>()
    for (const l of leadNotes) leadPcs.add(pcOf(l.midi))
    if (leadNotes.length > 8 && (leadPcs.size === 1 || leadPcs.size === 12)) {
      failures.push({
        type: 'HARMONY_IGNORED',
        level: 'WARNING',
        evidence: `lead pitch-class diversity is ${leadPcs.size} (extreme — likely ignoring harmony)`,
      })
    }
  }

  // ----- GROOVE_COLLAPSE: subdivision changes >2 times → WARNING -----
  // We have one groove per section, so this is informational. If the kick
  // pattern length varies wildly across bars (it shouldn't with one groove),
  // flag it.
  {
    const kickStepSignature = groove.kickSteps
      .slice()
      .sort((a, b) => a - b)
      .join(',')
    const mismatched: number[] = []
    for (let bar = 0; bar < bars; bar++) {
      const set = kickByBar.get(bar)
      if (!set) continue
      const actual = Array.from(set)
        .sort((a, b) => a - b)
        .join(',')
      // Allow fill bars to differ.
      if (groove.fillBars.includes(bar)) continue
      if (actual !== kickStepSignature && actual !== '') {
        // Only flag if the bar is supposed to have kick but doesn't match.
        const slot = arrangement.slots.find((s) => s.barIndex === bar)
        if (slot?.roles.kick) mismatched.push(bar)
      }
    }
    if (mismatched.length > 2) {
      failures.push({
        type: 'GROOVE_COLLAPSE',
        level: 'WARNING',
        evidence: `kick pattern deviates from groove in ${mismatched.length} bars`,
        bars: mismatched.slice(0, 8),
      })
    }
  }

  // ----- PARTS_NOT_INTERLOCKED: kick-bass alignment <0.5 → FAIL -----
  {
    let activeBars = 0
    let alignedBars = 0
    for (let bar = 0; bar < bars; bar++) {
      const slot = arrangement.slots.find((s) => s.barIndex === bar)
      if (!slot?.roles.kick || !slot?.roles.bass) continue
      activeBars++
      const bassInBar = bassByBar.get(bar) ?? []
      const kickSet = kickByBar.get(bar)
      if (!kickSet || kickSet.size === 0) continue
      // Interlock = bass hits at least one kick step.
      const bassSteps = new Set(bassInBar.map((b) => b.step))
      let interlocked = false
      for (const ks of kickSet) {
        if (bassSteps.has(ks)) {
          interlocked = true
          break
        }
      }
      if (interlocked) alignedBars++
    }
    const ratio = activeBars > 0 ? alignedBars / activeBars : 0
    if (ratio < 0.5) {
      failures.push({
        type: 'PARTS_NOT_INTERLOCKED',
        level: 'FAIL',
        evidence: `kick-bass alignment ${ratio.toFixed(2)} (<0.50) across ${activeBars} active bars`,
      })
    }
  }

  // ----- NO_SPACE: lead and bass overlap in register → WARNING -----
  {
    let overlapBars = 0
    for (let bar = 0; bar < bars; bar++) {
      const bassInBar = bassByBar.get(bar) ?? []
      const leadInBar = leadByBar.get(bar) ?? []
      if (bassInBar.length === 0 || leadInBar.length === 0) continue
      const bassMax = Math.max(...bassInBar.map((b) => b.midi))
      const leadMin = Math.min(...leadInBar.map((l) => l.midi))
      if (leadMin < bassMax) overlapBars++
    }
    if (overlapBars > 0) {
      failures.push({
        type: 'NO_SPACE',
        level: 'WARNING',
        evidence: `lead overlaps bass register in ${overlapBars} bar(s)`,
      })
    }
  }

  // ----- ARRANGEMENT_COLLAPSE: only one role-activation pattern across the section → WARNING -----
  {
    const patterns = new Set<string>()
    for (const slot of arrangement.slots) {
      const r = slot.roles
      patterns.add(
        `${r.kick ? 1 : 0}${r.bass ? 1 : 0}${r.lead ? 1 : 0}${r.hats ? 1 : 0}${r.percussion ? 1 : 0}${r.texture ? 1 : 0}`
      )
    }
    if (patterns.size <= 1 && bars > 8) {
      failures.push({
        type: 'ARRANGEMENT_COLLAPSE',
        level: 'WARNING',
        evidence: `only ${patterns.size} role-activation pattern(s) across ${bars} bars`,
      })
    }
  }

  // ----- SECTION_COLLAPSE: no density variation across arrangement states -----
  {
    const densitiesByState = new Map<ArrangementState, number[]>()
    for (const slot of arrangement.slots) {
      const arr = densitiesByState.get(slot.state) ?? []
      arr.push(slot.density)
      densitiesByState.set(slot.state, arr)
    }
    const stateAverages: number[] = []
    for (const arr of densitiesByState.values()) {
      const avg = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length)
      stateAverages.push(avg)
    }
    if (stateAverages.length > 1) {
      const min = Math.min(...stateAverages)
      const max = Math.max(...stateAverages)
      if (max - min < 0.1) {
        failures.push({
          type: 'SECTION_COLLAPSE',
          level: 'WARNING',
          evidence: `density variance across states is only ${(max - min).toFixed(2)} (<0.10)`,
        })
      }
    }
  }

  // ----- ZERO_VARIATION: every lead bar identical → WARNING -----
  // ----- EXCESSIVE_VARIATION: no two lead bars share a sequence -----
  {
    const sequences: string[] = []
    for (let bar = 0; bar < bars; bar++) {
      const arr = leadByBar.get(bar) ?? []
      if (arr.length === 0) continue
      const seq = arr
        .slice()
        .sort((a, b) => a.step - b.step)
        .map((n) => `${n.midi}`)
        .join(',')
      sequences.push(seq)
    }
    if (sequences.length > 4) {
      const uniqueSeqs = new Set(sequences).size
      if (uniqueSeqs === 1) {
        failures.push({
          type: 'ZERO_VARIATION',
          level: 'WARNING',
          evidence: `all ${sequences.length} lead bars share the same pitch sequence`,
        })
      } else if (uniqueSeqs === sequences.length) {
        failures.push({
          type: 'EXCESSIVE_VARIATION',
          level: 'WARNING',
          evidence: `no two lead bars share a pitch sequence across ${sequences.length} bars`,
        })
      }
    }
  }

  // ----- NO_CADENCE: last bar of the section has no ROOT bass → WARNING -----
  {
    const lastBar = bars - 1
    const bassInLast = bassByBar.get(lastBar) ?? []
    const hasCadence = bassInLast.some((b) => b.function === 'CADENCE' || b.function === 'ROOT')
    if (!hasCadence && bassInLast.length > 0) {
      failures.push({
        type: 'NO_CADENCE',
        level: 'WARNING',
        evidence: `last bar (${lastBar}) has no ROOT/CADENCE bass note`,
      })
    }
  }

  const level = worstLevel(failures)
  const summary = summarise(failures, level)
  return { level, failures, summary }
}

function worstLevel(failures: EnhancedMusicalFailure[]): FailureLevel {
  let worst: FailureLevel = 'OK'
  for (const f of failures) {
    if (LEVEL_RANK[f.level] > LEVEL_RANK[worst]) worst = f.level
  }
  return worst
}

function summarise(failures: EnhancedMusicalFailure[], level: FailureLevel): string {
  if (failures.length === 0) return 'OK — no failures detected'
  const failCount = failures.filter((f) => f.level === 'FAIL').length
  const warnCount = failures.filter((f) => f.level === 'WARNING').length
  const parts: string[] = []
  if (failCount > 0) parts.push(`${failCount} FAIL`)
  if (warnCount > 0) parts.push(`${warnCount} WARNING`)
  return `${level} — ${parts.join(', ')} (${failures.length} total)`
}

/** Convenience: filter failures by level. */
export function failuresAtLevel(
  report: EnhancedFailureReport,
  level: FailureLevel
): EnhancedMusicalFailure[] {
  return report.failures.filter((f) => f.level === level)
}
