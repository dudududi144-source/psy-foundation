/**
 * ArrangementState: role activation per section.
 *
 * An {@link ArrangementState} is a named musical function (INTRO, GROOVE,
 * BUILD, DROP, BREAK, DEVELOPMENT, PEAK, RELEASE, OUTRO). Each state has a
 * fixed {@link RoleActivation} that decides which parts play. Silence is a
 * compositional decision: in BREAK, the kick goes silent while the bass
 * thins out and the lead is exposed; in INTRO, only texture plays; in
 * OUTRO, everything fades.
 *
 * {@link planArrangement} walks a section through the nine states in a
 * musically sensible order, allocating bars to each state proportional to
 * its dramatic weight. PEAK and DEVELOPMENT get the most bars; INTRO and
 * OUTRO get the least.
 */

import type { MusicalContext } from './musical-context.ts'
import { Rng } from './rng.ts'

export type ArrangementState =
  | 'INTRO'
  | 'GROOVE'
  | 'BUILD'
  | 'DROP'
  | 'BREAK'
  | 'DEVELOPMENT'
  | 'PEAK'
  | 'RELEASE'
  | 'OUTRO'

export interface RoleActivation {
  kick: boolean
  bass: boolean
  lead: boolean
  hats: boolean
  percussion: boolean
  fills: boolean
  texture: boolean
}

export interface ArrangementSlot {
  barIndex: number
  state: ArrangementState
  roles: RoleActivation
  /** Density 0..1 — target density for this slot. */
  density: number
  /** Energy 0..1 — target energy for this slot. */
  energy: number
}

export interface ArrangementPlan {
  bars: number
  slots: ArrangementSlot[]
  seed: number
}

/**
 * Role activation per arrangement state. CRITICAL: silence is a
 * compositional decision. INTRO, BREAK, and OUTRO intentionally turn
 * parts OFF so the music has dynamic range rather than every part
 * playing all the time.
 */
export const ARRANGEMENT_ROLE_MAP: Record<ArrangementState, RoleActivation> = {
  INTRO: {
    kick: false,
    bass: false,
    lead: false,
    hats: false,
    percussion: false,
    fills: false,
    texture: true,
  },
  GROOVE: {
    kick: true,
    bass: true,
    lead: false,
    hats: true,
    percussion: true,
    fills: false,
    texture: false,
  },
  BUILD: {
    kick: true,
    bass: true,
    lead: true,
    hats: true,
    percussion: true,
    fills: true,
    texture: false,
  },
  DROP: {
    kick: true,
    bass: true,
    lead: true,
    hats: true,
    percussion: true,
    fills: true,
    texture: false,
  },
  BREAK: {
    kick: false,
    bass: true,
    lead: true,
    hats: false,
    percussion: false,
    fills: false,
    texture: true,
  },
  DEVELOPMENT: {
    kick: true,
    bass: true,
    lead: true,
    hats: true,
    percussion: true,
    fills: false,
    texture: false,
  },
  PEAK: {
    kick: true,
    bass: true,
    lead: true,
    hats: true,
    percussion: true,
    fills: true,
    texture: false,
  },
  RELEASE: {
    kick: true,
    bass: true,
    lead: false,
    hats: true,
    percussion: false,
    fills: false,
    texture: true,
  },
  OUTRO: {
    kick: false,
    bass: false,
    lead: false,
    hats: false,
    percussion: false,
    fills: false,
    texture: true,
  },
}

/** Target density and energy per arrangement state. */
const ARRANGEMENT_DENSITY: Record<ArrangementState, number> = {
  INTRO: 0.2,
  GROOVE: 0.5,
  BUILD: 0.65,
  DROP: 0.8,
  BREAK: 0.25,
  DEVELOPMENT: 0.7,
  PEAK: 0.9,
  RELEASE: 0.5,
  OUTRO: 0.2,
}

const ARRANGEMENT_ENERGY: Record<ArrangementState, number> = {
  INTRO: 0.3,
  GROOVE: 0.5,
  BUILD: 0.7,
  DROP: 0.9,
  BREAK: 0.3,
  DEVELOPMENT: 0.75,
  PEAK: 1.0,
  RELEASE: 0.5,
  OUTRO: 0.2,
}

