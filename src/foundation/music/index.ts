// Scales and modes
export {
  type Scale,
  SCALES,
  NOTE_NAMES,
  degreeToMidi,
  degreeToPc,
  getScale,
  isInScale,
  listScales,
  nameToPc,
  nearestDegree,
  pcToName,
  scaleNotes,
  scalePcs,
  stableDegrees,
} from './scales'

// Chords
export {
  type ChordType,
  CHORD_TYPES,
  chordNotes,
  chordPcs,
  chordTension,
  getChordType,
  listChordTypes,
  voiceChord,
} from './chords'

// RNG
export { Rng } from './rng'

// Motif
export {
  type MotifNote,
  type MotifOptions,
  type MotifTransform,
  allInScale,
  fragment,
  generateMotif,
  invert,
  retrograde,
  transpose,
  vary,
} from './motif'

// Bass
export {
  type BassNote,
  type BassPatternOptions,
  type BassStyle,
  type TensionCurve,
  generateBassPattern,
  sampleTension,
  tensionToDensity,
  tensionToOctave,
} from './bass'

// Rhythm
export {
  type RhythmOptions,
  type RhythmPattern,
  backbeat,
  combine,
  density,
  drivingHats,
  fourOnFloor,
  humanize,
  invertRhythm,
  offbeatHats,
  psyKick,
  rhythm,
  swing,
} from './rhythm'

// MusicalContext (v2 substrate)
export {
  type MusicalContext,
  createMusicalContext,
  hasChord,
} from './musical-context'

// Structural Motif (v2)
export {
  type CreateMotifOptions,
  type Motif,
  type MotifNote as MotifNoteV2,
  createMotif,
  motifIdentity,
  motifSimilarity,
} from './motif-v2'

// MotifMemory
export {
  type IngestOptions,
  type MotifMemoryEntry,
  MotifMemory,
} from './motif-memory'

// Transformations
export {
  callResponse,
  contourMutation,
  invert as invertMotifV2,
  isScaleSnapped,
  intervalSubstitution,
  motifScale,
  refreshMotif,
  retrograde as retrogradeMotifV2,
  rhythmicDisplacement,
  rhythmicStretch,
  shiftRegister,
  transpose as transposeMotifV2,
} from './transformation'

// PhrasePlanner
export {
  type PhrasePlan,
  type PhrasePlanOptions,
  type PhraseRole,
  type PhraseSlot,
  applyTransformId,
  contextDegreeToMidi,
  contextStableDegrees,
  generateMotifV2,
  planPhrase,
  renderPhraseNotes,
  renderSectionNotes as renderPhraseSectionNotes,
} from './phrase-planner'

// SectionPlanner
export {
  type SectionPlan,
  type SectionPlanOptions,
  type SectionRole,
  type SectionSlot,
  planSection,
  renderSectionNotes,
} from './section-planner'

// Diversity metrics
export {
  type MeasureOptions,
  type MusicalityHealthReport,
  type MusicalityMetrics,
  MUSICALITY_BOUNDS,
  healthReport,
  measureMusicality,
} from './diversity'

// CandidateScorer
export {
  type CandidateScore,
  type CandidateScoreBreakdown,
  type CandidateScorerOptions,
  CandidateScorer,
  contextScalePcs,
} from './candidate-scorer'

// HarmonicClassifier (P4 coherence)
export {
  type HarmonicAnalysis,
  type HarmonicClassifierOptions,
  type NoteHarmonicFunction,
  HarmonicClassifier,
  pitchClassMembership,
} from './harmonic-classifier'

// RhythmicIdentity (P4 coherence)
export {
  type RhythmNote,
  type RhythmTransform,
  type RhythmTransformOptions,
  type RhythmicIdentity,
  analyzeRhythm,
  rhythmSimilarity,
  transformRhythm,
} from './rhythmic-identity'

// BassBehavior (P4 coherence)
// Note: bass-behavior.ts exports its own BassNote type (with `function` field),
// which collides with the legacy bass.ts BassNote. We re-export the new one as
// BassBehaviorNote to avoid the conflict.
export {
  type BassBehavior,
  type BassFunction,
  type BassNote as BassBehaviorNote,
  type BassQualityReport,
  type GenerateBassOptions,
  bassPitchClasses,
  evaluateBassQuality,
  generateBassBehavior,
} from './bass-behavior'

// PhraseArc (P4 coherence)
export {
  type BuildPhraseArcOptions,
  type PhraseArc,
  type PhraseArcEvaluation,
  type PhraseArcStage,
  type PhraseArcStagePoint,
  arcStablePcs,
  buildPhraseArc,
  evaluatePhraseArc,
} from './phrase-arc'

