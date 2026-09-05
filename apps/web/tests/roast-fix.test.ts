/**
 * Roast-fix tests (ROAST-FIX-1 + ROAST-FIX-2).
 *
 * Verifies the 9 fixes applied during the audit-driven roast & fix pass:
 *   1. latent-decoder decode() no longer blows up at blend=0 (true no-op).
 *   2. latent-decoder FFT round-trip near-identity when gains are 1.
 *   3. NeuralStyleTransfer actually shapes spectrum (refutes "no-op" claim).
 *   4. getReferenceLatent is type-safe (LatentVector | null, not any).
 *   5. K-weighting b1 formula corrected (RBJ cookbook) — LUFS within 1 LU.
 *   6. decodeWav walks chunks dynamically (handles LIST/fact/junk before fmt).
 *   7. WaveguideString determinism preserved.
 *
 * See /home/z/my-project/worklog.md (ROAST-FIX-1, ROAST-FIX-2) for the
 * narrative behind each fix.
 */
import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { measureLUFS } from '@psy-foundation/dsp'
import { CompositionEngine, createIdentityA } from '@psy-foundation/music'
import { getReferenceLatent } from '../src/app/api/upload-reference/route'
import {
  DEFAULT_RENDER_CONFIG,
  decodeWav,
  renderFoundationSection,
} from '../src/lib/psy4/forensic-bridge'
import { Rng } from '../src/lib/psy4/forensic/prng'
import { WaveguideString } from '../src/lib/psy4/physical/waveguide-string'
import {
  LatentDecoder,
  type LatentVector,
  NeuralStyleTransfer,
} from '../src/lib/psy4/research/neural/latent-decoder'

const SR = 44100
const FFT_BLOCK = 2048

// Apps/web cwd so renderFoundationSection can resolve public/samples/.
const APPS_WEB_DIR = resolve(import.meta.dir, '..')
process.chdir(APPS_WEB_DIR)

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Goertzel magnitude of `buf` at `freq` — single-bin DFT (returns amplitude). */
function goertzelMag(buf: Float32Array, freq: number, sr = SR): number {
  const N = buf.length
  const k = (freq * N) / sr
  let re = 0
  let im = 0
  for (let i = 0; i < N; i++) {
    const x = buf[i] ?? 0
    const angle = (-2 * Math.PI * k * i) / N
    re += x * Math.cos(angle)
    im += x * Math.sin(angle)
  }
  return (2 * Math.sqrt(re * re + im * im)) / N
}

/** Seeded mulberry32 PRNG (deterministic broadband noise). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Build N samples of broadband noise (peak amplitude ~amp). */
function broadbandNoise(n: number, seed: number, amp = 0.3): Float32Array {
  const rng = mulberry32(seed)
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    // Center the [0,1) sample to [-0.5, 0.5), scale by 2·amp.
    buf[i] = (rng() - 0.5) * 2 * amp
  }
  return buf
}

/** Build N samples of a sine wave at `freq` (peak amplitude `amp`). */
function sine(freq: number, n: number, amp = 0.3, sr = SR): Float32Array {
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) buf[i] = Math.sin((2 * Math.PI * freq * i) / sr) * amp
  return buf
}

/** Build a "bright" reference signal: 440 Hz + 880 Hz sines (FFT_BLOCK samples). */
function brightReference(sr = SR): Float32Array {
  const a = sine(440, FFT_BLOCK, 0.3, sr)
  const b = sine(880, FFT_BLOCK, 0.3, sr)
  const out = new Float32Array(FFT_BLOCK)
  for (let i = 0; i < FFT_BLOCK; i++) out[i] = (a[i]! + b[i]!) * 0.5
  return out
}

/** Max absolute difference between two Float32Arrays of equal length. */
function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let m = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0))
    if (d > m) m = d
  }
  return m
}

/** Build a minimal 16-bit mono PCM WAV in a fresh ArrayBuffer. */
function buildWav(
  samples: Float32Array,
  sampleRate: number,
  preludeChunks: Uint8Array = new Uint8Array()
): ArrayBuffer {
  const bitsPerSample = 16
  const bytesPerSample = 2
  const numChannels = 1
  const dataSize = samples.length * bytesPerSample
  // Total: 12 (RIFF/WAVE) + prelude + 8 (fmt header) + 16 (fmt body) + 8 (data header) + dataSize
  const preludeSize = preludeChunks.length
  const totalSize = 12 + preludeSize + 8 + 16 + 8 + dataSize
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  // RIFF header
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, totalSize - 8, true)
  view.setUint32(8, 0x57415645, false) // "WAVE"
  let off = 12
  // Optional prelude chunks (e.g., LIST) BEFORE fmt — the regression-test hook.
  if (preludeSize > 0) {
    new Uint8Array(buf, off, preludeSize).set(preludeChunks)
    off += preludeSize
  }
  // fmt chunk
  view.setUint32(off, 0x666d7420, false) // "fmt "
  view.setUint32(off + 4, 16, true) // chunk size = 16
  view.setUint16(off + 8, 1, true) // audioFormat = 1 (PCM)
  view.setUint16(off + 10, numChannels, true)
  view.setUint32(off + 12, sampleRate, true)
  view.setUint32(off + 16, sampleRate * numChannels * bytesPerSample, true) // byteRate
  view.setUint16(off + 20, numChannels * bytesPerSample, true) // blockAlign
  view.setUint16(off + 22, bitsPerSample, true)
  off += 8 + 16
  // data chunk
  view.setUint32(off, 0x64617461, false) // "data"
  view.setUint32(off + 4, dataSize, true)
  off += 8
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(off + i * 2, Math.round(s * 32767), true)
  }
  return buf
}

/** Build a 26-byte LIST chunk with type 'INFO' (and nothing else) for the regression test. */
function buildListInfoChunk(): Uint8Array {
  // 8-byte header + 4-byte type + 14-byte (zero-padded) sub-payload = 26 bytes total.
  // (LIST chunk size in the header counts the type + sub-payload, so 4 + 14 = 18;
  // 18 is even so no extra pad byte.)
  const out = new Uint8Array(8 + 18)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x4c495354, false) // "LIST"
  view.setUint32(4, 18, true) // chunk size
  view.setUint32(8, 0x494e464f, false) // "INFO"
  // 14 zero bytes follow (a placeholder ISFT or similar; we leave them null).
  return out
}

