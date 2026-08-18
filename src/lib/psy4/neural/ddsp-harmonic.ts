/**
 * DDSP Harmonic Synthesizer — differentiable harmonic additive synthesis.
 *
 * Based on Google Magenta's DDSP (Differentiable Digital Signal Processing).
 * Instead of fixed waveforms, this synth sums N sine harmonics with independent
 * amplitudes. A neural network (or any controller) sets the harmonic amplitudes,
 * fundamental frequency, and noise coefficients — producing any timbre.
 *
 * Why this matters:
 * - A trained network can LEARN to synthesize from audio examples
 * - The synth is differentiable — gradients flow through it for training
 * - Produces sounds impossible with fixed wavetables (continuous harmonic control)
 * - Real-time capable (no FFT needed at inference)
 *
 * Usage:
 *   const synth = new DDSPHarmonic(60)  // 60 harmonics
 *   synth.setFreq(220)
 *   synth.setHarmonics([1.0, 0.5, 0.3, ...])  // 60 amplitudes 0..1
 *   synth.setAmplitude(0.8)
 *   const sample = synth.process()
 *
 * To integrate with neural decoding:
 *   const decoder = new NeuralDecoder(model)  // trained model
 *   const params = decoder.decode(features)    // features → harmonic params
 *   synth.setFreq(params.f0)
 *   synth.setHarmonics(params.harmonics)
 */

export class DDSPHarmonic {
  private phase = 0          // 0..1
  private freq = 220          // Hz
  private harmonics: Float32Array  // 0..1 amplitudes per harmonic
  private amp = 0.8           // master amplitude
  private readonly SR = 44100
  private active = false
  private ampEnv = 0          // envelope follower for smooth note on/off

  constructor(numHarmonics: number = 60) {
    this.harmonics = new Float32Array(numHarmonics)
    // Default: sawtooth-like distribution (1/n)
    for (let n = 0; n < numHarmonics; n++) {
      this.harmonics[n] = 1 / (n + 1)
    }
  }

  setFreq(freq: number): void {
    this.freq = Math.max(20, Math.min(20000, freq))
  }

  setHarmonics(amps: Float32Array | number[]): void {
    const src = Array.isArray(amps) ? amps : Array.from(amps)
    for (let i = 0; i < this.harmonics.length && i < src.length; i++) {
      this.harmonics[i] = Math.max(0, Math.min(1, src[i]!))
    }
  }

  setAmplitude(amp: number): void {
    this.amp = Math.max(0, Math.min(1, amp))
  }

  trigger(amp: number = 0.8): void {
    this.active = true
    this.ampEnv = 0
    this.amp = amp
  }

  noteOff(): void {
    this.active = false
  }

  reset(): void {
    this.phase = 0
    this.ampEnv = 0
    this.active = false
  }

  process(): number {
    if (!this.active && this.ampEnv < 0.001) return 0

    // Advance phase (0..1, wraps)
    const phaseInc = this.freq / this.SR
    this.phase += phaseInc
    if (this.phase >= 1) this.phase -= 1

    // Sum harmonics: sin(2π·n·phase) · amplitude[n]
    // This is additive synthesis — each harmonic is a pure sine.
    let sample = 0
    const twoPi = 2 * Math.PI
    for (let n = 0; n < this.harmonics.length; n++) {
      const amp = this.harmonics[n]!
      if (amp > 0.001) {
        // Only compute harmonics above noise floor
        sample += Math.sin(twoPi * (n + 1) * this.phase) * amp
      }
    }

    // Envelope follower (smooth attack/release)
    const target = this.active ? this.amp : 0
    const envCoef = this.active ? 0.997 : 0.999  // attack faster than release
    this.ampEnv += (target - this.ampEnv) * (1 - envCoef)

    return sample * this.ampEnv
  }

  /** Get current number of harmonics */
  get numHarmonics(): number { return this.harmonics.length }

  /**
   * Set harmonic distribution by preset name.
   * Useful for testing without a trained decoder.
   */
  setPreset(name: 'saw' | 'square' | 'organ' | 'bell' | 'voice' | 'psyLead'): void {
    const N = this.harmonics.length
    switch (name) {
      case 'saw':
        for (let n = 0; n < N; n++) this.harmonics[n] = 1 / (n + 1)
        break
      case 'square':
        for (let n = 0; n < N; n++) this.harmonics[n] = (n % 2 === 0) ? 1 / (n + 1) : 0
        break
      case 'organ':
        // Odd harmonics with decreasing amplitude
        for (let n = 0; n < N; n++) {
          this.harmonics[n] = (n % 2 === 0) ? 1 / Math.pow(n + 1, 0.7) : 0
        }
        break
      case 'bell':
        // Inharmonic-ish: stronger high harmonics
        for (let n = 0; n < N; n++) {
          this.harmonics[n] = Math.exp(-n * 0.05) * (1 + 0.3 * Math.sin(n * 0.7))
        }
        break
      case 'voice':
        // Formant-like: peaks at harmonics 4, 6, 14 (vowel "ah")
        for (let n = 0; n < N; n++) {
          let amp = 1 / (n + 1)
          // Boost near formant positions
          if (Math.abs(n - 4) < 2) amp *= 2
          if (Math.abs(n - 6) < 2) amp *= 1.8
          if (Math.abs(n - 14) < 2) amp *= 1.5
          this.harmonics[n] = amp
        }
        break
      case 'psyLead':
        // Rich harmonics for psytrance lead: fundamental + 2nd + 3rd + 5th + 7th
        for (let n = 0; n < N; n++) {
          const harmonic = n + 1
          let amp = 1 / harmonic
          if (harmonic <= 7) amp *= 1.5  // boost early harmonics
          this.harmonics[n] = amp
        }
        break
    }
  }
}
