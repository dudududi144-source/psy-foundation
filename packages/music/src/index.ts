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
} from './scales.ts'

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
} from './chords.ts'

// RNG
export { Rng } from './rng.ts'

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
} from './motif.ts'

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
} from './bass.ts'

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
} from './rhythm.ts'

// MusicalContext (v2 substrate)
export {
  type MusicalContext,
  createMusicalContext,
  hasChord,
} from './musical-context.ts'

// Structural Motif (v2)
export {
  type CreateMotifOptions,
  type Motif,
  type MotifNote as MotifNoteV2,
  createMotif,
  motifIdentity,
  motifSimilarity,
} from './motif-v2.ts'

// MotifMemory
export {
  type IngestOptions,
  type MotifMemoryEntry,
  MotifMemory,
} from './motif-memory.ts'

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
} from './transformation.ts'

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
} from './phrase-planner.ts'

// SectionPlanner
export {
  type SectionPlan,
  type SectionPlanOptions,
  type SectionRole,
  type SectionSlot,
  planSection,
  renderSectionNotes,
} from './section-planner.ts'

// Diversity metrics
export {
  type MeasureOptions,
  type MusicalityHealthReport,
  type MusicalityMetrics,
  MUSICALITY_BOUNDS,
  healthReport,
  measureMusicality,
} from './diversity.ts'

// CandidateScorer
export {
  type CandidateScore,
  type CandidateScoreBreakdown,
  type CandidateScorerOptions,
  CandidateScorer,
  contextScalePcs,
} from './candidate-scorer.ts'

// HarmonicClassifier (P4 coherence)
export {
  type HarmonicAnalysis,
  type HarmonicClassifierOptions,
  type NoteHarmonicFunction,
  HarmonicClassifier,
  pitchClassMembership,
} from './harmonic-classifier.ts'

// RhythmicIdentity (P4 coherence)
export {
  type RhythmNote,
  type RhythmTransform,
  type RhythmTransformOptions,
  type RhythmicIdentity,
  analyzeRhythm,
  rhythmSimilarity,
  transformRhythm,
} from './rhythmic-identity.ts'

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
} from './bass-behavior.ts'

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
} from './phrase-arc.ts'

// MotifQualityGate (P4 coherence)
export {
  type MotifQualityAxes,
  type MotifQualityGateOptions,
  type MotifQualityScore,
  MotifQualityGate,
} from './motif-quality.ts'

// RepetitionPolicy (P4 coherence)
export {
  type DecideOptions,
  type RepetitionDecision,
  type RepetitionPolicyOptions,
  type RepetitionType,
  RepetitionPolicy,
} from './repetition-policy.ts'

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
} from './coherence.ts'

// FailureDetector (P4 coherence)
export {
  type FailureDetectOptions,
  type FailureLevel,
  type MusicalFailure,
  type MusicalFailureReport,
  MusicalFailureDetector,
} from './failure-detector.ts'

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
} from './style-grammar.ts'

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
} from './groove-plan.ts'

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
} from './arrangement-state.ts'

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
} from './composition-engine.ts'

// EnhancedFailureDetector (P5 composition engine)
export {
  type EnhancedFailureDetectOptions,
  type EnhancedMusicalFailure,
  type EnhancedFailureReport,
  type FailureLevel as EnhancedFailureLevel,
  type MusicalFailureType,
  detectMusicalFailures,
  failuresAtLevel,
} from './enhanced-failure-detector.ts'

// SimulationHarness (P5 composition engine)
export {
  type MusicalFailure as SimulationMusicalFailure,
  type RunSimulationOptions,
  type SimulationResult,
  compareAlignment,
  runSimulation,
  runSimulationSuite,
} from './simulation-harness.ts'

// RadioMusicalContext (P5.5 radio adaptation)
export {
  type RadioMusicalContext,
  RADIO_ABSENT,
  createRadioContext,
  isRadioAbsent,
} from './radio-context.ts'

// OpportunityMap (P5.5 radio adaptation)
export {
  type OpportunityMap,
  type RoleStatus,
  buildOpportunityMap,
  countOccupied,
  countOpen,
  isDense,
} from './opportunity-map.ts'

// CompositionAdaptation (P5.5 radio adaptation)
export {
  type AdaptOptions,
  type AdaptSectionOptions,
  type AdaptedCompositionIntent,
  CompositionAdaptation,
  adaptationFitScore,
  applyAdaptation,
  bassCompetition,
} from './composition-adaptation.ts'

// RadioScenarios (P5.5 radio adaptation)
export {
  type RadioScenario,
  RADIO_SCENARIO_NAMES,
  RADIO_SCENARIOS,
  getRadioScenario,
  scenarioRadioSequence,
} from './radio-scenarios.ts'

// AdaptationMetrics (P5.5 radio adaptation)
export {
  type AdaptationDivergence,
  type AdaptationReport,
  adaptationReport,
  adaptationSweep,
  baseContextForStyle,
  measureDivergence,
} from './adaptation-metrics.ts'

