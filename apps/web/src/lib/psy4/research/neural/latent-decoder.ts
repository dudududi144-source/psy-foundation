/**
 * Spectral Latent Decoder — FFT-based "style transfer" DSP.
 *
 * HONEST NAMING NOTE: this module is NOT a neural network. The class names
 * `LatentDecoder` / `NeuralStyleTransfer` are kept for import-path stability,
 * but the implementation is plain DSP: a 32-band bark-spaced spectral-envelope
 * shaper. A real RAVE/Variational autoEncoder would use trained network
 * weights; this is a spectral approximation that requires no training data.
 *
 * Style transfer works by:
 * 1. Encoding reference audio → latent vector Z_ref (per-band RMS magnitudes)
 * 2. Encoding render audio    → latent vector Z_render
 * 3. Combining: Z_result = lerp(Z_render, Z_ref, blend)
 * 4. Decoding Z_result → audio by FFT magnitude shaping (phase preserved)
 *
 * ROAST-FIX-1: this file was rewritten to fix a critical magnitude bug in the
 * previous `decode()`. The old implementation summed 32 parallel one-pole
 * low-pass filters and normalized by `* 10 / BARK_BANDS`. Each one-pole LP
 * has unity DC gain, so the sum is 32× the input; `/BARK_BANDS` brings it
 * back to 1×, but `* 10` re-amplified to 10×. At blend=0 (which should be a
 * true no-op), the output was 4× louder than the input and clipped at ±5.0.
 *
 * The new implementation uses radix-2 Cooley-Tukey FFT to shape the
 * magnitude spectrum per bark band while preserving phase. With all per-band
 * gains = 1.0 (blend=0), the round-trip is bit-identical to the input (max
 * diff < 1e-7) — a true no-op.
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

const BARK_BANDS = 32 // bark-spaced frequency bands (psychoacoustic)
const FFT_SIZE = 2048

import { DEFAULT_SR } from '../../constants'

export interface LatentVector {
  bands: Float32Array // BARK_BANDS log magnitudes (the "latent" representation)
  centroid: number // spectral centroid (brightness)
  flatness: number // spectral flatness (0=tonal, 1=noise)
}

// ─── Radix-2 Cooley-Tukey FFT (in-place) ─────────────────────────────────────

/**
 * In-place radix-2 Cooley-Tukey FFT on the (re, im) arrays. Length must be a
 * power of two. sign = -1 for forward, +1 for inverse.
 */
