/**
 * OpportunityMap: which musical roles are open for the foundation to fill.
 *
 * Given a {@link RadioMusicalContext}, the opportunity map classifies each
 * role as OCCUPIED (the radio is already covering it), OPEN (the radio is
 * absent there — the foundation can step in), or MEDIUM (partial coverage —
 * the foundation should tread lightly).
 *
 * `counter` and `transition` are always OPEN: counter-melody space and
 * transition material are the foundation's own territory, regardless of
 * what the radio is doing. `texture` is MEDIUM if the radio's energy is
 * high (the soundscape is already busy) and OPEN otherwise.
 */

import type { RadioMusicalContext } from './radio-context.ts'
import { isRadioAbsent } from './radio-context.ts'

export type RoleStatus = 'OCCUPIED' | 'OPEN' | 'MEDIUM'

export interface OpportunityMap {
  kick: RoleStatus
  bass: RoleStatus
  percussion: RoleStatus
  lead: RoleStatus
  harmony: RoleStatus
  /** Always OPEN — counter-melody space is the foundation's own. */
  counter: RoleStatus
  texture: RoleStatus
  /** Always OPEN — transitions are the foundation's own. */
  transition: RoleStatus
}

/** Occupancy threshold above which a role is OCCUPIED. */
const OCCUPIED_THRESHOLD = 0.6
/** Occupancy threshold below which a role is OPEN. */
const OPEN_THRESHOLD = 0.3
/** Energy threshold above which texture space is considered MEDIUM. */
const TEXTURE_MEDIUM_ENERGY = 0.5

function classify(occupancy: number): RoleStatus {
  if (occupancy > OCCUPIED_THRESHOLD) return 'OCCUPIED'
  if (occupancy < OPEN_THRESHOLD) return 'OPEN'
  return 'MEDIUM'
}

/**
 * Build an {@link OpportunityMap} from a radio context.
 *
 * Rules:
 *   - occupancy > 0.6 → OCCUPIED
 *   - occupancy 0.3..0.6 → MEDIUM
 *   - occupancy < 0.3 → OPEN
 *   - counter and transition are always OPEN
 *   - texture is MEDIUM if radio.energy > 0.5, else OPEN
 *
 * When the radio is absent ({@link isRadioAbsent}), every occupancy is 0 so
 * every role (except texture under high energy, which can't happen here) is
 * OPEN — the foundation plays its full arrangement.
 */
export function buildOpportunityMap(radio: RadioMusicalContext): OpportunityMap {
  if (isRadioAbsent(radio)) {
    return {
      kick: 'OPEN',
      bass: 'OPEN',
      percussion: 'OPEN',
      lead: 'OPEN',
      harmony: 'OPEN',
      counter: 'OPEN',
      texture: 'OPEN',
      transition: 'OPEN',
    }
  }

  const texture: RoleStatus = radio.energy > TEXTURE_MEDIUM_ENERGY ? 'MEDIUM' : 'OPEN'

  return {
    kick: classify(radio.kickOccupancy),
    bass: classify(radio.bassOccupancy),
    percussion: classify(radio.percussionOccupancy),
    lead: classify(radio.leadOccupancy),
    harmony: classify(radio.harmonicOccupancy),
    counter: 'OPEN',
    texture,
    transition: 'OPEN',
  }
}

/** Convenience: how many roles are OCCUPIED? */
export function countOccupied(map: OpportunityMap): number {
  let n = 0
  for (const k of Object.keys(map) as (keyof OpportunityMap)[]) {
    if (map[k] === 'OCCUPIED') n++
  }
  return n
}

/** Convenience: how many roles are OPEN? */
export function countOpen(map: OpportunityMap): number {
  let n = 0
  for (const k of Object.keys(map) as (keyof OpportunityMap)[]) {
    if (map[k] === 'OPEN') n++
  }
  return n
}

/** Convenience: is the radio fully dense (every primary role OCCUPIED)? */
export function isDense(map: OpportunityMap): boolean {
  const primary: (keyof OpportunityMap)[] = ['kick', 'bass', 'percussion', 'lead', 'harmony']
  return primary.every((k) => map[k] === 'OCCUPIED')
}