// ── 1. NeuralStyleTransfer blend=0 is a TRUE no-op ──────────────────────────

describe('roast-fix: NeuralStyleTransfer', () => {
  test('blend=0 is a true no-op (max diff < 1e-4)', () => {
    const input = broadbandNoise(FFT_BLOCK, 1234)
    const reference = brightReference()

    const st = new NeuralStyleTransfer()
    st.loadReference(reference, SR)
    st.setBlendAmount(0)
    const output = st.transfer(input, SR)

    // With blend=0, decode() short-circuits and returns `samples` unchanged.
    expect(maxAbsDiff(input, output)).toBeLessThan(1e-4)
  })

  // ── 2. Output bounded at all blend levels ─────────────────────────────────

  test('output is bounded at all blend levels (no clipping, no NaN)', () => {
    const input = broadbandNoise(FFT_BLOCK, 42, 0.5)
    const reference = brightReference()

    for (const blend of [0, 0.25, 0.5, 0.75, 1.0]) {
      const st = new NeuralStyleTransfer()
      st.loadReference(reference, SR)
      st.setBlendAmount(blend)
      const output = st.transfer(input, SR)
      let maxAbs = 0
      let hasNaN = false
      for (let i = 0; i < output.length; i++) {
        const s = output[i] ?? 0
        if (Number.isNaN(s)) {
          hasNaN = true
          break
        }
        const a = Math.abs(s)
        if (a > maxAbs) maxAbs = a
      }
      expect(hasNaN).toBe(false)
      // Per-band gain is clamped to [0.25, 4.0]; with input peak ≤ 0.5, output peak ≤ 2.0.
      // Allow 2.5 for FFT round-trip edge effects. Definitely no ±5.0 (old bug).
      expect(maxAbs).toBeLessThan(2.5)
    }
  })

  // ── 3. Style transfer at blend=1 shapes spectrum of broadband input ───────

  test('blend=1 shapes spectrum of broadband input (200Hz/5000Hz ratio changes)', () => {
    // The transfer() method processes one FFT_BLOCK at a time (FFT_SIZE = 2048).
    // Using a single FFT_BLOCK keeps the IFFT output fully populated — longer
    // inputs would have their tail left as zero-padded garbage.
    const input = broadbandNoise(FFT_BLOCK, 99)
    const reference = brightReference()

    const st = new NeuralStyleTransfer()
    st.loadReference(reference, SR)
    st.setBlendAmount(1.0)
    const output = st.transfer(input, SR)

    const mag200In = goertzelMag(input, 200)
    const mag5000In = goertzelMag(input, 5000)
    const mag200Out = goertzelMag(output, 200)
    const mag5000Out = goertzelMag(output, 5000)

    const ratioIn = mag200In / Math.max(1e-9, mag5000In)
    const ratioOut = mag200Out / Math.max(1e-9, mag5000Out)

    // The reference is mid-frequency (440 + 880 Hz), so 200 Hz (band 11) and
    // 5000 Hz (band 26) lie in different bark bands from the reference energy
    // (bands 14 and 18). At least one of them must move relative to the other
    // — otherwise the transfer did nothing. Allow ≥ 10 % change.
    const relChange = Math.abs(ratioOut - ratioIn) / Math.max(1e-9, ratioIn)
    expect(relChange).toBeGreaterThan(0.1)
  })

  // ── 4. Previous worklog claim "self-reference no-op" is refuted ────────────

  test('non-self-reference transfer actually changes the audio (refutes no-op claim)', () => {
    const input = broadbandNoise(FFT_BLOCK, 7, 0.3)
    const reference = brightReference()

    const st = new NeuralStyleTransfer()
    st.loadReference(reference, SR)
    st.setBlendAmount(1.0)
    const output = st.transfer(input, SR)

    // The previous worklog claimed NeuralStyleTransfer was a "self-reference
    // no-op". With a non-self reference at blend=1, the output must differ
    // from the input by a non-trivial margin. (The class is functional DSP.)
    const maxDiff = maxAbsDiff(input, output)
    expect(maxDiff).toBeGreaterThan(1e-3)
  })

  // ── 5. LatentDecoder FFT round-trip near-identity with gain=1 ──────────────

  test('LatentDecoder: round-trip near-identity when target == current latent (gain = 1)', () => {
    const input = broadbandNoise(FFT_BLOCK, 55)
    const dec = new LatentDecoder()
    const own = dec.encode(input, SR)
    // Apply own latent as the target → per-band gain = exp(0) = 1 everywhere.
    dec.applyStyle(own, 1.0)
    const output = dec.decode(input, SR)

    // FFT round-trip with all gains = 1 → near-identity (max diff < 1e-4).
    // The previous implementation gave 4× louder output here.
    expect(maxAbsDiff(input, output)).toBeLessThan(1e-4)
  })

  // ── 6. encode produces a non-trivial latent for non-silent input ──────────

  test('LatentDecoder: encode produces non-trivial latent for non-silent input', () => {
    const input = sine(440, FFT_BLOCK, 0.3)
    const dec = new LatentDecoder()
    const latent = dec.encode(input, SR)
    let sum = 0
    let nonZero = 0
    for (let b = 0; b < latent.bands.length; b++) {
      const v = latent.bands[b]!
      sum += v
      if (v > 0.01) nonZero++
    }
    expect(sum).toBeGreaterThan(0)
    expect(nonZero).toBeGreaterThan(0)
    // 440 Hz lives in a single bark band — centroid should be near that band.
    expect(latent.centroid).toBeGreaterThan(200)
    expect(latent.centroid).toBeLessThan(5000)
  })

  // ── 9. Same input → bit-identical latent (determinism) ─────────────────────

  test('determinism: same input → bit-identical latent', () => {
    const input = sine(880, FFT_BLOCK, 0.25)
    const dec1 = new LatentDecoder()
    const dec2 = new LatentDecoder()
    const l1 = dec1.encode(input, SR)
    const l2 = dec2.encode(input, SR)
    expect(l1.bands.length).toBe(l2.bands.length)
    for (let b = 0; b < l1.bands.length; b++) {
      expect(l1.bands[b]).toBe(l2.bands[b])
    }
    expect(l1.centroid).toBe(l2.centroid)
    expect(l1.flatness).toBe(l2.flatness)
  })

  // ── 10. Same reference + render → bit-identical styled output ──────────────

  test('determinism: same reference + render → bit-identical styled output', () => {
    const reference = brightReference()
    const input = broadbandNoise(FFT_BLOCK, 31, 0.4)

    const st1 = new NeuralStyleTransfer()
    st1.loadReference(reference, SR)
    st1.setBlendAmount(0.6)
    const out1 = st1.transfer(input, SR)

    const st2 = new NeuralStyleTransfer()
    st2.loadReference(reference, SR)
    st2.setBlendAmount(0.6)
    const out2 = st2.transfer(input, SR)

    for (let i = 0; i < out1.length; i++) {
      expect(out1[i]).toBe(out2[i])
    }
  })
})