/**
 * Fraction of total bars allocated to each state. The order is the canonical
 * narrative arc: INTRO → GROOVE → BUILD → DROP → BREAK → DEVELOPMENT → PEAK
 * → RELEASE → OUTRO. PEAK and DEVELOPMENT get the most bars; INTRO and
 * OUTRO get the least.
 */
const STATE_ORDER: ArrangementState[] = [
  'INTRO',
  'GROOVE',
  'BUILD',
  'DROP',
  'BREAK',
  'DEVELOPMENT',
  'PEAK',
  'RELEASE',
  'OUTRO',
]

const STATE_FRACTIONS: Record<ArrangementState, number> = {
  INTRO: 0.04,
  GROOVE: 0.12,
  BUILD: 0.12,
  DROP: 0.12,
  BREAK: 0.06,
  DEVELOPMENT: 0.18,
  PEAK: 0.18,
  RELEASE: 0.12,
  OUTRO: 0.06,
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * Plan an arrangement across `bars` bars.
 *
 * Walks through the nine arrangement states in narrative order, allocating
 * each state a proportional slice of the total bars. Each resulting
 * {@link ArrangementSlot} carries the state's role activation and target
 * density/energy.
 *
 * The allocation is rounded to multiples of 2 so each state gets an even
 * number of bars (avoids odd-length phrases). If rounding causes the total
 * to differ from `bars`, the last state (OUTRO) absorbs the slack.
 */
export function planArrangement(opts: {
  bars: number
  seed: number
  context: MusicalContext
}): ArrangementPlan {
  const { bars, seed, context } = opts
  const rng = new Rng(seed)
  void context // reserved for future style-aware allocation

  const slots: ArrangementSlot[] = []
  let bar = 0
  // First pass: compute raw allocations.
  const rawCounts: number[] = STATE_ORDER.map((state) => {
    const frac = STATE_FRACTIONS[state]
    // Round to nearest multiple of 2; minimum 2 bars per state.
    const raw = Math.max(2, Math.round((bars * frac) / 2) * 2)
    return raw
  })
  const rawTotal = rawCounts.reduce((a, b) => a + b, 0)
  // If we over-allocated, trim from DEVELOPMENT and PEAK proportionally.
  // If we under-allocated, add to OUTRO.
  let diff = bars - rawTotal
  const adjusted = rawCounts.slice()
  if (diff < 0) {
    // Trim from the largest allocations first.
    for (let i = adjusted.length - 2; i >= 0 && diff < 0; i--) {
      const trim = Math.min(adjusted[i] - 2, -diff)
      adjusted[i] -= trim
      diff += trim
    }
  } else if (diff > 0) {
    adjusted[adjusted.length - 1] += diff
  }

  for (let i = 0; i < STATE_ORDER.length; i++) {
    const state = STATE_ORDER[i] as ArrangementState
    const count = adjusted[i] ?? 0
    const roles = ARRANGEMENT_ROLE_MAP[state]
    const baseDensity = ARRANGEMENT_DENSITY[state]
    const baseEnergy = ARRANGEMENT_ENERGY[state]
    for (let j = 0; j < count && bar < bars; j++) {
      // Small per-bar jitter for organic shape (deterministic via rng).
      const dJitter = rng.range(-0.03, 0.03)
      const eJitter = rng.range(-0.03, 0.03)
      slots.push({
        barIndex: bar,
        state,
        roles: { ...roles },
        density: clamp01(baseDensity + dJitter),
        energy: clamp01(baseEnergy + eJitter),
      })
      bar++
    }
  }

  return { bars, slots, seed }
}

/** Look up the role activation for a state. */
export function rolesForState(state: ArrangementState): RoleActivation {
  return { ...ARRANGEMENT_ROLE_MAP[state] }
}

/** Find the arrangement slot covering a given bar index. */
export function slotAtBar(plan: ArrangementPlan, bar: number): ArrangementSlot | undefined {
  return plan.slots.find((s) => s.barIndex === bar)
}

/** Count how many slots have a given state. */
export function countState(plan: ArrangementPlan, state: ArrangementState): number {
  return plan.slots.filter((s) => s.state === state).length
}
