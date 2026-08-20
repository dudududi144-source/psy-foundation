/**
 * Forensic Mixing — bus processors, master chain, reverb, delay.
 *
 * Direct port of psy4-engine.js mixing classes. Same DSP, same coefficients.
 */

import { DEFAULT_SR } from '../constants'
import { fastTanh } from './dsp'

// ─── Bus Processor (compression + HP + saturation per bus) ─────────────────

export interface BusConfig {
  hpFreq: number
  compThr: number
  compRatio: number
  compAtt: number
  compRel: number
  compMakeup: number
  drive: number
  gain: number
}

export class BusProcessor {
  config: BusConfig
  compEnv = 0
  hpState = 0
  drive: number
  gain: number

  constructor(config: Partial<BusConfig> = {}) {
    this.config = {
      hpFreq: 0,
      compThr: 0,
      compRatio: 2,
      compAtt: 0.003,
      compRel: 0.1,
      compMakeup: 1.2,
      drive: 1.0,
      gain: 1.0,
      ...config,
    }
    this.drive = this.config.drive
    this.gain = this.config.gain
  }

  process(sample: number, sr: number): number {
    // Guard: prevent NaN/Infinity from corrupting compressor envelope
    if (!Number.isFinite(sample)) return 0
    const dt = 1 / sr
    if (this.config.hpFreq > 0) {
      const hpA = (1 / sr) * 2 * Math.PI * this.config.hpFreq
      this.hpState += (hpA * (sample - this.hpState)) / (1 + hpA)
      sample = sample - this.hpState
    }
    if (this.config.compThr > 0) {
      const abs = Math.abs(sample)
      if (abs > this.compEnv) {
        this.compEnv += (abs - this.compEnv) * (dt / this.config.compAtt)
      } else {
        this.compEnv += (abs - this.compEnv) * (dt / this.config.compRel)
      }
      if (this.compEnv > this.config.compThr) {
        const over = this.compEnv - this.config.compThr
        const reduction = over * (1 - 1 / this.config.compRatio)
        const compGain = (this.compEnv - reduction) / this.compEnv
        sample *= compGain
      }
      sample *= this.config.compMakeup
    }
    if (this.drive > 1.0) {
      sample = fastTanh(sample * this.drive)
    }
    return sample * this.gain
  }
}

// ─── Master Chain (glue compression + saturation + limiter) ────────────────

export class MasterChain {
  gain = 1.0
  ceiling = 0.9 // was 0.98 — leave headroom
  env = 0
  attack = 0.0003
  release = 0.06
  glueEnv = 0
  glueThr = 0.6 // was 0.50 — less compression
  glueRatio = 2.5 // was 3.5 — gentler
  glueAttack = 0.004
  glueRelease = 0.12
  makeup = 1.0 // was 1.5 — was causing over-compression

  process(sample: number, sr: number): number {
    // Guard: prevent NaN/Infinity from propagating
    if (!Number.isFinite(sample)) return 0
    const dt = 1 / sr
    const abs = Math.abs(sample)
    if (abs > this.glueEnv) {
      this.glueEnv += (abs - this.glueEnv) * (dt / this.glueAttack)
    } else {
      this.glueEnv += (abs - this.glueEnv) * (dt / this.glueRelease)
    }
    let glueGain = 1
    if (this.glueEnv > this.glueThr) {
      const over = this.glueEnv - this.glueThr
      const reduction = over * (1 - 1 / this.glueRatio)
      glueGain = (this.glueEnv - reduction) / this.glueEnv
    }
    let s = sample * glueGain * this.makeup
    s = fastTanh(s * 1.2) * 0.7 + s * 0.3
    const absS = Math.abs(s)
    if (absS > this.env) {
      this.env += (absS - this.env) * (dt / this.attack)
    } else {
      this.env += (absS - this.env) * (dt / this.release)
    }
    let limGain = 1
    if (this.env > this.ceiling) {
      limGain = this.ceiling / this.env
    }
    s *= limGain * this.gain
    // Phase 1 Day 1 FIX: removed hard clip `Math.max(-1, Math.min(1, s))`.
    // The TruePeakLimiter at the end of the chain handles brickwall limiting.
    // Hard clipping here aliases ungracefully and was causing fizz on transients.
    // If sample exceeds [-1, 1], it will be caught by TruePeakLimiter.processBuffer.
    return s
  }
}

