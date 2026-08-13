/**
 * RhythmicSpaceMap — per-subdivision view of who is playing where in a bar.
 *
 * F20 requirement: the lead must make musical decisions based on the ACTUAL
 * rhythmic space — where kick/bass already hit, where the bar is open, where
 * a response to a bass onset would land. This is fundamentally different
 * from choosing note density randomly.
 *
 * The map is derived AFTER kick and bass plans are generated, then consumed
 * by the lead generator. Each 16th-step cell records:
 *   - kickStrength / bassStrength / drumAccent / harmonicAccent (0..1)
 *   - occupied (kick or bass hits here) / open (neither)
 *   - preferredLead (0..1 — how good a lead ONSET is here)
 *   - preferredResponse (0..1 — how good a lead RESPONSE here is, given bass)
 *
 * Example:
 *   kick:  X---X---X---X---
 *   bass:  X-------X-X-----
 *   space: --XX--X---XX---   (open steps where lead is welcome)
 *   lead:   X-X--X-----X-X   (lead plays in the open gaps + answers bass)
 */

export interface RhythmicSpaceCell {
  /** Step index within the bar (0..stepsPerBar-1). */
  step: number
  /** Kick onset strength at this step (0 or 1 for simple plans, 0..1 for velocity-weighted). */
  kickStrength: number
  /** Bass onset strength at this step. */
  bassStrength: number
  /** Drum accent (from the groove's accent grid + hats). */
  drumAccent: number
  /** Harmonic accent — high at chord-change steps. */
  harmonicAccent: number
  /** True if kick or bass hits this step. */
  occupied: boolean
  /** True if neither kick nor bass hits this step. */
  open: boolean
  /** 0..1 — how good a lead ONSET is at this step. */
  preferredLead: number
  /** 0..1 — how good a lead RESPONSE is at this step (given upstream bass onsets). */
  preferredResponse: number
}

export interface RhythmicSpaceMap {
  stepsPerBar: number
  cells: RhythmicSpaceCell[]
}

export interface BuildSpaceMapOptions {
  stepsPerBar: number
  /** Kick onset step indices within the bar. */
  kickOnsets: number[]
  /** Bass onset step indices within the bar. */
  bassOnsets: number[]
  /** Accent grid step indices (strong beats). */
  accentSteps: number[]
  /** Hat onset step indices. */
  hatOnsets?: number[]
  /** Steps where the chord changes (harmonic accents). */
  harmonicChangeSteps?: number[]
  /** Bass anticipation steps (steps where bass anticipates a kick — from grammar). */
  bassAnticipationSteps?: number[]
}

/**
 * Build a RhythmicSpaceMap from the generated kick + bass plans and the
 * groove's accent grid. The map is the single source of truth the lead
 * consults to decide where to play, where to leave silence, where to answer
 * the bass, and where to anticipate.
 */
export function buildRhythmicSpaceMap(opts: BuildSpaceMapOptions): RhythmicSpaceMap {
  const { stepsPerBar, kickOnsets, bassOnsets, accentSteps } = opts
  const kickSet = new Set(kickOnsets)
  const bassSet = new Set(bassOnsets)
  const accentSet = new Set(accentSteps)
  const hatSet = new Set(opts.hatOnsets ?? [])
  const harmSet = new Set(opts.harmonicChangeSteps ?? [])
  const anticiSet = new Set(opts.bassAnticipationSteps ?? [])

  const cells: RhythmicSpaceCell[] = []
  for (let step = 0; step < stepsPerBar; step++) {
    const kickHas = kickSet.has(step)
    const bassHas = bassSet.has(step)
    const occupied = kickHas || bassHas
    const open = !occupied

    const kickStrength = kickHas ? 1 : 0
    const bassStrength = bassHas ? 1 : 0
    const drumAccent = (accentSet.has(step) ? 0.6 : 0) + (hatSet.has(step) ? 0.3 : 0)
    const harmonicAccent = harmSet.has(step) ? 1 : 0

    // preferredLead: lead onsets are welcome in OPEN steps and on harmonic
    // accents. Lead is discouraged from doubling kick (would muddy the groove)
    // unless the step is a harmonic accent (lead may mark the change).
    let preferredLead: number
    if (open) {
      preferredLead = 0.6 + Math.min(0.3, drumAccent) + harmonicAccent * 0.1
    } else if (kickHas && !bassHas) {
      // Kick-only step: lead may mark it but sparingly (low preference).
      preferredLead = 0.25 + harmonicAccent * 0.2
    } else if (bassHas && !kickHas) {
      // Bass-only step: lead should generally leave it to the bass.
      preferredLead = 0.2
    } else {
      // Both kick and bass hit: lead should rest.
      preferredLead = 0.1
    }
    // Anticipation steps are good for lead.
    if (anticiSet.has(step)) preferredLead = Math.max(preferredLead, 0.7)

    // preferredResponse: a lead RESPONSE is welcome 1-2 steps AFTER a bass
    // onset. Computed here as a per-step value derived from bass onsets.
    let preferredResponse = 0
    for (const bs of bassOnsets) {
      const offset = step - bs
      if (offset === 1) preferredResponse = Math.max(preferredResponse, 0.85)
      else if (offset === 2) preferredResponse = Math.max(preferredResponse, 0.6)
      else if (offset === 3) preferredResponse = Math.max(preferredResponse, 0.35)
    }
    // If this step itself is a bass onset, a response here is low (bass owns it).
    if (bassHas) preferredResponse = Math.min(preferredResponse, 0.15)

    cells.push({
      step,
      kickStrength,
      bassStrength,
      drumAccent,
      harmonicAccent,
      occupied,
      open,
      preferredLead,
      preferredResponse,
    })
  }

  return { stepsPerBar, cells }
}

/** Convenience: get the cell for a step (wraps modulo stepsPerBar). */
export function cellAt(map: RhythmicSpaceMap, step: number): RhythmicSpaceCell {
  const wrapped = ((step % map.stepsPerBar) + map.stepsPerBar) % map.stepsPerBar
  const cell = map.cells[wrapped]
  if (!cell) {
    return {
      step: wrapped,
      kickStrength: 0,
      bassStrength: 0,
      drumAccent: 0,
      harmonicAccent: 0,
      occupied: false,
      open: true,
      preferredLead: 0.5,
      preferredResponse: 0,
    }
  }
  return cell
}

/** Count of open steps in the bar (where lead may freely play). */
export function countOpen(map: RhythmicSpaceMap): number {
  let n = 0
  for (const c of map.cells) if (c.open) n++
  return n
}

/** Count of occupied steps. */
export function countOccupied(map: RhythmicSpaceMap): number {
  let n = 0
  for (const c of map.cells) if (c.occupied) n++
  return n
}

/** Mean preferredLead across all steps — the bar's overall lead-friendliness. */
export function meanPreferredLead(map: RhythmicSpaceMap): number {
  if (map.cells.length === 0) return 0
  let s = 0
  for (const c of map.cells) s += c.preferredLead
  return s / map.cells.length
}

/**
 * Steps sorted by preferredLead descending — the lead generator picks onsets
 * from the top of this list up to the target density.
 */
export function stepsByLeadPreference(map: RhythmicSpaceMap): number[] {
  return map.cells
    .slice()
    .sort((a, b) => b.preferredLead - a.preferredLead)
    .map((c) => c.step)
}

/** Steps sorted by preferredResponse descending — for lead response placement. */
export function stepsByResponsePreference(map: RhythmicSpaceMap): number[] {
  return map.cells
    .slice()
    .sort((a, b) => b.preferredResponse - a.preferredResponse)
    .map((c) => c.step)
}
