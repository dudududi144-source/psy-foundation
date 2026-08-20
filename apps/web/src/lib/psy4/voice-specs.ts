/**
 * VoiceSpecs — Single Source of Truth for all voice parameters.
 *
 * Based on PSY3_SOUND_DESIGN_RULES + COMMERCIAL_AUDIO_AUDIT + PSY4_DEEP_ROAST.
 * The forensic bridge (offline render) reads from these specs.
 *
 * Key principles (from PSY3):
 * 1. Sub over click (kick sub 90x longer than click)
 * 2. Bass leaves room (filter drops to 150Hz)
 * 3. Band-limited oscillators (no aliasing)
 * 4. Controlled mutation (not random)
 * 5. Section-aware FX (kick dry, lead delay)
 * 6. Subtle saturation (15% mix)
 * 7. Frequency-dependent stereo (mono <120Hz)
 */

// ═══════════════════════════════════════════════════════════════
// KICK — 3-layer: sub (dominant) + mid + click
// ═══════════════════════════════════════════════════════════════

export interface KickSpec {
  fundamental: number // Hz, 40 (below bass territory)
  subDecay: number // 0.18s — 90x longer than click (PSY3 rule 1)
  subLevel: number // 0.9 — sub dominates
  midDecay: number // 0.05s — mid punch
  midLevel: number // 0.5
  midFreq: number // 150Hz — mid body frequency
  clickDecay: number // 0.002s — ultra short
  clickLevel: number // 0.35
  pitchStart: number // 200Hz — pitch sweep start
  pitchDecay: number // 0.012s — 12ms sweep
  saturation: number // 1.8 — drive
  hpFreq: number // 30Hz — clean sub rumble
}

export const KICK_SPEC: KickSpec = {
  fundamental: 38,
  subDecay: 0.45, // Phase 3: psytrance kick (was 0.25 — too short for genre)
  subLevel: 1.0,
  midDecay: 0.05,
  midLevel: 0.5,
  midFreq: 150,
  clickDecay: 0.002,
  clickLevel: 0.35,
  pitchStart: 200,
  pitchDecay: 0.012,
  saturation: 1.8,
  hpFreq: 30,
}

// ═══════════════════════════════════════════════════════════════
// BASS — 3-layer: sub + body + character, pluck/sustain mode
// ═══════════════════════════════════════════════════════════════

export interface BassSpec {
  mode: 'pluck' | 'sustain' // pluck = short, sustain = held
  subLevel: number // 0.5 — sub at f/2
  bodyLevel: number // 0.7 — main saw
  characterLevel: number // 0.2 — stereo character
  cutoffStart: number // 1500Hz — filter opens here (PSY3 rule 2)
  cutoffEnd: number // 150Hz — filter settles here
  res: number // 0.3 — moderate resonance
  pluckDecay: number // 0.06s — short pluck
  sustainLevel: number // 0.7 — sustain portion
  sustainRelease: number // 0.005s — quick release
  hpFreq: number // 40Hz — let kick own sub
  saturation: number // 2.5
  sidechainDepth: number // 0.7 — 7dB duck
}

export const BASS_SPEC: BassSpec = {
  mode: 'pluck',
  subLevel: 0.3,
  bodyLevel: 0.7,
  characterLevel: 0.2,
  cutoffStart: 1200,
  cutoffEnd: 150,
  res: 0.3,
  pluckDecay: 0.08, // Phase 3 Day 2: longer pluck (was 0.05 — too short for psytrance)
  sustainLevel: 0.6,
  sustainRelease: 0.004,
  hpFreq: 40, // Phase 3 Day 2: lower HP (was 45 — let more sub through)
  saturation: 2.0,
  sidechainDepth: 0.75,
}

// ═══════════════════════════════════════════════════════════════
// LEAD — 4-layer: fundamental + octave + air + FM
// ═══════════════════════════════════════════════════════════════

export interface LeadSpec {
  oscCount: number // 2 — detuned fundamentals
  detune: number // 12 cents
  octaveLevel: number // 0.4 — octave-up layer
  octaveDetune: number // 7 cents
  airLevel: number // 0.05 — noise air
  airDecay: number // 0.1s
  fmLevel: number // 0.3 — FM component
  fmRatio: number // 2.0 — modulator ratio
  fmIndex: number // 150 — FM depth
  cutoff: number // 1500Hz
  res: number // 0.7 — acid resonance
  filterEnvAmount: number // 3.0 — dramatic sweep
  filterEnvDecay: number // 0.15s
  lfoRate: number // 1.2Hz
  lfoDepth: number // 0.5
  saturation: number // 2.0
  delaySend: number // 0.25 — per-note throws
  reverbSend: number // 0.25
  hpFreq: number // 80Hz
  gain: number // -7dB → 0.45 linear
}