// ─── Schroeder Reverb (Phase 1 Day 3: true stereo) ──────────────────────────
// Phase 1 Day 3 FIX: the previous implementation had FAKE stereo — L was
// post-allpass output, R was pre-allpass comb sum × 0.9, sharing all state.
// Now uses separate comb banks per channel with slightly different delay
// lengths for proper stereo decorrelation (Freeverb-style).

export class SchroederReverb {
  // Phase 1 Day 3: separate delay lengths for L and R for stereo decorrelation
  combDelaysL = [1687, 1601, 2053, 2251]
  combDelaysR = [1747, 1663, 2113, 2311] // +60, +62, +60, +60 samples for decorrelation
  combBuffersL: Float32Array[] = []
  combBuffersR: Float32Array[] = []
  combIdxL: number[] = []
  combIdxR: number[] = []
  combFeedback = 0.84
  combDamping = 0.2
  combLPL: number[] = []
  combLPR: number[] = []
  // Allpass delays also differ per channel
  allpassDelaysL = [347, 113]
  allpassDelaysR = [373, 127] // +26, +14 samples for decorrelation
  allpassBuffersL: Float32Array[] = []
  allpassBuffersR: Float32Array[] = []
  allpassIdxL: number[] = []
  allpassIdxR: number[] = []
  allpassFeedback = 0.7
  wet = 0.45
  inputGain = 0.15

  constructor() {
    for (let i = 0; i < 4; i++) {
      this.combBuffersL.push(new Float32Array(this.combDelaysL[i]))
      this.combBuffersR.push(new Float32Array(this.combDelaysR[i]))
      this.combIdxL.push(0)
      this.combIdxR.push(0)
      this.combLPL.push(0)
      this.combLPR.push(0)
    }
    for (let i = 0; i < 2; i++) {
      this.allpassBuffersL.push(new Float32Array(this.allpassDelaysL[i]))
      this.allpassBuffersR.push(new Float32Array(this.allpassDelaysR[i]))
      this.allpassIdxL.push(0)
      this.allpassIdxR.push(0)
    }
  }

  setWet(wet: number): void {
    this.wet = wet
  }
  setInputGain(g: number): void {
    this.inputGain = g
  }

  /** Process a stereo input → stereo output. L and R have independent
   *  comb/allpass banks with slightly different delays for decorrelation. */
  process(inputL: number, inputR: number, _sr: number): [number, number] {
    if (!Number.isFinite(inputL) || !Number.isFinite(inputR)) return [0, 0]
    const inL = inputL * this.inputGain
    const inR = inputR * this.inputGain

    // Left channel combs
    let combSumL = 0
    for (let i = 0; i < 4; i++) {
      const buf = this.combBuffersL[i]!
      const idx = this.combIdxL[i]!
      const delayed = buf[idx]!
      this.combLPL[i] = delayed + this.combDamping * (this.combLPL[i]! - delayed)
      const out = inL + this.combLPL[i]! * this.combFeedback
      buf[idx] = out
      this.combIdxL[i] = (idx + 1) % this.combDelaysL[i]!
      combSumL += out
    }
    combSumL *= 0.25

    // Right channel combs
    let combSumR = 0
    for (let i = 0; i < 4; i++) {
      const buf = this.combBuffersR[i]!
      const idx = this.combIdxR[i]!
      const delayed = buf[idx]!
      this.combLPR[i] = delayed + this.combDamping * (this.combLPR[i]! - delayed)
      const out = inR + this.combLPR[i]! * this.combFeedback
      buf[idx] = out
      this.combIdxR[i] = (idx + 1) % this.combDelaysR[i]!
      combSumR += out
    }
    combSumR *= 0.25

    // Left allpasses
    let apL = combSumL
    for (let i = 0; i < 2; i++) {
      const buf = this.allpassBuffersL[i]!
      const idx = this.allpassIdxL[i]!
      const delayed = buf[idx]!
      const out = -apL * this.allpassFeedback + delayed
      buf[idx] = apL + delayed * this.allpassFeedback
      this.allpassIdxL[i] = (idx + 1) % this.allpassDelaysL[i]!
      apL = out
    }

    // Right allpasses
    let apR = combSumR
    for (let i = 0; i < 2; i++) {
      const buf = this.allpassBuffersR[i]!
      const idx = this.allpassIdxR[i]!
      const delayed = buf[idx]!
      const out = -apR * this.allpassFeedback + delayed
      buf[idx] = apR + delayed * this.allpassFeedback
      this.allpassIdxR[i] = (idx + 1) % this.allpassDelaysR[i]!
      apR = out
    }

    return [apL * this.wet, apR * this.wet]
  }

