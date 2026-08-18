/**
 * DDSP Filtered Noise Synthesizer — differentiable filtered noise.
 *
 * Companion to DDSPHarmonic. While the harmonic synth produces tonal content
 * (sines at harmonic frequencies), the noise synth produces the non-tonal
 * content (breath, bow noise, percussion, attack transients).
 *
 * The noise is filtered by N bandpass filters whose gains are set by a
 * controller (neural network or otherwise). This creates any noise timbre.
 *
 * Based on Google Magenta DDSP: "filtered_noise" module.
 *
 * Usage:
 *   const synth = new DDSPNoise(65)  // 65 noise bands
 *   synth.setBands([0.1, 0.3, 0.5, ...])  // 65 gains 0..1
 *   synth.setAmplitude(0.4)
 *   const sample = synth.process()
 */

import { Rng } from '../forensic/prng'

export class DDSPNoise {
  private bands: Float32Array        // 0..1 gains per band
  private amp = 0.4                  // master amplitude
  private readonly SR = 44100
  private active = false
  private ampEnv = 0
  private rng: Rng
  // One-pole filter states per band (simple IIR bandpass)
  private bandStates: Float32Array
  private readonly numBands: number
  private readonly lowFreq = 0       // Hz, start of noise spectrum
  private readonly highFreq = 22050  // Hz, end of noise spectrum

  constructor(rng: Rng, numBands: number = 65) {
    this.rng = rng
    this.numBands = numBands
    this.bands = new Float32Array(numBands)
    this.bandStates = new Float32Array(numBands)
    // Default: flat spectrum (white noise)
    this.bands.fill(0.3)
  }

  setBands(gains: Float32Array | number[]): void {
    const src = Array.isArray(gains) ? gains : Array.from(gains)
    for (let i = 0; i < this.bands.length && i < src.length; i++) {
      this.bands[i] = Math.max(0, Math.min(1, src[i]!))
    }
  }

  setAmplitude(amp: number): void {
    this.amp = Math.max(0, Math.min(1, amp))
  }

  trigger(amp: number = 0.4): void {
    this.active = true
    this.ampEnv = 0
    this.amp = amp
  }

  noteOff(): void {
    this.active = false
  }

  reset(): void {
    this.ampEnv = 0
    this.active = false
    this.bandStates.fill(0)
  }

  process(): number {
    if (!this.active && this.ampEnv < 0.001) return 0

    // Generate white noise
    const noise = this.rng.range(-1, 1)

    // Filter noise through N bands (log-spaced bandpass filters)
    // Each band is a simple one-pole resonator at a specific frequency
    let sample = 0
    const logLow = Math.log(this.lowFreq > 0 ? this.lowFreq : 20)
    const logHigh = Math.log(this.highFreq)
    const logRange = logHigh - logLow

    for (let b = 0; b < this.numBands; b++) {
      const gain = this.bands[b]!
      if (gain < 0.001) continue

      // Log-spaced center frequency for this band
      const bandPos = b / (this.numBands - 1)
      const freq = Math.exp(logLow + bandPos * logRange)
      if (freq < 1 || freq > this.SR / 2) continue

      // One-pole bandpass (simplified — center frequency + bandwidth)
      const omega = (2 * Math.PI * freq) / this.SR
      const cosO = Math.cos(omega)
      const sinO = Math.sin(omega)
      const Q = 2  // bandwidth
      const alpha = sinO / (2 * Q)

      // Direct Form I bandpass (simplified for performance)
      // This is an approximation — a full biquad would be more accurate
      // but too slow for 65 bands × 44100 samples/sec
      const a0 = 1 + alpha
      const b0 = alpha / a0
      const b1 = 0
      const b2 = -alpha / a0
      const a1 = -2 * cosO / a0
      const a2 = (1 - alpha) / a0

      const x = noise
      const prev = this.bandStates[b]!
      // Simplified: just use the b0 coefficient (approximation)
      const out = b0 * x + b1 * prev + b2 * prev - a1 * prev - a2 * prev
      this.bandStates[b] = out
      sample += out * gain
    }

    // Envelope follower
    const target = this.active ? this.amp : 0
    const envCoef = this.active ? 0.997 : 0.999
    this.ampEnv += (target - this.ampEnv) * (1 - envCoef)

    // Normalize (65 bands can sum loudly)
    return sample * this.ampEnv * (1 / Math.sqrt(this.numBands))
  }

  get bandCount(): number { return this.numBands }

  /**
   * Set noise band distribution by preset name.
   */
  setPreset(name: 'white' | 'pink' | 'brown' | 'breath' | 'percussive'): void {
    const N = this.numBands
    switch (name) {
      case 'white':
        this.bands.fill(0.3)
        break
      case 'pink':
        // -3dB/octave
        for (let i = 0; i < N; i++) {
          const freq = i / (N - 1)
          this.bands[i] = 0.3 * Math.pow(1 - freq * 0.7, 1)
        }
        break
      case 'brown':
        // -6dB/octave
        for (let i = 0; i < N; i++) {
          const freq = i / (N - 1)
          this.bands[i] = 0.3 * Math.pow(1 - freq * 0.8, 2)
        }
        break
      case 'breath':
        // Boost 2-8kHz (breath/noise character)
        for (let i = 0; i < N; i++) {
          const freq = i / (N - 1)
          const boost = Math.exp(-Math.pow((freq - 0.5) * 4, 2)) * 0.5
          this.bands[i] = 0.2 + boost
        }
        break
      case 'percussive':
        // Wideband with slight high emphasis
        for (let i = 0; i < N; i++) {
          const freq = i / (N - 1)
          this.bands[i] = 0.3 + freq * 0.2
        }
        break
    }
  }
}