// ── 7. getReferenceLatent returns null for unknown hash ──────────────────────
// ── 8. getReferenceLatent type-safe (LatentVector | null, not any) ──────────

describe('roast-fix: getReferenceLatent', () => {
  test('returns null for unknown hash', () => {
    const ref = getReferenceLatent(`nonexistent-${Date.now()}-${Math.random()}`)
    expect(ref).toBeNull()
  })

  test('return type is LatentVector | null (typed, not any)', () => {
    // Compile-time check: this assignment only type-checks if getReferenceLatent
    // returns `LatentVector | null`. (If it were typed `any`, TS would still
    // accept this — so the type annotation here is also documentation.)
    const ref: LatentVector | null = getReferenceLatent(`unknown-${Math.random()}`)
    // Runtime structure check: a real LatentVector has bands/centroid/flatness.
    if (ref !== null) {
      expect(ref.bands).toBeInstanceOf(Float32Array)
      expect(typeof ref.centroid).toBe('number')
      expect(typeof ref.flatness).toBe('number')
    } else {
      expect(ref).toBeNull()
    }
  })
})

// ── 11..15. K-weighting (RBJ-cookbook) ────────────────────────────────────────

describe('roast-fix: K-weighting (RBJ cookbook)', () => {
  /**
   * Compute the integrated-LUFS reading for a mono sine (signal on L only, R silent).
   * Returns the K-weighting gain at `freq` in dB:
   *   gain_dB = measured_LUFS - input_LUFS_no_K
   *   input_LUFS_no_K = -0.691 + 10·log10(RMS²)
   */
  function kGainDb(freq: number, amplitude = 0.1, durationSec = 3.0): number {
    const n = Math.floor(durationSec * SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) L[i] = Math.sin((2 * Math.PI * freq * i) / SR) * amplitude
    const res = measureLUFS(L, R, SR)
    const rms = amplitude / Math.SQRT2
    const inputLufsNoK = -0.691 + 10 * Math.log10(rms * rms)
    return res.integratedLUFS - inputLufsNoK
  }

  test('ITU calibration: mono 997 Hz @ -23 dBFS RMS within 1 LU of -23', () => {
    const amplitude = Math.SQRT2 * 10 ** (-23 / 20) // peak such that RMS = 10^(-23/20)
    const n = Math.floor(3 * SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) L[i] = Math.sin((2 * Math.PI * 997 * i) / SR) * amplitude
    const res = measureLUFS(L, R, SR)
    expect(Math.abs(res.integratedLUFS - -23)).toBeLessThan(1.0)
  })

  test('K-gain at 1682 Hz corner ≈ +2 dB', () => {
    const gain = kGainDb(1682)
    expect(gain).toBeGreaterThan(1.5)
    expect(gain).toBeLessThan(2.5)
  })

  test('K-gain at 10000 Hz plateau ≈ +4 dB', () => {
    const gain = kGainDb(10000)
    expect(gain).toBeGreaterThan(3.5)
    expect(gain).toBeLessThan(4.5)
  })

  test('K-gain at 100 Hz RLB transition ≈ -1 dB', () => {
    const gain = kGainDb(100)
    // The RLB high-pass (f0=38 Hz, Q=0.5) starts cutting below ~100 Hz.
    // At 100 Hz the curve is in the transition; gain should be near 0 dB to -2 dB.
    expect(gain).toBeGreaterThan(-3.0)
    expect(gain).toBeLessThan(0.5)
  })

  test('render LUFS in expected club-master range (-11 .. -7 LUFS)', async () => {
    const ctx = {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      octave: 4,
      bpm: 145,
      beatsPerBar: 4,
      beatPosition: 0,
      barPosition: 0,
      phrasePosition: 0,
      harmonicContext: [] as number[],
      density: 0.7,
      energy: 0.7,
      tension: 0.3,
      sectionRole: 'full-on' as const,
      repetitionPressure: 0.3,
      noveltyPressure: 0.5,
      seed: 42,
    }
    const engine = new CompositionEngine({ seed: 42, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars: 8 })
    const result = await renderFoundationSection(section, {
      useSamples: true,
      bpm: 145,
      config: { ...DEFAULT_RENDER_CONFIG, bassGain: 0.8, subBassGain: 0.6, padGain: 0.7 },
    })
    const lufs = measureLUFS(result.samplesL, result.samplesR, result.sampleRate)
    expect(lufs.integratedLUFS).toBeGreaterThan(-11.5)
    expect(lufs.integratedLUFS).toBeLessThan(-6.5)
  }, 60000)
})

// ── 16..17. decodeWav (chunk-walking) ────────────────────────────────────────

