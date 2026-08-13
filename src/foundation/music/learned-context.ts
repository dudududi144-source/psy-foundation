/**
 * LearnedMusicalContext — serializable musical knowledge learned from radio.
 *
 * This is NOT raw audio. It is statistical abstractions that the
 * CompositionEngine consumes to shape its output.
 *
 * PSY4 learns from radio → produces this → passes to Foundation.
 * Foundation turns abstractions into new music (never copies source).
 *
 * All fields are serializable, deterministic, browser-independent.
 */

// ── TEMPO ──
export interface TempoLearning {
  tempo: number
  tempoConfidence: number
  /** 0..1 — how phase-locked the learned source is */
  phaseRelationship: number
}

// ── HARMONY ──
export interface HarmonyLearning {
  key: number
  mode: string
  tonalCenterConfidence: number
  /** 12-bin pitch class histogram (normalized 0..1) */
  pitchClassProfile: number[]
  /** chord changes per bar */
  harmonicRhythm: number
  /** root movement intervals observed */
  rootMovement: number[]
  /** preferred intervals (semitone → 0..1 preference) */
  intervalPreferences: Record<number, number>
}

// ── RHYTHM ──
export interface RhythmLearning {
  subdivision: number
  swing: number
  syncopation: number
  /** 16-step accent profile (0..1 per step) */
  accentProfile: number[]
  /** kick onset probability per 16th step (0..1) */
  kickGrammar: number[]
  /** bass onset probability per 16th step (0..1) */
  bassRhythmGrammar: number[]
  /** hat onset probability per 16th step (0..1) */
  hatGrammar: number[]
  /** probability of ghost notes (0..1) */
  ghostProbability: number
}

// ── BASS ──
export interface BassLearning {
  /** scale degree → 0..1 preference */
  degreePreferences: Record<number, number>
  /** interval transition probabilities (semitone → 0..1) */
  intervalTransitionProfile: Record<number, number>
  /** preferred register (MIDI octave) */
  register: number
  /** 0..1 — tendency to use octave jumps */
  octaveBehavior: number
  /** 0..1 — tendency to use approach tones */
  approachToneProfile: number
  /** 0..1 — tendency to use phrase-ending walkups */
  phraseEndingProfile: number
  /** 'LOCKED' | 'COMPLEMENTARY' | 'INDEPENDENT' */
  kickRelationship: string
}

// ── MELODY ──
export interface MelodyLearning {
  /** contour direction histogram: [up, down, same] normalized 0..1 */
  contourProfile: [number, number, number]
  /** interval histogram (semitone → 0..1 frequency) */
  intervalProfile: Record<number, number>
  /** preferred register center (MIDI) */
  registerProfile: number
  /** preferred phrase length in bars */
  phraseLength: number
  /** 0..1 — rest density preference */
  restProfile: number
  /** 0..1 — cadence tendency (resolving to stable tones) */
  cadenceProfile: number
  /** scale degree → 0..1 preference */
  scaleDegreePreferences: Record<number, number>
  /** 'REUSE' | 'VARY' | 'NEW' — motif behavior tendency */
  motifBehavior: string
  /** 0..1 — call/response tendency */
  callResponseProfile: number
}

// ── ARRANGEMENT ──
export interface ArrangementLearning {
  /** 0..1 energy curve over a section */
  energyCurve: number[]
  /** 0..1 density curve over a section */
  densityCurve: number[]
  /** 0..1 — tendency for sudden builds */
  buildBehavior: number
  /** 0..1 — tendency for drops */
  dropBehavior: number
  /** 0..1 — tendency for breakdowns */
  breakdownBehavior: number
  /** role → 0..1 activation probability */
  roleActivationProfile: Record<string, number>
}

// ── TIMBRE ──
export interface TimbreProfile {
  brightness: number
  spectralCentroid: number
  harmonicity: number
  noisiness: number
  transientCharacter: number
  attack: number
  decay: number
  sustain: number
  roughness: number
  subEnergy: number
  midEnergy: number
  highEnergy: number
  saturation: number
  confidence: number
}

// ── META ──
export interface LearningMeta {
  confidence: number
  novelty: number
  source: string
  observationWindow: number
  reward: number
  usageCount: number
  /** structural fingerprint of the source */
  fingerprint: string
}