// MotifQualityGate (P4 coherence)
export {
  type MotifQualityAxes,
  type MotifQualityGateOptions,
  type MotifQualityScore,
  MotifQualityGate,
} from './motif-quality'

// RepetitionPolicy (P4 coherence)
export {
  type DecideOptions,
  type RepetitionDecision,
  type RepetitionPolicyOptions,
  type RepetitionType,
  RepetitionPolicy,
} from './repetition-policy'

// Coherence metrics (P4 coherence)
export {
  type CoherenceReport,
  type CoherenceReportOptions,
  type HarmonicCoherenceMetrics,
  type MotifCoherenceMetrics,
  type PhraseCoherenceMetrics,
  type RhythmicCoherenceMetrics,
  type StructuralCoherenceMetrics,
  coherenceReport,
  measureHarmonicCoherence,
  measureMotifCoherence,
  measurePhraseCoherence,
  measureRhythmicCoherence,
  measureStructuralCoherence,
} from './coherence'

// FailureDetector (P4 coherence)
export {
  type FailureDetectOptions,
  type FailureLevel,
  type MusicalFailure,
  type MusicalFailureReport,
  MusicalFailureDetector,
} from './failure-detector'

// StyleGrammar (P5 composition engine)
export {
  type BassAlignment,
  type DevelopmentStyle,
  type KickPatternKind,
  type StyleGrammar,
  STYLE_GRAMMARS,
  DEFAULT_STYLE,
  applyStyleToContext,
  getStyleGrammar,
  listStyleNames,
} from './style-grammar'

// GroovePlan (P5 composition engine)
export {
  type BassKickAlignment,
  type BuildGrooveOptions,
  type GroovePlan,
  type HatStyle,
  accentGrid,
  buildGroovePlan,
  hatStepsForStyle,
  isAccentStep,
  isFillBar,
  isKickStep,
  kickStepsForPattern,
} from './groove-plan'

// ArrangementState (P5 composition engine)
export {
  type ArrangementPlan,
  type ArrangementSlot,
  type ArrangementState,
  type RoleActivation,
  ARRANGEMENT_ROLE_MAP,
  countState,
  planArrangement,
  rolesForState,
  slotAtBar,
} from './arrangement-state'

// CompositionEngine (P5 composition engine)
export {
  type ComposedBar,
  type ComposedPhrase,
  type ComposedSection,
  type CompositionEngineOptions,
  CompositionEngine,
  clampToRegister,
  invertPitchPure,
  measureBassKickAlignment,
  retrogradePure,
} from './composition-engine'

// EnhancedFailureDetector (P5 composition engine)
export {
  type EnhancedFailureDetectOptions,
  type EnhancedMusicalFailure,
  type EnhancedFailureReport,
  type FailureLevel as EnhancedFailureLevel,
  type MusicalFailureType,
  detectMusicalFailures,
  failuresAtLevel,
} from './enhanced-failure-detector'

// SimulationHarness (P5 composition engine)
export {
  type MusicalFailure as SimulationMusicalFailure,
  type RunSimulationOptions,
  type SimulationResult,
  compareAlignment,
  runSimulation,
  runSimulationSuite,
} from './simulation-harness'

// RadioMusicalContext (P5.5 radio adaptation)
export {
  type RadioMusicalContext,
  RADIO_ABSENT,
  createRadioContext,
  isRadioAbsent,
} from './radio-context'

// OpportunityMap (P5.5 radio adaptation)
export {
  type OpportunityMap,
  type RoleStatus,
  buildOpportunityMap,
  countOccupied,
  countOpen,
  isDense,
} from './opportunity-map'

// CompositionAdaptation (P5.5 radio adaptation)
export {
  type AdaptOptions,
  type AdaptSectionOptions,
  type AdaptedCompositionIntent,
  CompositionAdaptation,
  adaptationFitScore,
  applyAdaptation,
  bassCompetition,
} from './composition-adaptation'

// RadioScenarios (P5.5 radio adaptation)
export {
  type RadioScenario,
  RADIO_SCENARIO_NAMES,
  RADIO_SCENARIOS,
  getRadioScenario,
  scenarioRadioSequence,
} from './radio-scenarios'

// AdaptationMetrics (P5.5 radio adaptation)
export {
  type AdaptationDivergence,
  type AdaptationReport,
  adaptationReport,
  adaptationSweep,
  baseContextForStyle,
  measureDivergence,
} from './adaptation-metrics'
