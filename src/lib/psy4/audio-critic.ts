/**
 * AudioCritic — analyzes rendered PCM and returns an actionable musical/sonic
 * diagnosis.
 *
 * F22 requirement: the critic must NOT just return peak/RMS/centroid. It must
 * return a diagnosis that maps perceptual problems to probable causes to
 * parameter families to musical/synthesis corrections.
 *
 * The critique covers 8 areas:
 *   lowEnd — kick clarity, bass clarity, kick/bass separation, sub mud, phase risk
 *   transient — punch, attack sharpness, kick definition
 *   bass — note separation, decay overlap, pitch stability, spectral consistency
 *   groove — onset clarity, pocket consistency, kick/bass lock, excessive uniformity
 *   lead — articulation, melodic clarity, phrase contrast, repetition balance, harmonic clarity
 *   timbre — brightness, roughness, noisiness, spectral movement, modulation depth, identity strength
 *   mix — low-mid mud, harshness, high-end presence, stereo contrast, dynamic range, masking
 *   musicality — tension/release, motif identity, development, call/response, rhythmic interest
 *
 * Each failure includes a diagnosis string + a correction hint that the
 * generator/synth can act on.
 */

export interface AudioCritique {
  lowEnd: {
    kickClarity: number
    bassClarity: number
    kickBassSeparation: number
    subMud: number
    phaseRisk: number
  }
  transient: {
    punch: number
    attackSharpness: number
    kickDefinition: number
  }
  bass: {
    noteSeparation: number
    decayOverlap: number
    pitchStability: number
    spectralConsistency: number
  }
  groove: {
    onsetClarity: number
    pocketConsistency: number
    kickBassLock: number
    excessiveUniformity: number
  }
  lead: {
    articulation: number
    melodicClarity: number
    phraseContrast: number
    repetitionBalance: number
    harmonicClarity: number
  }
  timbre: {
    brightness: number
    roughness: number
    noisiness: number
    spectralMovement: number
    modulationDepth: number
    identityStrength: number
  }
  mix: {
    lowMidMud: number
    harshness: number
    highEndPresence: number
    stereoContrast: number
    dynamicRange: number
    masking: number
  }
  musicality: {
    tensionRelease: number
    motifIdentity: number
    development: number
    callResponse: number
    rhythmicInterest: number
  }
  overallScore: number
  failures: AudioFailure[]
}

export interface AudioFailure {
  /** Failure code (e.g. BASS_DECAY_TOO_LONG). */
  code: string
  /** Human-readable diagnosis. */
  diagnosis: string
  /** Which parameter family to change. */
  correctionTarget: string
  /** Suggested correction direction (e.g. "shorten bass decay", "raise click brightness"). */
  correctionHint: string
  /** Severity 0..1. */
  severity: number
}

/**
 * Analyze a rendered PCM buffer and return an actionable critique.
 *
 * @param pcm — mono PCM Float32Array
 * @param sampleRate — sample rate
 * @param bpm — BPM (for rhythmic analysis)
 * @param stepsPerBar — steps per bar (for onset grid analysis)
 */
