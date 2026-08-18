/**
 * Humanizer — ported from PSYSTAR (src/engine/humanizer.ts)
 *
 * Adds human feel to machine-generated music:
 * - Velocity jitter: ±18% variation
 * - Time drift: ±18ms timing variation
 * - Ghost note skipping: probabilistic note dropping
 *
 * Uses mulberry32 PRNG (deterministic, same seed → same output).
 */

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Add velocity jitter to a velocity value.
 * @param velocity Original velocity (0..1)
 * @param amount Humanization amount (0..1)
 * @param random PRNG function
 * @returns Jittered velocity clamped to 0.2-1.6
 */
export function jitterVelocity(velocity: number, amount: number, random: () => number): number {
  const clampedAmount = Math.max(0, Math.min(1, amount))
  const jitter = (random() * 2 - 1) * clampedAmount * 0.18
  return Math.max(0.2, Math.min(1.6, velocity * (1 + jitter)))
}

/**
 * Calculate timing drift offset.
 * @param amount Humanization amount (0..1)
 * @param random PRNG function
 * @returns Time offset in seconds (±18ms max)
 */
export function driftTime(amount: number, random: () => number): number {
  const clampedAmount = Math.max(0, Math.min(1, amount))
  return (random() * 2 - 1) * clampedAmount * 0.018
}

/**
 * Determine if a note should be skipped (ghost note drop).
 * Bass (row 0) is never skipped — it's the foundation.
 * @param row Track/row index (0 = bass, never skipped)
 * @param amount Humanization amount (0..1, only skips when > 0.5)
 * @param random PRNG function
 */
export function shouldSkip(row: number, amount: number, random: () => number): boolean {
  if (row === 0) return false // never skip bass
  const clamped = Math.max(0, Math.min(1, amount))
  if (clamped <= 0.5) return false
  const skipChance = (clamped - 0.5) * 0.3
  return random() < skipChance
}

/**
 * Apply humanization to a batch of events.
 * Returns new arrays (does not mutate input).
 */
export interface HumanizableEvent {
  velocity: number
  timeOffset: number
  row: number
}

export function humanizeEvents(
  events: HumanizableEvent[],
  amount: number,
  seed: number,
): HumanizableEvent[] {
  const random = mulberry32(seed)
  return events.map(ev => {
    if (shouldSkip(ev.row, amount, random)) {
      return { ...ev, velocity: 0 } // ghost note — velocity 0 means skip
    }
    return {
      velocity: jitterVelocity(ev.velocity, amount, random),
      timeOffset: ev.timeOffset + driftTime(amount, random),
      row: ev.row,
    }
  })
}