  reset(): void {
    for (const buf of this.combBuffersL) buf.fill(0)
    for (const buf of this.combBuffersR) buf.fill(0)
    for (const buf of this.allpassBuffersL) buf.fill(0)
    for (const buf of this.allpassBuffersR) buf.fill(0)
    this.combLPL.fill(0)
    this.combLPR.fill(0)
  }
}

// ─── Stereo Delay (ping-pong) ──────────────────────────────────────────────

export class StereoDelay {
  bufferSize = DEFAULT_SR * 2
  leftBuf: Float32Array
  rightBuf: Float32Array
  leftIdx = 0
  rightIdx = 0
  leftDelay = 0.375
  rightDelay = 0.281
  feedback = 0.35
  wet = 0.35
  inputGain = 0.2
  fbLP = [0, 0]

  constructor() {
    this.leftBuf = new Float32Array(this.bufferSize)
    this.rightBuf = new Float32Array(this.bufferSize)
  }

  setFeedback(fb: number): void {
    this.feedback = fb
  }
  setWet(wet: number): void {
    this.wet = wet
  }
  setInputGain(g: number): void {
    this.inputGain = g
  }

  process(leftIn: number, rightIn: number, sr: number): [number, number] {
    // Guard: prevent NaN/Infinity from entering feedback loops
    if (!Number.isFinite(leftIn)) leftIn = 0
    if (!Number.isFinite(rightIn)) rightIn = 0
    const leftDelaySamples = Math.floor(this.leftDelay * sr)
    const rightDelaySamples = Math.floor(this.rightDelay * sr)
    const leftReadIdx = (this.leftIdx - leftDelaySamples + this.bufferSize) % this.bufferSize
    const rightReadIdx = (this.rightIdx - rightDelaySamples + this.bufferSize) % this.bufferSize
    const leftDelayed = this.leftBuf[leftReadIdx]
    const rightDelayed = this.rightBuf[rightReadIdx]
    const fbCutoff = 0.3
    this.fbLP[0] = this.fbLP[0] + fbCutoff * (leftDelayed - this.fbLP[0])
    this.fbLP[1] = this.fbLP[1] + fbCutoff * (rightDelayed - this.fbLP[1])
    const leftWrite = leftIn * this.inputGain + this.fbLP[1] * this.feedback
    const rightWrite = rightIn * this.inputGain + this.fbLP[0] * this.feedback
    this.leftBuf[this.leftIdx] = leftWrite
    this.rightBuf[this.rightIdx] = rightWrite
    this.leftIdx = (this.leftIdx + 1) % this.bufferSize
    this.rightIdx = (this.rightIdx + 1) % this.bufferSize
    return [leftDelayed * this.wet, rightDelayed * this.wet]
  }

  reset(): void {
    this.leftBuf.fill(0)
    this.rightBuf.fill(0)
    this.fbLP.fill(0)
  }
}
