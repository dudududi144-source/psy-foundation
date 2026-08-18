/**
 * ONNX Inference Module — load and run trained neural network models.
 *
 * This module provides inference for the DDSP and RAVE models trained by
 * the Python training scripts. Uses ONNX Runtime Web for browser inference
 * or ONNX Runtime Node for server-side inference.
 *
 * Architecture:
 *   - ONNXDDSPDecoder: loads ddsp_{voice}.onnx, decodes audio features → harmonics
 *   - ONNXRAVEEncoder: loads rave_encoder.onnx, encodes audio → latent
 *   - ONNXRAVEDecoder: loads rave_decoder.onnx, decodes latent → audio
 *
 * If no ONNX model is found, falls back to the spectral approximation
 * in latent-decoder.ts (functional placeholder).
 *
 * Usage:
 *   const decoder = new ONNXDDSPDecoder('/models/ddsp_lead.onnx')
 *   await decoder.init()
 *   const harmonics = decoder.decode(spectrogramFeatures)
 *   synth.setHarmonics(harmonics)
 *
 * Requirements:
 *   npm install onnxruntime-web  (for browser)
 *   npm install onnxruntime-node  (for server)
 */

// Dynamic import to avoid requiring onnxruntime as a hard dependency
let ort: any = null

async function loadORT(): Promise<any> {
  if (ort) return ort
  try {
    if (typeof window !== 'undefined') {
      // Browser
      ort = await import('onnxruntime-web')
    } else {
      // Node.js
      ort = await import('onnxruntime-node')
    }
    return ort
  } catch (e) {
    console.warn('ONNX Runtime not available, falling back to spectral approximation:', e)
    return null
  }
}

/**
 * ONNX DDSP Decoder — loads trained model and predicts harmonic amplitudes.
 */
export class ONNXDDSPDecoder {
  private session: any = null
  private modelPath: string
  private initialized = false

  constructor(modelPath: string = '/models/ddsp_lead.onnx') {
    this.modelPath = modelPath
  }

  async init(): Promise<boolean> {
    if (this.initialized) return true
    const ortInstance = await loadORT()
    if (!ortInstance) return false

    try {
      this.session = await ortInstance.InferenceSession.create(this.modelPath)
      this.initialized = true
      return true
    } catch (e) {
      console.warn(`Failed to load ONNX model ${this.modelPath}:`, e)
      return false
    }
  }

  /**
   * Decode audio features → 60 harmonic amplitudes.
   * Returns null if model not loaded (caller should fall back to presets).
   */
  decode(spectrogram: Float32Array): Float32Array | null {
    if (!this.session) return null

    try {
      // Create input tensor (1, 1, 1024, 128)
      const inputTensor = new ort.Tensor('float32', spectrogram, [1, 1, 1024, 128])
      const feeds = { spectrogram: inputTensor }
      const results = this.session.run(feeds)
      return results.harmonics.data as Float32Array
    } catch (e) {
      console.error('ONNX inference failed:', e)
      return null
    }
  }

  get isReady(): boolean { return this.initialized }
}

/**
 * ONNX RAVE Encoder — encodes audio to latent vector.
 */
export class ONNXRAVEEncoder {
  private session: any = null
  private modelPath: string
  private initialized = false

  constructor(modelPath: string = '/models/rave_encoder.onnx') {
    this.modelPath = modelPath
  }

  async init(): Promise<boolean> {
    if (this.initialized) return true
    const ortInstance = await loadORT()
    if (!ortInstance) return false

    try {
      this.session = await ortInstance.InferenceSession.create(this.modelPath)
      this.initialized = true
      return true
    } catch (e) {
      console.warn(`Failed to load ONNX model ${this.modelPath}:`, e)
      return false
    }
  }

