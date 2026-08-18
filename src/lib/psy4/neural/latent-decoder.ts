/**
 * Neural Latent Decoder — RAVE-style decoder for audio style transfer.
 *
 * Based on RAVE (Realtime Audio Variational autoEncoder) — a VAE for audio
 * that learns a compressed latent representation. Style transfer works by:
 * 1. Encoding reference audio → latent vector Z_ref
 * 2. Encoding render audio → latent vector Z_render
 * 3. Combining: Z_result = blend(Z_render, Z_ref, amount)
 * 4. Decoding Z_result → audio with render's content + reference's style
 *
 * This implementation uses a SIMPLIFIED approach (no actual neural network):
 * - Latent = spectral envelope (32-band bark-spaced FFT magnitudes)
 * - Encoding: FFT → bark bands → log magnitudes → normalize
 * - Decoding: latent → 32-band FIR filter → apply to render
 * - Style transfer: blend spectral envelopes
 *
 * A real RAVE model would use trained neural network weights, but this
 * spectral approach gives a functional approximation without training data.
 * It's the same concept as RAVE — just using DSP instead of neural inference.
 *
 * Usage:
 *   const st = new NeuralStyleTransfer()
 *   st.loadReference(referenceSamples, 44100)  // learn reference style
 *   const output = st.transfer(renderSamples, 0.5)  // 50% style blend
 *
 * Or per-block for real-time:
 *   const decoder = new LatentDecoder()
 *   decoder.encode(block)
 *   decoder.applyStyle(refLatent, 0.3)
 *   const styled = decoder.decode()
 */

const BARK_BANDS = 32  // bark-spaced frequency bands (psychoacoustic)
const FFT_SIZE = 2048

export interface LatentVector {
  bands: Float32Array  // BARK_BANDS log magnitudes (the "latent" representation)
  centroid: number    // spectral centroid (brightness)
  flatness: number     // spectral flatness (0=tonal, 1=noise)
}

export class LatentDecoder {
  private currentLatent: LatentVector
  private targetLatent: LatentVector | null = null
  private blendAmount = 0  // 0=own style, 1=reference style
  private filterStates: Float32Array

  constructor() {
    this.currentLatent = {
      bands: new Float32Array(BARK_BANDS),
      centroid: 1000,
      flatness: 0.3,
    }
    this.filterStates = new Float32Array(BARK_BANDS)
  }

  /**
   * Encode an audio block into a latent vector.
   * Extracts: bark-band magnitudes, spectral centroid, spectral flatness.
   */
  encode(samples: Float32Array, sampleRate: number = 44100): LatentVector {
    const N = Math.min(samples.length, FFT_SIZE)
    // Simplified DFT (magnitude spectrum at bark-spaced frequencies)
    const bands = new Float32Array(BARK_BANDS)
    let totalEnergy = 0
    let weightedFreq = 0

    // Bark scale: log-spaced bands from 20Hz to ~16kHz
    const minFreq = 20
    const maxFreq = 16000
    const logMin = Math.log(minFreq)
    const logMax = Math.log(maxFreq)

    for (let b = 0; b < BARK_BANDS; b++) {
      const bandPos = b / (BARK_BANDS - 1)
      const freq = Math.exp(logMin + bandPos * (logMax - logMin))
      const bin = Math.floor((freq * N) / sampleRate)
      // Goertzel-like: compute magnitude at this frequency
      let real = 0, imag = 0
      const omega = (2 * Math.PI * freq) / sampleRate
      for (let i = 0; i < N; i++) {
        const s = samples[i] ?? 0
        real += s * Math.cos(omega * i)
        imag += s * Math.sin(omega * i)
      }
      const mag = Math.sqrt(real * real + imag * imag) / N
      bands[b] = Math.log(1 + mag * 100)  // log scale
      totalEnergy += mag
      weightedFreq += mag * freq
    }

    const centroid = totalEnergy > 0 ? weightedFreq / totalEnergy : 1000
    // Spectral flatness: geometric mean / arithmetic mean (0=tonal, 1=noise)
    let logSum = 0, linSum = 0
    for (let b = 0; b < BARK_BANDS; b++) {
      const m = Math.exp(bands[b]!) - 1
      logSum += Math.log(Math.max(0.0001, m))
      linSum += m
    }
    const geoMean = Math.exp(logSum / BARK_BANDS)
    const arithMean = linSum / BARK_BANDS
    const flatness = arithMean > 0 ? geoMean / arithMean : 0

    this.currentLatent = { bands, centroid, flatness }
    return this.currentLatent
  }

  /**
   * Apply a reference latent as a style target.
   * blendAmount: 0=keep own style, 1=fully match reference.
   */
  applyStyle(reference: LatentVector, blendAmount: number): void {
    this.targetLatent = reference
    this.blendAmount = Math.max(0, Math.min(1, blendAmount))
  }