export function critiqueAudio(
  pcm: Float32Array,
  sampleRate: number,
  bpm: number,
  stepsPerBar = 16
): AudioCritique {
  const failures: AudioFailure[] = []

  // ── Basic levels ──
  const peak = findPeak(pcm)
  const rms = computeRMS(pcm)
  const dynamicRange = peak / Math.max(0.0001, rms)

  // ── Spectral analysis ──
  const fftSize = 2048
  const spectra = computeSpectrogram(pcm, fftSize, sampleRate)
  const avgSpectrum = averageSpectrum(spectra)
  const spectralCentroid = computeCentroid(avgSpectrum, sampleRate, fftSize)
  const _spectralRolloff = computeRolloff(avgSpectrum, sampleRate, fftSize)

  // ── Band energy ──
  const subEnergy = bandEnergy(avgSpectrum, sampleRate, fftSize, 20, 80)
  const bassEnergy = bandEnergy(avgSpectrum, sampleRate, fftSize, 80, 250)
  const lowMidEnergy = bandEnergy(avgSpectrum, sampleRate, fftSize, 250, 500)
  const midEnergy = bandEnergy(avgSpectrum, sampleRate, fftSize, 500, 2000)
  const highMidEnergy = bandEnergy(avgSpectrum, sampleRate, fftSize, 2000, 5000)
  const highEnergy = bandEnergy(avgSpectrum, sampleRate, fftSize, 5000, 12000)

  // ── Onset detection ──
  const onsets = detectOnsets(pcm, sampleRate, bpm, stepsPerBar)
  const onsetSharpness = computeOnsetSharpness(pcm, onsets, sampleRate)

  // ── Transient analysis ──
  const _transientEnv = computeTransientEnvelope(pcm, sampleRate)
  const punch = computePunch(pcm, onsets, sampleRate)

  // ── Spectral movement (how much the spectrum changes over time) ──
  const spectralMovement = computeSpectralMovement(spectra)

  // ── Low-end analysis ──
  // kickClarity: kick-specific clarity = onset sharpness weighted by low-end energy presence
  const kickClarity = onsetSharpness * 0.7 + Math.min(1, (subEnergy + bassEnergy) / Math.max(0.01, subEnergy + bassEnergy + lowMidEnergy + midEnergy)) * 0.3
  const bassClarity = Math.min(1, bassEnergy / Math.max(0.01, subEnergy + bassEnergy))
  const kickBassSeparation = computeKickBassSeparation(avgSpectrum, sampleRate, fftSize)
  const subMud = computeSubMud(avgSpectrum, sampleRate, fftSize)
  const phaseRisk = computePhaseRisk(pcm, sampleRate)

  // ── Bass analysis ──
  const noteSeparation = computeNoteSeparation(spectra, sampleRate, fftSize)
  const decayOverlap = computeDecayOverlap(spectra, sampleRate, fftSize)
  const pitchStability = computePitchStability(pcm, sampleRate)
  const spectralConsistency = 1 - spectralMovement

  // ── Groove analysis ──
  const pocketConsistency = computePocketConsistency(onsets, sampleRate, bpm, stepsPerBar)
  const kickBassLock = computeKickBassLock(pcm, onsets, sampleRate, bpm)
  const excessiveUniformity = computeExcessiveUniformity(pcm, sampleRate, bpm)
  // onsetClarity: general onset clarity = sharpness × consistency (how regular the onsets are)
  const onsetClarity = onsetSharpness * (1 - excessiveUniformity * 0.3)

  // ── Lead analysis ──
  const articulation = computeArticulation(pcm, sampleRate)
  const melodicClarity = computeMelodicClarity(pcm, sampleRate)
  const phraseContrast = computePhraseContrast(pcm, sampleRate, bpm)
  const repetitionBalance = computeRepetitionBalance(pcm, sampleRate, bpm)
  const harmonicClarity = computeHarmonicClarity(avgSpectrum, sampleRate, fftSize)

  // ── Timbre analysis ──
  const brightness = Math.min(1, spectralCentroid / 5000)
  const roughness = computeRoughness(avgSpectrum, sampleRate, fftSize)
  const noisiness = computeNoisiness(avgSpectrum, sampleRate, fftSize)
  // Modulation depth: measures how much the spectral centroid changes over time.
  // Unlike spectralMovement (which measures frame-to-frame spectral diff), this
  // captures the DEPTH of timbral modulation (bright→dark sweeps, filter movement).
  const centroidOverTime = spectra.map(s => computeCentroid(s, sampleRate, fftSize))
  let centroidMean = 0
  for (const c of centroidOverTime) centroidMean += c
  centroidMean /= Math.max(1, centroidOverTime.length)
  let centroidVar = 0
  for (const c of centroidOverTime) centroidVar += (c - centroidMean) ** 2
  centroidVar /= Math.max(1, centroidOverTime.length)
  const centroidStd = Math.sqrt(centroidVar)
  // Normalize: centroidStd > 500Hz = strong modulation, < 100Hz = static
  const modulationDepth = Math.min(1, centroidStd / 500)
  const identityStrength = computeIdentityStrength(spectra)

  // ── Mix analysis ──
  const lowMidMud = computeLowMidMud(avgSpectrum, sampleRate, fftSize)
  const harshness = computeHarshness(avgSpectrum, sampleRate, fftSize)
  const highEndPresence =
    highEnergy /
    Math.max(0.01, subEnergy + bassEnergy + lowMidEnergy + midEnergy + highMidEnergy + highEnergy)
  // stereoContrast: measured from the spectral difference between low and high bins
  // (a proxy for stereo width when we only have mono — wide mixes have more high-freq
  // energy relative to low because reverb/delay add high-end ambience).
  const stereoContrast = Math.min(1, highEnergy / Math.max(0.01, subEnergy + bassEnergy))
  const masking = computeMasking(avgSpectrum, sampleRate, fftSize)

  // ── Musicality analysis ──
  const tensionRelease = computeTensionRelease(pcm, sampleRate, bpm)
  const motifIdentity = computeMotifIdentity(pcm, sampleRate, bpm)
  const development = computeDevelopment(pcm, sampleRate, bpm)
  const callResponse = computeCallResponse(pcm, sampleRate, bpm)
  // rhythmicInterest: measures syncopation and rhythmic variation (not just 1-uniformity)
  const rhythmicInterest = Math.min(1, (1 - excessiveUniformity) * 0.6 + pocketConsistency * 0.4)

  // ── Diagnose failures ──
  if (subMud > 0.6) {
    failures.push({
      code: 'LOW_MID_MUD',
      diagnosis: `Low-mid energy is too high (${lowMidEnergy.toFixed(3)}), creating mud that masks kick and bass clarity.`,
      correctionTarget: 'bass.mid.cutoffHz',
      correctionHint: 'Lower the mid bass filter cutoff and reduce sub sustain',
      severity: subMud,
    })
  }
  if (kickClarity < 0.4) {
    failures.push({
      code: 'KICK_TRANSIENT_MASKED',
      diagnosis: `Kick transient is not sharp enough (sharpness=${onsetSharpness.toFixed(3)}), likely masked by bass decay overlap.`,
      correctionTarget: 'kick.clickAmount / bass.decay',
      correctionHint: 'Increase click amount and brightness; shorten bass decay to leave space',
      severity: 1 - kickClarity,
    })
  }
  if (decayOverlap > 0.5) {
    failures.push({
      code: 'BASS_DECAY_TOO_LONG',
      diagnosis: `Bass decay overlaps ${decayOverlap.toFixed(2)} of the next kick onset — bass is smearing into the kick.`,
      correctionTarget: 'bass.decay / bass.release',
      correctionHint: 'Shorten bass decay to 0.06s or less; reduce sustain to 0',
      severity: decayOverlap,
    })
  }
  if (punch < 0.3) {
    failures.push({
      code: 'WEAK_PUNCH',
      diagnosis: `Kick punch is weak (${punch.toFixed(3)}) — the body envelope isn't sharp enough.`,
      correctionTarget: 'kick.bodyDecay / kick.pitchDropTime',
      correctionHint: 'Shorten body decay to 0.12s; increase pitch drop speed',
      severity: 1 - punch,
    })
  }
  if (spectralMovement < 0.15) {
    failures.push({
      code: 'NO_TIMBRAL_MOVEMENT',
      diagnosis: `Spectral movement is low (${spectralMovement.toFixed(3)}) — the sound is static across the section.`,
      correctionTarget: 'lead.filterEnvAmount / lead.fmAmount',
      correctionHint:
        'Increase filter envelope amount; add FM modulation; introduce sound trajectory',
      severity: 0.5 - spectralMovement,
    })
  }
  if (brightness > 0.7) {
    failures.push({
      code: 'LEAD_TOO_BRIGHT',
      diagnosis: `Lead is too bright (centroid=${spectralCentroid.toFixed(0)}Hz) — harshness in the high mids.`,
      correctionTarget: 'lead.cutoffHz / lead.resonance',
      correctionHint: 'Lower filter cutoff; reduce resonance; add warmer saturation',
      severity: brightness - 0.7,
    })
  }
  if (brightness < 0.2 && highEndPresence < 0.05) {
    failures.push({
      code: 'HIGH_END_TOO_WEAK',
      diagnosis: `High-end energy is weak (${(highEndPresence * 100).toFixed(1)}%) — hats and lead are masked by low-mid energy.`,
      correctionTarget: 'hatGain / lead.cutoffHz',
      correctionHint: 'Raise hat gain; raise lead cutoff; introduce upper harmonic layer',
      severity: 0.2 - brightness,
    })
  }
  if (excessiveUniformity > 0.7) {
    failures.push({
      code: 'RHYTHMIC_PATTERN_TOO_UNIFORM',
      diagnosis: `Rhythmic pattern is too uniform (${excessiveUniformity.toFixed(3)}) — lacks dynamic variation.`,
      correctionTarget: 'groove.velocityContour / ghost.notes',
      correctionHint: 'Add velocity variation; introduce ghost notes; vary accent patterns',
      severity: excessiveUniformity - 0.7,
    })
  }
  if (kickBassSeparation < 0.10) {
    failures.push({
      code: 'KICK_BASS_PHASE_RISK',
      diagnosis: `Kick and bass are not spectrally separated (${kickBassSeparation.toFixed(3)}) — they occupy the same frequency range.`,
      correctionTarget: 'kick.pitchEnd / bass.sub.cutoffHz',
      correctionHint:
        'Lower kick sub frequency; raise bass sub cutoff; ensure kick is done before bass starts',
      severity: 0.2 - kickBassSeparation,
    })
  }
  if (melodicClarity < 0.3) {
    failures.push({
      code: 'LEAD_TOO_STATIC',
      diagnosis: `Lead melodic clarity is low (${melodicClarity.toFixed(3)}) — the phrase lacks articulation and movement.`,
      correctionTarget: 'lead.attack / lead.filterEnvAmount',
      correctionHint: 'Shorten attack; increase filter envelope; add pitch movement',
      severity: 0.3 - melodicClarity,
    })
  }
  if (masking > 0.6) {
    failures.push({
      code: 'LEAD_MASKING_BASS',
      diagnosis: `Masking detected (${masking.toFixed(3)}) — lead frequencies overlap with bass, reducing clarity.`,
      correctionTarget: 'lead.cutoffHz / bass.mid.cutoffHz',
      correctionHint: 'Raise lead cutoff above 2000Hz; lower bass mid cutoff below 800Hz',
      severity: masking - 0.6,
    })
  }
  if (motifIdentity < 0.3) {
    failures.push({
      code: 'WEAK_MOTIF_IDENTITY',
      diagnosis: `Motif identity is weak (${motifIdentity.toFixed(3)}) — the listener cannot recognize a returning motif.`,
      correctionTarget: 'phraseMaterial.developmentHistory',
      correctionHint: 'Reduce variation amount; use CONTINUE more; callback to earlier motifs',
      severity: 0.3 - motifIdentity,
    })
  }

  // ── Overall score ──
  const scores = [
    kickClarity,
    bassClarity,
    kickBassSeparation,
    1 - subMud,
    1 - phaseRisk,
    punch,
    onsetSharpness,
    kickDefinition(punch, onsetSharpness),
    noteSeparation,
    1 - decayOverlap,
    pitchStability,
    spectralConsistency,
    onsetClarity,
    pocketConsistency,
    kickBassLock,
    1 - excessiveUniformity,
    articulation,
    melodicClarity,
    phraseContrast,
    repetitionBalance,
    harmonicClarity,
    1 - Math.abs(brightness - 0.5),
    1 - roughness,
    1 - noisiness,
    spectralMovement,
    modulationDepth,
    identityStrength,
    1 - lowMidMud,
    1 - harshness,
    highEndPresence * 5,
    stereoContrast,
    Math.min(1, dynamicRange / 10),
    1 - masking,
    tensionRelease,
    motifIdentity,
    development,
    callResponse,
    rhythmicInterest,
  ]
  const overallScore = scores.reduce((s, v) => s + Math.max(0, Math.min(1, v)), 0) / scores.length

  return {
    lowEnd: { kickClarity, bassClarity, kickBassSeparation, subMud, phaseRisk },
    transient: {
      punch,
      attackSharpness: onsetSharpness,
      kickDefinition: kickDefinition(punch, onsetSharpness),
    },
    bass: { noteSeparation, decayOverlap, pitchStability, spectralConsistency },
    groove: { onsetClarity, pocketConsistency, kickBassLock, excessiveUniformity },
    lead: { articulation, melodicClarity, phraseContrast, repetitionBalance, harmonicClarity },
    timbre: {
      brightness,
      roughness,
      noisiness,
      spectralMovement,
      modulationDepth,
      identityStrength,
    },
    mix: {
      lowMidMud,
      harshness,
      highEndPresence,
      stereoContrast,
      dynamicRange: Math.min(1, dynamicRange / 10),
      masking,
    },
    musicality: { tensionRelease, motifIdentity, development, callResponse, rhythmicInterest },
    overallScore,
    failures,
  }
}

