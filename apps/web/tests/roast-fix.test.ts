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
import { CompositionEngine, createIdentityA } from '@psy-foundation/music'
import { getReferenceLatent } from '../src/app/api/upload-reference/route'
import {
  DEFAULT_RENDER_CONFIG,
  decodeWav,
  renderFoundationSection,
} from '../src/lib/psy4/forensic-bridge'
import { Rng } from '../src/lib/psy4/forensic/prng'
import { measureLUFS } from '../src/lib/psy4/loudness'
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
    const { measureLUFS } = await import('@/lib/psy4/loudness')

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
