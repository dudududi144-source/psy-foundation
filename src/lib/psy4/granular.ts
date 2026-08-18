/**
 * Granular Synthesis — spawns thousands of tiny grains from a buffer.
 *
 * Each grain is 10-100ms of audio with its own:
 * - Position in source buffer
 * - Pitch (playback rate)
 * - Pan
 * - Envelope (Hann window for smooth edges)
 * - Duration
 *
 * Creates textures impossible with oscillators — evolving pads, risers, atmospheres.
 * This is what professional psytrance uses for texture beds.
 *
 * Usage:
 *   const buf = GrainCloud.generateNoiseBuffer(rng, 2.0)
 *   const cloud = new GrainCloud(buf, rng)
 *   cloud.setDensity(80)  // 80 grains/sec
 *   const [left, right] = cloud.process()
 */

import { Rng } from './forensic/prng'

interface Grain {
  pos: number        // position in source buffer
  pitch: number      // playback rate (1 = normal)
  pan: number        // -1..1
  dur: number        // duration in samples
  age: number        // current age in samples
}

export class GrainCloud {
  private grains: Grain[] = []
  private buffer: Float32Array
  private density = 50
  private grainDurMs = 50
  private pitchVar = 0.1
  private posVar = 0.5
  private rng: Rng
  private sampleCount = 0
  private samplesPerGrain: number

  constructor(buffer: Float32Array, rng: Rng) {
    this.buffer = buffer
    this.rng = rng
    this.samplesPerGrain = Math.floor(44100 / this.density)
  }

  setDensity(d: number): void {
    this.density = d
    this.samplesPerGrain = Math.floor(44100 / d)
  }

  setGrainDuration(ms: number): void { this.grainDurMs = ms }
  setPitchVar(v: number): void { this.pitchVar = v }
  setPosVar(v: number): void { this.posVar = v }
  setAmp(a: number): void { this.amp = a }
  setBuffer(buf: Float32Array): void { this.buffer = buf; this.reset() }

  private amp = 1.0

  private spawnGrain(): void {
    const grainDur = Math.floor(44100 * this.grainDurMs / 1000)
    const posRange = this.buffer.length - grainDur - 1
    const basePos = this.rng.range(0, Math.max(1, posRange))
    this.grains.push({
      pos: basePos,
      pitch: 1 + this.rng.range(-this.pitchVar, this.pitchVar),
      pan: this.rng.range(-1, 1),
      dur: grainDur,
      age: 0,
    })
  }

  process(): [number, number] {
    this.sampleCount++
    if (this.sampleCount >= this.samplesPerGrain) {
      this.spawnGrain()
      this.sampleCount = 0
    }

    let outL = 0, outR = 0
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const g = this.grains[i]!
      if (g.age >= g.dur) {
        this.grains.splice(i, 1)
        continue
      }
      const samplePos = Math.floor(g.pos + g.age * g.pitch)
      const sample = this.buffer[samplePos % this.buffer.length] ?? 0
      // Hann envelope (smooth grain edges)
      const env = 0.5 * (1 - Math.cos(2 * Math.PI * g.age / g.dur))
      // Equal-power pan
      const panAngle = (g.pan + 1) * 0.25 * Math.PI
      const panL = Math.cos(panAngle)
      const panR = Math.sin(panAngle)
      outL += sample * env * panL * this.amp
      outR += sample * env * panR * this.amp
      g.age++
    }
    return [outL, outR]
  }

  reset(): void { this.grains = []; this.sampleCount = 0 }

  get activeGrains(): number { return this.grains.length }

  // ── Factory: generate source buffer procedurally ──

  static generateNoiseBuffer(rng: Rng, durationSec: number): Float32Array {
    const len = Math.floor(44100 * durationSec)
    const buf = new Float32Array(len)
    // Pink-ish noise (filtered white noise)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = rng.range(-1, 1)
      last = last * 0.95 + white * 0.05
      buf[i] = last * 10
    }
    return buf
  }

  static generateSawBuffer(freq: number, durationSec: number): Float32Array {
    const len = Math.floor(44100 * durationSec)
    const buf = new Float32Array(len)
    const period = 44100 / freq
    for (let i = 0; i < len; i++) {
      const phase = (i % period) / period
      buf[i] = 2 * phase - 1
    }
    return buf
  }

  static generateMixedBuffer(rng: Rng, freq: number, durationSec: number, noiseLevel: number = 0.5): Float32Array {
    const len = Math.floor(44100 * durationSec)
    const buf = new Float32Array(len)
    const period = 44100 / freq
    let noiseState = 0
    for (let i = 0; i < len; i++) {
      const phase = (i % period) / period
      const saw = 2 * phase - 1
      const white = rng.range(-1, 1)
      noiseState = noiseState * 0.95 + white * 0.05
      buf[i] = saw * (1 - noiseLevel) + noiseState * 3 * noiseLevel
    }
    return buf
  }
}
