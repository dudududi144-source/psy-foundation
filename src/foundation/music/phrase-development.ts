/**
 * PhraseDevelopment — explicit development operators for phrase-to-phrase continuity.
 *
 * Instead of treating every phrase as independent, the engine chooses a
 * development operation based on the previous phrase, current state, and
 * learned tendencies. This creates musical DEVELOPMENT, not just variation.
 */

export type DevelopmentOperator =
  | 'CONTINUE' // Repeat the previous phrase's identity with minimal change
  | 'DEVELOP' // Keep identity but add variation (transpose, rhythmic mutation)
  | 'ANSWER' // Create a response phrase (call/response structure)
  | 'CONTRAST' // Introduce new material while preserving harmonic world
  | 'VARIATE' // Transform the previous phrase (invert, retrograde, fragment)
  | 'INTENSIFY' // Increase density, register, or energy
  | 'REDUCE' // Decrease density, create space
  | 'BREAK' // Strip down to minimal elements
  | 'RESOLVE' // Resolve tension, cadence to stable tones
  | 'TRANSITION' // Move toward a new harmonic area

export interface DevelopmentDecision {
  operator: DevelopmentOperator
  /** Why this operator was chosen */
  reason: string
  /** How much to vary from the previous phrase (0..1) */
  variationAmount: number
  /** Whether to callback to a previous motif */
  callbackTo?: string
  /** Target energy (0..1) — the phrase should move toward this */
  targetEnergy: number
  /** Target tension (0..1) */
  targetTension: number
  /** Target density (0..1) */
  targetDensity: number
}

/**
 * Choose a development operator for the next phrase.
 *
 * Decision logic:
 * - First phrase: always CONTINUE (establish)
 * - After 2+ phrases of CONTINUE: DEVELOP or VARIATE
 * - After DEVELOP: INTENSIFY or ANSWER
 * - After INTENSIFY: CONTRAST or BREAK
 * - After CONTRAST: ANSWER or RESOLVE
 * - Last phrase of section: RESOLVE or TRANSITION
 * - After BREAK: CONTINUE or DEVELOP (return)
 */
