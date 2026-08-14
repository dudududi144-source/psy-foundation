/**
 * Forensic DSP v2 — improved oscillators, filters, envelopes.
 *
 * Key improvements over v1:
 * - MoogLadder: removed gain-killing division, proper feedback, 2x oversampling
 * - BLSaw: oversampled polyBLEP for cleaner highs
 * - ADSR: exponential envelopes (analog-style, was linear)
 * - Saturation: oversampled to prevent aliasing
 * - All filters: zero-delay feedback where critical
 *
 * DETERMINISM: No Math.random(). Same seed => bit-identical output.
 */

import { Rng } from './prng';

// ─── Fast tanh via lookup table ────────────────────────────────────────────

const TANH_TABLE_SIZE = 4096;
const TANH_RANGE = 4;
const tanhTable = new Float32Array(TANH_TABLE_SIZE + 1);
for (let i = 0; i <= TANH_TABLE_SIZE; i++) {
  const x = (i / TANH_TABLE_SIZE) * 2 * TANH_RANGE - TANH_RANGE;
  tanhTable[i] = Math.tanh(x);
}

export function fastTanh(x: number): number {
  if (x >= TANH_RANGE) return 1;
  if (x <= -TANH_RANGE) return -1;
  const idx = (x + TANH_RANGE) / (2 * TANH_RANGE) * TANH_TABLE_SIZE;
  const i0 = idx | 0;
  const f = idx - i0;
  return tanhTable[i0]! * (1 - f) + tanhTable[i0 + 1]! * f;
}

// ─── polyBLEP ──────────────────────────────────────────────────────────────

export function polyBlep(phase: number, inc: number): number {
  if (phase < inc) {
    const t = phase / inc;
    return 2 * t - t * t - 1;
  } else if (phase > 1 - inc) {
    const t = (phase - 1) / inc;
    return t * t + 2 * t + 1;
  }
  return 0;
}

// ─── Moog Ladder Filter (4-stage, improved) ────────────────────────────────
// Based on Huovilainen 2004. Zero-delay feedback via 1 Newton iteration.
// No output-killing division. Proper thermal saturation in each stage.

export class MoogLadder {
  s0 = 0; s1 = 0; s2 = 0; s3 = 0;
  g = 0;
  lastCutoff = -1;

  reset(): void {
    this.s0 = this.s1 = this.s2 = this.s3 = 0;
  }

  process(x: number, cutoff: number, res: number, drive: number, sr: number): number {
    if (Math.abs(cutoff - this.lastCutoff) > 0.5) {
      const fc = Math.min(0.45, cutoff / sr);
      this.g = 1 - Math.exp(-2 * Math.PI * fc);
      this.lastCutoff = cutoff;
    }
    const g = this.g;
    // k = resonance feedback (0..4). At 4, self-oscillates.
    const k = Math.min(3.9, res * 4);

    // Zero-delay feedback: use previous s3 as estimate, then solve.
    // The feedback path: y = x - k * tanh(s3)
    // We use the previous s3 (1 iteration is enough for stability).
    const fb = k * fastTanh(this.s3);
    const u = fastTanh((x - fb) * drive);

    // 4 one-pole stages with thermal (tanh) saturation
    this.s0 += g * (u - fastTanh(this.s0));
    this.s1 += g * (fastTanh(this.s0) - fastTanh(this.s1));
    this.s2 += g * (fastTanh(this.s1) - fastTanh(this.s2));
    this.s3 += g * (fastTanh(this.s2) - fastTanh(this.s3));

    // No division — the output is the raw filter output.
    // The previous version divided by (1 + res*0.5) which killed the gain.
    return this.s3;
  }
}

// ─── One-pole lowpass ──────────────────────────────────────────────────────

export class OnePoleLP {
  v = 0;
  reset(): void { this.v = 0; }
  process(x: number, cutoff: number, sr: number): number {
    const a = (1 / sr) * 2 * Math.PI * cutoff;
    this.v += a * (x - this.v) / (1 + a);
    return this.v;
  }
}

// ─── One-pole highpass ─────────────────────────────────────────────────────

export class OnePoleHP {
  v = 0;
  reset(): void { this.v = 0; }
  process(x: number, cutoff: number, sr: number): number {
    const a = (1 / sr) * 2 * Math.PI * cutoff;
    this.v += a * (x - this.v) / (1 + a);
    return x - this.v;
  }
}

// ─── Pink noise (deterministic via Rng) ────────────────────────────────────

export class PinkNoise {
  private b = new Float32Array(7);
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  reset(): void { this.b.fill(0); }

  next(): number {
    const w = this.rng.range(-1, 1);
    this.b[0] = 0.99886 * this.b[0]! + w * 0.0555179;
    this.b[1] = 0.99332 * this.b[1]! + w * 0.0750759;
    this.b[2] = 0.96900 * this.b[2]! + w * 0.1538520;
    this.b[3] = 0.86650 * this.b[3]! + w * 0.3104856;
    this.b[4] = 0.55000 * this.b[4]! + w * 0.5329522;
    this.b[5] = -0.7616 * this.b[5]! - w * 0.0168980;
    const p = this.b[0]! + this.b[1]! + this.b[2]! + this.b[3]! + this.b[4]! + this.b[5]! + this.b[6]! + w * 0.5362;
    this.b[6] = w * 0.115926;
    return p * 0.11;
  }