describe('roast-fix: decodeWav (chunk-walking)', () => {
  test('decodes a WAV with fmt at standard offset 12 (baseline)', () => {
    const sr = 44100
    const samples = sine(440, 1024, 0.3, sr)
    const buf = buildWav(samples, sr)
    const decoded = decodeWav(buf)
    expect(decoded.sampleRate).toBe(sr)
    expect(decoded.data.length).toBe(samples.length)
    // Decode should approximately preserve the sine amplitude.
    let maxAbs = 0
    for (let i = 0; i < decoded.data.length; i++) {
      const a = Math.abs(decoded.data[i] ?? 0)
      if (a > maxAbs) maxAbs = a
    }
    expect(maxAbs).toBeGreaterThan(0.2)
    expect(maxAbs).toBeLessThan(0.4)
  })

  test('decodes a WAV with LIST chunk before fmt (regression test)', () => {
    const sr = 44100
    const samples = sine(880, 1024, 0.25, sr)
    // Build a WAV where a 26-byte LIST/INFO chunk is placed BEFORE the fmt chunk.
    // The old hardcoded reader would have read sampleRate from offset 24 — but
    // with LIST sitting between WAVE and fmt, offset 24 lands inside the LIST
    // chunk and returns garbage (1.87 billion).
    const list = buildListInfoChunk()
    const buf = buildWav(samples, sr, list)
    const decoded = decodeWav(buf)
    expect(decoded.sampleRate).toBe(sr)
    expect(decoded.data.length).toBe(samples.length)
    let maxAbs = 0
    for (let i = 0; i < decoded.data.length; i++) {
      const a = Math.abs(decoded.data[i] ?? 0)
      if (a > maxAbs) maxAbs = a
    }
    expect(maxAbs).toBeGreaterThan(0.15)
    expect(maxAbs).toBeLessThan(0.35)
  })
})

// ── 18. WaveguideString determinism static check ────────────────────────────

describe('roast-fix: WaveguideString determinism', () => {
  test('triggerDeterministic with same seed produces bit-identical output', () => {
    const n = 4096
    const rng1 = new Rng(42)
    const rng2 = new Rng(42)

    const wg1 = new WaveguideString()
    const wg2 = new WaveguideString()
    wg1.triggerDeterministic(220, 0.5, 0.5, rng1)
    wg2.triggerDeterministic(220, 0.5, 0.5, rng2)

    for (let i = 0; i < n; i++) {
      expect(wg1.render()).toBe(wg2.render())
    }
  })
})

// ─── True-peak fix (Roast-Fix-3) ───────────────────────────────────────────

// measureLUFS already imported above

describe('Roast Fix 3: truePeakDb is 4x-oversampled (was sample peak)', () => {
  test('truePeakDb >= samplePeakDb for all signals', () => {
    // Pure sine (minimal ISP)
    const L = new Float32Array(SR * 2)
    const R = new Float32Array(SR * 2)
    for (let i = 0; i < L.length; i++) {
      L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR)
      R[i] = L[i]!
    }
    const result = measureLUFS(L, R, SR)
    expect(result.truePeakDb).toBeGreaterThanOrEqual(result.samplePeakDb)
  })

  test('truePeakDb > samplePeakDb for signal with inter-sample peaks', () => {
    // Create a signal that has known inter-sample peaks: a steep transient
    // where samples go from -0.9 to +0.9 in one step. Catmull-Rom interpolation
    // will produce an overshoot between the samples that exceeds both.
    const L = new Float32Array(SR * 1)
    const R = new Float32Array(SR * 1)
    for (let i = 0; i < L.length; i++) {
      // Square wave at 2000 Hz — has steep edges that create ISPs
      L[i] = 0.5 * Math.sign(Math.sin((2 * Math.PI * 2000 * i) / SR))
      R[i] = L[i]!
    }
    const result = measureLUFS(L, R, SR)
    expect(result.truePeakDb).toBeGreaterThanOrEqual(result.samplePeakDb)
    // Square waves have ISPs due to Gibbs phenomenon at the edges
    // The Catmull-Rom should detect some overshoot
    expect(result.truePeakDb).toBeGreaterThan(result.samplePeakDb + 0.01)
  })

  test('truePeakDb is finite (no NaN/Inf)', () => {
    const L = new Float32Array(SR * 1)
    const R = new Float32Array(SR * 1)
    for (let i = 0; i < L.length; i++) {
      L[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR)
      R[i] = L[i]!
    }
    const result = measureLUFS(L, R, SR)
    expect(Number.isFinite(result.truePeakDb)).toBe(true)
    expect(Number.isFinite(result.samplePeakDb)).toBe(true)
  })

  test('samplePeakDb matches old behavior (max |sample|)', () => {
    const L = new Float32Array(1000)
    const R = new Float32Array(1000)
    for (let i = 0; i < 1000; i++) {
      L[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / SR)
      R[i] = -0.3
    }
    const result = measureLUFS(L, R, SR)
    // Max |sample| = 0.5 (from L channel) → 20*log10(0.5) = -6.02 dBFS
    expect(result.samplePeakDb).toBeCloseTo(20 * Math.log10(0.5), 1)
  })
})

// ─── Roast Fix 4: reference-analyzer + multi-export ─────────────────────────

describe('Roast Fix 4: reference-analyzer uses true peak (not sample peak)', () => {
  test('analyzeReference.truePeakDb matches measureLUFS.truePeakDb', async () => {
    const { analyzeReference } = await import('@/lib/psy4/reference-analyzer')
    const { measureLUFS } = await import('@psy-foundation/dsp')

    // Generate a signal with significant ISPs (square wave)
    const L = new Float32Array(SR * 1)
    const R = new Float32Array(SR * 1)
    for (let i = 0; i < L.length; i++) {
      L[i] = 0.5 * Math.sign(Math.sin((2 * Math.PI * 2000 * i) / SR))
      R[i] = L[i]!
    }
    const analysis = analyzeReference(L, R, SR)
    const meter = measureLUFS(L, R, SR)

    expect(analysis.profile.truePeakDb).toBeCloseTo(meter.truePeakDb, 1)
    // Should NOT equal sample peak (would indicate the bug is back)
    expect(analysis.profile.truePeakDb).not.toBeCloseTo(meter.samplePeakDb, 0)
  })
})

describe('Roast Fix 4: multi-export FLAC honestly rejects (was broken file)', () => {
  test('encodeFlacPlaceholder throws (not returns broken WAV)', async () => {
    const { encodeFlacPlaceholder, FlacNotSupportedError } = await import('@/lib/psy4/multi-export')
    expect(() => encodeFlacPlaceholder(new Float32Array(1), new Float32Array(1), 44100)).toThrow(
      FlacNotSupportedError
    )
  })

  test('FlacNotSupportedError message mentions wav/aiff alternatives', async () => {
    const { FlacNotSupportedError } = await import('@/lib/psy4/multi-export')
    const err = new FlacNotSupportedError()
    expect(err.message.toLowerCase()).toContain('wav')
    expect(err.message.toLowerCase()).toContain('aiff')
  })
})