export const LEAD_SPEC: LeadSpec = {
  oscCount: 2,
  detune: 12,
  octaveLevel: 0.6,
  octaveDetune: 7,
  airLevel: 0.18, // Phase 3 Day 2: more air (was 0.12 — too dark for psytrance)
  airDecay: 0.15,
  fmLevel: 0.35,
  fmRatio: 2.0,
  fmIndex: 180,
  cutoff: 5200, // Phase 3 Day 2: brighter (was 4200 — needs more high end)
  res: 0.7,
  filterEnvAmount: 5.0,
  filterEnvDecay: 0.25,
  lfoRate: 2.0,
  lfoDepth: 1.0,
  saturation: 2.0,
  delaySend: 0.25,
  reverbSend: 0.25,
  hpFreq: 80,
  gain: 0.6,
}

// ═══════════════════════════════════════════════════════════════
// PAD — 5-layer: 3 osc + chorus + shimmer
// ═══════════════════════════════════════════════════════════════

export interface PadSpec {
  oscCount: number // 3 detuned oscillators
  detune: number // 7 cents
  octaveOsc: boolean // true — one osc octave up
  chorusDepth: number // 0.5
  chorusRate: number // 0.3Hz
  shimmerLevel: number // 0.3 — pitch-shifted reverb tail
  cutoff: number // 600Hz
  res: number // 0.3
  filterLfoRate: number // 0.15Hz — slow sweep
  filterLfoDepth: number // 0.5
  saturation: number // 1.0
  reverbSend: number // 0.4
  hpFreq: number // 80Hz
  attack: number // 0.3s — slow swell
  release: number // 0.4s
  gain: number // -8dB → 0.4 linear
}

export const PAD_SPEC: PadSpec = {
  oscCount: 3,
  detune: 7,
  octaveOsc: true,
  chorusDepth: 0.7, // Phase 3 Day 2: deeper chorus (was 0.5 — more movement)
  chorusRate: 0.3,
  shimmerLevel: 0.4, // Phase 3 Day 2: more shimmer (was 0.3 — more air)
  cutoff: 600,
  res: 0.3,
  filterLfoRate: 0.15,
  filterLfoDepth: 0.6, // Phase 3 Day 2: deeper filter sweep (was 0.5)
  saturation: 1.0,
  reverbSend: 0.4,
  hpFreq: 80,
  attack: 0.3,
  release: 0.4,
  gain: 0.4,
}

// ═══════════════════════════════════════════════════════════════
// ACID — bidirectional filter LFO
// ═══════════════════════════════════════════════════════════════

export interface AcidSpec {
  waveType: 'square' | 'saw'
  cutoff: number // 800Hz base
  res: number // 0.85 — high resonance
  lfoRate: number // 2.0Hz — bidirectional
  lfoDepth: number // 0.7 — deep modulation
  envAmount: number // 2.0 — envelope sweep
  envDecay: number // 0.12s
  distortion: number // 3.0 — heavy
  hpFreq: number // 100Hz
  gain: number // -10dB → 0.3 linear
}

export const ACID_SPEC: AcidSpec = {
  waveType: 'square',
  cutoff: 800,
  res: 0.85,
  lfoRate: 2.0,
  lfoDepth: 0.7,
  envAmount: 2.0,
  envDecay: 0.12,
  distortion: 3.0,
  hpFreq: 100,
  gain: 0.3,
}

// ═══════════════════════════════════════════════════════════════
// HAT — metallic synthesis + per-hit variation
// ═══════════════════════════════════════════════════════════════

export interface HatSpec {
  metallicFreqs: number[] // 6 inharmonic frequencies
  bpFreq: number // 10000Hz bandpass
  bpRes: number // 0.5
  hpFreq: number // 6000Hz
  closedDecay: number // 0.04s
  openDecay: number // 0.18s
  pitchVar: number // 0.02 — ±2% per hit
  panVar: number // 0.1 — ±0.1 per hit
  gain: number // -10dB → 0.3 linear
}

export const HAT_SPEC: HatSpec = {
  metallicFreqs: [540, 800, 1080, 1360, 1700, 2400],
  bpFreq: 12000,
  bpRes: 0.5,
  hpFreq: 6000,
  closedDecay: 0.04,
  openDecay: 0.18,
  pitchVar: 0.02,
  panVar: 0.1,
  gain: 1.2,
}

// ═══════════════════════════════════════════════════════════════
// SNARE — 2 tone + filtered noise
// ═══════════════════════════════════════════════════════════════

export interface SnareSpec {
  tone1Freq: number // 180Hz
  tone2Freq: number // 330Hz
  toneDecay: number // 0.05s
  noiseBpFreq: number // 1800Hz
  noiseBpRes: number // 0.7
  noiseHpFreq: number // 1000Hz
  noiseDecay: number // 0.08s
  gain: number // -8dB → 0.4 linear
}

export const SNARE_SPEC: SnareSpec = {
  tone1Freq: 180,
  tone2Freq: 330,
  toneDecay: 0.05,
  noiseBpFreq: 1800,
  noiseBpRes: 0.7,
  noiseHpFreq: 1000,
  noiseDecay: 0.08,
  gain: 0.4,
}