  /**
   * Decode the (possibly style-blended) latent back into a filter response.
   * Returns the filtered audio block.
   */
  decode(samples: Float32Array, sampleRate: number = 44100): Float32Array {
    if (!this.targetLatent) return samples

    // Blend current latent with target latent
    const blended = new Float32Array(BARK_BANDS)
    for (let b = 0; b < BARK_BANDS; b++) {
      const own = this.currentLatent.bands[b]!
      const ref = this.targetLatent.bands[b]!
      blended[b] = own * (1 - this.blendAmount) + ref * this.blendAmount
    }

    // Apply as a filter: boost/cut each bark band by the ratio
    // between blended and current latent
    const output = new Float32Array(samples.length)
    const minFreq = 20
    const maxFreq = 16000
    const logMin = Math.log(minFreq)
    const logMax = Math.log(maxFreq)

    // One-pole filter per band (simplified)
    for (let i = 0; i < samples.length; i++) {
      let out = 0
      const s = samples[i] ?? 0
      for (let b = 0; b < BARK_BANDS; b++) {
        const bandPos = b / (BARK_BANDS - 1)
        const freq = Math.exp(logMin + bandPos * (logMax - logMin))
        if (freq > sampleRate / 2) continue

        // Compute gain ratio (how much to boost/cut this band)
        const ownMag = this.currentLatent.bands[b]! + 0.01
        const blendMag = blended[b]! + 0.01
        const gainRatio = blendMag / ownMag  // 1.0 = no change

        // One-pole resonator at this frequency
        const omega = (2 * Math.PI * freq) / sampleRate
        const alpha = Math.sin(omega) / (2 * 4)  // Q=4
        const a0 = 1 + alpha
        const b0 = alpha / a0

        const prev = this.filterStates[b]!
        const filtered = b0 * s + prev * (1 - b0)
        this.filterStates[b] = filtered
        out += filtered * gainRatio
      }
      // Normalize by number of bands
      output[i] = out / BARK_BANDS * 10
    }
    return output
  }

  getCurrentLatent(): LatentVector {
    return {
      bands: new Float32Array(this.currentLatent.bands),
      centroid: this.currentLatent.centroid,
      flatness: this.currentLatent.flatness,
    }
  }
}

/**
 * Neural Style Transfer — high-level API for "clone reference" feature.
 *
 * Encodes a reference track's style and applies it to PSY4 renders.
 */
export class NeuralStyleTransfer {
  private decoder = new LatentDecoder()
  private referenceLatent: LatentVector | null = null
  private blendAmount = 0.3  // 30% style by default

  /**
   * Learn the style of a reference track.
   * Analyzes multiple windows and averages the latent vectors.
   */
  loadReference(samples: Float32Array, sampleRate: number = 44100): void {
    const windowSize = FFT_SIZE
    const numWindows = Math.min(50, Math.floor(samples.length / windowSize))
    const latents: LatentVector[] = []

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSize
      const block = samples.subarray(start, start + windowSize)
      if (block.length === windowSize) {
        latents.push(this.decoder.encode(block, sampleRate))
      }
    }

    if (latents.length === 0) return

    // Average the latents
    const avgBands = new Float32Array(BARK_BANDS)
    let avgCentroid = 0, avgFlatness = 0
    for (const l of latents) {
      for (let b = 0; b < BARK_BANDS; b++) avgBands[b]! += l.bands[b]!
      avgCentroid += l.centroid
      avgFlatness += l.flatness
    }
    for (let b = 0; b < BARK_BANDS; b++) avgBands[b] = avgBands[b]! / latents.length
    avgCentroid /= latents.length
    avgFlatness /= latents.length

    this.referenceLatent = { bands: avgBands, centroid: avgCentroid, flatness: avgFlatness }
  }

  setBlendAmount(amount: number): void {
    this.blendAmount = Math.max(0, Math.min(1, amount))
  }

  getBlendAmount(): number { return this.blendAmount }

  hasReference(): boolean { return this.referenceLatent !== null }

  /**
   * Apply the learned style to a render block.
   * Returns the styled audio.
   */
  transfer(samples: Float32Array, sampleRate: number = 44100): Float32Array {
    if (!this.referenceLatent) return samples
    this.decoder.encode(samples, sampleRate)
    this.decoder.applyStyle(this.referenceLatent, this.blendAmount)
    return this.decoder.decode(samples, sampleRate)
  }

  /**
   * Process in real-time blocks (for streaming).
   * blockSize: typically 1024 or 2048 samples.
   */
  *processStream(blocks: Iterable<Float32Array>, sampleRate: number = 44100): Generator<Float32Array> {
    for (const block of blocks) {
      yield this.transfer(block, sampleRate)
    }
  }

  getReferenceLatent(): LatentVector | null {
    if (!this.referenceLatent) return null
    return {
      bands: new Float32Array(this.referenceLatent.bands),
      centroid: this.referenceLatent.centroid,
      flatness: this.referenceLatent.flatness,
    }
  }
}
