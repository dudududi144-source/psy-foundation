/**
 * TensionDimensions — seven tension dimensions, each with a REAL consumer in
 * the composition engine.
 *
 * F21 requirement: each tension dimension that is claimed to be active must
 * have an actual consumer. The seven dimensions:
 *
 *   HARMONIC    → harmonic instability / target selection
 *   MELODIC     → interval / contour behavior
 *   RHYTHMIC    → syncopation / rests
 *   REGISTER    → register expansion/compression
 *   DENSITY     → event density
 *   SPECTRAL    → timbral movement (→ SoundDNA)
 *   EXPECTATION → continuation vs surprise
 *
 * Each dimension is a function that takes the current tension level (0..1)
 * and returns a concrete value the composition engine consumes. The engine
 * reads these values during generation — they are NOT just stored metadata.
 */

/**
 * The seven tension dimensions. Each maps to a concrete composition behavior.
 */
export interface TensionDimensions {
  /** HARMONIC: chord instability 0..1 (0 = stable root, 1 = unstable extensions). */
  harmonic: number
  /** MELODIC: max interval size (semitones) the lead/bass may use. */
  melodic: number
  /** RHYTHMIC: syncopation probability 0..1 (0 = straight, 1 = fully syncopated). */
  rhythmic: number
  /** REGISTER: register expansion in semitones (±around the center). */
  register: number
  /** DENSITY: event density multiplier 0.3..1.5. */
  density: number
  /** SPECTRAL: brightness target 0..1 (→ SoundDNA cutoff/brightness). */
  spectral: number
  /** EXPECTATION: surprise probability 0..1 (0 = continue, 1 = disrupt). */
  expectation: number
}

/**
 * Derive the seven tension dimensions from a single tension level (0..1).
 * Low tension → stable, narrow, straight, compressed, sparse, dark, continuous.
 * High tension → unstable, wide, syncopated, expanded, dense, bright, surprising.
 *
 * The CompositionEngine reads these values during generation — they are the
 * causal bridge from context.tension to actual musical decisions.
 */
export function deriveTensionDimensions(tension: number): TensionDimensions {
  const t = Math.max(0, Math.min(1, tension))
  return {
    // HARMONIC: low tension → stable triads; high → extensions (7th, 9th, #11).
    harmonic: t,
    // MELODIC: low → 3 semitone max interval; high → 10 semitone max.
    melodic: Math.round(3 + t * 7),
    // RHYTHMIC: low → 0.1 syncopation; high → 0.8 syncopation.
    rhythmic: 0.1 + t * 0.7,
    // REGISTER: low → ±2 semitones; high → ±8 semitones.
    register: Math.round(2 + t * 6),
    // DENSITY: low → 0.5x density; high → 1.3x density.
    density: 0.5 + t * 0.8,
    // SPECTRAL: low → 0.2 brightness; high → 0.9 brightness.
    spectral: 0.2 + t * 0.7,
    // EXPECTATION: low → 0.05 surprise; high → 0.5 surprise.
    expectation: 0.05 + t * 0.45,
  }
}

/**
 * Apply harmonic tension to a chord-tone set. At high tension, add an
 * extension (7th, 9th, or #11) to the chord tones.
 */
export function applyHarmonicTension(
  chordTones: number[],
  tension: number,
  scalePcs: number[]
): number[] {
  const dims = deriveTensionDimensions(tension)
  if (dims.harmonic < 0.4) return chordTones
  // Add one extension from the scale.
  const extensions = scalePcs.filter((pc) => !chordTones.includes(pc))
  if (extensions.length === 0) return chordTones
  const idx = Math.floor(dims.harmonic * (extensions.length - 1))
  const ext = extensions[Math.min(idx, extensions.length - 1)]
  if (ext !== undefined) return [...chordTones, ext]
  return chordTones
}

/**
 * Apply melodic tension to filter candidate intervals. At high tension, wider
 * intervals are permitted; at low tension, only narrow intervals pass.
 */
export function applyMelodicTension(intervals: number[], tension: number): number[] {
  const dims = deriveTensionDimensions(tension)
  return intervals.filter((iv) => Math.abs(iv) <= dims.melodic)
}

/**
 * Apply rhythmic tension to a syncopation probability. At high tension, more
 * syncopation is permitted.
 */
export function applyRhythmicTension(baseSyncopation: number, tension: number): number {
  const dims = deriveTensionDimensions(tension)
  return Math.max(baseSyncopation, dims.rhythmic * 0.7)
}

/**
 * Apply register tension to a register center. At high tension, the register
 * expands upward; at low tension, it compresses toward the center.
 */
export function applyRegisterTension(registerCenter: number, tension: number): number {
  const dims = deriveTensionDimensions(tension)
  return registerCenter + (tension - 0.5) * dims.register
}

/**
 * Apply density tension to a note count target. At high tension, more notes;
 * at low tension, fewer notes.
 */
export function applyDensityTension(baseDensity: number, tension: number): number {
  const dims = deriveTensionDimensions(tension)
  return Math.max(0.1, Math.min(1, baseDensity * dims.density))
}

/**
 * Apply spectral tension to a brightness target. At high tension, brighter.
 * This value flows into SoundDNA → synth cutoff.
 */
export function applySpectralTension(baseBrightness: number, tension: number): number {
  const dims = deriveTensionDimensions(tension)
  return Math.max(0, Math.min(1, baseBrightness * 0.5 + dims.spectral * 0.5))
}

/**
 * Apply expectation tension — returns true if the phrase should "surprise"
 * (break pattern continuity). At low tension, almost never; at high tension,
 * up to 50% of the time.
 */
export function shouldSurprise(tension: number, rng: { next: () => number }): boolean {
  const dims = deriveTensionDimensions(tension)
  return rng.next() < dims.expectation
}