function kickDefinition(punch: number, sharpness: number): number {
  return (punch + sharpness) / 2
}

// ── DSP helper functions ──

function findPeak(pcm: Float32Array): number {
  let peak = 0
  for (let i = 0; i < pcm.length; i++) {
    const abs = Math.abs(pcm[i] ?? 0)
    if (abs > peak) peak = abs
  }
  return peak
}

function computeRMS(pcm: Float32Array): number {
  let sum = 0
  for (let i = 0; i < pcm.length; i++) {
    sum += (pcm[i] ?? 0) ** 2
  }
  return Math.sqrt(sum / pcm.length)
}

/**
 * Compute a simple spectrogram using a sliding window FFT.
 * For performance, uses a simplified DFT (not a full FFT) at reduced resolution.
 */
function computeSpectrogram(pcm: Float32Array, fftSize: number, _sampleRate: number): number[][] {
  const hopSize = fftSize
  const numFrames = Math.floor(pcm.length / hopSize)
  // Full spectrum: 512 bins at fftSize=2048 → 0 to 11025Hz (covers all bands incl. 5-12kHz high band).
  // Previous 128-bin limit only covered 0-2756Hz, making highEndPresence/brightness always 0.
  const numBins = Math.min(512, fftSize / 2)
  const spectra: number[][] = []
  const window = hannWindow(fftSize)
  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize
    const frame = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++) {
      frame[i] = (pcm[start + i] ?? 0) * (window[i] ?? 0)
    }
    const spectrum = computeDFT(frame, numBins)
    spectra.push(spectrum)
  }
  return spectra
}