  /**
   * Encode audio → latent vector (μ, σ).
   * Returns { mu, logvar } or null if not loaded.
   */
  encode(audio: Float32Array): { mu: Float32Array; logvar: Float32Array } | null {
    if (!this.session) return null

    try {
      const inputTensor = new ort.Tensor('float32', audio, [1, 1, audio.length])
      const feeds = { audio: inputTensor }
      const results = this.session.run(feeds)
      return {
        mu: results.mu.data as Float32Array,
        logvar: results.logvar.data as Float32Array,
      }
    } catch (e) {
      console.error('ONNX encode failed:', e)
      return null
    }
  }

  get isReady(): boolean { return this.initialized }
}

/**
 * ONNX RAVE Decoder — decodes latent vector → audio.
 */
export class ONNXRAVEDecoder {
  private session: any = null
  private modelPath: string
  private initialized = false

  constructor(modelPath: string = '/models/rave_decoder.onnx') {
    this.modelPath = modelPath
  }

  async init(): Promise<boolean> {
    if (this.initialized) return true
    const ortInstance = await loadORT()
    if (!ortInstance) return false

    try {
      this.session = await ortInstance.InferenceSession.create(this.modelPath)
      this.initialized = true
      return true
    } catch (e) {
      console.warn(`Failed to load ONNX model ${this.modelPath}:`, e)
      return false
    }
  }

  /**
   * Decode latent vector → audio.
   * Returns Float32Array or null if not loaded.
   */
  decode(latent: Float32Array): Float32Array | null {
    if (!this.session) return null

    try {
      const inputTensor = new ort.Tensor('float32', latent, [1, latent.length])
      const feeds = { latent: inputTensor }
      const results = this.session.run(feeds)
      return results.audio.data as Float32Array
    } catch (e) {
      console.error('ONNX decode failed:', e)
      return null
    }
  }

  get isReady(): boolean { return this.initialized }
}

/**
 * Neural Style Transfer with ONNX models.
 * Falls back to spectral approximation if models not available.
 */
export class ONNXStyleTransfer {
  private encoder: ONNXRAVEEncoder
  private decoder: ONNXRAVEDecoder
  private referenceLatent: Float32Array | null = null
  private blendAmount = 0.3

  constructor() {
    this.encoder = new ONNXRAVEEncoder()
    this.decoder = new ONNXRAVEDecoder()
  }

  async init(): Promise<boolean> {
    const [encOk, decOk] = await Promise.all([
      this.encoder.init(),
      this.decoder.init(),
    ])
    return encOk && decOk
  }

  get isReady(): boolean {
    return this.encoder.isReady && this.decoder.isReady
  }

  loadReference(audio: Float32Array): boolean {
    const result = this.encoder.encode(audio)
    if (!result) return false
    // Use μ as the latent (ignore σ for inference)
    this.referenceLatent = result.mu
    return true
  }

  setBlendAmount(amount: number): void {
    this.blendAmount = Math.max(0, Math.min(1, amount))
  }

  transfer(audio: Float32Array): Float32Array {
    if (!this.isReady || !this.referenceLatent) return audio

    const renderLatent = this.encoder.encode(audio)
    if (!renderLatent) return audio

    // Blend: Z_result = lerp(Z_render, Z_ref, amount)
    const blended = new Float32Array(this.referenceLatent.length)
    for (let i = 0; i < blended.length; i++) {
      const zRender = renderLatent.mu[i] ?? 0
      const zRef = this.referenceLatent[i] ?? 0
      blended[i] = zRender * (1 - this.blendAmount) + zRef * this.blendAmount
    }

    // Decode blended latent
    const result = this.decoder.decode(blended)
    return result ?? audio
  }
}

/**
 * Check if ONNX models are available (without loading them).
 * Used to decide whether to show "Neural mode" in UI.
 */
export async function checkModelAvailability(modelPath: string): Promise<boolean> {
  if (typeof window === 'undefined') {
    // Node.js
    try {
      const fs = await import('fs/promises')
      await fs.access(modelPath)
      return true
    } catch {
      return false
    }
  } else {
    // Browser
    try {
      const res = await fetch(modelPath, { method: 'HEAD' })
      return res.ok
    } catch {
      return false
    }
  }
}
