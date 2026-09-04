/**
 * GAP-F1/F2/F3 fixtures (PLAN_V3 3.5): melody, 16th-note rhythm grid and
 * white noise — the three fixture classes the consumer contract needs that
 * the rhythmic/tempo corpus does not cover.
 *
 * All generators are deterministic (seeded mulberry32 RNG via `Rng`, fixed
 * constants) — generating twice yields byte-identical signals, locked by
 * tests.
 */
import { synthesizeKick, synthesizeLead } from './kick.ts'
import { Rng } from './rng.ts'
import type { Fixture } from './types.ts'

const SAMPLE_RATE = 44100

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/**
 * GAP-F1 — melody fixture: an ascending A-minor-pentatonic run of sine-ish
 * lead tones on a steady quarter grid. Ground truth = the exact MIDI pitch
 * of every note, in time order (analysis can verify pitch detection note by
 * note instead of guessing).
 */
export function genMelodyPentatonic(): Fixture {
  const bpm = 120
  const beatSec = 60 / bpm
  // A3 C4 D4 E4 G4 A4 C5 E5 — A minor pentatonic, ascending.
  const pitches = [57, 60, 62, 64, 67, 69, 72, 76]
  const durationSec = pitches.length * beatSec
  const signal = new Float32Array(Math.ceil(durationSec * SAMPLE_RATE))
  for (let i = 0; i < pitches.length; i++) {
    const start = i * beatSec
    // 90% of a quarter note — a small gap keeps onsets separable.
    synthesizeLead(midiToHz(pitches[i]!), start, start + beatSec * 0.9, SAMPLE_RATE, signal, 0.2)
  }
  const groundTruthBeats = pitches.map((_, i) => i * beatSec)
  return {
    id: 'melody-pentatonic',
    name: 'A-minor pentatonic ascending lead',
    anomaly: 'melody',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats,
    groundTruthBpm: bpm,
    groundTruthPitches: pitches,
    description:
      '8 lead notes, quarter grid at 120 BPM, A minor pentatonic (MIDI 57..76). Ground truth: exact MIDI pitches.',
  }
}

/**
 * GAP-F2 — rhythm fixture: 4-on-the-floor kick plus a hi-hat tick on EVERY
 * 16th of two bars. Ground truth = the exact timestamp of every 16th
 * position (60/bpm/4 spacing), the grid the 414ms-style schedulers must hit.
 */
export function genRhythm16thGrid(): Fixture {
  const bpm = 120
  const beatSec = 60 / bpm
  const sixteenthSec = beatSec / 4
  const beats = 8 // two 4/4 bars
  const durationSec = beats * beatSec
  const signal = new Float32Array(Math.ceil(durationSec * SAMPLE_RATE))
  const rng = new Rng(0x51c1) // deterministic; tiny level variation only
  const groundTruthBeats: number[] = []
  const groundTruthSixteenths: number[] = []
  for (let s = 0; s < beats * 4; s++) {
    const t = s * sixteenthSec
    groundTruthSixteenths.push(t)
    if (s % 4 === 0) {
      // Kick lands on the beat.
      synthesizeKick(t, SAMPLE_RATE, signal)
      groundTruthBeats.push(t)
    } else {
      // Hat: short noise burst, low gain, deterministic ±20% level.
      writeHat(signal, t, SAMPLE_RATE, 0.08 * (0.9 + 0.2 * rng.next()))
    }
  }
  return {
    id: 'rhythm-16th-grid',
    name: '4-on-floor kick + 16th hats, two bars',
    anomaly: 'sixteenth-grid',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats,
    groundTruthBpm: bpm,
    groundTruthSixteenths,
    description:
      'Two bars at 120 BPM: kick on every beat, hat tick on every 16th. Ground truth: exact 16th-note timestamps (0.125s spacing).',
  }
}

/** Short noise-burst hat (used by the 16th grid; deterministic shape). */
function writeHat(signal: Float32Array, startSec: number, sampleRate: number, gain: number): void {
  const start = Math.floor(startSec * sampleRate)
  const len = Math.floor(0.03 * sampleRate) // 30ms
  const rng = new Rng(start >>> 0)
  for (let i = 0; i < len && start + i < signal.length; i++) {
    const t = i / sampleRate
    const env = Math.min(1, t * 200) * Math.exp(-t / 0.008)
    signal[start + i]! += gain * env * (rng.next() * 2 - 1)
  }
}

/**
 * GAP-F3 — noise fixture: seeded white noise. Ground truth declares the
 * spectral character (flat spectrum — spectral flatness near 1, centroid
 * near Nyquist/2), which tests MEASURE from the signal instead of trusting
 * the label.
 */
export function genWhiteNoise(): Fixture {
  const durationSec = 2
  const n = Math.ceil(durationSec * SAMPLE_RATE)
  const signal = new Float32Array(n)
  const rng = new Rng(0x4e015ea1) // deterministic
  for (let i = 0; i < n; i++) signal[i] = rng.next() * 2 - 1
  const nyquist = SAMPLE_RATE / 2
  return {
    id: 'noise-white-2s',
    name: 'White noise, 2 seconds',
    anomaly: 'white-noise',
    sampleRate: SAMPLE_RATE,
    durationSec,
    signal,
    groundTruthBeats: [],
    groundTruthBpm: null,
    groundTruthSpectrum: { kind: 'white', centroidHz: nyquist / 2 },
    description:
      'Deterministic seeded white noise (mulberry32, seed 0x4e015ea1). Ground truth: flat spectrum, centroid ≈ Nyquist/2 ≈ 11025 Hz.',
  }
}