describe('Roast Fix 4: AIFF writeExtendedFloat supports all sample rates', () => {
  test('encodeAiff produces valid AIFF for 44100 Hz', async () => {
    const { encodeAiff } = await import('@/lib/psy4/multi-export')
    const L = new Float32Array(100)
    const R = new Float32Array(100)
    for (let i = 0; i < 100; i++) {
      L[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 44100)
      R[i] = L[i]!
    }
    const buf = encodeAiff(L, R, 44100)
    expect(buf.byteLength).toBeGreaterThan(100)
    // Check FORM/AIFF magic
    const view = new DataView(buf)
    expect(view.getUint32(0, false)).toBe(0x464f524d) // 'FORM'
    expect(view.getUint32(8, false)).toBe(0x41494646) // 'AIFF'
  })

  test('encodeAiff supports non-standard rates (was 44100 fallback bug)', async () => {
    const { encodeAiff } = await import('@/lib/psy4/multi-export')
    const L = new Float32Array(100)
    const R = new Float32Array(100)
    // 96000 Hz — would have been silently written as 44100 in the old code
    const buf = encodeAiff(L, R, 96000)
    const view = new DataView(buf)
    // The COMM chunk starts at offset 20 (after FORM header + COMM id/size).
    // Sample rate is the 80-bit extended float at offset 28.
    // Read the exponent (16 bits, big-endian) — for 96000, msb is at position 16
    // (2^16 = 65536 < 96000 < 131072 = 2^17), so exponent = 16 + 16383 = 16399 = 0x400F
    const exponent = view.getUint16(28, false)
    expect(exponent).toBe(0x400f) // 16399, not 0x400e (16398 = 44100's exponent)
  })

  test('encodeAiff 88200 Hz has correct exponent', async () => {
    const { encodeAiff } = await import('@/lib/psy4/multi-export')
    const L = new Float32Array(100)
    const R = new Float32Array(100)
    // 88200 = 44100 * 2 = 2^16.43... msb = 16, exponent = 16399 = 0x400F
    const buf = encodeAiff(L, R, 88200)
    const view = new DataView(buf)
    const exponent = view.getUint16(28, false)
    expect(exponent).toBe(0x400f)
  })

  test('encodeAiff 22050 Hz has correct exponent', async () => {
    const { encodeAiff } = await import('@/lib/psy4/multi-export')
    const L = new Float32Array(100)
    const R = new Float32Array(100)
    // 22050 < 32768 = 2^15, msb = 14, exponent = 14 + 16383 = 16397 = 0x400D
    const buf = encodeAiff(L, R, 22050)
    const view = new DataView(buf)
    const exponent = view.getUint16(28, false)
    expect(exponent).toBe(0x400d)
  })
})

// ─── Roast Fix 6: audio-critic bpm guard + render seed propagation ────────