// Contract version
export { FOUNDATION_CONTRACT_VERSION } from './contract-version.ts'
export type {
  LearnedMusicalContext,
  PhraseState,
  TempoLearning,
  HarmonyLearning,
  RhythmLearning,
  BassLearning,
  MelodyLearning,
  ArrangementLearning,
  TimbreProfile,
  LearningMeta,
  FoundationCompositionInput,
  FoundationCompositionOutput,
} from './learned-context.ts'
export { createEmptyLearnedContext, createEmptyPhraseState } from './learned-context.ts'
export { MusicalLearningKernel } from './learning-kernel.ts'
export type { MusicalObservation, PhraseEvaluation, RewardSignal } from './learning-kernel.ts'
export type {
  InteractionGrammar,
  KickBassInteraction,
  BassTransition,
  HarmonyLeadInteraction,
  EnergyDensityInteraction,
  TensionRegisterInteraction,
} from './interaction-grammar.ts'
export { createEmptyInteractionGrammar, updateInteractionGrammar } from './interaction-grammar.ts'
export type { DevelopmentOperator, DevelopmentDecision } from './phrase-development.ts'
export { chooseDevelopment, applyDevelopment } from './phrase-development.ts'

// F20: PhraseMaterial (real musical material + transformations)
export {
  type MaterialTransformContext,
  type PhraseMaterial,
  answerMaterial,
  applyOperatorToMaterial,
  breakMaterial,
  continueMaterial,
  contrastMaterial,
  developMaterial,
  emptyPhraseMaterial,
  intensifyMaterial,
  isMaterialRelated,
  materialSimilarity,
  motifToPhraseMaterial,
  reduceMaterial,
  resolveMaterial,
  transitionMaterial,
  variateMaterial,
} from './phrase-material.ts'

// F20: RhythmicSpaceMap
export {
  type BuildSpaceMapOptions,
  type RhythmicSpaceCell,
  type RhythmicSpaceMap,
  buildRhythmicSpaceMap,
  cellAt,
  meanPreferredLead,
  stepsByLeadPreference,
  stepsByResponsePreference,
} from './rhythmic-space-map.ts'
export {
  countOccupied as countSpaceOccupied,
  countOpen as countSpaceOpen,
} from './rhythmic-space-map.ts'

// F20: HarmonicPlan
export {
  type CadenceTarget,
  type CadenceTargetFunction,
  type HarmonicChord,
  type HarmonicFunction,
  type HarmonicPlan,
  buildHarmonicPlan,
  PSYTRANCE_PROGRESSIONS,
  cadenceMidi,
  chordAtBar,
  isAnticipationBar,
  nextChordAfterBar,
} from './harmonic-plan.ts'

// F20: Voice plans
export {
  type BassPlan,
  type BassPlanNote,
  type KickPlan,
  type LeadPlan,
  type LeadPlanNote,
  type LeadRole,
  bassOnsetsOf,
  emptyBassPlan,
  emptyKickPlan,
  emptyLeadPlan,
  kickOnsetsOf,
} from './voice-plans.ts'
export type { BassFunction as VoiceBassFunction } from './voice-plans.ts'

// F20: Interaction-grammar consumer (causal bridge)
export {
  bassOnsetProbability,
  bassTransitionProbability,
  densityForEnergy,
  leadIntervalScore,
  leadResponseBoost,
  pickNextBassDegree,
  registerForTension,
} from './interaction-grammar-consumer.ts'

// F21: PhraseMaterial shapes + PhraseArc
export {
  type AccentShape,
  type ContourShape,
  type DevelopmentHistoryEntry,
  type PhraseArc as PhraseMaterialArc,
  type PhraseArcStage as PhraseMaterialArcStage,
  arcStageAt,
  buildPhraseArc as buildPhraseMaterialArc,
} from './phrase-material.ts'

// F21: LearnedIdentity
export {
  type BassVocabulary,
  type LearnedIdentity,
  type LeadContourVocabulary,
  createIdentityA,
  createIdentityB,
  createNeutralIdentity,
} from './learned-identity.ts'

// F21: Bass vocabulary (generation-behavior modes)
export {
  type BassVocabularyContext,
  acidBass,
  generateBassByVocabulary,
  melodicBass,
  rollingBass,
  rollingBass16th,
  sparseBass,
  syncopatedBass,
  tensionBass,
} from './bass-vocabulary.ts'

// F21: Tension dimensions
export {
  type TensionDimensions,
  applyDensityTension,
  applyHarmonicTension,
  applyMelodicTension,
  applyRegisterTension,
  applyRhythmicTension,
  applySpectralTension,
  deriveTensionDimensions,
  shouldSurprise,
} from './tension-dimensions.ts'

// F21: SoundDNA → SynthRecipe
export {
  type EnvelopeConfig,
  type FilterConfig,
  type FilterTopology,
  type LfoConfig,
  type LfoTarget,
  type OscillatorLayer,
  type OscillatorType,
  type SaturationConfig,
  type SaturationType,
  type SoundDNA,
  type StereoConfig,
  type SynthRecipe,
  isMateriallyDifferentArchitecture,
  recipeDivergence,
  renderSynthRecipe,
  timbreToSoundDNA,
} from './sound-dna.ts'

// F22: RawScore Serializer (EXPERIMENTAL — Vertical Proof Freeze)
// Read-only serializer that extracts REQUIRED musical fields from the existing
// ComposedSection. Does NOT modify CompositionEngine. Does NOT add fields.
// Does NOT delete DEAD fields. Only serializes what the Freeze Instruction
// specifies for the PSY4 Vertical Proof.
export {
  type RawArrangement,
  type RawBar,
  type RawGroove,
  type RawPhrase,
  type RawPhraseMaterial,
  type RawScore,
  serializeRawScore,
  serializeRawScoreJSON,
} from './raw-score-serializer.ts'