function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
  }
  return w
}

/**
 * Simplified DFT — computes the magnitude spectrum at numBins frequency bins.
 * Uses direct computation (O(n*k)) rather than FFT for simplicity. This is
 * slow for large fftSize but adequate for analysis (not real-time).
 */
function computeDFT(frame: Float32Array, numBins: number): number[] {
  const N = frame.length
  const spectrum = new Array(numBins).fill(0)
  for (let k = 0; k < numBins; k++) {
    let real = 0
    let imag = 0
    const freq = k / N
    for (let n = 0; n < N; n++) {
      const angle = -2 * Math.PI * freq * n
      real += (frame[n] ?? 0) * Math.cos(angle)
      imag += (frame[n] ?? 0) * Math.sin(angle)
    }
    spectrum[k] = Math.sqrt(real * real + imag * imag) / N
  }
  return spectrum
}

function averageSpectrum(spectra: number[][]): number[] {
  if (spectra.length === 0) return []
  const numBins = spectra[0]?.length
  const avg = new Array(numBins).fill(0)
  for (const s of spectra) {
    for (let i = 0; i < numBins; i++) {
      avg[i] = (avg[i] ?? 0) + (s[i] ?? 0)
    }
  }
  for (let i = 0; i < numBins; i++) {
    avg[i] = (avg[i] ?? 0) / spectra.length
  }
  return avg
}

function computeCentroid(spectrum: number[], sampleRate: number, fftSize: number): number {
  let weighted = 0
  let total = 0
  for (let i = 0; i < spectrum.length; i++) {
    const freq = (i * sampleRate) / fftSize
    const mag = spectrum[i] ?? 0
    weighted += freq * mag
    total += mag
  }
  return total > 0 ? weighted / total : 0
}

function computeRolloff(spectrum: number[], sampleRate: number, fftSize: number): number {
  let total = 0
  for (const m of spectrum) total += m
  if (total === 0) return 0
  let cumulative = 0
  for (let i = 0; i < spectrum.length; i++) {
    cumulative += spectrum[i] ?? 0
    if (cumulative > 0.85 * total) {
      return (i * sampleRate) / fftSize
    }
  }
  return 0
}

function bandEnergy(
  spectrum: number[],
  sampleRate: number,
  fftSize: number,
  lowHz: number,
  highHz: number
): number {
  const lowBin = Math.floor((lowHz * fftSize) / sampleRate)
  const highBin = Math.ceil((highHz * fftSize) / sampleRate)
  let energy = 0
  for (let i = lowBin; i <= highBin && i < spectrum.length; i++) {
    energy += spectrum[i] ?? 0
  }
  return energy
}

function detectOnsets(
  pcm: Float32Array,
  sampleRate: number,
  bpm: number,
  stepsPerBar: number
): number[] {
  const secondsPerStep = 60 / bpm / (stepsPerBar / 4)
  const samplesPerStep = Math.ceil(secondsPerStep * sampleRate)
  const onsets: number[] = []
  for (let pos = 0; pos < pcm.length; pos += samplesPerStep) {
    // Measure the energy in a short window after the onset.
    const windowSize = Math.floor(sampleRate * 0.01) // 10ms
    let energy = 0
    for (let i = 0; i < windowSize && pos + i < pcm.length; i++) {
      energy += Math.abs(pcm[pos + i] ?? 0)
    }
    onsets.push(energy / windowSize)
  }
  return onsets
}