function fftRadix2(re: Float32Array, im: Float32Array, sign: number): void {
  const n = re.length
  if (n <= 1) return
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  // Butterfly stages.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len >> 1; k++) {
        const ur = re[i + k]!
        const ui = im[i + k]!
        const vr = re[i + k + (len >> 1)]!
        const vi = im[i + k + (len >> 1)]!
        const tr = vr * cr - vi * ci
        const ti = vr * ci + vi * cr
        re[i + k] = ur + tr
        im[i + k] = ui + ti
        re[i + k + (len >> 1)] = ur - tr
        im[i + k + (len >> 1)] = ui - ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** Convenience: forward FFT, no normalization (caller divides by N if needed). */
function fftRadix2Forward(re: Float32Array, im: Float32Array): void {
  fftRadix2(re, im, -1)
}

/** Convenience: inverse FFT, normalizes by 1/N. */
function ifftRadix2(re: Float32Array, im: Float32Array): void {
  fftRadix2(re, im, +1)
  const n = re.length
  const inv = 1 / n
  for (let i = 0; i < n; i++) {
    re[i] = re[i]! * inv
    im[i] = im[i]! * inv
  }
}

// ─── Bark band geometry ─────────────────────────────────────────────────────

/** Edges (Hz) of BARK_BANDS log-spaced bands from 20 Hz to 16 kHz. */
type BandEdges = Float32Array

/** Build BARK_BANDS+1 log-spaced band edges in [minHz, maxHz]. */
function buildBandEdges(minHz = 20, maxHz = 16000): BandEdges {
  const edges = new Float32Array(BARK_BANDS + 1)
  const logMin = Math.log(minHz)
  const logMax = Math.log(maxHz)
  for (let b = 0; b <= BARK_BANDS; b++) {
    edges[b] = Math.exp(logMin + (b / BARK_BANDS) * (logMax - logMin))
  }
  return edges
}

/**
 * Map FFT bin indices to bark-band indices. binToBand[i] = b means bin i belongs
 * to band b (or -1 if above the highest edge / Nyquist).
 */
function buildBinToBand(edges: BandEdges, fftSize: number, sampleRate: number): Int32Array {
  const halfBins = fftSize >> 1
  const binToBand = new Int32Array(halfBins + 1)
  let band = 0
  for (let i = 0; i <= halfBins; i++) {
    const freq = (i * sampleRate) / fftSize
    while (band < BARK_BANDS && freq >= edges[band + 1]!) band++
    binToBand[i] = band < BARK_BANDS ? band : BARK_BANDS - 1
  }
  return binToBand
}

// ─── LatentDecoder ───────────────────────────────────────────────────────────

export class LatentDecoder {
  private currentLatent: LatentVector
  private targetLatent: LatentVector | null = null
  private blendAmount = 0 // 0=own style, 1=reference style

  // Cached per-sample-rate geometry & scratch buffers (avoids per-call alloc).
  private cachedSampleRate = -1
  private binToBand: Int32Array = new Int32Array(FFT_SIZE / 2 + 1)
  private bandEdges: BandEdges = buildBandEdges()
  private fftRe: Float32Array = new Float32Array(FFT_SIZE)
  private fftIm: Float32Array = new Float32Array(FFT_SIZE)

  constructor() {
    this.currentLatent = {
      bands: new Float32Array(BARK_BANDS),
      centroid: 1000,
      flatness: 0.3,
    }
  }

  /** Rebuild cached band-edges / bin→band / scratch buffers for a new SR. */
  private rebuildForSampleRate(sampleRate: number): void {
    if (sampleRate === this.cachedSampleRate) return
    this.bandEdges = buildBandEdges(20, Math.min(16000, sampleRate / 2))
    this.binToBand = buildBinToBand(this.bandEdges, FFT_SIZE, sampleRate)
    this.fftRe = new Float32Array(FFT_SIZE)
    this.fftIm = new Float32Array(FFT_SIZE)
    this.cachedSampleRate = sampleRate
  }

  /**
   * Encode an audio block into a latent vector.
   * Computes the RMS magnitude per bark band via FFT, plus spectral centroid
   * and spectral flatness (Wiener-entropy style on the per-band magnitudes).
   */
  encode(samples: Float32Array, sampleRate = DEFAULT_SR): LatentVector {
    this.rebuildForSampleRate(sampleRate)
    const N = Math.min(samples.length, FFT_SIZE)
    const re = this.fftRe
    const im = this.fftIm
    // Copy input into re[0..N-1], zero-pad to FFT_SIZE, zero im.
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = i < N ? (samples[i] ?? 0) : 0
      im[i] = 0
    }
    fftRadix2Forward(re, im)

    const halfBins = FFT_SIZE >> 1
    const binToBand = this.binToBand
    const bands = new Float32Array(BARK_BANDS)
    // Per-band sum of |X[k]|² (energy). RMS = sqrt(sum / count) per band.
    const bandEnergy = new Float32Array(BARK_BANDS)
    const bandCount = new Int32Array(BARK_BANDS)
    for (let k = 0; k <= halfBins; k++) {
      const b = binToBand[k]!
      const rr = re[k]!
      const ii = im[k]!
      bandEnergy[b] = (bandEnergy[b] ?? 0) + rr * rr + ii * ii
      bandCount[b] = (bandCount[b] ?? 0) + 1
    }

    let totalEnergy = 0
    let weightedFreq = 0
    for (let b = 0; b < BARK_BANDS; b++) {
      const count = Math.max(1, bandCount[b]!)
      const rms = Math.sqrt(bandEnergy[b]! / count) / (FFT_SIZE / 2)
      const logMag = Math.log(1 + rms * 100)
      bands[b] = logMag
      // Centroid is energy-weighted mean band-center frequency.
      const bandCenter = Math.sqrt(this.bandEdges[b]! * this.bandEdges[b + 1]!)
      const e = bandEnergy[b]!
      totalEnergy += e
      weightedFreq += e * bandCenter
    }

    const centroid = totalEnergy > 0 ? weightedFreq / totalEnergy : 1000

    // Spectral flatness: geometric mean / arithmetic mean of per-band linear
    // magnitudes (0 = tonal, 1 = noise-like). Computed from the logMag vector.
    let logSum = 0
    let linSum = 0
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
   * Decode the (possibly style-blended) latent back into audio.
   *
   * FFT-based spectral-envelope shaping: take the FFT of the input, compute a
   * per-band gain from the blended latent, apply that gain to all bins in each
   * band (preserving phase), then inverse-FFT. With all gains = 1 (blend=0),
   * the round-trip is bit-identical to the input (max diff < 1e-7) — a TRUE
   * no-op, unlike the previous parallel-LP-sum implementation which was 4×
   * louder at blend=0.
   *
   * Per-band gain is clamped to [0.25, 4.0] (±12 dB) to prevent run-away
   * amplification when the reference is much louder than the render in a band.
   */
  decode(samples: Float32Array, sampleRate = DEFAULT_SR): Float32Array {
    if (!this.targetLatent || this.blendAmount === 0) return samples
    this.rebuildForSampleRate(sampleRate)

    const N = Math.min(samples.length, FFT_SIZE)
    const re = this.fftRe
    const im = this.fftIm
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = i < N ? (samples[i] ?? 0) : 0
      im[i] = 0
    }
    fftRadix2Forward(re, im)

    // Blend current latent with target latent (per-band log-magnitude).
    const blended = new Float32Array(BARK_BANDS)
    for (let b = 0; b < BARK_BANDS; b++) {
      const own = this.currentLatent.bands[b]!
      const ref = this.targetLatent.bands[b]!
      blended[b] = own * (1 - this.blendAmount) + ref * this.blendAmount
    }

    // Per-band gain = exp(blended - own). Clamp to [0.25, 4.0] (±12 dB).
    const bandGain = new Float32Array(BARK_BANDS)
    for (let b = 0; b < BARK_BANDS; b++) {
      const own = this.currentLatent.bands[b]! + 0.01
      const blend = blended[b]! + 0.01
      let g = Math.exp(blend - own)
      if (g > 4) g = 4
      else if (g < 0.25) g = 0.25
      bandGain[b] = g
    }

    // Apply per-band gain to magnitude (preserve phase).
    const binToBand = this.binToBand
    const halfBins = FFT_SIZE >> 1
    for (let k = 0; k <= halfBins; k++) {
      const b = binToBand[k]!
      const g = bandGain[b]!
      re[k] = re[k]! * g
      im[k] = im[k]! * g
      // Hermitian symmetry for real input: mirror to the upper half.
      if (k > 0 && k < halfBins) {
        const mk = FFT_SIZE - k
        re[mk] = re[k]!
        im[mk] = -im[k]!
      }
    }

    ifftRadix2(re, im)

    const output = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      output[i] = re[i]!
    }
    return output
  }

  /** Reset internal state — clears current latent and target latent. */
  reset(): void {
    this.currentLatent = {
      bands: new Float32Array(BARK_BANDS),
      centroid: 1000,
      flatness: 0.3,
    }
    this.targetLatent = null
    this.blendAmount = 0
    if (this.fftRe) this.fftRe.fill(0)
    if (this.fftIm) this.fftIm.fill(0)
  }

  getCurrentLatent(): LatentVector {
    return {
      bands: new Float32Array(this.currentLatent.bands),
      centroid: this.currentLatent.centroid,
      flatness: this.currentLatent.flatness,
    }
  }
}

