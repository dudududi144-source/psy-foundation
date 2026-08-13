/**
 * InteractionGrammar — learns statistical relationships between musical voices.
 *
 * Instead of treating kick, bass, lead, and harmony as independent generators,
 * this module captures how they relate:
 *
 *   kick step → bass step probability
 *   bass degree → next bass degree (transition matrix)
 *   harmonic state → lead interval distribution
 *   energy → note density
 *   tension → register
 *
 * All relationships are learned incrementally from observations and consumed
 * during composition to create INTERLOCKED parts rather than independent ones.
 */

export interface KickBassInteraction {
  /** For each 16th step, probability that bass also hits when kick hits */
  bassOnKickProb: number[]
  /** For each 16th step, probability that bass hits when kick does NOT hit */
  bassOffKickProb: number[]
}

export interface BassTransition {
  /** degree → { nextDegree → probability } */
  transitions: Record<number, Record<number, number>>
}

export interface HarmonyLeadInteraction {
  /** harmonic state (chord root pc) → { interval → probability } */
  intervalPreferences: Record<number, Record<number, number>>
}

export interface EnergyDensityInteraction {
  /** energy bin (0-9) → average note density */
  densityByEnergy: number[]
}

export interface TensionRegisterInteraction {
  /** tension bin (0-9) → average lead register (MIDI) */
  registerByTension: number[]
}

export interface InteractionGrammar {
  kickBass: KickBassInteraction
  bassTransitions: BassTransition
  harmonyLead: HarmonyLeadInteraction
  energyDensity: EnergyDensityInteraction
  tensionRegister: TensionRegisterInteraction
  confidence: number
}

export function createEmptyInteractionGrammar(): InteractionGrammar {
  return {
    kickBass: {
      bassOnKickProb: new Array(16).fill(0.5),
      bassOffKickProb: new Array(16).fill(0.2),
    },
    bassTransitions: { transitions: {} },
    harmonyLead: { intervalPreferences: {} },
    energyDensity: { densityByEnergy: new Array(10).fill(0.5) },
    tensionRegister: { registerByTension: new Array(10).fill(67) },
    confidence: 0,
  }
}

/**
 * Update interaction grammar from an observation.
 * Incremental, bounded, deterministic.
 */
export function updateInteractionGrammar(
  grammar: InteractionGrammar,
  obs: {
    kickOnsets?: number[]
    bassOnsets?: number[]
    bassDegrees?: number[]
    leadIntervals?: number[]
    harmonicRoot?: number
    energy?: number
    density?: number
    tension?: number
    leadRegister?: number
    confidence?: number
  }
): InteractionGrammar {
  const lr = 0.05
  const conf = obs.confidence ?? 0.5
  const g = {
    ...grammar,
    kickBass: {
      bassOnKickProb: [...grammar.kickBass.bassOnKickProb],
      bassOffKickProb: [...grammar.kickBass.bassOffKickProb],
    },
    energyDensity: { densityByEnergy: [...grammar.energyDensity.densityByEnergy] },
    tensionRegister: { registerByTension: [...grammar.tensionRegister.registerByTension] },
  }

  // KICK ↔ BASS
  if (obs.kickOnsets && obs.bassOnsets) {
    const kickSet = new Set(obs.kickOnsets)
    const bassSet = new Set(obs.bassOnsets)
    for (let step = 0; step < 16; step++) {
      const kickHas = kickSet.has(step)
      const bassHas = bassSet.has(step)
      if (kickHas) {
        g.kickBass.bassOnKickProb[step] =
          (g.kickBass.bassOnKickProb[step] ?? 0.5) * (1 - lr * conf) + (bassHas ? 1 : 0) * lr * conf
      } else {
        g.kickBass.bassOffKickProb[step] =
          (g.kickBass.bassOffKickProb[step] ?? 0.2) * (1 - lr * conf) +
          (bassHas ? 1 : 0) * lr * conf
      }
    }
  }

  // BASS TRANSITIONS
  if (obs.bassDegrees && obs.bassDegrees.length >= 2) {
    for (let i = 0; i < obs.bassDegrees.length - 1; i++) {
      const from = obs.bassDegrees[i] ?? 0
      const to = obs.bassDegrees[i + 1] ?? 0
      if (!g.bassTransitions.transitions[from]) g.bassTransitions.transitions[from] = {}
      const row = g.bassTransitions.transitions[from]
      if (!row) continue
      const cur = row[to] ?? 0
      row[to] = cur + lr * conf
      // Normalize row
      const sum = Object.values(row).reduce((s, v) => s + v, 0)
      if (sum > 0) for (const k in row) row[k] = (row[k] ?? 0) / sum
    }
  }

  // HARMONY ↔ LEAD
  if (obs.harmonicRoot !== undefined && obs.leadIntervals) {
    const root = obs.harmonicRoot
    if (!g.harmonyLead.intervalPreferences[root]) g.harmonyLead.intervalPreferences[root] = {}
    const prefs = g.harmonyLead.intervalPreferences[root]
    if (!prefs) return g
    for (const interval of obs.leadIntervals) {
      const cur2 = prefs[interval] ?? 0
      prefs[interval] = cur2 + lr * conf
    }
    const sum = Object.values(prefs).reduce((s, v) => s + v, 0)
    if (sum > 0) for (const k in prefs) prefs[k] = (prefs[k] ?? 0) / sum
  }

  // ENERGY ↔ DENSITY
  if (obs.energy !== undefined && obs.density !== undefined) {
    const bin = Math.min(9, Math.floor(obs.energy * 10))
    g.energyDensity.densityByEnergy[bin] =
      (g.energyDensity.densityByEnergy[bin] ?? 0.5) * (1 - lr * conf) + obs.density * lr * conf
  }

  // TENSION ↔ REGISTER
  if (obs.tension !== undefined && obs.leadRegister !== undefined) {
    const bin = Math.min(9, Math.floor(obs.tension * 10))
    g.tensionRegister.registerByTension[bin] =
      (g.tensionRegister.registerByTension[bin] ?? 67) * (1 - lr * conf) +
      obs.leadRegister * lr * conf
  }

  g.confidence = Math.min(1, g.confidence + lr * conf * 0.3)
  return g
}
