/**
 * Reward signal — turns an outcome into a scalar reward -1..1.
 *
 * The reward function is the single most important design choice in a
 * contextual bandit. It encodes what "good" means musically.
 *
 * Default reward shape:
 *  - sounded (the action produced sound): +0.3 base, scaled by outcome
 *  - skipped (the action was a no-op): 0 (neutral — sometimes correct)
 *  - collided (the action clashed with something else): -0.5 (bad)
 *
 * The caller can override this with a custom reward function.
 */

import type { MusicalOutcome } from '@psy-foundation/protocol'

export type RewardFunction = (outcome: MusicalOutcome) => number

/** Default reward function. */
export const defaultReward: RewardFunction = (outcome) => {
  switch (outcome.type) {
    case 'sounded':
      // Sounded is mildly positive. Duration too short or too long is penalized.
      if (outcome.durationSec < 0.05) return -0.1 // too short = glitch
      if (outcome.durationSec > 8) return 0.0 // too long = drone, neutral
      return 0.3
    case 'skipped':
      // Neutral. DO NOTHING is legal and sometimes correct.
      return 0.0
    case 'collided':
      // Negative. Collisions are musically bad.
      return -0.5
  }
}

/** Custom reward that favors longer-sounding outcomes (for ambient textures). */
export const sustainedReward: RewardFunction = (outcome) => {
  if (outcome.type === 'sounded') {
    return Math.min(1, 0.2 + outcome.durationSec * 0.1)
  }
  return defaultReward(outcome)
}

/** Custom reward that penalizes collisions heavily (for bass/kick roles). */
export const antiCollisionReward: RewardFunction = (outcome) => {
  if (outcome.type === 'collided') return -1
  return defaultReward(outcome)
}