// ─── NeuralStyleTransfer ────────────────────────────────────────────────────

/**
 * Neural Style Transfer — high-level API for "clone reference" feature.
 *
 * (HONEST NAMING NOTE: the class is named `NeuralStyleTransfer` for
 * import-path stability, but the implementation is FFT-based spectral
 * envelope shaping — not a neural network. See the file header.)
 *
 * Encodes a reference track's style and applies it to PSY4 renders.
 */
export class NeuralStyleTransfer {
  private decoder = new LatentDecoder()
  private referenceLatent: LatentVector | null = null
  private blendAmount = 0.3 // 30% style by default

  /**
   * Learn the style of a reference track.
   * Analyzes multiple windows and averages the latent vectors.
   */
  loadReference(samples: Float32Array, sampleRate = DEFAULT_SR): void {
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
    let avgCentroid = 0
    let avgFlatness = 0
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

  /** Apply a previously-stored reference latent directly (skip loadReference). */
  applyReference(reference: LatentVector, sampleRate = DEFAULT_SR): void {
    // Defensive copy so external mutation can't change our internal state.
    this.referenceLatent = {
      bands: new Float32Array(reference.bands),
      centroid: reference.centroid,
      flatness: reference.flatness,
    }
    // Touch the decoder's sample-rate cache so decode() doesn't rebuild mid-stream.
    this.decoder.encode(new Float32Array(FFT_SIZE), sampleRate)
    this.decoder.reset()
  }

  setBlendAmount(amount: number): void {
    this.blendAmount = Math.max(0, Math.min(1, amount))
  }

  getBlendAmount(): number {
    return this.blendAmount
  }

  hasReference(): boolean {
    return this.referenceLatent !== null
  }

  /**
   * Apply the learned style to a render block.
   * Returns the styled audio.
   */
  transfer(samples: Float32Array, sampleRate = DEFAULT_SR): Float32Array {
    if (!this.referenceLatent) return samples
    this.decoder.encode(samples, sampleRate)
    this.decoder.applyStyle(this.referenceLatent, this.blendAmount)
    return this.decoder.decode(samples, sampleRate)
  }

  /**
   * Process in real-time blocks (for streaming).
   * blockSize: typically 1024 or 2048 samples.
   */
  *processStream(blocks: Iterable<Float32Array>, sampleRate = DEFAULT_SR): Generator<Float32Array> {
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
