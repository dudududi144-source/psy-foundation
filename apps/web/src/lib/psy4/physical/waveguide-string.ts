/**
 * Waveguide String Synthesis — Karplus-Strong algorithm.
 *
 * Simulates a plucked string by:
 * 1. Filling a delay line with noise (the "pluck")
 * 2. Reading from the delay line
 * 3. Averaging consecutive samples (low-pass filter = string damping)
 * 4. Feeding back into the delay line
 *
 * Creates realistic guitar/bass string decay — impossible with oscillator+filter.
 *
 * Usage:
 *   const wg = new WaveguideString()
 *   wg.triggerDeterministic(freq, amp, 0.5, rng)
 *   const sample = wg.render()
 */

import type { Rng } from '../forensic/prng'

export class WaveguideString {
  private delayLine: Float32Array
  private writePos = 0
  private delayLength = 0
  private damping = 0.5
  private active = false
  private amp = 0
  private readonly SR = 44100

  constructor() {
    this.delayLine = new Float32Array(4410)
  }

  trigger(freq: number, amp: number, damping = 0.5) {
    this.delayLength = Math.max(2, Math.floor(this.SR / freq))
    if (this.delayLength > this.delayLine.length) {
      this.delayLine = new Float32Array(this.delayLength + 10)
    }
    for (let i = 0; i < this.delayLength; i++) {
      this.delayLine[i] = (Math.random() - 0.5) * 2
    }
    this.writePos = 0
    this.damping = damping
    this.amp = amp
    this.active = true
  }

  triggerDeterministic(freq: number, amp: number, damping: number, rng: Rng) {
    this.delayLength = Math.max(2, Math.floor(this.SR / freq))
    if (this.delayLength > this.delayLine.length) {
      this.delayLine = new Float32Array(this.delayLength + 10)
    }
    for (let i = 0; i < this.delayLength; i++) {
      this.delayLine[i] = (rng.next() - 0.5) * 2
    }
    this.writePos = 0
    this.damping = damping
    this.amp = amp
    this.active = true
  }

  render(): number {
    if (!this.active) return 0
    const readPos = this.writePos
    const current = this.delayLine[readPos] ?? 0
    const nextIdx = (readPos + 1) % this.delayLength
    const next = this.delayLine[nextIdx] ?? 0
    // Low-pass filter (damping) — average current and next
    const damped = current * (1 - this.damping * 0.5) + next * (this.damping * 0.5)
    this.delayLine[this.writePos] = damped
    this.writePos = nextIdx
    // Decay envelope
    this.amp *= 0.9996
    if (this.amp < 0.001) this.active = false
    return current * this.amp
  }

  noteOff(): void {
    this.amp *= 0.5
  }
  reset(): void {
    this.active = false
    this.amp = 0
  }
}