export function chooseDevelopment(
  phraseIndex: number,
  previousOperator: DevelopmentOperator | null,
  phrasesInSection: number,
  _currentEnergy: number,
  _currentTension: number,
  rng: { next: () => number }
): DevelopmentDecision {
  // First phrase: establish
  if (phraseIndex === 0 || previousOperator === null) {
    return {
      operator: 'CONTINUE',
      reason: 'first phrase — establish identity',
      variationAmount: 0.1,
      targetEnergy: 0.5,
      targetTension: 0.3,
      targetDensity: 0.5,
    }
  }

  // Last phrase in section: resolve
  const isLastInSection = phraseIndex >= phrasesInSection - 1
  if (isLastInSection) {
    return {
      operator: rng.next() < 0.6 ? 'RESOLVE' : 'TRANSITION',
      reason: 'section ending — resolve or transition',
      variationAmount: 0.3,
      targetEnergy: 0.4,
      targetTension: 0.2,
      targetDensity: 0.4,
    }
  }

  // Development chain based on previous operator
  switch (previousOperator) {
    case 'CONTINUE':
      // After establishing, develop
      return {
        operator: rng.next() < 0.6 ? 'DEVELOP' : 'ANSWER',
        reason: 'after establish → develop or answer',
        variationAmount: 0.3,
        targetEnergy: 0.6,
        targetTension: 0.4,
        targetDensity: 0.6,
      }

    case 'DEVELOP':
      // After developing, intensify or contrast
      return {
        operator: rng.next() < 0.5 ? 'INTENSIFY' : 'CONTRAST',
        reason: 'after develop → intensify or contrast',
        variationAmount: 0.4,
        targetEnergy: 0.75,
        targetTension: 0.55,
        targetDensity: 0.7,
      }

    case 'ANSWER':
      // After answering, continue developing or vary
      return {
        operator: rng.next() < 0.5 ? 'VARIATE' : 'DEVELOP',
        reason: 'after answer → vary or develop',
        variationAmount: 0.4,
        targetEnergy: 0.65,
        targetTension: 0.45,
        targetDensity: 0.6,
      }

    case 'INTENSIFY':
      // After intensifying, contrast or break
      return {
        operator: rng.next() < 0.4 ? 'BREAK' : 'CONTRAST',
        reason: 'after intensify → contrast or break',
        variationAmount: 0.5,
        targetEnergy: 0.5,
        targetTension: 0.3,
        targetDensity: 0.4,
      }

    case 'CONTRAST':
      // After contrasting, answer or resolve
      return {
        operator: rng.next() < 0.6 ? 'ANSWER' : 'RESOLVE',
        reason: 'after contrast → answer or resolve',
        variationAmount: 0.35,
        targetEnergy: 0.55,
        targetTension: 0.35,
        targetDensity: 0.55,
      }

    case 'VARIATE':
      // After varying, continue or intensify
      return {
        operator: rng.next() < 0.5 ? 'CONTINUE' : 'INTENSIFY',
        reason: 'after vary → continue or intensify',
        variationAmount: 0.2,
        targetEnergy: 0.7,
        targetTension: 0.5,
        targetDensity: 0.65,
      }

    case 'BREAK':
      // After break, return to material
      return {
        operator: 'CONTINUE',
        reason: 'after break → return to identity',
        variationAmount: 0.15,
        targetEnergy: 0.5,
        targetTension: 0.3,
        targetDensity: 0.5,
      }

    case 'RESOLVE':
      // After resolving, start new development
      return {
        operator: 'DEVELOP',
        reason: 'after resolve → new development',
        variationAmount: 0.3,
        targetEnergy: 0.55,
        targetTension: 0.35,
        targetDensity: 0.55,
      }

    case 'REDUCE':
      return {
        operator: 'CONTINUE',
        reason: 'after reduce → rebuild',
        variationAmount: 0.2,
        targetEnergy: 0.5,
        targetTension: 0.3,
        targetDensity: 0.5,
      }

    case 'TRANSITION':
      return {
        operator: 'CONTINUE',
        reason: 'after transition → establish new area',
        variationAmount: 0.15,
        targetEnergy: 0.5,
        targetTension: 0.3,
        targetDensity: 0.5,
      }

    default:
      return {
        operator: 'CONTINUE',
        reason: 'default — continue',
        variationAmount: 0.2,
        targetEnergy: 0.5,
        targetTension: 0.3,
        targetDensity: 0.5,
      }
  }
}

/**
 * Apply a development operator to influence composition parameters.
 * Returns modifiers that composePhrase should use.
 */