// ── THE FULL CONTRACT ──
export interface LearnedMusicalContext {
  tempo: TempoLearning
  harmony: HarmonyLearning
  rhythm: RhythmLearning
  bass: BassLearning
  melody: MelodyLearning
  arrangement: ArrangementLearning
  timbre: TimbreProfile
  meta: LearningMeta
}

// ── FACTORY ──
export function createEmptyLearnedContext(): LearnedMusicalContext {
  return {
    tempo: { tempo: 145, tempoConfidence: 0, phaseRelationship: 0 },
    harmony: {
      key: 4,
      mode: 'phrygian-dominant',
      tonalCenterConfidence: 0,
      pitchClassProfile: new Array(12).fill(0),
      harmonicRhythm: 0.25,
      rootMovement: [],
      intervalPreferences: {},
    },
    rhythm: {
      subdivision: 4,
      swing: 0,
      syncopation: 0,
      accentProfile: new Array(16).fill(0),
      kickGrammar: new Array(16).fill(0),
      bassRhythmGrammar: new Array(16).fill(0),
      hatGrammar: new Array(16).fill(0),
      ghostProbability: 0,
    },
    bass: {
      degreePreferences: {},
      intervalTransitionProfile: {},
      register: 2,
      octaveBehavior: 0,
      approachToneProfile: 0,
      phraseEndingProfile: 0,
      kickRelationship: 'LOCKED',
    },
    melody: {
      contourProfile: [0.33, 0.33, 0.34],
      intervalProfile: {},
      registerProfile: 67,
      phraseLength: 8,
      restProfile: 0.2,
      cadenceProfile: 0.5,
      scaleDegreePreferences: {},
      motifBehavior: 'NEUTRAL',
      callResponseProfile: 0.3,
    },
    arrangement: {
      energyCurve: [],
      densityCurve: [],
      buildBehavior: 0.3,
      dropBehavior: 0.3,
      breakdownBehavior: 0.2,
      roleActivationProfile: {},
    },
    timbre: {
      brightness: 0.5,
      spectralCentroid: 2000,
      harmonicity: 0.5,
      noisiness: 0.3,
      transientCharacter: 0.5,
      attack: 0.01,
      decay: 0.3,
      sustain: 0.5,
      roughness: 0.3,
      subEnergy: 0.5,
      midEnergy: 0.5,
      highEnergy: 0.5,
      saturation: 0.3,
      confidence: 0,
    },
    meta: {
      confidence: 0,
      novelty: 0.5,
      source: 'empty',
      observationWindow: 0,
      reward: 0,
      usageCount: 0,
      fingerprint: '',
    },
  }
}

// ── PHRASE STATE (continuity between phrases) ──
export interface PhraseState {
  phraseIndex: number
  /** last motif id used */
  previousMotifId: string | null
  /** previous bass register (MIDI octave) */
  previousBassRegister: number
  /** previous lead register (MIDI center) */
  previousLeadRegister: number
  /** current harmonic context (pitch classes) */
  harmonicState: number[]
  /** 0..1 energy level at phrase end */
  energyState: number
  /** 0..1 density level at phrase end */
  densityState: number
  /** current arrangement state */
  arrangementState: string
  /** contour direction of last phrase (for continuation) */
  lastContourDirection: number
}

export function createEmptyPhraseState(): PhraseState {
  return {
    phraseIndex: 0,
    previousMotifId: null,
    previousBassRegister: 2,
    previousLeadRegister: 67,
    harmonicState: [],
    energyState: 0.5,
    densityState: 0.5,
    arrangementState: 'INTRO',
    lastContourDirection: 0,
  }
}

// ── COMPOSITION INPUT / OUTPUT CONTRACT ──
export interface FoundationCompositionInput {
  musicalContext: import('./musical-context.ts').MusicalContext
  learnedContext: LearnedMusicalContext
  adaptationIntent?: import('./composition-adaptation.ts').AdaptedCompositionIntent
  phraseState: PhraseState
  seed: number
}

export interface FoundationCompositionOutput {
  composedSection: import('./composition-engine.ts').ComposedSection
  nextPhraseState: PhraseState
  /** what the composition actually did (for PSY4 to evaluate) */
  musicalEvidence: {
    bassDegreesUsed: number[]
    leadContour: number[]
    harmonicMovement: number[]
    motifIdsUsed: string[]
    arrangementStates: string[]
    energyCurve: number[]
    densityCurve: number[]
  }
}
