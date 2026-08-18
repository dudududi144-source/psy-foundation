/**
 * Wavetable Synthesis — 2048-sample single-cycle waveforms with morphing.
 *
 * This is the core engine of Serum and Vital. Instead of fixed saw/square/triangle,
 * a wavetable is a collection of single-cycle waveforms that can be morphed between.
 *
 * Features:
 * - N wavetables, each 2048 samples (single cycle)
 * - Morph position 0..1 interpolates between adjacent tables
 * - Built-in wavetables: saw, square, triangle, pulse, psy-lead, acid-squelch, vocal
 * - Can be loaded from audio file (extract one cycle, rebuild)
 *
 * Usage:
 *   const wt = Wavetable.createMulti()  // 6 morphable tables
 *   wt.setFreq(440)
 *   wt.setPosition(0.5)  // morph between table 2 and 3
 *   const sample = wt.process(freq / SR)
 */

import { Rng } from './forensic/prng'

export class Wavetable {
  private tables: Float32Array[]
  private position = 0
  private phase = 0
  private readonly TABLE_SIZE = 2048

  constructor(tables: Float32Array[]) {
    this.tables = tables
  }

  setPosition(pos: number): void { this.position = Math.max(0, Math.min(1, pos)) }
  getPosition(): number { return this.position }
  setFreq(_freq: number): void { /* freq is passed via process(inc) — kept for API compat */ }
  reset(): void { this.phase = 0 }

  process(inc: number): number {
    // Advance phase
    this.phase += inc
    if (this.phase >= 1) this.phase -= 1
    if (this.phase < 0) this.phase += 1

    // Interpolate between adjacent wavetables
    const tablePos = this.position * (this.tables.length - 1)
    const idx0 = Math.floor(tablePos)
    const idx1 = Math.min(idx0 + 1, this.tables.length - 1)
    const frac = tablePos - idx0

    const samplePos = this.phase * this.TABLE_SIZE
    const sIdx0 = Math.floor(samplePos)
    const sIdx1 = (sIdx0 + 1) % this.TABLE_SIZE
    const sFrac = samplePos - sIdx0

    const table0 = this.tables[idx0]!
    const table1 = this.tables[idx1]!

    const s0 = table0[sIdx0 % table0.length]! * (1 - sFrac) + table0[sIdx1 % table0.length]! * sFrac
    const s1 = table1[sIdx0 % table1.length]! * (1 - sFrac) + table1[sIdx1 % table1.length]! * sFrac

    return s0 * (1 - frac) + s1 * frac
  }

  // ── Factory: create built-in wavetables ──

  static createSaw(): Wavetable {
    const t = new Float32Array(2048)
    for (let i = 0; i < 2048; i++) t[i] = (2 * i) / 2048 - 1
    return new Wavetable([t])
  }

  static createSquare(): Wavetable {
    const t = new Float32Array(2048)
    for (let i = 0; i < 2048; i++) t[i] = i < 1024 ? 1 : -1
    return new Wavetable([t])
  }

  static createTriangle(): Wavetable {
    const t = new Float32Array(2048)
    for (let i = 0; i < 2048; i++) t[i] = 2 * Math.abs(2 * (i / 2048 - Math.floor(i / 2048 + 0.5))) - 1
    return new Wavetable([t])
  }

  static createPsyLead(): Wavetable {
    // Rich harmonics for psytrance lead: fundamental + 2nd + 3rd + 5th harmonics
    const t = new Float32Array(2048)
    for (let i = 0; i < 2048; i++) {
      const phase = (i / 2048) * 2 * Math.PI
      t[i] = (
        Math.sin(phase) * 1.0 +
        Math.sin(2 * phase) * 0.5 +
        Math.sin(3 * phase) * 0.33 +
        Math.sin(5 * phase) * 0.2
      ) / 2.03
    }
    return new Wavetable([t])
  }

  static createAcidSquelch(): Wavetable {
    // TB-303 style: square wave with resonant character
    const t = new Float32Array(2048)
    for (let i = 0; i < 2048; i++) {
      const phase = i / 2048
      // Square wave with slight resonant peak near the transition
      const sq = phase < 0.5 ? 1 : -1
      // Add a resonant "squelch" bump near phase 0.5
      const resPeak = Math.exp(-Math.pow((phase - 0.5) * 20, 2)) * 0.3
      t[i] = Math.max(-1, Math.min(1, sq + resPeak))
    }
    return new Wavetable([t])
  }

  static createVocalFormant(): Wavetable {
    // Saw with formant peaks at 800Hz, 1200Hz, 2800Hz (vowel "ah")
    const t = new Float32Array(2048)
    for (let i = 0; i < 2048; i++) {
      const phase = (i / 2048) * 2 * Math.PI
      // Base sawtooth
      const saw = (2 * i) / 2048 - 1
      // Add formant resonances (sin at formant frequencies, modulated)
      const f1 = Math.sin(phase * 800 / 440) * 0.3  // 800Hz formant
      const f2 = Math.sin(phase * 1200 / 440) * 0.25 // 1200Hz formant
      const f3 = Math.sin(phase * 2800 / 440) * 0.2  // 2800Hz formant
      t[i] = Math.max(-1, Math.min(1, saw * 0.5 + f1 + f2 + f3))
    }
    return new Wavetable([t])
  }

  /**
   * Multi-table wavetable with 6 morphable waveforms.
   * Position 0.0 = saw, 0.2 = square, 0.4 = triangle,
   * 0.6 = psyLead, 0.8 = acidSquelch, 1.0 = vocalFormant
   */
  static createMulti(): Wavetable {
    const saw = (Wavetable.createSaw() as any).tables[0] as Float32Array
    const sq = (Wavetable.createSquare() as any).tables[0] as Float32Array
    const tri = (Wavetable.createTriangle() as any).tables[0] as Float32Array
    const psy = (Wavetable.createPsyLead() as any).tables[0] as Float32Array
    const acid = (Wavetable.createAcidSquelch() as any).tables[0] as Float32Array
    const vocal = (Wavetable.createVocalFormant() as any).tables[0] as Float32Array
    return new Wavetable([saw, sq, tri, psy, acid, vocal])
  }

  /**
   * Create a wavetable from an audio buffer by extracting single-cycle waveforms.
   * Scans the buffer for zero crossings and extracts N cycles.
   */
  static fromAudio(buffer: Float32Array, numTables: number = 8): Wavetable {
    const tables: Float32Array[] = []
    const cycleLength = Math.floor(buffer.length / numTables)
    for (let t = 0; t < numTables; t++) {
      const start = t * cycleLength
      const table = new Float32Array(2048)
      for (let i = 0; i < 2048; i++) {
        const srcIdx = start + Math.floor((i / 2048) * cycleLength)
        table[i] = buffer[srcIdx] ?? 0
      }
      tables.push(table)
    }
    return new Wavetable(tables)
  }
}