function computeOnsetSharpness(pcm: Float32Array, onsets: number[], sampleRate: number): number {
  // Measure how quickly energy rises at each onset.
  let totalSharpness = 0
  let count = 0
  const samplesPerStep = Math.floor(pcm.length / Math.max(1, onsets.length))
  const preWindow = Math.floor(sampleRate * 0.005) // 5ms before
  const postWindow = Math.floor(sampleRate * 0.005) // 5ms after
  for (let s = 0; s < onsets.length; s++) {
    const pos = s * samplesPerStep
    let pre = 0
    let post = 0
    for (let i = 0; i < preWindow; i++) {
      pre += Math.abs(pcm[pos - preWindow + i] ?? 0)
    }
    for (let i = 0; i < postWindow; i++) {
      post += Math.abs(pcm[pos + i] ?? 0)
    }
    pre /= preWindow
    post /= postWindow
    const sharpness = post / Math.max(0.001, pre + post)
    totalSharpness += sharpness
    count++
  }
  return count > 0 ? totalSharpness / count : 0
}

function computeTransientEnvelope(pcm: Float32Array, sampleRate: number): number[] {
  const env: number[] = []
  const windowSize = Math.floor(sampleRate * 0.005)
  for (let i = 0; i < pcm.length; i += windowSize) {
    let sum = 0
    for (let j = 0; j < windowSize && i + j < pcm.length; j++) {
      sum += Math.abs(pcm[i + j] ?? 0)
    }
    env.push(sum / windowSize)
  }
  return env
}

function computePunch(pcm: Float32Array, onsets: number[], sampleRate: number): number {
  // Punch = peak energy in the first 5ms after onset / peak energy in 50ms after
  let totalPunch = 0
  let count = 0
  const samplesPerStep = Math.floor(pcm.length / Math.max(1, onsets.length))
  const shortWindow = Math.floor(sampleRate * 0.005)
  const longWindow = Math.floor(sampleRate * 0.05)
  for (let s = 0; s < onsets.length; s++) {
    const pos = s * samplesPerStep
    let peakShort = 0
    let peakLong = 0
    for (let i = 0; i < shortWindow && pos + i < pcm.length; i++) {
      peakShort = Math.max(peakShort, Math.abs(pcm[pos + i] ?? 0))
    }
    for (let i = 0; i < longWindow && pos + i < pcm.length; i++) {
      peakLong = Math.max(peakLong, Math.abs(pcm[pos + i] ?? 0))
    }
    totalPunch += peakShort / Math.max(0.001, peakLong)
    count++
  }
  return count > 0 ? totalPunch / count : 0
}

function computeSpectralMovement(spectra: number[][]): number {
  if (spectra.length < 2) return 0
  let totalChange = 0
  for (let i = 1; i < spectra.length; i++) {
    const prev = spectra[i - 1] ?? []
    const cur = spectra[i] ?? []
    let change = 0
    for (let j = 0; j < prev.length; j++) {
      change += Math.abs((cur[j] ?? 0) - (prev[j] ?? 0))
    }
    totalChange += change / prev.length
  }
  // Scale by 300 (was 100) to account for the dilution from high-frequency constant
  // bins (hats/cymbals noise) that are now visible with 512-bin spectra. The low/mid
  // bins (kick/bass/lead) carry the musical movement; the high bins are noise-like and
  // constant, diluting the average. The higher scaling factor compensates.
  return Math.min(1, (totalChange / (spectra.length - 1)) * 300)
}

function computeKickBassSeparation(
  spectrum: number[],
  sampleRate: number,
  fftSize: number
): number {
  // Kick/bass separation: measures the spectral valley between kick (50-90Hz)
  // and bass (110-180Hz) fundamentals. A well-separated mix has a dip around
  // 90-110Hz (HPF on bass) so the kick punches through.
  //
  // If no valley exists (flat spectrum), we fall back to the ratio of kick to
  // bass energy — a balanced mix (similar energy) scores moderately.
  const kickFund = bandEnergy(spectrum, sampleRate, fftSize, 50, 90)
  const valley = bandEnergy(spectrum, sampleRate, fftSize, 90, 110)
  const bassFund = bandEnergy(spectrum, sampleRate, fftSize, 110, 180)
  const peakAvg = (kickFund + bassFund) / 2
  if (peakAvg < 1e-8) return 0.5

  const ratio = valley / peakAvg
  // ratio < 0.3 = deep valley (excellent separation, score ~1)
  // ratio 0.3-0.7 = moderate separation
  // ratio > 0.7 = flat (poor separation)
  // But if kick and bass have very different energies, that also indicates separation
  // (one dominates). Combine valley depth with energy balance.
  const energyBalance = Math.abs(kickFund - bassFund) / (kickFund + bassFund)
  const valleyScore = Math.max(0, Math.min(1, 1 - (ratio - 0.2) / 0.6))
  // Blend: 60% valley, 40% energy balance
  return valleyScore * 0.6 + energyBalance * 0.4
}

function computeSubMud(spectrum: number[], sampleRate: number, fftSize: number): number {
  const sub = bandEnergy(spectrum, sampleRate, fftSize, 20, 80)
  const lowMid = bandEnergy(spectrum, sampleRate, fftSize, 250, 500)
  // Mud = high sub + high lowMid relative to total.
  const total = sub + lowMid + bandEnergy(spectrum, sampleRate, fftSize, 80, 250)
  return total > 0 ? (sub + lowMid) / total : 0
}