// ═══════════════════════════════════════════════════════════════
// BUS GAINS — frequency ownership
// ═══════════════════════════════════════════════════════════════

export interface BusGains {
  drum: number // 1.2 — drums prominent
  bass: number // 0.35 — bass controlled
  music: number // 1.1 — lead/pad audible
  fx: number // 0.5 — FX subtle
}

export const BUS_GAINS: BusGains = {
  drum: 0.8,
  bass: 0.35,
  music: 2.5,
  fx: 1.0,
}

// ═══════════════════════════════════════════════════════════════
// MASTER CHAIN — full PSY3-style chain
// ═══════════════════════════════════════════════════════════════

export interface MasterSpec {
  hpFreq: number // 25Hz — clean DC
  // Multiband (3-band)
  mbLowXover: number // 180Hz
  mbHighXover: number // 4000Hz
  mbLowThr: number // -18dB → 0.126 linear
  mbMidThr: number // -22dB → 0.079 linear
  mbHighThr: number // -20dB → 0.1 linear
  // Glue
  glueThr: number // 0.6
  glueRatio: number // 2.0
  glueAttack: number // 0.004s
  glueRelease: number // 0.12s
  glueMakeup: number // 1.3
  // Saturation
  satDrive: number // 1.15
  satMix: number // 0.15 — 15% wet
  // Stereo
  stereoWidth: number // 1.3
  monoBelowHz: number // 120Hz — mono bass
  // Limiter
  ceiling: number // 0.98 — high ceiling
  // LUFS
  targetLufs: number // -9
}

export const MASTER_SPEC: MasterSpec = {
  hpFreq: 25,
  mbLowXover: 180,
  mbHighXover: 3500,
  mbLowThr: 0.3, // raised: less low-band compression
  mbMidThr: 0.2, // raised: less mid compression
  mbHighThr: 0.25, // raised: less high compression = more air
  glueThr: 0.8, // raised: 0.6 → 0.8 (much less glue compression)
  glueRatio: 1.5, // lowered: 2.0 → 1.5 (gentler ratio)
  glueAttack: 0.01, // slower: 0.005 → 0.01 (let transients through)
  glueRelease: 0.2, // slower: 0.15 → 0.2 (more natural)
  glueMakeup: 1.0, // lowered: 1.1 → 1.0 (no makeup = no pumping)
  satDrive: 1.0, // lowered = less saturation = cleaner
  satMix: 0.1, // lowered = less sat mix = more transparency
  stereoWidth: 1.3, // slightly less width = more mono compatibility
  monoBelowHz: 120,
  ceiling: 0.95, // raised = less limiting = more dynamics
  targetLufs: -9, // Phase 3: club target for psytrance (was -12)
}

// ═══════════════════════════════════════════════════════════════
// ARRANGEMENT — 88-bar structure
// ═══════════════════════════════════════════════════════════════

export interface ArrangementSpec {
  sections: Array<{
    name: string
    bars: number
    energy: number // 0-1
    tensionShape: 'rise' | 'fall' | 'arc' | 'sustain'
    voices: string[] // which voices play
  }>
}

export const ARRANGEMENT_SPEC: ArrangementSpec = {
  sections: [
    {
      name: 'intro',
      bars: 8,
      energy: 0.5,
      tensionShape: 'rise',
      voices: ['kick', 'bass', 'hats', 'shaker'],
    },
    {
      name: 'build1',
      bars: 16,
      energy: 0.7,
      tensionShape: 'rise',
      voices: ['kick', 'bass', 'hats', 'shaker', 'pad', 'lead'],
    },
    {
      name: 'drop1',
      bars: 16,
      energy: 1.0,
      tensionShape: 'arc',
      voices: ['kick', 'bass', 'hats', 'shaker', 'pad', 'lead', 'counter', 'snare'],
    },
    {
      name: 'break',
      bars: 8,
      energy: 0.4,
      tensionShape: 'fall',
      voices: ['kick', 'pad', 'texture', 'riser'],
    },
    {
      name: 'drop2',
      bars: 16,
      energy: 1.0,
      tensionShape: 'arc',
      voices: ['kick', 'bass', 'hats', 'shaker', 'pad', 'lead', 'counter', 'snare', 'acid'],
    },
    {
      name: 'climax',
      bars: 16,
      energy: 1.0,
      tensionShape: 'sustain',
      voices: [
        'kick',
        'bass',
        'hats',
        'shaker',
        'pad',
        'lead',
        'counter',
        'snare',
        'acid',
        'impact',
      ],
    },
    { name: 'outro', bars: 8, energy: 0.3, tensionShape: 'fall', voices: ['kick', 'bass', 'pad'] },
  ],
}
// Total: 88 bars = ~2.4 minutes at 145 BPM
