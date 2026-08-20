/**
 * Reference Analyzer — analyzes commercial tracks and compares to renders.
 *
 * Ported concept from PSYSTAR style_clone.py + PSY4 REFERENCE_ANALYSIS_REPORT.
 *
 * Extracts: BPM, key/scale, spectral profile, dynamics, structure.
 * Compares render → reference → distance → adjustment suggestions.
 *
 * Pure functions: no audio playback, no I/O, no side effects.
 */

import { type LUFSResult, measureLUFS } from './loudness'

export interface ReferenceProfile {
  bpm: number
  lufs: number
  truePeakDb: number
  spectralCentroid: number // Hz — brightness
  bassEnergy: number // 20-250Hz ratio
  midEnergy: number // 250-2000Hz ratio
  highEnergy: number // 2000-12000Hz ratio
  airEnergy: number // 12000-20000Hz ratio
  crestFactor: number // peak/RMS
  stereoWidth: number // L-R / L+R
  dynamicRange: number // LU range
  lowMidMud: number // 200-500Hz ratio
}

export interface RenderComparison {
  distance: number // 0 = identical, 1 = completely different
  lufsDelta: number // dB difference
  brightnessDelta: number // Hz difference
  bassRatioDelta: number // ratio difference
  widthDelta: number // width difference
  suggestions: string[] // actionable corrections
}

export interface AnalysisResult {
  profile: ReferenceProfile
  lufs: LUFSResult
}

/**
 * Analyze a stereo audio buffer and extract a reference profile.
 */
export function analyzeReference(
  L: Float32Array,
  R: Float32Array,
  sampleRate: number
): AnalysisResult {
  const N = Math.min(L.length, R.length)
  const fftSize = 2048

  // LUFS measurement
  const lufs = measureLUFS(L, R, sampleRate)

  // Peak / RMS
  let peak = 0
  let sumSq = 0
  for (let i = 0; i < N; i++) {
    const l = Math.abs(L[i]!)
    const r = Math.abs(R[i]!)
    if (l > peak) peak = l
    if (r > peak) peak = r
    sumSq += L[i]! * L[i]! + R[i]! * R[i]!
  }
  const rms = Math.sqrt(sumSq / (N * 2))
  const crestFactor = peak / Math.max(0.0001, rms)
  const truePeakDb = 20 * Math.log10(Math.max(0.0001, peak))

  // Stereo width
  let sumDiff = 0
  let sumSum = 0
  for (let i = 0; i < N; i++) {
    sumDiff += Math.abs(L[i]! - R[i]!)
    sumSum += Math.abs(L[i]! + R[i]!)
  }
  const stereoWidth = sumSum > 0 ? Math.min(2, sumDiff / sumSum) : 0

  // Spectral analysis — average spectrum from multiple frames
  const numFrames = Math.floor(N / fftSize)
  const avgSpectrum = new Float32Array(fftSize / 2)
  let totalWeighted = 0
  let totalMag = 0

  for (let f = 0; f < numFrames; f++) {
    const frame = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++) {
      // Use mono sum + Hann window
      const mono = (L[f * fftSize + i]! + R[f * fftSize + i]!) * 0.5
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / fftSize))
      frame[i] = mono * hann
    }
    // DFT
    for (let k = 0; k < fftSize / 2; k++) {
      let re = 0,
        im = 0
      for (let n = 0; n < fftSize; n++) {
        const angle = (-2 * Math.PI * k * n) / fftSize
        re += frame[n]! * Math.cos(angle)
        im += frame[n]! * Math.sin(angle)
      }
      const mag = Math.sqrt(re * re + im * im)
      avgSpectrum[k] += mag
      totalWeighted += ((k * sampleRate) / fftSize) * mag
      totalMag += mag
    }
  }

  // Normalize spectrum
  for (let i = 0; i < avgSpectrum.length; i++) avgSpectrum[i]! /= numFrames

  const spectralCentroid = totalMag > 0 ? totalWeighted / totalMag : 0

  // Band energies
  const bandEnergy = (loHz: number, hiHz: number): number => {
    const loBin = Math.floor((loHz * fftSize) / sampleRate)
    const hiBin = Math.ceil((hiHz * fftSize) / sampleRate)
    let e = 0
    for (let i = loBin; i <= hiBin && i < avgSpectrum.length; i++) e += avgSpectrum[i]!
    return e
  }

  const bass = bandEnergy(20, 250)
  const mid = bandEnergy(250, 2000)
  const high = bandEnergy(2000, 12000)
  const air = bandEnergy(12000, 20000)
  const lowMid = bandEnergy(200, 500)
  const total = bass + mid + high + air

  // Dynamic range (simplified: difference between max and min frame energy)
  let maxFrameRMS = 0
  let minFrameRMS = Number.POSITIVE_INFINITY
  for (let f = 0; f < numFrames; f++) {
    let frameSum = 0
    for (let i = 0; i < fftSize; i++) {
      const s = (L[f * fftSize + i]! + R[f * fftSize + i]!) * 0.5
      frameSum += s * s
    }
    const frameRMS = Math.sqrt(frameSum / fftSize)
    if (frameRMS > maxFrameRMS) maxFrameRMS = frameRMS
    if (frameRMS < minFrameRMS) minFrameRMS = frameRMS
  }
  const dynamicRange =
    maxFrameRMS > 0 && minFrameRMS > 0 ? 20 * Math.log10(maxFrameRMS / minFrameRMS) : 0

  // BPM estimation via onset autocorrelation
  const bpm = estimateBPM(L, sampleRate)

  return {
    profile: {
      bpm,
      lufs: lufs.integratedLUFS,
      truePeakDb,
      spectralCentroid,
      bassEnergy: total > 0 ? bass / total : 0,
      midEnergy: total > 0 ? mid / total : 0,
      highEnergy: total > 0 ? high / total : 0,
      airEnergy: total > 0 ? air / total : 0,
      crestFactor,
      stereoWidth,
      dynamicRange,
      lowMidMud: total > 0 ? lowMid / total : 0,
    },
    lufs,
  }
}