function computePhaseRisk(pcm: Float32Array, _sampleRate: number): number {
  // Phase risk: detects DC offset only.
  //
  // The original metric measured 20-60Hz sub energy / total — but that's the kick
  // fundamental (46Hz) and sub-bass, which are SUPPOSED to be present in psytrance.
  // It flagged every track as "phase risk" with severity 0.3+.
  //
  // This v3 measures only TRUE phase-risk: DC offset (non-zero mean). DC offset
  // causes clicks on playback and indicates a rendering bug. Sub-sonic energy
  // below 20Hz was too hard to measure reliably with 64-bin DFT (resolution too
  // coarse at low frequencies). DC offset is unambiguous and deterministic.
  const N = Math.min(pcm.length, 65536)
  let sum = 0
  for (let i = 0; i < N; i++) sum += pcm[i] ?? 0
  const dcOffset = Math.abs(sum / N)
  // dcOffset > 0.05 = severe, 0.01 = noticeable, < 0.001 = clean
  return Math.max(0, Math.min(1, dcOffset * 20))
}

function computeNoteSeparation(
  spectra: number[][],
  sampleRate: number,
  fftSize: number
): number {
  // Note separation = how much the bass-band energy drops between note onsets.
  // Uses the spectral approach (same as computeDecayOverlap v3) to avoid the
  // full-range contamination problem. Measures the CV of bass-band energy across
  // frames — high CV = notes pulse strongly (good separation), low CV = smeared.
  if (spectra.length < 4) return 0.5
  const lowBin = Math.floor((80 * fftSize) / sampleRate)
  const highBin = Math.ceil((250 * fftSize) / sampleRate)
  const bassEnergies: number[] = []
  for (const spectrum of spectra) {
    let energy = 0
    for (let i = lowBin; i <= highBin && i < spectrum.length; i++) {
      energy += (spectrum[i] ?? 0) ** 2
    }
    bassEnergies.push(Math.sqrt(energy))
  }
  let sum = 0
  for (const e of bassEnergies) sum += e
  const mean = sum / bassEnergies.length
  if (mean < 1e-8) return 0.5
  let varSum = 0
  for (const e of bassEnergies) varSum += (e - mean) ** 2
  const std = Math.sqrt(varSum / bassEnergies.length)
  const cv = std / mean
  // High CV = good note separation. Cap at 1.0.
  return Math.max(0, Math.min(1, cv * 2.0))
}

function computeDecayOverlap(
  spectra: number[][],
  sampleRate: number,
  fftSize: number
): number {
  // Measures BASS-BAND ENERGY MODULATION across spectral frames.
  //
  // PROBLEM: Time-domain filtering approaches failed because (a) one-pole filters
  // have slow transient response that contaminates the measurement, and (b) every
  // frequency band in a full mix has continuous energy from other voices.
  //
  // SOLUTION: Use the already-computed spectrogram to extract the bass-band energy
  // (80-250Hz) per frame, then measure the COEFFICIENT OF VARIATION (CV = std/mean)
  // across frames. A tight 16th-note bass with 0.06s decay produces strong energy
  // pulses at each note onset → high CV. A smeared bass (long decay, no note
  // separation) produces constant energy → low CV.
  //
  // decayOverlap = 1 - min(1, CV * 2.5)
  //   CV > 0.4 → overlap = 0 (very tight, notes pulse strongly)
  //   CV = 0.2 → overlap = 0.5 (moderate)
  //   CV < 0.1 → overlap = 0.75+ (smeared, no modulation)

  if (spectra.length < 4) return 0.5

  // Extract bass-band energy (80-250Hz) for each spectral frame.
  const lowBin = Math.floor((80 * fftSize) / sampleRate)
  const highBin = Math.ceil((250 * fftSize) / sampleRate)
  const bassEnergies: number[] = []
  for (const spectrum of spectra) {
    let energy = 0
    for (let i = lowBin; i <= highBin && i < spectrum.length; i++) {
      energy += (spectrum[i] ?? 0) ** 2
    }
    bassEnergies.push(Math.sqrt(energy))
  }

  // Compute mean and std of bass energy.
  let sum = 0
  for (const e of bassEnergies) sum += e
  const mean = sum / bassEnergies.length
  if (mean < 1e-8) return 0.5 // silence

  let varSum = 0
  for (const e of bassEnergies) varSum += (e - mean) ** 2
  const std = Math.sqrt(varSum / bassEnergies.length)
  const cv = std / mean // coefficient of variation

  // High CV = tight bass (pulsing) → low overlap (good)
  // Low CV = smeared bass (constant) → high overlap (bad)
  return Math.max(0, Math.min(1, 1 - cv * 2.5))
}

function computePitchStability(pcm: Float32Array, sampleRate: number): number {
  // Simplified: measure autocorrelation at bass frequencies.
  // High autocorrelation = stable pitch.
  const window = pcm.slice(0, Math.min(pcm.length, 4096))
  let autocorr = 0
  let energy = 0
  const lag = Math.floor(sampleRate / 80) // ~80Hz
  for (let i = 0; i < window.length - lag; i++) {
    autocorr += (window[i] ?? 0) * (window[i + lag] ?? 0)
    energy += (window[i] ?? 0) ** 2
  }
  return energy > 0 ? Math.min(1, autocorr / energy) : 0.5
}

