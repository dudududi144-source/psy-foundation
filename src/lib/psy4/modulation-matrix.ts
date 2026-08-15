/**
 * Modulation Matrix — routable modulation system for PSY4.
 *
 * Sources: LFO (6 rates), envelope, velocity, macros (3)
 * Destinations: pitch, cutoff, resonance, FM index, amp, pan, drive, delay send
 *
 * Based on PSY4_DEEP_ROAST: "אין modulation matrix — הכל hardcoded"
 * and COMMERCIAL_AUDIO_AUDIT: "S9. אין modulation matrix"
 *
 * Deterministic: all LFOs use phase accumulation, no Math.random.
 */

export type ModSource = 'lfo1' | 'lfo2' | 'lfo3' | 'lfo4' | 'lfo5' | 'lfo6' | 'env' | 'velocity' | 'macro1' | 'macro2' | 'macro3'
export type ModDestination = 'pitch' | 'cutoff' | 'resonance' | 'fmIndex' | 'amp' | 'pan' | 'drive' | 'delaySend'

export interface ModRoute {
  source: ModSource
  destination: ModDestination
  amount: number  // -1..1
}

export class ModulationMatrix {
  private routes: ModRoute[] = []
  private lfoPhases: Record<string, number> = {
    lfo1: 0, lfo2: 0, lfo3: 0, lfo4: 0, lfo5: 0, lfo6: 0,
  }
  private lfoRates: Record<string, number> = {
    lfo1: 0.3,   // slow filter sweep
    lfo2: 2.0,   // acid bidirectional
    lfo3: 5.5,   // shimmer
    lfo4: 0.15,  // pad morph
    lfo5: 0.1,   // texture morph
    lfo6: 0.05,  // ultra-slow evolution
  }
  private envValue = 0
  private velocity = 0.5
  private macros: Record<string, number> = {
    macro1: 0.5,  // SPACE: reverb + delay + filter
    macro2: 0.5,  // ENERGY: drive + volume + filter
    macro3: 0.5,  // TENSION: filter + reso + swing
  }

  addRoute(route: ModRoute): void {
    this.routes.push(route)
  }

  setMacro(name: 'macro1' | 'macro2' | 'macro3', value: number): void {
    this.macros[name] = Math.max(0, Math.min(1, value))
  }

  setVelocity(vel: number): void {
    this.velocity = Math.max(0, Math.min(1, vel))
  }

  setEnvValue(value: number): void {
    this.envValue = value
  }

  /** Advance all LFO phases by one sample. */
  tick(sampleRate: number): void {
    for (const key of Object.keys(this.lfoPhases)) {
      const rate = this.lfoRates[key]!
      this.lfoPhases[key] = (this.lfoPhases[key]! + rate / sampleRate) % 1
    }
  }

  /** Get the current value of a modulation source. */
  getSourceValue(source: ModSource): number {
    if (source.startsWith('lfo')) {
      const phase = this.lfoPhases[source]!
      return Math.sin(2 * Math.PI * phase)
    }
    if (source === 'env') return this.envValue
    if (source === 'velocity') return this.velocity
    if (source.startsWith('macro')) {
      return this.macros[source]! * 2 - 1 // -1..1
    }
    return 0
  }

  /** Apply all routes to a set of voice parameters. Returns modified params. */
  apply(params: {
    pitch?: number
    cutoff?: number
    resonance?: number
    fmIndex?: number
    amp?: number
    pan?: number
    drive?: number
    delaySend?: number
  }): void {
    for (const route of this.routes) {
      const sourceValue = this.getSourceValue(route.source)
      const amount = route.amount
      switch (route.destination) {
        case 'pitch':
          if (params.pitch !== undefined) params.pitch *= Math.pow(2, sourceValue * amount * 0.1 / 12)
          break
        case 'cutoff':
          if (params.cutoff !== undefined) params.cutoff *= (1 + sourceValue * amount * 0.5)
          break
        case 'resonance':
          if (params.resonance !== undefined) params.resonance = Math.max(0, Math.min(1, params.resonance + sourceValue * amount * 0.3))
          break
        case 'fmIndex':
          if (params.fmIndex !== undefined) params.fmIndex *= (1 + sourceValue * amount * 0.5)
          break
        case 'amp':
          if (params.amp !== undefined) params.amp *= (1 + sourceValue * amount * 0.3)
          break
        case 'pan':
          if (params.pan !== undefined) params.pan += sourceValue * amount * 0.5
          break
        case 'drive':
          if (params.drive !== undefined) params.drive *= (1 + sourceValue * amount * 0.5)
          break
        case 'delaySend':
          if (params.delaySend !== undefined) params.delaySend = Math.max(0, Math.min(1, params.delaySend + sourceValue * amount * 0.3))
          break
      }
    }
  }

  /** Default routes based on PSY4_DEEP_ROAST recommendations. */
  static createDefault(): ModulationMatrix {
    const matrix = new ModulationMatrix()
    // LFO1 (0.3Hz) → lead cutoff (depth 0.3)
    matrix.addRoute({ source: 'lfo1', destination: 'cutoff', amount: 0.3 })
    // LFO2 (2Hz) → acid cutoff (depth 0.7, bidirectional)
    matrix.addRoute({ source: 'lfo2', destination: 'cutoff', amount: 0.7 })
    // LFO3 (5.5Hz) → lead FM index (depth 0.2)
    matrix.addRoute({ source: 'lfo3', destination: 'fmIndex', amount: 0.2 })
    // Velocity → lead brightness (0.5)
    matrix.addRoute({ source: 'velocity', destination: 'cutoff', amount: 0.5 })
    // Macro1 (SPACE) → delay send
    matrix.addRoute({ source: 'macro1', destination: 'delaySend', amount: 0.5 })
    // Macro2 (ENERGY) → drive
    matrix.addRoute({ source: 'macro2', destination: 'drive', amount: 0.5 })
    // Macro3 (TENSION) → resonance
    matrix.addRoute({ source: 'macro3', destination: 'resonance', amount: 0.3 })
    return matrix
  }
}