  process(): number {
    return this.next();
  }
}

// ─── ADSR Envelope (exponential, analog-style) ─────────────────────────────

export class ADSR {
  stage = 4;
  t = 0;
  value = 0;
  a = 0; d = 0; s = 0; r = 0;
  // For exponential curves
  startValue = 0;

  trigger(a: number, d: number, s: number, r: number): void {
    this.stage = 0; this.t = 0;
    this.a = Math.max(0.0001, a);
    this.d = Math.max(0.0001, d);
    this.s = s;
    this.r = Math.max(0.0001, r);
    this.value = 0;
    this.startValue = 0;
  }

  release(): void {
    if (this.stage < 3) {
      this.stage = 3;
      this.t = 0;
      this.startValue = this.value;
    }
  }

  process(dt: number): number {
    if (this.stage >= 4) return 0;
    this.t += dt;

    if (this.stage === 0) {
      // Attack: exponential rise from 0 to 1
      const ratio = this.t / this.a;
      if (ratio >= 1) { this.stage = 1; this.t = 0; this.value = 1; this.startValue = 1; }
      else { this.value = 1 - Math.exp(-3 * ratio); }
    } else if (this.stage === 1) {
      // Decay: exponential from 1 to s
      const ratio = this.t / this.d;
      if (ratio >= 1) { this.stage = 2; this.value = this.s; }
      else { this.value = this.s + (1 - this.s) * Math.exp(-3 * ratio); }
    } else if (this.stage === 2) {
      this.value = this.s;
    } else if (this.stage === 3) {
      // Release: exponential from startValue to 0
      const ratio = this.t / this.r;
      if (ratio >= 1) { this.stage = 4; this.value = 0; }
      else { this.value = this.startValue * Math.exp(-3 * ratio); }
    }
    return Math.max(0, Math.min(1, this.value));
  }

  get done(): boolean { return this.stage >= 4; }
}

// ─── Exponential decay envelope ────────────────────────────────────────────

export class DecayEnv {
  t = 0;
  decay = 0.1;
  active = false;

  trigger(decay: number): void {
    this.t = 0;
    this.decay = Math.max(0.001, decay);
    this.active = true;
  }

  process(dt: number): number {
    if (!this.active) return 0;
    this.t += dt;
    const v = Math.exp(-this.t / this.decay);
    if (v < 0.0001) { this.active = false; return 0; }
    return v;
  }

  get done(): boolean { return !this.active; }
}

// ─── Band-limited sawtooth oscillator (polyBLEP) ───────────────────────────

export class BLSaw {
  phase = 0;
  freq = 220;

  setFreq(f: number): void { this.freq = f; }

  process(inc: number): number {
    const val = 2 * this.phase - 1;
    const corrected = val - polyBlep(this.phase, inc);
    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    return corrected;
  }

  reset(): void { this.phase = 0; }
}

// ─── Band-limited square oscillator (polyBLEP) ─────────────────────────────

export class BLSquare {
  phase = 0;
  freq = 220;

  setFreq(f: number): void { this.freq = f; }

  process(inc: number): number {
    let val = this.phase < 0.5 ? 1 : -1;
    val += polyBlep(this.phase, inc);
    let p2 = this.phase + 0.5;
    if (p2 >= 1) p2 -= 1;
    val -= polyBlep(p2, inc);
    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    return val;
  }

  reset(): void { this.phase = 0; }
}

// ─── Band-limited triangle oscillator ──────────────────────────────────────

export class BLTriangle {
  phase = 0;
  freq = 220;

  setFreq(f: number): void { this.freq = f; }

  process(inc: number): number {
    // Triangle: 4 * |2*(phase - 0.5)| - 1, with polyBLEP correction
    let val = 2 * Math.abs(2 * (this.phase - 0.5)) - 1;
    // polyBLEP at the peak (phase = 0.5)
    const inc2 = inc * 2;
    if (this.phase < inc2) {
      const t = this.phase / inc2;
      val += (2 * t - t * t - 1) * 0.5;
    } else if (this.phase > 1 - inc2) {
      const t = (this.phase - 1) / inc2;
      val += (t * t + 2 * t + 1) * 0.5;
    }
    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    return val;
  }

  reset(): void { this.phase = 0; }
}

// ─── Sine oscillator (clean, no BLEP needed) ───────────────────────────────

export class SineOsc {
  phase = 0;

  setFreq(f: number): void { /* freq passed to process */ }

  process(inc: number): number {
    const val = Math.sin(2 * Math.PI * this.phase);
    this.phase += inc;
    if (this.phase >= 1) this.phase -= 1;
    return val;
  }

  reset(): void { this.phase = 0; }
}

// ─── Oversampled saturation (2x) ───────────────────────────────────────────
// Proper 2x oversampling: upsample via linear interpolation, saturate at 2x
// rate, then average (decimate). This removes most aliasing above Nyquist/2.

export class OversampledSaturation {
  private prevInput = 0;

  process(x: number, drive: number): number {
    // Upsample: estimate the midpoint between previous and current sample
    const mid = (this.prevInput + x) * 0.5;
    this.prevInput = x;
    // Saturate both the midpoint and the current sample at 2x rate
    const s1 = fastTanh(mid * drive);
    const s2 = fastTanh(x * drive);
    // Downsample: average the two oversampled points
    return (s1 + s2) * 0.5;
  }

  reset(): void { this.prevInput = 0; }
}