/**
 * Estimate BPM via onset autocorrelation.
 */
function estimateBPM(pcm: Float32Array, sampleRate: number): number {
  // Onset detection: energy envelope
  const windowSize = Math.floor(sampleRate * 0.01) // 10ms
  const numWindows = Math.floor(pcm.length / windowSize)
  const envelope: number[] = []
  for (let w = 0; w < numWindows; w++) {
    let energy = 0
    for (let i = 0; i < windowSize; i++) energy += Math.abs(pcm[w * windowSize + i]!)
    envelope.push(energy / windowSize)
  }

  // Autocorrelation — find the lag with highest correlation
  let bestLag = 0
  let bestCorr = 0
  const minLag = Math.floor(((60 / 200) * sampleRate) / windowSize) // 200 BPM
  const maxLag = Math.floor(((60 / 60) * sampleRate) / windowSize) // 60 BPM

  for (let lag = minLag; lag < maxLag; lag++) {
    let corr = 0
    let energy = 0
    for (let i = 0; i < envelope.length - lag; i++) {
      corr += envelope[i]! * envelope[i + lag]!
      energy += envelope[i]! * envelope[i]! + envelope[i + lag]! * envelope[i + lag]!
    }
    const norm = energy > 0 ? (corr / energy) * 2 : 0
    if (norm > bestCorr) {
      bestCorr = norm
      bestLag = lag
    }
  }

  // Convert lag to BPM
  const secondsPerWindow = windowSize / sampleRate
  const bpm = bestLag > 0 ? 60 / (bestLag * secondsPerWindow) : 145
  return Math.round(bpm)
}

/**
 * Compare a render to a reference profile.
 */
export function compareProfiles(
  render: ReferenceProfile,
  reference: ReferenceProfile
): RenderComparison {
  const lufsDelta = render.lufs - reference.lufs
  const brightnessDelta = render.spectralCentroid - reference.spectralCentroid
  const bassRatioDelta = render.bassEnergy - reference.bassEnergy
  const widthDelta = render.stereoWidth - reference.stereoWidth

  // Distance: weighted sum of normalized deltas
  const distance = Math.min(
    1,
    (Math.abs(lufsDelta) / 6 +
      Math.abs(brightnessDelta) / 2000 +
      Math.abs(bassRatioDelta) +
      Math.abs(widthDelta)) /
      4
  )

  const suggestions: string[] = []
  if (lufsDelta < -1)
    suggestions.push(
      `Increase LUFS by ${(-lufsDelta).toFixed(1)}dB — render is quieter than reference`
    )
  if (lufsDelta > 1)
    suggestions.push(`Decrease LUFS by ${lufsDelta.toFixed(1)}dB — render is louder than reference`)
  if (brightnessDelta < -500)
    suggestions.push(
      `Increase brightness — render is ${(-brightnessDelta).toFixed(0)}Hz darker than reference`
    )
  if (brightnessDelta > 500)
    suggestions.push(
      `Decrease brightness — render is ${brightnessDelta.toFixed(0)}Hz brighter than reference`
    )
  if (bassRatioDelta > 0.1)
    suggestions.push(
      `Reduce bass — render has ${(bassRatioDelta * 100).toFixed(0)}% more bass than reference`
    )
  if (bassRatioDelta < -0.1)
    suggestions.push(
      `Increase bass — render has ${(-bassRatioDelta * 100).toFixed(0)}% less bass than reference`
    )
  if (widthDelta > 0.3) suggestions.push(`Reduce stereo width — render is wider than reference`)
  if (widthDelta < -0.3)
    suggestions.push(`Increase stereo width — render is narrower than reference`)
  if (render.lowMidMud > 0.15) suggestions.push(`Reduce low-mid mud (200-500Hz) — render is muddy`)

  return {
    distance,
    lufsDelta,
    brightnessDelta,
    bassRatioDelta,
    widthDelta,
    suggestions,
  }
}