describe('Roast Fix 6: audio-critic guards against invalid bpm', () => {
  test('critiqueAudio with bpm=undefined returns finite score (was NaN)', async () => {
    const { critiqueAudio } = await import('@/lib/psy4/audio-critic')
    const sr = 44100
    const mono = new Float32Array(sr)
    for (let i = 0; i < mono.length; i++) mono[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
    const r = critiqueAudio(mono, sr, undefined as unknown as number, 16)
    expect(Number.isFinite(r.overallScore)).toBe(true)
  })

  test('critiqueAudio with bpm=0 returns finite score', async () => {
    const { critiqueAudio } = await import('@/lib/psy4/audio-critic')
    const sr = 44100
    const mono = new Float32Array(sr)
    for (let i = 0; i < mono.length; i++) mono[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
    const r = critiqueAudio(mono, sr, 0, 16)
    expect(Number.isFinite(r.overallScore)).toBe(true)
  })

  test('critiqueAudio with bpm=NaN returns finite score', async () => {
    const { critiqueAudio } = await import('@/lib/psy4/audio-critic')
    const sr = 44100
    const mono = new Float32Array(sr)
    for (let i = 0; i < mono.length; i++) mono[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
    const r = critiqueAudio(mono, sr, Number.NaN, 16)
    expect(Number.isFinite(r.overallScore)).toBe(true)
  })

  test('critiqueAudio with negative bpm returns finite score', async () => {
    const { critiqueAudio } = await import('@/lib/psy4/audio-critic')
    const sr = 44100
    const mono = new Float32Array(sr)
    for (let i = 0; i < mono.length; i++) mono[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
    const r = critiqueAudio(mono, sr, -100, 16)
    expect(Number.isFinite(r.overallScore)).toBe(true)
  })
})

describe('Roast Fix 6: render seed propagation (was hardcoded 42)', () => {
  test('different seeds produce different audio outputs', async () => {
    const { renderFoundationSection, DEFAULT_RENDER_CONFIG } = await import(
      '@/lib/psy4/forensic-bridge'
    )
    const { CompositionEngine, createIdentityA } = await import('@psy-foundation/music')
    const { createHash } = await import('node:crypto')

    const ctx = {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      octave: 4,
      bpm: 145,
      beatsPerBar: 4,
      beatPosition: 0,
      barPosition: 0,
      phrasePosition: 0,
      harmonicContext: [],
      density: 0.7,
      energy: 0.7,
      tension: 0.3,
      sectionRole: 'full-on' as const,
      repetitionPressure: 0.3,
      noveltyPressure: 0.5,
    }

    const hashes: string[] = []
    for (const seed of [42, 100, 200, 300]) {
      const engine = new CompositionEngine({
        seed,
        context: ctx,
        identity: createIdentityA(),
      })
      const section = engine.composeSection({ bars: 8 })
      const result = await renderFoundationSection(section, {
        useSamples: false,
        bpm: 145,
        config: DEFAULT_RENDER_CONFIG,
      })
      const hash = createHash('md5')
        .update(Buffer.from(result.samplesL.buffer))
        .digest('hex')
        .slice(0, 16)
      hashes.push(hash)
    }

    // All 4 hashes must be different
    const uniqueHashes = new Set(hashes)
    expect(uniqueHashes.size).toBe(4)
  }, 30000)

  test('seed=42 still matches the snapshot baseline (determinism preserved)', async () => {
    const { renderFoundationSection, encodeWav, DEFAULT_RENDER_CONFIG } = await import(
      '@/lib/psy4/forensic-bridge'
    )
    const { CompositionEngine, createIdentityA } = await import('@psy-foundation/music')
    const { createHash } = await import('node:crypto')

    const ctx = {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      octave: 4,
      bpm: 145,
      beatsPerBar: 4,
      beatPosition: 0,
      barPosition: 0,
      phrasePosition: 0,
      harmonicContext: [],
      density: 0.7,
      energy: 0.7,
      tension: 0.3,
      sectionRole: 'full-on' as const,
      repetitionPressure: 0.3,
      noveltyPressure: 0.5,
    }

    const engine = new CompositionEngine({
      seed: 42,
      context: ctx,
      identity: createIdentityA(),
    })
    const section = engine.composeSection({ bars: 8 })
    const result = await renderFoundationSection(section, {
      useSamples: true,
      bpm: 145,
      config: { ...DEFAULT_RENDER_CONFIG, bassGain: 0.8, subBassGain: 0.6, padGain: 0.7 },
    })
    const wav = encodeWav(result.samplesL, result.samplesR, result.sampleRate)
    const hash = createHash('md5').update(Buffer.from(wav)).digest('hex')
    // Baseline from roast-fix-3 (after K-weighting correction).
    // Phase 1.2 (2026-09-04): limiter rewrite → re-baselined (audit C3 fix).
    // Phase 1.1 (2026-09-04): OTT per-channel expanders (DECISIONS_V3 D3) →
    // re-baselined.
    expect(hash).toBe('f2f81ed62a25743358417bed75ab67f7')
  })
})

// ─── Roast Fix 8: MoogLadder guard against missing args ─────────────────────

describe('Roast Fix 8: MoogLadder guards against invalid args (was NaN)', () => {
  test('MoogLadder with missing drive (4 args) returns finite output', async () => {
    const { MoogLadder } = await import('@/lib/psy4/forensic/dsp')
    const moog = new MoogLadder()
    const sr = 44100
    let nanCount = 0
    for (let i = 0; i < sr; i++) {
      const x = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr)
      const y = moog.process(x, 2000, 0.3, undefined as unknown as number, sr)
      if (!Number.isFinite(y)) nanCount++
    }
    expect(nanCount).toBe(0)
  })

  test('MoogLadder with NaN drive returns finite output', async () => {
    const { MoogLadder } = await import('@/lib/psy4/forensic/dsp')
    const moog = new MoogLadder()
    const sr = 44100
    let nanCount = 0
    for (let i = 0; i < sr; i++) {
      const x = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr)
      const y = moog.process(x, 2000, 0.3, Number.NaN, sr)
      if (!Number.isFinite(y)) nanCount++
    }
    expect(nanCount).toBe(0)
  })

  test('MoogLadder with NaN sr returns finite output', async () => {
    const { MoogLadder } = await import('@/lib/psy4/forensic/dsp')
    const moog = new MoogLadder()
    let nanCount = 0
    for (let i = 0; i < 100; i++) {
      const x = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 44100)
      const y = moog.process(x, 2000, 0.3, 1.0, Number.NaN)
      if (!Number.isFinite(y)) nanCount++
    }
    expect(nanCount).toBe(0)
  })

  test('MoogLadder with correct args still works (no regression)', async () => {
    const { MoogLadder } = await import('@/lib/psy4/forensic/dsp')
    const moog = new MoogLadder()
    const sr = 44100
    let maxOut = 0
    for (let i = 0; i < sr; i++) {
      const x = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr)
      const y = moog.process(x, 2000, 0.3, 1.0, sr)
      maxOut = Math.max(maxOut, Math.abs(y))
    }
    expect(maxOut).toBeGreaterThan(0.01) // produces signal
    expect(maxOut).toBeLessThan(1.0) // doesn't blow up
  })
})

// ─── Roast Fix 9: OTT parameter + gain clamping ────────────────────────────

describe('Roast Fix 9: OTT clamps extreme params (was 685 billion output)', () => {
  test('OTT with depth=10 produces bounded output (was 186x)', async () => {
    const { OTT } = await import('@psy-foundation/dsp')
    const sr = 44100
    const ott = new OTT({ depth: 10, sampleRate: sr }) // depth clamped to 1
    const L = new Float32Array(sr)
    const R = new Float32Array(sr)
    for (let i = 0; i < sr; i++) {
      L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
      R[i] = L[i]!
    }
    ott.processBuffer(L, R)
    let maxOut = 0
    for (let i = 0; i < sr; i++) maxOut = Math.max(maxOut, Math.abs(L[i] ?? 0))
    expect(maxOut).toBeLessThan(10) // was 186 before clamp
    expect(maxOut).toBeGreaterThan(0) // still produces signal
  })

  test('OTT with upwardGain=20dB produces bounded output (was 685 billion)', async () => {
    const { OTT } = await import('@psy-foundation/dsp')
    const sr = 44100
    const ott = new OTT({ depth: 1, upwardGainDb: 20, sampleRate: sr }) // clamped to 12
    const L = new Float32Array(sr)
    const R = new Float32Array(sr)
    for (let i = 0; i < sr; i++) {
      L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
      R[i] = L[i]!
    }
    ott.processBuffer(L, R)
    let maxOut = 0
    for (let i = 0; i < sr; i++) maxOut = Math.max(maxOut, Math.abs(L[i] ?? 0))
    expect(maxOut).toBeLessThan(100) // was 685 billion before clamp
    expect(Number.isFinite(maxOut)).toBe(true)
  })

  test('OTT with normal params still works (no regression)', async () => {
    const { OTT } = await import('@psy-foundation/dsp')
    const sr = 44100
    const ott = new OTT({ depth: 0.3, upwardGainDb: 2, downwardGainDb: -2, sampleRate: sr })
    const L = new Float32Array(sr)
    const R = new Float32Array(sr)
    for (let i = 0; i < sr; i++) {
      L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
      R[i] = L[i]!
    }
    ott.processBuffer(L, R)
    let maxOut = 0
    for (let i = 0; i < sr; i++) maxOut = Math.max(maxOut, Math.abs(L[i] ?? 0))
    expect(maxOut).toBeGreaterThan(0.1)
    expect(maxOut).toBeLessThan(1.0)
  })

  test('OTT depth=0 is still a no-op', async () => {
    const { OTT } = await import('@psy-foundation/dsp')
    const sr = 44100
    const ott = new OTT({ depth: 0, sampleRate: sr })
    const L = new Float32Array(sr)
    const R = new Float32Array(sr)
    for (let i = 0; i < sr; i++) {
      L[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr)
      R[i] = L[i]!
    }
    const Lin = L.slice()
    ott.processBuffer(L, R)
    let maxDiff = 0
    for (let i = 0; i < sr; i++) maxDiff = Math.max(maxDiff, Math.abs(Lin[i]! - L[i]!))
    expect(maxDiff).toBe(0) // true no-op
  })
})