function computePocketConsistency(
  onsets: number[],
  _sampleRate: number,
  _bpm: number,
  _stepsPerBar: number
): number {
  // Consistency = how uniform the onset energies are (pocket = steady).
  if (onsets.length < 2) return 0.5
  const mean = onsets.reduce((s, v) => s + v, 0) / onsets.length
  if (mean === 0) return 0
  const variance = onsets.reduce((s, v) => s + (v - mean) ** 2, 0) / onsets.length
  const cv = Math.sqrt(variance) / mean // coefficient of variation
  return Math.max(0, 1 - cv)
}

function computeKickBassLock(
  _pcm: Float32Array,
  onsets: number[],
  sampleRate: number,
  bpm: number
): number {
  // Simplified: if onset energies are consistent, kick+bass are locked.
  return computePocketConsistency(onsets, sampleRate, bpm, 16)
}

function computeExcessiveUniformity(pcm: Float32Array, sampleRate: number, bpm: number): number {
  // Uniformity = how similar consecutive bars are.
  const secondsPerBar = (60 / bpm) * 4
  const samplesPerBar = Math.floor(secondsPerBar * sampleRate)
  if (pcm.length < samplesPerBar * 2) return 0.5
  let totalSim = 0
  let count = 0
  for (let b = 1; b < Math.floor(pcm.length / samplesPerBar); b++) {
    let corr = 0
    let energy = 0
    for (let i = 0; i < samplesPerBar; i++) {
      const cur = pcm[b * samplesPerBar + i] ?? 0
      const prev = pcm[(b - 1) * samplesPerBar + i] ?? 0
      corr += cur * prev
      energy += cur * cur + prev * prev
    }
    totalSim += energy > 0 ? (corr / energy) * 2 : 0
    count++
  }
  return count > 0 ? totalSim / count : 0
}

function computeArticulation(pcm: Float32Array, sampleRate: number): number {
  // Articulation = how much the envelope changes (not sustains).
  // Measures the rate of envelope change in 5ms windows. Higher = more articulated.
  const windowSize = Math.floor(sampleRate * 0.005) // 5ms
  let changes = 0
  let prevEnv = 0
  let count = 0
  for (let i = 0; i < pcm.length; i += windowSize) {
    let env = 0
    for (let j = 0; j < windowSize && i + j < pcm.length; j++) {
      env += Math.abs(pcm[i + j] ?? 0)
    }
    env /= windowSize
    if (count > 0) changes += Math.abs(env - prevEnv)
    prevEnv = env
    count++
  }
  // Average change per window. Scale by 30 (was 10) — the lead's filter envelope
  // and note on/off produce ~0.01-0.03 change per 5ms window.
  return Math.min(1, (changes / Math.max(1, count)) * 30)
}

function computeMelodicClarity(pcm: Float32Array, sampleRate: number): number {
  // Melodic clarity = spectral peakiness. A clear melody has distinct harmonic peaks
  // (high spectral crest factor). A noisy/muddy mix has flat spectrum.
  const fftSize = 2048
  const spectrum = computeDFT(pcm.slice(0, Math.min(pcm.length, fftSize)), 512)
  // Spectral crest factor = max(bin) / mean(bin) in the lead range (500-5000Hz)
  const lowBin = Math.floor((500 * fftSize) / sampleRate)
  const highBin = Math.ceil((5000 * fftSize) / sampleRate)
  let maxBin = 0, sumBins = 0, binCount = 0
  for (let i = lowBin; i <= highBin && i < spectrum.length; i++) {
    const v = spectrum[i] ?? 0
    if (v > maxBin) maxBin = v
    sumBins += v
    binCount++
  }
  if (binCount === 0 || sumBins < 1e-8) return 0.3
  const meanBin = sumBins / binCount
  const crest = maxBin / meanBin
  // crest > 5 = very clear peaks (good melody), crest < 2 = flat/noisy
  return Math.max(0, Math.min(1, (crest - 1) / 4))
}

function computePhraseContrast(pcm: Float32Array, sampleRate: number, _bpm: number): number {
  // Contrast = how different the first and second halves of the section are.
  const half = Math.floor(pcm.length / 2)
  const firstHalf = pcm.slice(0, half)
  const secondHalf = pcm.slice(half)
  const centroid1 = computeCentroid(computeDFT(firstHalf.slice(0, 2048), 128), sampleRate, 2048)
  const centroid2 = computeCentroid(computeDFT(secondHalf.slice(0, 2048), 128), sampleRate, 2048)
  const diff = Math.abs(centroid1 - centroid2) / Math.max(1, centroid1)
  return Math.min(1, diff)
}

function computeRepetitionBalance(pcm: Float32Array, sampleRate: number, bpm: number): number {
  // Balance = some repetition but not too much.
  const uniformity = computeExcessiveUniformity(pcm, sampleRate, bpm)
  // Ideal is around 0.3-0.5 repetition.
  const distance = Math.abs(uniformity - 0.4)
  return 1 - distance
}

function computeHarmonicClarity(spectrum: number[], sampleRate: number, fftSize: number): number {
  // Harmonic clarity = energy in harmonic bands (fundamental + overtones).
  const fundamental = bandEnergy(spectrum, sampleRate, fftSize, 100, 400)
  const overtones = bandEnergy(spectrum, sampleRate, fftSize, 400, 3000)
  const noise = bandEnergy(spectrum, sampleRate, fftSize, 5000, 12000)
  const total = fundamental + overtones + noise
  return total > 0 ? (fundamental + overtones) / total : 0.5
}