export function applyDevelopment(
  decision: DevelopmentDecision,
  baseContext: { density: number; energy: number; tension: number }
): {
  densityModifier: number
  energyModifier: number
  tensionModifier: number
  variationMultiplier: number
  useCallback: boolean
  useInversion: boolean
  useRetrograde: boolean
  useFragmentation: boolean
  reduceToMinimal: boolean
  cadenceStrength: number
} {
  const { operator, variationAmount, targetEnergy, targetTension, targetDensity } = decision

  const densityModifier = targetDensity / Math.max(0.1, baseContext.density)
  const energyModifier = targetEnergy / Math.max(0.1, baseContext.energy)
  const tensionModifier = targetTension / Math.max(0.1, baseContext.tension)

  switch (operator) {
    case 'CONTINUE':
      return {
        densityModifier: 1.0,
        energyModifier: 1.0,
        tensionModifier: 1.0,
        variationMultiplier: 0.1,
        useCallback: true,
        useInversion: false,
        useRetrograde: false,
        useFragmentation: false,
        reduceToMinimal: false,
        cadenceStrength: 0.3,
      }

    case 'DEVELOP':
      return {
        densityModifier,
        energyModifier,
        tensionModifier,
        variationMultiplier: variationAmount,
        useCallback: false,
        useInversion: rng() < 0.3,
        useRetrograde: false,
        useFragmentation: false,
        reduceToMinimal: false,
        cadenceStrength: 0.4,
      }

    case 'ANSWER':
      return {
        densityModifier: 0.9,
        energyModifier: 0.9,
        tensionModifier: 0.8,
        variationMultiplier: 0.5,
        useCallback: true,
        useInversion: false,
        useRetrograde: false,
        useFragmentation: false,
        reduceToMinimal: false,
        cadenceStrength: 0.5,
      }

    case 'CONTRAST':
      return {
        densityModifier: 1.1,
        energyModifier: 1.15,
        tensionModifier: 1.3,
        variationMultiplier: 0.8,
        useCallback: false,
        useInversion: rng() < 0.4,
        useRetrograde: rng() < 0.3,
        useFragmentation: rng() < 0.2,
        reduceToMinimal: false,
        cadenceStrength: 0.3,
      }

    case 'VARIATE':
      return {
        densityModifier: 1.0,
        energyModifier: 1.0,
        tensionModifier: 1.1,
        variationMultiplier: variationAmount,
        useCallback: false,
        useInversion: rng() < 0.3,
        useRetrograde: rng() < 0.2,
        useFragmentation: rng() < 0.25,
        reduceToMinimal: false,
        cadenceStrength: 0.4,
      }

    case 'INTENSIFY':
      return {
        densityModifier: 1.3,
        energyModifier: 1.4,
        tensionModifier: 1.5,
        variationMultiplier: 0.3,
        useCallback: false,
        useInversion: false,
        useRetrograde: false,
        useFragmentation: false,
        reduceToMinimal: false,
        cadenceStrength: 0.2,
      }

    case 'REDUCE':
      return {
        densityModifier: 0.6,
        energyModifier: 0.7,
        tensionModifier: 0.5,
        variationMultiplier: 0.2,
        useCallback: true,
        useInversion: false,
        useRetrograde: false,
        useFragmentation: false,
        reduceToMinimal: false,
        cadenceStrength: 0.5,
      }

    case 'BREAK':
      return {
        densityModifier: 0.3,
        energyModifier: 0.4,
        tensionModifier: 0.3,
        variationMultiplier: 0.1,
        useCallback: true,
        useInversion: false,
        useRetrograde: false,
        useFragmentation: true,
        reduceToMinimal: true,
        cadenceStrength: 0.6,
      }

    case 'RESOLVE':
      return {
        densityModifier: 0.7,
        energyModifier: 0.6,
        tensionModifier: 0.3,
        variationMultiplier: 0.2,
        useCallback: true,
        useInversion: false,
        useRetrograde: false,
        useFragmentation: false,
        reduceToMinimal: false,
        cadenceStrength: 0.9,
      }

    case 'TRANSITION':
      return {
        densityModifier: 0.8,
        energyModifier: 0.7,
        tensionModifier: 0.6,
        variationMultiplier: 0.4,
        useCallback: false,
        useInversion: false,
        useRetrograde: false,
        useFragmentation: false,
        reduceToMinimal: false,
        cadenceStrength: 0.5,
      }

    default:
      return {
        densityModifier: 1.0,
        energyModifier: 1.0,
        tensionModifier: 1.0,
        variationMultiplier: 0.2,
        useCallback: false,
        useInversion: false,
        useRetrograde: false,
        useFragmentation: false,
        reduceToMinimal: false,
        cadenceStrength: 0.3,
      }
  }
}

// Simple deterministic RNG for internal use
let _seed = 42
function rng(): number {
  _seed = (_seed * 1664525 + 1013904223) >>> 0
  return _seed / 4294967296
}