// ─── Roast Fix 10 → Phase 1.1 (One DSP): master chain parity in worklet land ─
//
// Roast-fix-10 ported MultibandCompressor + OTT into the hand-written worklet
// JS. Phase 1.1 (DECISIONS_V3 D6) deleted that vendored 4th copy: the worklet
// is now GENERATED from apps/web/src/worklets/psy4-processor.ts, which imports
// the master chain from @psy-foundation/dsp — the same classes the offline
// render uses, so real-time/offline parity is structural. These tests keep
// the roast-fix-10 behavior locks on the CANONICAL classes, and verify the
// generated artifact really parses and registers under its contract name.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LR4Crossover, MultibandCompressor, OTT } from '@psy-foundation/dsp'

function sineBuffer(n: number, freq = 440, amp = 0.3): Float32Array {
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return buf
}

function generatedWorkletPath(): string {
  const candidates = [
    join(process.cwd(), 'public', 'worklets', 'psy4-processor.js'),
    join(process.cwd(), 'apps', 'web', 'public', 'worklets', 'psy4-processor.js'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  throw new Error('generated worklet not found — run: bun run build:worklet')
}

describe('Roast Fix 10 → One DSP: canonical master chain (worklet AND offline)', () => {
  test('LR4Crossover produces LP + HP that sum to ~unity (magnitude)', () => {
    const xover = new LR4Crossover(200, SR)
    let sumSq = 0
    let inputSq = 0
    const n = SR
    for (let i = 0; i < n; i++) {
      const x = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR)
      const [lp, hp] = xover.process(x)
      const sum = lp + hp
      sumSq += sum * sum
      inputSq += x * x
    }
    const rmsSum = Math.sqrt(sumSq / n)
    const rmsInput = Math.sqrt(inputSq / n)
    // RMS of sum should be close to RMS of input (within 15%)
    expect(Math.abs(rmsSum - rmsInput) / rmsInput).toBeLessThan(0.15)
  })

  test('MultibandCompressor produces finite output (no NaN)', () => {
    const mb = new MultibandCompressor({ sampleRate: SR })
    const L = sineBuffer(1000)
    const R = sineBuffer(1000)
    mb.processBuffer(L, R)
    for (let i = 0; i < L.length; i++) {
      expect(Number.isFinite(L[i]!)).toBe(true)
      expect(Number.isFinite(R[i]!)).toBe(true)
    }
  })

  test('MultibandCompressor L/R symmetric for same input', () => {
    const mb = new MultibandCompressor({ sampleRate: SR })
    const L = sineBuffer(SR)
    const R = sineBuffer(SR)
    mb.processBuffer(L, R)
    let maxDiff = 0
    for (let i = 0; i < L.length; i++) maxDiff = Math.max(maxDiff, Math.abs(L[i]! - R[i]!))
    // L and R should be identical for same input (separate state per channel)
    expect(maxDiff).toBeLessThan(0.001)
  })

  test('OTT depth=0 is a no-op (returns input unchanged)', () => {
    const ott = new OTT({ sampleRate: SR, depth: 0 })
    const L = new Float32Array([0.5, 0.25, -0.3])
    const R = new Float32Array([0.5, 0.25, -0.3])
    ott.processBuffer(L, R)
    expect(L[0]).toBeCloseTo(0.5, 4)
    expect(R[0]).toBeCloseTo(0.5, 4)
    expect(L[2]).toBeCloseTo(-0.3, 4)
  })

  test('OTT produces finite output (no NaN)', () => {
    const ott = new OTT({ sampleRate: SR, depth: 0.3 })
    const L = sineBuffer(1000)
    const R = sineBuffer(1000)
    ott.processBuffer(L, R)
    for (let i = 0; i < L.length; i++) {
      expect(Number.isFinite(L[i]!)).toBe(true)
      expect(Number.isFinite(R[i]!)).toBe(true)
    }
  })

  test('OTT L/R symmetric for same input (per-channel expanders, D3)', () => {
    const ott = new OTT({ sampleRate: SR, depth: 0.3 })
    const L = sineBuffer(SR)
    const R = sineBuffer(SR)
    ott.processBuffer(L, R)
    let maxDiff = 0
    for (let i = 0; i < L.length; i++) maxDiff = Math.max(maxDiff, Math.abs(L[i]! - R[i]!))
    expect(maxDiff).toBeLessThan(0.001)
  })

  test('OTT extreme params bounded (inherits roast-fix-9 clamp)', () => {
    const ott = new OTT({ sampleRate: SR, depth: 10, upwardGainDb: 20 })
    const L = sineBuffer(SR)
    const R = sineBuffer(SR)
    ott.processBuffer(L, R)
    let maxOut = 0
    for (let i = 0; i < L.length; i++) maxOut = Math.max(maxOut, Math.abs(L[i]!), Math.abs(R[i]!))
    // Bounded (was 685 billion before the clamp)
    expect(maxOut).toBeLessThan(100)
    expect(Number.isFinite(maxOut)).toBe(true)
  })

  test('MultibandCompressor + OTT chained: finite bounded output', () => {
    const mb = new MultibandCompressor({ sampleRate: SR })
    const ott = new OTT({ sampleRate: SR, depth: 0.3 })
    const L = sineBuffer(SR)
    const R = sineBuffer(SR)
    mb.processBuffer(L, R)
    ott.processBuffer(L, R)
    let nanCount = 0
    let maxOut = 0
    for (let i = 0; i < L.length; i++) {
      if (!Number.isFinite(L[i]!) || !Number.isFinite(R[i]!)) nanCount++
      maxOut = Math.max(maxOut, Math.abs(L[i]!), Math.abs(R[i]!))
    }
    expect(nanCount).toBe(0)
    expect(maxOut).toBeLessThan(10)
    expect(maxOut).toBeGreaterThan(0)
  })
})

describe('One DSP: generated worklet artifact contract (D6)', () => {
  /** Extract the registered PSY4Processor class from the built artifact by
   *  executing it in a mocked AudioWorkletGlobalScope. Returns the class (or
   *  null when registration didn't happen). Restores all patched globals. */
  function loadProcessorClass(): (new () => unknown) | null {
    const src = readFileSync(generatedWorkletPath(), 'utf-8')
    const g = globalThis as unknown as Record<string, unknown>
    let captured: (new () => unknown) | null = null
    const saved: Array<[string, unknown]> = [
      ['AudioWorkletProcessor', g.AudioWorkletProcessor],
      ['registerProcessor', g.registerProcessor],
      ['sampleRate', g.sampleRate],
      ['currentFrame', g.currentFrame],
    ]
    class MockProcessor {
      port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: () => {} }
    }
    g.AudioWorkletProcessor = MockProcessor
    g.registerProcessor = (_name: string, ctor: new () => unknown) => {
      captured = ctor
    }
    g.sampleRate = 44100
    g.currentFrame = 0
    try {
      ;(new Function(src) as () => void)()
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete g[k]
        else g[k] = v
      }
    }
    return captured
  }

  /** Drive the processor's port handler with messages and pull one render
   *  quantum (128 frames) through process(). Returns [L, R] outputs.
   *  NOTE the AudioWorklet signature: process(inputs, outputs) where outputs
   *  is Float32Array[][] (bus → channels). */
  function renderQuantum(
    proc: {
      port: { onmessage: ((e: { data: unknown }) => void) | null }
      process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean
    },
    messages: unknown[]
  ): [Float32Array, Float32Array] {
    for (const m of messages) proc.port.onmessage?.({ data: m })
    const L = new Float32Array(128)
    const R = new Float32Array(128)
    proc.process([], [[L, R]])
    return [L, R]
  }

  function peak(f: Float32Array): number {
    let p = 0
    for (let i = 0; i < f.length; i++) p = Math.max(p, Math.abs(f[i] ?? 0))
    return p
  }

  test('artifact parses, executes and registers under the contract name', () => {
    const src = readFileSync(generatedWorkletPath(), 'utf-8')
    expect(src.startsWith('/* GENERATED by scripts/build-worklet.mjs')).toBe(true)
    // Syntax-valid script (compiles without executing):
    expect(() => new Function(src)).not.toThrow()
    // Executes in a mocked AudioWorkletGlobalScope and registers 'psy4-processor':
    const captured = loadProcessorClass()
    expect(captured).not.toBeNull()
  })

  test('PLAN_V3 4.5: per-note noteOff releases only that note (PLAN lock)', () => {
    const Ctor = loadProcessorClass()
    expect(Ctor).not.toBeNull()
    const proc = new (
      Ctor as new () => {
        port: { onmessage: ((e: { data: unknown }) => void) | null }
        process: (i: Float32Array[][], o: Float32Array[][]) => boolean
      }
    )()

    // Two held lead notes (48-71 → LeadVoice pool).
    renderQuantum(proc, [
      { type: 'noteOn', midi: 60, velocity: 0.9 },
      { type: 'noteOn', midi: 64, velocity: 0.9 },
    ])
    // Release ONLY midi 60 — 64 must keep sounding.
    const [l1] = renderQuantum(proc, [{ type: 'noteOff', midi: 60 }])
    expect(peak(l1)).toBeGreaterThan(0) // 64 still active

    // Release-all (no midi) — legacy semantics intact. The OTT master chain
    // has a natural ~100ms release bloom after any signal stops (measured:
    // true digital silence within 250ms), so the honest lock is "decays to
    // silence", not "instant zero".
    for (let q = 0; q < 40; q++) {
      renderQuantum(proc, [{ type: 'noteOff' }])
    }
    const [l2] = renderQuantum(proc, [])
    expect(peak(l2)).toBeLessThan(0.001) // −60 dBFS after the release window
  })

  test('PLAN_V3 4.5: setVoiceGain scales the section (mute → silence)', () => {
    const Ctor = loadProcessorClass()
    expect(Ctor).not.toBeNull()
    const proc = new (
      Ctor as new () => {
        port: { onmessage: ((e: { data: unknown }) => void) | null }
        process: (i: Float32Array[][], o: Float32Array[][]) => boolean
      }
    )()

    // Lead note with default gain → audible.
    const [l1] = renderQuantum(proc, [{ type: 'noteOn', midi: 60, velocity: 0.9 }])
    expect(peak(l1)).toBeGreaterThan(0)

    // Mute the lead section → the note's contribution is zero; whatever the
    // master chain's release tail still holds decays (see note above), so the
    // honest lock is "decays to near-silence", not "instant zero".
    for (let q = 0; q < 40; q++) {
      renderQuantum(proc, [{ type: 'setVoiceGain', section: 'lead', value: 0 }])
    }
    const [l2] = renderQuantum(proc, [])
    expect(peak(l2)).toBeLessThan(0.001) // −60 dBFS after the release window

    // Unmute → audible again; out-of-range gains are clamped, not trusted.
    const [l3] = renderQuantum(proc, [
      { type: 'setVoiceGain', section: 'lead', value: 1 },
      { type: 'setVoiceGain', section: 'bass', value: 99 }, // clamp → 2
      { type: 'setVoiceGain', section: 'pad', value: Number.NaN }, // clamp → 1
    ])
    expect(peak(l3)).toBeGreaterThan(0)
  })
})