function computeRoughness(spectrum: number[], sampleRate: number, fftSize: number): number {
  // Roughness = energy in dissonant frequency relationships (simplified).
  const mid = bandEnergy(spectrum, sampleRate, fftSize, 1000, 3000)
  const total = spectrum.reduce((s, v) => s + v, 0)
  return total > 0 ? mid / total : 0
}

function computeNoisiness(spectrum: number[], sampleRate: number, fftSize: number): number {
  const high = bandEnergy(spectrum, sampleRate, fftSize, 5000, 12000)
  const total = spectrum.reduce((s, v) => s + v, 0)
  return total > 0 ? high / total : 0
}

function computeIdentityStrength(spectra: number[][]): number {
  // Identity = spectral consistency across time (the sound stays recognizable).
  if (spectra.length < 2) return 0.5
  const avg = averageSpectrum(spectra)
  let totalCorr = 0
  for (const s of spectra) {
    let corr = 0
    let energy = 0
    for (let i = 0; i < avg.length; i++) {
      corr += (s[i] ?? 0) * (avg[i] ?? 0)
      energy += (s[i] ?? 0) ** 2 + (avg[i] ?? 0) ** 2
    }
    totalCorr += energy > 0 ? (corr / energy) * 2 : 0
  }
  return totalCorr / spectra.length
}

function computeLowMidMud(spectrum: number[], sampleRate: number, fftSize: number): number {
  const lowMid = bandEnergy(spectrum, sampleRate, fftSize, 200, 500)
  const total = spectrum.reduce((s, v) => s + v, 0)
  return total > 0 ? lowMid / total : 0
}

function computeHarshness(spectrum: number[], sampleRate: number, fftSize: number): number {
  const harsh = bandEnergy(spectrum, sampleRate, fftSize, 3000, 6000)
  const total = spectrum.reduce((s, v) => s + v, 0)
  return total > 0 ? harsh / total : 0
}

function computeMasking(spectrum: number[], sampleRate: number, fftSize: number): number {
  // Masking: spectral overlap between bass (80-250Hz) and lower lead harmonics (1-3kHz).
  // High overlap = lead harmonics mask the bass. We measure the RATIO of bass-band
  // energy to the sum of bass + lower-lead. Low masking = bass dominates its band.
  const bassBand = bandEnergy(spectrum, sampleRate, fftSize, 80, 250)
  const leadLowBand = bandEnergy(spectrum, sampleRate, fftSize, 1000, 3000)
  const total = bassBand + leadLowBand
  if (total === 0) return 0.5
  // masking = how much the lead low band intrudes on the bass band region.
  // If bassBand >> leadLowBand, masking is low (good).
  return leadLowBand / total
}

function computeTensionRelease(pcm: Float32Array, _sampleRate: number, _bpm: number): number {
  // Tension/release: measures the dynamic energy contour across the track.
  // A good psytrance track has variation — builds, drops, releases — not flat energy.
  // Uses 32 sections (1 per bar at 32 bars) for fine-grained contour detection.
  // Measures the ratio of max-section-energy to min-section-energy (dynamic range
  // across sections) AND the coefficient of variation.
  const sections = 32
  const sectionLength = Math.floor(pcm.length / sections)
  if (sectionLength < 100) return 0.5
  const energies: number[] = []
  for (let s = 0; s < sections; s++) {
    let energy = 0
    for (let i = 0; i < sectionLength; i++) {
      energy += Math.abs(pcm[s * sectionLength + i] ?? 0)
    }
    energies.push(energy / sectionLength)
  }
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length
  if (mean < 1e-8) return 0
  const variance = energies.reduce((s, e) => s + (e - mean) ** 2, 0) / energies.length
  const cv = Math.sqrt(variance) / mean
  // Also measure max/min ratio (dynamic range across sections)
  const maxE = Math.max(...energies)
  const minE = Math.min(...energies)
  const drRatio = minE > 0 ? Math.min(maxE / minE, 4) / 4 : 0
  // Blend: 50% CV (variation shape), 50% DR ratio (contrast)
  // CV > 0.3 = good, scale to 1.0. DR ratio > 0.75 (3:1 contrast) = good.
  return Math.min(1, cv * 2.0 * 0.5 + drRatio * 0.5)
}

function computeMotifIdentity(pcm: Float32Array, sampleRate: number, bpm: number): number {
  // Simplified: if there's some repetition, motif identity is present.
  const uniformity = computeExcessiveUniformity(pcm, sampleRate, bpm)
  return Math.min(1, uniformity * 1.5)
}

function computeDevelopment(pcm: Float32Array, sampleRate: number, bpm: number): number {
  // Development = some change over time but not random.
  const contrast = computePhraseContrast(pcm, sampleRate, bpm)
  return Math.min(1, contrast * 1.5)
}

function computeCallResponse(pcm: Float32Array, sampleRate: number, _bpm: number): number {
  // Simplified: check if the second half mirrors the first (response).
  const half = Math.floor(pcm.length / 2)
  let corr = 0
  let energy = 0
  const windowSize = Math.floor(sampleRate * 0.05)
  for (let i = 0; i < half - windowSize; i += windowSize) {
    let a = 0
    let b = 0
    for (let j = 0; j < windowSize; j++) {
      a += pcm[i + j] ?? 0
      b += pcm[half + i + j] ?? 0
    }
    corr += a * b
    energy += a * a + b * b
  }
  return energy > 0 ? Math.min(1, (corr / energy) * 2 + 0.3) : 0.3
}
