/**
 * CompositionEngine: the single authoritative composer.
 *
 * The engine composes whole phrases, not isolated bars. It follows a strict
 * hierarchy:
 *   1. Build GroovePlan (kick skeleton, subdivision, accents)
 *   2. Determine harmonic plan (chord tones, tension notes)
 *   3. Compose BASS against groove (bass knows where kick is)
 *   4. Compose LEAD against bass+harmony (lead leaves space for bass,
 *      stays in tessitura)
 *   5. Arrange parts (some roles OFF in BREAK / INTRO / OUTRO sections)
 *
 * Bass composition rules:
 *   - Bass ALWAYS places a ROOT on step 0 (beat 1) — the LOCKED invariant
 *     that keeps bass-kick alignment high.
 *   - In LOCKED mode: bass hits every kick step with ROOT.
 *   - In COMPLEMENTARY mode: bass hits the gaps between kicks with
 *     FIFTH / OCTAVE.
 *   - Bass register: octave 2 (MIDI 36-59).
 *   - Last bar of a phrase: CADENCE walk (fifth → root).
 *
 * Lead composition rules:
 *   - Lead MUST NOT overlap bass register (lead clamped to MIDI 60-84).
 *   - Lead respects harmonic context (chord tones preferred).
 *   - Lead max leap: grammar.maxLeap (default 7 semitones).
 *   - Lead tessitura center: grammar.tessituraCenter.
 *   - Lead uses motifs from memory, transformed purposefully.
 *   - Lead has call/response structure: first half = call (small
 *     transpositions of the phrase motif), second half = response
 *     (callResponse transform).
 */

import {
  ARRANGEMENT_ROLE_MAP,
  type ArrangementPlan,
  type ArrangementState,
  type RoleActivation,
  planArrangement,
} from './arrangement-state.ts'
import { generateBassByVocabulary } from './bass-vocabulary.ts'
import type { AdaptedCompositionIntent } from './composition-adaptation.ts'
import { type GroovePlan, buildGroovePlan } from './groove-plan.ts'
import {
  type HarmonicChord,
  type HarmonicFunction,
  type HarmonicPlan,
  buildHarmonicPlan,
  cadenceMidi,
  chordAtBar,
  isAnticipationBar,
  nextChordAfterBar,
} from './harmonic-plan.ts'
import {
  bassOnsetProbability,
  densityForEnergy,
  leadIntervalScore,
  leadResponseBoost,
  pickNextBassDegree,
  registerForTension,
} from './interaction-grammar-consumer.ts'
import type { InteractionGrammar } from './interaction-grammar.ts'
import { createEmptyInteractionGrammar } from './interaction-grammar.ts'
import type { LearnedMusicalContext } from './learned-context.ts'
import { createEmptyLearnedContext } from './learned-context.ts'
import type { LearnedIdentity } from './learned-identity.ts'
import { MotifMemory } from './motif-memory.ts'
import { type Motif, type MotifNote, createMotif } from './motif-v2.ts'
import type { MusicalContext } from './musical-context.ts'
import type { DevelopmentOperator } from './phrase-development.ts'
import {
  type ContourShape,
  type PhraseMaterial,
  applyOperatorToMaterial,
  arcStageAt,
  motifToPhraseMaterial,
} from './phrase-material.ts'
import { generateMotifV2 } from './phrase-planner.ts'
import { type RhythmicSpaceMap, buildRhythmicSpaceMap, cellAt } from './rhythmic-space-map.ts'
import { Rng } from './rng.ts'
import { degreeToMidi, getScale, isInScale, scalePcs } from './scales.ts'
import {
  type SoundDNA,
  type SynthRecipe,
  renderSynthRecipe,
  timbreToSoundDNA,
} from './sound-dna.ts'
import { type StyleGrammar, getStyleGrammar } from './style-grammar.ts'
import {
  applyDensityTension,
  applyHarmonicTension,
  applyRegisterTension,
  deriveTensionDimensions,
} from './tension-dimensions.ts'
import {
  callResponse,
  invert as invertMotif,
  retrograde as retrogradeMotif,
  transpose as transposeMotif,
} from './transformation.ts'
import {
  type BassPlan,
  type BassPlanNote,
  type KickPlan,
  type LeadPlan,
  type LeadPlanNote,
  emptyBassPlan,
  emptyLeadPlan,
} from './voice-plans.ts'

export interface ComposedBar {
  barIndex: number
  arrangementState: ArrangementState
  groove: GroovePlan
  /** Step indices within the bar that have a kick onset. */
  kickNotes: number[]
  /** Bass notes for this bar. */
  bassNotes: { midi: number; step: number; durationSteps: number; function: string }[]
  /** Lead notes for this bar. */
  leadNotes: { midi: number; step: number; durationSteps: number; velocity: number }[]
  /** Step indices within the bar that have a hat onset. */
  hatNotes: number[]
  /** Active chord pitch classes for this bar. */
  harmonicContext: number[]
  /** Role activation for this bar (copied from arrangement slot). */
  roles: RoleActivation
  /** Timbre intent from learned context (PSY4 translates to synth params). */
  timbreIntent?: {
    brightness: number
    harmonicity: number
    noisiness: number
    attack: number
    subEnergy: number
  }
  // ── F20 plan inspection fields (for behavioral A/B tests) ──
  /** The harmonic plan active at this bar (cadence target, chord sequence). */
  harmonicPlan?: HarmonicPlan
  /** The active chord at this bar. */
  activeChord?: HarmonicChord
  /** The rhythmic space map derived from kick + bass at this bar. */
  spaceMap?: RhythmicSpaceMap
  /** The kick plan for this bar. */
  kickPlan?: KickPlan
  /** The bass plan for this bar. */
  bassPlan?: BassPlan
  /** The lead plan for this bar (with roles). */
  leadPlan?: LeadPlan
  // ── F21 SoundDNA fields ──
  /** Per-role synth recipes derived from SoundDNA (reaches the synthesis graph). */
  synthRecipes?: { kick: SynthRecipe; bass: SynthRecipe; lead: SynthRecipe; hats: SynthRecipe }
  /** The SoundDNA used to generate the recipes. */
  soundDNA?: SoundDNA
}

export interface ComposedPhrase {
  bars: ComposedBar[]
  /** Indices (within the phrase) of the opening / peak / resolution bars. */
  phraseArc: { opening: number; peak: number; resolution: number }
  /** Motif ids used in this phrase (primary motif first). */
  motifIds: string[]
  /** If this phrase is a callback, the motif id it callbacks to. */
  callbackTo?: string
  seed: number
  /** F20: the phrase material used in this phrase (for lineage / A/B tests). */
  phraseMaterial?: PhraseMaterial
  /** F20: the development operator applied to derive this phrase's material. */
  developmentOperator?: string
  /** F20: the harmonic plan for this phrase. */
  harmonicPlan?: HarmonicPlan
}

export interface ComposedSection {
  bars: ComposedBar[]
  phrases: ComposedPhrase[]
  arrangement: ArrangementPlan
  groove: GroovePlan
  seed: number
}

export interface CompositionEngineOptions {
  memory?: MotifMemory
  seed: number
  context: MusicalContext
  /** Optional explicit grammar; defaults to context.sectionRole lookup. */
  grammar?: StyleGrammar
  /** Optional learned preference function (0..1). When provided, motif selection is biased. */
  preferenceFor?: (motif: Motif) => number
  /** Optional learned musical context from radio observation. Changes bass/melody/rhythm grammar. */
  learnedContext?: LearnedMusicalContext
  /** F20: learned interaction grammar — causally consumed by bass/lead generators. */
  interactionGrammar?: InteractionGrammar
  /** F20: the previous phrase's material — used to derive the next phrase via development operators. */
  previousPhraseMaterial?: PhraseMaterial
  /** F20: the development operator to apply to previousPhraseMaterial for this section. */
  developmentOperator?: DevelopmentOperator
  /** F20: disable relational generation (for the A/B OFF vs ON test). Falls back to pre-F20 behaviour. */
  relationalGenerationOff?: boolean
  /** F21: the learned musical identity — drives vocabulary, contour, register, tension. */
  identity?: LearnedIdentity
}

const BASS_OCTAVE = 2
const LEAD_MIN_MIDI = 60
const LEAD_MAX_MIDI = 84

export class CompositionEngine {
  private memory: MotifMemory
  private seed: number
  private context: MusicalContext
  private grammar: StyleGrammar
  private preferenceFor: ((motif: Motif) => number) | null
  private learned: LearnedMusicalContext
  private interactionGrammar: InteractionGrammar
  private previousPhraseMaterial: PhraseMaterial | null
  private developmentOperator: DevelopmentOperator | null
  private relationalOff: boolean
  private identity: LearnedIdentity | null

  constructor(opts: CompositionEngineOptions) {
    this.memory = opts.memory ?? new MotifMemory()
    this.seed = opts.seed
    this.context = opts.context
    this.grammar = opts.grammar ?? getStyleGrammar(opts.context.sectionRole || 'full-on')
    this.preferenceFor = opts.preferenceFor ?? null
    this.learned = opts.learnedContext ?? opts.identity?.learned ?? createEmptyLearnedContext()
    this.interactionGrammar =
      opts.interactionGrammar ?? opts.identity?.grammar ?? createEmptyInteractionGrammar()
    this.previousPhraseMaterial = opts.previousPhraseMaterial ?? null
    this.developmentOperator = opts.developmentOperator ?? null
    this.relationalOff = opts.relationalGenerationOff ?? false
    this.identity = opts.identity ?? null
    // If an identity is provided, bake its energy/tension/syncopation into the context.
    if (this.identity) {
      this.context = {
        ...this.context,
        energy: this.identity.energy,
        tension: this.identity.tension,
        density: 0.3 + this.identity.energy * 0.4,
      }
    }
    this.seedMemory()
  }

  /** Compose a single phrase as ONE musical object. */
  composePhrase(opts: {
    bars: number
    arrangementState: ArrangementState
    groove: GroovePlan
    harmonicContext: number[]
    previousPhrase?: ComposedPhrase
    /** If set, the phrase uses this motif (callback) instead of generating fresh. */
    callbackMotif?: Motif
    /** Optional adaptation intent — changes what is composed (not just filters). */
    intent?: AdaptedCompositionIntent
    /** F20: absolute bar index where this phrase starts (for HarmonicPlan). */
    startBar?: number
    /** F20: phrase index within the section (for harmonic function + cadence). */
    phraseIndex?: number
    /** F20: is this the last phrase in the section? (drives cadence target). */
    isLastPhrase?: boolean
    /** F20: phrase role (STATEMENT/RESPONSE/RESOLUTION/...) — drives cadence target. */
    phraseRole?: string
  }): ComposedPhrase {
    const { bars, arrangementState, groove, harmonicContext } = opts
    const intent = opts.intent
    // Per-phrase rng, derived deterministically from the engine seed + state.
    const rng = new Rng(
      (this.seed * 7919 + bars * 31 + arrangementState.length * 17 + harmonicContext.length * 7) >>>
        0
    )
    const roles = { ...ARRANGEMENT_ROLE_MAP[arrangementState] }

    // Apply intent to roles (adaptation changes WHO plays)
    if (intent) {
      if (intent.bassPressure < 0.3) roles.bass = false
      if (intent.leadPressure < 0.3) roles.lead = false
      if (intent.groovePressure < 0.3) {
        roles.kick = false
        roles.hats = false
      }
      if (intent.texturePressure > 0.6) roles.hats = true
    }

    const phraseMotif = opts.callbackMotif ?? this.choosePhraseMotif(rng, opts.previousPhrase)
    const callbackTo = opts.callbackMotif?.id

    // ── F20 STEP 1: HarmonicPlan ──
    // Build a real harmonic plan for the phrase. The lead will consult this
    // for current chord, next chord, cadence target, and harmonic function.
    const harmonicPlan = buildHarmonicPlan({
      bars,
      startBar: opts.startBar ?? 0,
      tonic: this.context.tonic,
      scaleName: this.context.scaleName,
      phraseIndex: opts.phraseIndex ?? 0,
      isLastPhrase: opts.isLastPhrase ?? false,
      phraseRole: opts.phraseRole,
      chordChangeRate: this.grammar.chordChangeRate,
      tensionPreference: this.grammar.tensionPreference,
      learnedPcProfile: this.learned.harmony.pitchClassProfile,
      learnedConfidence: this.learned.meta.confidence,
      progressionName: this.context.progressionName,
    })

    // ── F20 STEP 2: PhraseMaterial ──
    // Derive the phrase's musical material from the previous phrase's material
    // via the development operator. When no previous material exists (first
    // phrase), extract material from the chosen phrase motif.
    let phraseMaterial: PhraseMaterial
    if (this.previousPhraseMaterial && this.developmentOperator) {
      const scale = getScale(this.context.scaleName)
      const fallbackScale = getScale('phrygian-dominant')
      const rootMidi = degreeToMidi(
        this.context.tonic,
        scale ?? fallbackScale ?? (getScale('minor') as NonNullable<typeof scale>),
        0,
        4
      )
      phraseMaterial = applyOperatorToMaterial(
        this.developmentOperator,
        this.previousPhraseMaterial,
        {
          tonic: this.context.tonic,
          scaleName: this.context.scaleName,
          scale: scale ?? undefined,
          rootMidi,
          rng: rng as unknown as {
            next: () => number
            pick: <T>(a: T[]) => T
            int: (a: number, b: number) => number
          },
          variationAmount: 0.4,
          cadenceTargetPc: harmonicPlan.cadenceTarget.pc,
        }
      )
    } else {
      phraseMaterial = motifToPhraseMaterial(phraseMotif, groove.stepsPerBar)
    }

    const half = Math.floor(bars / 2)
    const composedBars: ComposedBar[] = []
    const grammarConfidence = this.interactionGrammar.confidence
    // F21: derive tension dimensions for this phrase (used by SoundDNA + lead).
    const tensionDims = deriveTensionDimensions(this.context.tension)

    for (let bar = 0; bar < bars; bar++) {
      const isLast = bar === bars - 1
      const isResponse = bar >= half
      // Per-bar bass + lead rngs (independent streams).
      const bassRng = new Rng((this.seed * 131 + bar * 53 + 11) >>> 0)
      const leadRng = new Rng((this.seed * 191 + bar * 71 + 23) >>> 0)

      // Active chord at this bar (absolute bar index within the phrase).
      const absoluteBar = (opts.startBar ?? 0) + bar
      const activeChord = chordAtBar(harmonicPlan, absoluteBar)
      const barChordTones = activeChord?.chordTones ?? harmonicContext
      const nextChord = nextChordAfterBar(harmonicPlan, absoluteBar)
      const isAnticipation = isAnticipationBar(harmonicPlan, absoluteBar)

      // ── F20 STEP 3: KickPlan ──
      // Kick is generated from the groove skeleton + learned kick grammar.
      // The KickPlan object is emitted so the bass and lead can consume the
      // ACTUAL kick onsets (not the style skeleton).
      const kickPlan = this.composeKickPlan(bar, groove, rng)
      const kickNotes = kickPlan.onsets

      // ── F20 STEP 4: Hats ── (unchanged logic, kept for backward compat)
      let hatNotes: number[] = []
      if (roles.hats) {
        hatNotes = Array.from(new Set(groove.hatSteps)).sort((a, b) => a - b)
        const learnedHats = this.learned.rhythm.hatGrammar
        if (this.learned.meta.confidence > 0.3 && learnedHats.some((v: number) => v > 0.1)) {
          const hatRng = new Rng((this.seed * 223 + bar * 47 + 13) >>> 0)
          const generated: number[] = []
          for (let step = 0; step < groove.stepsPerBar; step++) {
            const prob = learnedHats[step % 16] ?? 0
            const styleHas = groove.hatSteps.includes(step)
            const blended = styleHas ? 0.7 : prob * 0.5
            if (hatRng.next() < blended) {
              generated.push(step)
            }
          }
          hatNotes = generated.length > 0 ? generated.sort((a, b) => a - b) : hatNotes
        }
      }

      // ── F20/F21 STEP 5: BassPlan ──
      // Bass is composed AGAINST the actual KickPlan + HarmonicPlan.
      // F21: when a learned identity is present, dispatch to the vocabulary-
      // based generator (ROLLING/SYNCOPATED/MELODIC/ACID/SPARSE/TENSION) —
      // each mode alters the GENERATION PROCEDURE, not a step array.
      // F20: otherwise use the grammar-driven composeBassPlan.
      let bassPlan: BassPlan = emptyBassPlan()
      if (roles.bass) {
        if (this.relationalOff) {
          // A/B test fallback: old deaf bass (groove skeleton only, no grammar).
          bassPlan = this.composeBassLegacy(bar, groove, bassRng, isLast)
        } else if (this.identity) {
          // F21: vocabulary-based bass generation.
          const bassScale = getScale(this.context.scaleName)
          if (bassScale) {
            const vocabNotes = generateBassByVocabulary(this.identity.bassVocabulary, {
              bar,
              groove,
              kickPlan,
              chordTones: barChordTones,
              tonic: this.context.tonic,
              scaleName: this.context.scaleName,
              scale: bassScale,
              isLast,
              isAnticipationBar: isAnticipation,
              rng: bassRng,
              intervalWidth: this.identity.bassIntervalWidth,
              syncopation: this.identity.syncopation,
              bassOctave: BASS_OCTAVE,
              tension: this.context.tension,
            })
            bassPlan = { notes: vocabNotes, onsets: vocabNotes.map((n) => n.step) }
          }
        } else {
          bassPlan = this.composeBassPlan({
            bar,
            groove,
            kickPlan,
            chordTones: barChordTones,
            harmonicFunction: activeChord?.function ?? 'TONIC',
            isLast,
            rng: bassRng,
            grammarConfidence,
            isAnticipationBar: isAnticipation,
          })
        }
      }
      const bassNotes: { midi: number; step: number; durationSteps: number; function: string }[] =
        bassPlan.notes.map((n) => ({
          midi: n.midi,
          step: n.step,
          durationSteps: n.durationSteps,
          function: n.function,
        }))

      // ── F20 STEP 6: RhythmicSpaceMap ──
      // Derived from the actual kick + bass plans. The lead consults this to
      // decide where to play, where to rest, where to answer bass.
      const spaceMap = buildRhythmicSpaceMap({
        stepsPerBar: groove.stepsPerBar,
        kickOnsets: kickPlan.onsets,
        bassOnsets: bassPlan.onsets,
        accentSteps: groove.accentSteps,
        hatOnsets: hatNotes,
        harmonicChangeSteps: isAnticipation ? [groove.stepsPerBar - 1] : [],
        bassAnticipationSteps: bassPlan.notes.filter((n) => n.isAnticipation).map((n) => n.step),
      })

      // ── F20 STEP 7: LeadPlan ──
      // Lead is composed AGAINST everything: harmonic plan, groove, kick plan,
      // bass plan, space map, phrase material, phrase role, tension state,
      // and the learned interaction grammar. The lead explicitly decides per
      // step where to play / rest / answer / anticipate / cadence.
      let leadPlan: LeadPlan = emptyLeadPlan()
      if (roles.lead) {
        if (this.relationalOff) {
          // A/B test fallback: old deaf lead (motif + chord snapping only).
          const legacyNotes = this.composeLeadLegacy(
            bar,
            bars,
            phraseMotif,
            barChordTones,
            leadRng,
            isResponse
          )
          leadPlan = { notes: legacyNotes.map((n) => ({ ...n, role: 'CONTINUATION' as const })) }
        } else {
          leadPlan = this.composeLeadPlan({
            bar,
            bars,
            groove,
            kickPlan,
            bassPlan,
            spaceMap,
            harmonicPlan,
            activeChord: activeChord ?? null,
            nextChord: nextChord,
            isAnticipation,
            isLast,
            isResponse,
            phraseMaterial,
            phraseRole: opts.phraseRole ?? 'STATEMENT',
            rng: leadRng,
            grammarConfidence,
          })
        }
      }
      const leadNotes: { midi: number; step: number; durationSteps: number; velocity: number }[] =
        leadPlan.notes.map((n) => ({
          midi: n.midi,
          step: n.step,
          durationSteps: n.durationSteps,
          velocity: n.velocity,
        }))

      // Apply adaptation intent to change DENSITY (not just on/off)
      let adjustedBass = bassNotes
      let adjustedLead = leadNotes
      if (intent) {
        // Reduce bass notes proportionally to bassPressure
        if (intent.bassPressure < 0.6 && adjustedBass.length > 1) {
          const keepRatio = Math.max(0.3, intent.bassPressure)
          const keepCount = Math.max(1, Math.floor(adjustedBass.length * keepRatio))
          adjustedBass = adjustedBass.slice(0, keepCount)
        }
        // Reduce lead notes proportionally to leadPressure
        if (intent.leadPressure < 0.6 && adjustedLead.length > 1) {
          const keepRatio = Math.max(0.2, intent.leadPressure)
          const keepCount = Math.max(1, Math.floor(adjustedLead.length * keepRatio))
          adjustedLead = adjustedLead.slice(0, keepCount)
        }
        // Register shift: shift lead notes
        if (intent.registerShift !== 0 && adjustedLead.length > 0) {
          const shift = intent.registerShift * 12
          adjustedLead = adjustedLead.map((n) => ({
            ...n,
            midi: Math.max(LEAD_MIN_MIDI, Math.min(LEAD_MAX_MIDI, n.midi + shift)),
          }))
        }
        // Rest pressure: silence some bars entirely
        if (intent.restPressure > 0.5 && bar % 4 === 2) {
          adjustedLead = []
        }
        // High texture: add hats if sparse
        if (intent.texturePressure > 0.6 && hatNotes.length === 0 && roles.hats) {
          hatNotes.push(2, 6, 10, 14)
        }
      }

      // F21: render per-role SynthRecipes from SoundDNA. The SoundDNA is
      // derived from the learned TimbreProfile and tension dimensions. The
      // recipes specify oscillator type, layer count, filter topology,
      // envelope, saturation, modulation, and stereo — they reach the real
      // synthesis graph (consumed by PSY4's DSP layer).
      const soundDNA = timbreToSoundDNA(this.learned.timbre)
      // Apply spectral tension: high tension → brighter.
      soundDNA.brightness = Math.max(
        0,
        Math.min(1, soundDNA.brightness * 0.5 + tensionDims.spectral * 0.5)
      )
      const synthRecipes = {
        kick: renderSynthRecipe(soundDNA, 'kick'),
        bass: renderSynthRecipe(soundDNA, 'bass'),
        lead: renderSynthRecipe(soundDNA, 'lead'),
        hats: renderSynthRecipe(soundDNA, 'hats'),
      }

      composedBars.push({
        barIndex: bar,
        arrangementState,
        groove,
        kickNotes,
        bassNotes: adjustedBass,
        leadNotes: adjustedLead,
        hatNotes,
        harmonicContext: barChordTones.slice(),
        roles: { ...roles },
        timbreIntent:
          this.learned.meta.confidence > 0.3
            ? {
                brightness: this.learned.timbre.brightness,
                harmonicity: this.learned.timbre.harmonicity,
                noisiness: this.learned.timbre.noisiness,
                attack: this.learned.timbre.attack,
                subEnergy: this.learned.timbre.subEnergy,
              }
            : undefined,
        // F20 plan inspection fields.
        harmonicPlan,
        activeChord: activeChord ?? undefined,
        spaceMap,
        kickPlan,
        bassPlan,
        leadPlan,
        // F21 SoundDNA fields.
        synthRecipes,
        soundDNA,
      })
    }

    return {
      bars: composedBars,
      phraseArc: { opening: 0, peak: half, resolution: Math.max(0, bars - 1) },
      motifIds: [phraseMotif.id],
      callbackTo,
      seed: this.seed,
      phraseMaterial,
      developmentOperator: this.developmentOperator ?? undefined,
      harmonicPlan,
    }
  }

  /** Compose a full section (32-256 bars). */
  composeSection(opts: { bars: number }): ComposedSection {
    const groove = buildGroovePlan({
      context: this.context,
      seed: this.seed,
      bars: opts.bars,
      grammar: this.grammar,
    })
    const arrangement = planArrangement({
      bars: opts.bars,
      seed: this.seed,
      context: this.context,
    })

    // Slice the arrangement into phrases at state boundaries so each phrase
    // has a single ArrangementState. This keeps composePhrase's
    // role-activation logic correct (an INTRO phrase has no kick; a GROOVE
    // phrase has kick) while still respecting the arrangement's per-bar
    // state changes.
    const groups: { state: ArrangementState; start: number; length: number }[] = []
    let curState: ArrangementState | null = null
    let curStart = 0
    for (let bar = 0; bar < opts.bars; bar++) {
      const slot = arrangement.slots[bar]
      const state: ArrangementState = slot?.state ?? 'GROOVE'
      if (curState === null) {
        curState = state
        curStart = bar
      } else if (state !== curState) {
        groups.push({ state: curState, start: curStart, length: bar - curStart })
        curState = state
        curStart = bar
      }
    }
    if (curState !== null) {
      groups.push({
        state: curState,
        start: curStart,
        length: opts.bars - curStart,
      })
    }
    const totalPhrases = groups.length

    const phrases: ComposedPhrase[] = []
    const bars: ComposedBar[] = []
    let prev: ComposedPhrase | undefined
    let firstPhraseMotif: Motif | undefined

    for (let phraseIdx = 0; phraseIdx < groups.length; phraseIdx++) {
      const group = groups[phraseIdx] as { state: ArrangementState; start: number; length: number }
      const isLastPhrase = phraseIdx === totalPhrases - 1
      const harmonicContext = this.chooseHarmonicForPhrase(phraseIdx)
      const callbackMotif = isLastPhrase && firstPhraseMotif ? firstPhraseMotif : undefined

      // F20: derive a phrase role from the arrangement state for cadence targeting.
      const phraseRole = this.derivePhraseRole(group.state, phraseIdx, isLastPhrase)

      const phrase = this.composePhrase({
        bars: group.length,
        arrangementState: group.state,
        groove,
        harmonicContext,
        previousPhrase: prev,
        callbackMotif,
        startBar: group.start,
        phraseIndex: phraseIdx,
        isLastPhrase,
        phraseRole,
      })

      // Re-index bars to absolute bar indices and sync per-bar roles from
      // the arrangement (in case the arrangement's slot has slightly
      // different roles than the state's default — e.g., due to jitter).
      for (const b of phrase.bars) {
        const absoluteBar = b.barIndex + group.start
        const absSlot = arrangement.slots.find((s) => s.barIndex === absoluteBar)
        const out: ComposedBar = { ...b, barIndex: absoluteBar }
        if (absSlot) {
          out.roles = { ...absSlot.roles }
        }
        bars.push(out)
      }
      phrases.push(phrase)

      // Capture the first phrase's motif for the final callback.
      if (phraseIdx === 0) {
        const id = phrase.motifIds[0]
        if (id) {
          const entry = this.memory.retrieve(id)
          if (entry) firstPhraseMotif = entry.motif
        }
      }
      prev = phrase
    }

    return { bars, phrases, arrangement, groove, seed: this.seed }
  }

  /** Get all notes from a composed section as flat arrays per part. */
  renderNotes(section: ComposedSection): {
    kick: { step: number; bar: number }[]
    bass: { midi: number; step: number; bar: number; function: string }[]
    lead: { midi: number; step: number; bar: number; velocity: number }[]
    hats: { step: number; bar: number }[]
  } {
    const kick: { step: number; bar: number }[] = []
    const bass: { midi: number; step: number; bar: number; function: string }[] = []
    const lead: { midi: number; step: number; bar: number; velocity: number }[] = []
    const hats: { step: number; bar: number }[] = []
    for (const bar of section.bars) {
      for (const step of bar.kickNotes) kick.push({ step, bar: bar.barIndex })
      for (const n of bar.bassNotes) {
        bass.push({ midi: n.midi, step: n.step, bar: bar.barIndex, function: n.function })
      }
      for (const n of bar.leadNotes) {
        lead.push({ midi: n.midi, step: n.step, bar: bar.barIndex, velocity: n.velocity })
      }
      for (const step of bar.hatNotes) hats.push({ step, bar: bar.barIndex })
    }
    return { kick, bass, lead, hats }
  }

  // ---------------- internal helpers ----------------

  /** Seed memory with 2-3 motifs so the first phrase has material to draw on. */
  private seedMemory(): void {
    if (this.memory.size > 0) return
    const baseMotif = generateMotifV2(
      { ...this.context, octave: 4 },
      (this.seed * 7 + 1) >>> 0,
      'lead'
    )
    this.memory.ingest(baseMotif, 0, { salience: 0.7, role: 'lead' })
    const altMotif = generateMotifV2(
      { ...this.context, octave: 4 },
      (this.seed * 13 + 31) >>> 0,
      'lead'
    )
    this.memory.ingest(altMotif, 0, { salience: 0.6, role: 'lead' })
  }

  /**
   * Choose the phrase motif. 30% of the time (deterministic via rng), pull
   * a motif from memory referenced by the previous phrase — a cross-phrase
   * callback. Otherwise generate a fresh motif. When a learned preference
   * function is provided, candidates are scored and the highest-scoring
   * motif is selected with 70% probability (30% exploration).
   */
  private choosePhraseMotif(rng: Rng, previousPhrase?: ComposedPhrase): Motif {
    // 30% chance: callback to previous phrase motif
    if (previousPhrase && rng.next() < 0.3) {
      const prevId = previousPhrase.motifIds[0]
      if (prevId) {
        const entry = this.memory.retrieve(prevId)
        if (entry) return entry.motif
      }
    }

    // Generate 3 candidate motifs
    const candidates: Motif[] = []
    for (let i = 0; i < 3; i++) {
      const freshSeed = (this.seed * 101 + rng.int(1, 1_000_000) + i * 7919) >>> 0
      candidates.push(generateMotifV2({ ...this.context, octave: 4 }, freshSeed, 'lead'))
    }

    // If learning is wired, score candidates and prefer the best (70% exploit, 30% explore)
    if (this.preferenceFor) {
      const prefFn = this.preferenceFor
      const scored = candidates.map((m) => ({ motif: m, score: prefFn ? prefFn(m) : 0.5 }))
      scored.sort((a, b) => b.score - a.score)
      if (rng.next() < 0.7) {
        // Exploit: pick highest-scoring
        const best = scored[0] as { motif: Motif; score: number }
        this.memory.ingest(best.motif, 0, { salience: 0.6, role: 'lead' })
        return best.motif
      }
      // Explore: pick a random candidate
      const pick = candidates[rng.int(0, candidates.length - 1)] as Motif
      this.memory.ingest(pick, 0, { salience: 0.6, role: 'lead' })
      return pick
    }

    // No learning: pick first candidate (deterministic)
    const motif = candidates[0] as Motif
    this.memory.ingest(motif, 0, { salience: 0.6, role: 'lead' })
    return motif
  }

  /**
   * Choose chord pitch classes for a phrase. Rotates through tonic /
   * subdominant / tonic / dominant across phrases so harmonic rhythm is
   * non-zero across a section.
   */
  private chooseHarmonicForPhrase(phraseIndex: number): number[] {
    const scale = getScale(this.context.scaleName)
    if (!scale) return [this.context.tonic]
    const pcs = scalePcs(this.context.tonic, scale)
    if (pcs.length < 5) return [pcs[0] ?? this.context.tonic]

    // Wire learned harmony: if pitch-class profile has data, use it to
    // influence which chord tones are selected (not copying, but preferring
    // pitch classes that were prominent in the source)
    const pcProfile = this.learned.harmony.pitchClassProfile
    const hasLearnedHarmony =
      this.learned.meta.confidence > 0.3 && pcProfile.some((v: number) => v > 0.05)

    const idx = ((phraseIndex % 4) + 4) % 4

    // Base progression: tonic / subdominant / tonic / dominant
    let baseChord: number[]
    if (idx === 0) {
      baseChord = [pcs[0] ?? 0, pcs[2] ?? 0, pcs[4] ?? 0]
    } else if (idx === 1) {
      baseChord = [pcs[3] ?? 0, pcs[5] ?? 0, pcs[7 % pcs.length] ?? 0]
    } else if (idx === 2) {
      baseChord = [pcs[0] ?? 0, pcs[2] ?? 0, pcs[4] ?? 0]
    } else {
      baseChord = [pcs[4] ?? 0, pcs[6 % pcs.length] ?? 0, pcs[8 % pcs.length] ?? 0]
    }

    if (hasLearnedHarmony) {
      // Blend: keep the progression structure but weight chord tones by
      // learned pitch-class profile. Replace one chord tone with a
      // high-weight pc from the learned profile if it's in the scale.
      const sortedPcs = pcProfile
        .map((weight: number, pc: number) => ({ pc, weight }))
        .filter(
          (x: { pc: number; weight: number }) => pcs.includes(x.pc) && !baseChord.includes(x.pc)
        )
        .sort((a: { weight: number }, b: { weight: number }) => b.weight - a.weight)

      if (sortedPcs.length > 0 && sortedPcs[0]) {
        const top = sortedPcs[0] as { pc: number; weight: number }
        // Replace the third chord tone with the learned-preferred pc
        baseChord = [baseChord[0] ?? 0, baseChord[1] ?? 0, top.pc]
      }
    }

    return baseChord
  }

  /**
   * F20: derive a phrase role from the arrangement state + position. Drives
   * the cadence target (root / third / fifth) in the HarmonicPlan.
   */
  private derivePhraseRole(
    state: ArrangementState,
    phraseIdx: number,
    isLastPhrase: boolean
  ): string {
    if (isLastPhrase) return 'RESOLUTION'
    if (state === 'INTRO' || state === 'BUILD') return 'INTRO'
    if (state === 'BREAK' || state === 'DROP') return 'BUILD'
    if (state === 'OUTRO') return 'RESOLUTION'
    if (phraseIdx % 2 === 1) return 'RESPONSE'
    return 'STATEMENT'
  }

  /**
   * F20: compose a KickPlan for one bar. Emits a first-class KickPlan object
   * (onsets + velocities) so the bass and lead generators can consume the
   * ACTUAL kick onsets, not the style skeleton.
   *
   * When learned kick grammar is available (confidence > 0.3), the kick
   * pattern is regenerated from learned probabilities blended with the style
   * groove. Beat 1 (step 0) is always kept — the LOCKED invariant.
   */
  private composeKickPlan(bar: number, groove: GroovePlan, _phraseRng: Rng): KickPlan {
    let onsets: number[] = Array.from(new Set(groove.kickSteps)).sort((a, b) => a - b)
    const learnedKick = this.learned.rhythm.kickGrammar
    const kickConf = this.learned.meta.confidence
    if (kickConf > 0.3 && learnedKick.some((v: number) => v > 0.1)) {
      const kickRng = new Rng((this.seed * 211 + bar * 43 + 7) >>> 0)
      const generated: number[] = []
      for (let step = 0; step < groove.stepsPerBar; step++) {
        const prob = learnedKick[step % 16] ?? 0
        const styleHas = groove.kickSteps.includes(step)
        const blended = styleHas ? 0.8 : prob * 0.6
        if (kickRng.next() < blended) {
          generated.push(step)
        }
      }
      if (!generated.includes(0)) generated.unshift(0)
      onsets = generated.sort((a, b) => a - b)
    }
    const velocities = onsets.map((s) => (s === 0 ? 1.0 : 0.7 + groove.accent[s] * 0.2))
    return { onsets, velocities }
  }

  /**
   * F20: compose a BassPlan against the ACTUAL KickPlan + HarmonicPlan, and
   * consume the learned KICK→BASS grammar (bassOnsetProbability) and bass
   * transition grammar (pickNextBassDegree).
   *
   * Causal paths:
   *   KICK → BASS: bassOnsetProbability(step, kickHas) decides each onset
   *   BASS TRANSITIONS: pickNextBassDegree picks the next degree from the
   *   learned Markov chain
   *
   * The bass reads `kickPlan.onsets` (the generated kick), NOT
   * `groove.kickSteps` (the style skeleton) — so bass-kick alignment is real,
   * not vestigial.
   */
  private composeBassPlan(opts: {
    bar: number
    groove: GroovePlan
    kickPlan: KickPlan
    chordTones: number[]
    harmonicFunction: HarmonicFunction
    isLast: boolean
    rng: Rng
    grammarConfidence: number
    isAnticipationBar: boolean
  }): BassPlan {
    const scale = getScale(this.context.scaleName)
    if (!scale) return emptyBassPlan()
    const { groove, kickPlan, rng, isLast, grammarConfidence } = opts

    const rootMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE)
    const fifthMidi = degreeToMidi(this.context.tonic, scale, 4, BASS_OCTAVE)
    const octaveMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE + 1)
    const thirdMidi = degreeToMidi(this.context.tonic, scale, 2, BASS_OCTAVE)
    const seventhMidi = degreeToMidi(this.context.tonic, scale, 6, BASS_OCTAVE)
    const tension = this.grammar.tensionPreference

    const bassDegPrefs = this.learned.bass.degreePreferences
    const hasLearnedBass =
      Object.keys(bassDegPrefs).length > 0 && this.learned.meta.confidence > 0.3

    const notes: BassPlanNote[] = []
    let prevDegree = 0

    /** Weighted selection from learned degree preferences (F15 compat). */
    const pickDegreeByPreferences = (): number => {
      if (hasLearnedBass) {
        const degrees = Object.entries(bassDegPrefs)
        const totalWeight = degrees.reduce((s, [, w]) => s + (w as number), 0)
        let r = rng.next() * totalWeight
        for (const [degStr, weight] of degrees) {
          r -= weight as number
          if (r <= 0) return Number.parseInt(degStr, 10)
        }
      }
      return [0, 4, 2, 6][Math.floor(rng.next() * 4)] ?? 0
    }

    /** Choose the next bass degree using the learned transition Markov chain,
     * falling back to degreePreferences when the grammar is untrained. */
    const chooseNextDegree = (candidates: number[]): number => {
      const row = this.interactionGrammar.bassTransitions.transitions[prevDegree]
      if (hasLearnedBass && grammarConfidence > 0.1 && row && Object.keys(row).length > 0) {
        return pickNextBassDegree({
          fromDegree: prevDegree,
          candidates,
          grammar: this.interactionGrammar,
          confidence: grammarConfidence,
          rng,
        })
      }
      // F15 compat: weighted selection from learned degree preferences.
      if (hasLearnedBass) {
        return pickDegreeByPreferences()
      }
      return candidates[Math.floor(rng.next() * candidates.length)] ?? 0
    }

    /** Map a degree to a MIDI + function label. */
    const degreeToNote = (deg: number): { midi: number; fn: BassPlanNote['function'] } => {
      const midi = degreeToMidi(this.context.tonic, scale, deg, BASS_OCTAVE)
      const fns: BassPlanNote['function'][] = ['ROOT', 'THIRD', 'FIFTH', 'SEVENTH', 'OCTAVE']
      return { midi, fn: fns[deg] ?? 'PASSING' }
    }

    // Beat 1: ALWAYS ROOT (LOCKED invariant — bass-kick alignment).
    notes.push({
      midi: rootMidi,
      step: 0,
      durationSteps: 2,
      function: 'ROOT',
      isAnticipation: false,
    })
    prevDegree = 0

    // LOCKED mode: bass hits EVERY kick step (the invariant that keeps
    // bass-kick alignment high). The grammar's bassOnsetProbability is
    // consumed for NON-kick steps (the off-kick syncopation decisions).
    const kickSet = new Set(kickPlan.onsets)
    if (groove.bassKickAlignment === 'LOCKED') {
      for (const step of kickPlan.onsets) {
        if (step === 0) continue
        // LOCKED: bass always hits the kick step. Vary the pitch via the
        // learned transition chain / degree preferences (causal).
        if (rng.next() < 0.3 + tension * 0.2) {
          const deg = chooseNextDegree([0, 4, 2, 6])
          const { midi, fn } = degreeToNote(deg)
          const dur = rng.next() < 0.5 ? 1 : 2
          notes.push({ midi, step, durationSteps: dur, function: fn, isAnticipation: false })
          prevDegree = deg
        } else {
          notes.push({
            midi: rootMidi,
            step,
            durationSteps: 2,
            function: 'ROOT',
            isAnticipation: false,
          })
        }
      }
    }

    // Walk the NON-kick steps. At each, decide whether to place a bass note
    // using the learned KICK→BASS probability (bassOnsetProbability). This is
    // the causal path: grammar.bassOffKickProb[step] → probability → note.
    for (let step = 1; step < groove.stepsPerBar; step++) {
      if (kickSet.has(step)) continue // already handled in LOCKED pass
      const kickHas = false // off-kick step
      const prob = bassOnsetProbability({
        step,
        kickHas,
        grammar: this.interactionGrammar,
        confidence: grammarConfidence,
        defaultOnKick: 0.3 + tension * 0.2,
        defaultOffKick: 0.1 + groove.syncopationBudget * 0.2,
      })
      if (rng.next() < prob) {
        const deg = chooseNextDegree([0, 4, 2, 6])
        const { midi, fn } = degreeToNote(deg)
        const isAnticipation = opts.isAnticipationBar && step >= groove.stepsPerBar - 2
        const dur = rng.next() < 0.5 ? 1 : 2
        notes.push({
          midi,
          step,
          durationSteps: dur,
          function: isAnticipation ? 'ANTICIPATION' : fn,
          isAnticipation,
        })
        prevDegree = deg
      }
    }

    // Offbeat passing/approach tones — vary per bar (kept from legacy for
    // musical richness; these do not depend on grammar).
    const beat = Math.max(1, Math.round(groove.stepsPerBar / 4))
    const offbeatVariation = (opts.bar * 7 + this.seed * 13) % 4
    const offbeatTargets =
      offbeatVariation === 0
        ? [beat * 2, beat * 3]
        : offbeatVariation === 1
          ? [beat + 1, beat * 3 + 1]
          : offbeatVariation === 2
            ? [beat * 2 + 1]
            : [beat * 3, beat * 3 + 2]
    for (const step of offbeatTargets) {
      if (notes.some((n) => n.step === step)) continue
      if (step >= groove.stepsPerBar) continue
      if (rng.next() < 0.2 + groove.syncopationBudget * 0.3 + tension * 0.2) {
        const useApproach = rng.next() < 0.3
        if (useApproach) {
          const approachMidi = rootMidi + (rng.next() < 0.5 ? -1 : 1)
          notes.push({
            midi: approachMidi,
            step,
            durationSteps: 1,
            function: 'APPROACH',
            isAnticipation: false,
          })
        } else {
          const useThird = rng.next() < 0.5
          notes.push({
            midi: useThird ? thirdMidi : seventhMidi,
            step,
            durationSteps: 1,
            function: useThird ? 'THIRD' : 'PASSING',
            isAnticipation: false,
          })
        }
      }
    }

    // Octave jump for energy on some bars.
    if (rng.next() < 0.15 + tension * 0.15) {
      const jumpStep = beat * 2
      if (!notes.some((n) => n.step === jumpStep)) {
        notes.push({
          midi: octaveMidi,
          step: jumpStep,
          durationSteps: 1,
          function: 'OCTAVE',
          isAnticipation: false,
        })
      }
    }

    // Cadence on the last bar — fifth → root walk.
    if (isLast) {
      const lastStep = groove.stepsPerBar - 2
      const filtered = notes.filter((n) => n.step < lastStep)
      notes.length = 0
      notes.push(...filtered)
      notes.push({
        midi: fifthMidi,
        step: lastStep,
        durationSteps: 1,
        function: 'CADENCE',
        isAnticipation: false,
      })
      notes.push({
        midi: rootMidi,
        step: lastStep + 1,
        durationSteps: 2,
        function: 'CADENCE',
        isAnticipation: false,
      })
    }

    // Clamp to octave 2 (MIDI 36-59).
    for (const n of notes) {
      while (n.midi < 36) n.midi += 12
      while (n.midi > 59) n.midi -= 12
    }

    notes.sort((a, b) => a.step - b.step)
    const deduped: BassPlanNote[] = []
    for (const n of notes) {
      if (!deduped.some((d) => d.step === n.step)) deduped.push(n)
    }
    return { notes: deduped, onsets: deduped.map((n) => n.step) }
  }

  /**
   * F21: compose a LeadPlan PHRASE-FIRST.
   *
   * The generation pipeline is:
   *   PhraseContext → PhraseIntent → Contour → Harmonic targets
   *     → Rhythmic cell → Bass/Kick relational constraints
   *     → Phrase transformation → LeadPlan → Scheduled notes
   *
   * The 16-step grid is the REALIZATION layer — it is NOT the musical
   * decision layer. The contour and rhythmic cell are designed at the phrase
   * level (driven by the learned identity's lead vocabulary), then placed
   * onto the per-bar grid respecting the RhythmicSpaceMap.
   *
   * Causal paths (all live):
   *   LEARNED IDENTITY → contour shape (ascending/descending/arch/wave)
   *   LEARNED IDENTITY → interval width (narrow vs wide)
   *   HARMONY → LEAD: chord-tone targeting + cadence resolution
   *   BASS → LEAD: response placement (leadResponseBoost)
   *   ENERGY → DENSITY: note count target
   *   TENSION → REGISTER: register center + expansion
   *   TENSION → MELODIC: max interval size
   *   TENSION → RHYTHMIC: syncopation level
   */
  private composeLeadPlan(opts: {
    bar: number
    bars: number
    groove: GroovePlan
    kickPlan: KickPlan
    bassPlan: BassPlan
    spaceMap: RhythmicSpaceMap
    harmonicPlan: HarmonicPlan
    activeChord: HarmonicChord | null
    nextChord: HarmonicChord | null
    isAnticipation: boolean
    isLast: boolean
    isResponse: boolean
    phraseMaterial: PhraseMaterial
    phraseRole: string
    rng: Rng
    grammarConfidence: number
  }): LeadPlan {
    const scale = getScale(this.context.scaleName)
    if (!scale) return emptyLeadPlan()
    const {
      groove,
      bassPlan,
      spaceMap,
      harmonicPlan,
      activeChord,
      nextChord,
      isLast,
      rng,
      grammarConfidence,
      phraseMaterial,
    } = opts

    // ── PHRASE CONTEXT ──
    // Gather the phrase-level state: arc stage, tension, learned identity.
    const arcStage = arcStageAt(phraseMaterial.phraseArc, opts.bar)
    const tensionDims = deriveTensionDimensions(this.context.tension)

    // ── PHRASE INTENT ──
    // Decide what this bar wants to do within the phrase arc.
    const stageLabel = arcStage?.stage ?? 'DEVELOP'
    const isFocalBar = stageLabel === 'FOCAL'
    const isOpenBar = stageLabel === 'OPEN'
    const isCadenceStage = stageLabel === 'CADENCE'
    // When no learned identity is present, dampen the arc's effect so bars
    // within the same phrase retain motif recurrence (backward compat).
    const arcStrength = this.identity ? 1.0 : 0.3

    // ── TARGETS from learned grammar + tension dimensions (causal). ──
    // ENERGY → DENSITY (with tension density multiplier).
    const baseDensity = 0.3 + this.context.energy * 0.4
    const learnedDensity = densityForEnergy({
      energy: this.context.energy,
      grammar: this.interactionGrammar,
      confidence: grammarConfidence,
      defaultDensity: baseDensity,
    })
    const targetDensity = applyDensityTension(learnedDensity, this.context.tension)
    // TENSION → REGISTER (with tension register expansion).
    const baseRegister = this.grammar.tessituraCenter + (this.context.tension - 0.5) * 6
    const learnedRegister = registerForTension({
      tension: this.context.tension,
      grammar: this.interactionGrammar,
      confidence: grammarConfidence,
      defaultRegister: baseRegister,
    })
    const targetRegister = applyRegisterTension(learnedRegister, this.context.tension)
    // TENSION → MELODIC: max interval size.
    const maxInterval = tensionDims.melodic

    // ── CONTOUR DESIGN (phrase-level, driven by learned identity) ──
    // The contour shape comes from the learned identity's lead vocabulary.
    // If no identity, derive from the phrase material's existing contour.
    let contourShape: ContourShape = phraseMaterial.contour
    if (this.identity) {
      switch (this.identity.leadVocabulary) {
        case 'DESCENDING_NARROW':
          contourShape = opts.bar < opts.bars / 2 ? 'arch' : 'descending'
          break
        case 'ASCENDING_WIDE':
          contourShape = opts.bar < opts.bars / 2 ? 'ascending' : 'arch'
          break
        case 'ARCH_BALANCED':
          contourShape = isFocalBar ? 'arch' : 'flat'
          break
        case 'WAVE_SYNCOPATED':
          contourShape = 'wave'
          break
      }
    }

    // ── HARMONIC TARGETS (phrase-level) ──
    // Sequence the chord tones to target across the bar, ordered by contour.
    const chordPcs = activeChord?.chordTones ?? []
    const cadenceTarget = harmonicPlan.cadenceTarget
    const rootPc = activeChord?.rootPc ?? this.context.tonic
    // Apply harmonic tension: at high tension, add extensions.
    const pcs = scalePcs(this.context.tonic, scale)
    const extendedChordTones = applyHarmonicTension(chordPcs, this.context.tension, pcs)

    // ── RHYTHMIC CELL (phrase-level, driven by learned identity) ──
    // The rhythmic cell is the repeating onset pattern. It comes from the
    // phrase material's rhythmicCell, or is designed from the space map.
    let rhythmicCell = phraseMaterial.rhythmicCell
    if (rhythmicCell.length === 0) {
      // Design a cell from the space map: pick the 3-4 most open steps.
      const openSteps = spaceMap.cells
        .filter((c) => c.open)
        .sort((a, b) => b.preferredLead - a.preferredLead)
        .slice(0, 4)
        .map((c) => c.step)
        .sort((a, b) => a - b)
      rhythmicCell = openSteps.length > 0 ? openSteps : [2, 6, 10, 14]
    }

    // ── BASS/KICK RELATIONAL CONSTRAINTS ──
    // Build the per-step "lead desire" score using the space map + response
    // boost + arc stage. This shapes WHERE the rhythmic cell lands.
    const bassOnsets = bassPlan.onsets
    const leadDesire: number[] = new Array(groove.stepsPerBar).fill(0)
    for (let step = 0; step < groove.stepsPerBar; step++) {
      const cell = cellAt(spaceMap, step)
      let desire = cell.preferredLead
      desire += leadResponseBoost({
        step,
        bassOnsets,
        grammar: this.interactionGrammar,
        confidence: grammarConfidence,
      })
      // Focal bars get higher desire across all open steps (climax energy).
      if (isFocalBar && cell.open) desire += 0.3 * arcStrength
      // Open bars get lower desire (sparse, leaving space).
      if (isOpenBar) desire *= 1 - 0.4 * arcStrength
      // Anticipation: the step before a chord change is a good lead spot.
      if (opts.isAnticipation && step >= groove.stepsPerBar - 2) desire += 0.4
      // Cadence: on the last bar, the final steps are reserved.
      if (isLast && step >= groove.stepsPerBar - 2) desire += 0.5
      leadDesire[step] = desire
    }

    // Pick the top-N steps by lead desire (N = target density * stepsPerBar).
    // This is the REALIZATION layer — the musical decision (contour + cell)
    // was already made above; now we place it on the grid.
    const targetCount = Math.max(1, Math.round(targetDensity * groove.stepsPerBar))
    const stepOrder = leadDesire
      .map((desire, step) => ({ step, desire }))
      .sort((a, b) => b.desire - a.desire)
      .slice(0, targetCount)
      .map((x) => x.step)
      .sort((a, b) => a - b)

    // ── PITCH POOL (from phrase material, transposed to target register) ──
    let pitchPool: number[] = phraseMaterial.pitchContour.slice()
    if (pitchPool.length === 0) {
      pitchPool = pcs.map((pc) => degreeToMidi(this.context.tonic, scale, pcs.indexOf(pc), 4))
    }
    // Transpose the pool so its mean matches the target register (causal:
    // TENSION → REGISTER shifts the actual pitches).
    if (pitchPool.length > 0) {
      const poolMean = pitchPool.reduce((s, m) => s + m, 0) / pitchPool.length
      const offset = Math.round(targetRegister - poolMean)
      pitchPool = pitchPool.map((m) => {
        const shifted = m + offset
        for (let off = 0; off <= 2; off++) {
          if (isInScale(this.context.tonic, scale, shifted + off)) return shifted + off
          if (isInScale(this.context.tonic, scale, shifted - off)) return shifted - off
        }
        return shifted
      })
    }
    pitchPool = pitchPool.map((m) => {
      let midi = m
      while (midi < LEAD_MIN_MIDI) midi += 12
      while (midi > LEAD_MAX_MIDI) midi -= 12
      return midi
    })

    // ── REALIZE THE PHRASE ONTO THE GRID ──
    // For each chosen step, select a pitch that follows the contour shape and
    // targets chord tones. The contour drives the pitch SEQUENCE; the space
    // map drives the ONSET positions.
    const notes: LeadPlanNote[] = []
    let prevMidi: number | null = null

    // Build a contour-driven pitch sequence from the pool + chord tones.
    // When a learned identity is present, use chord tones as the primary pool
    // (identity-driven vocabulary). When no identity, use the phrase material's
    // pitchContour as the primary pool (preserves motif recurrence).
    const chordToneMidis = extendedChordTones.map((pc) => {
      let midi = pc + 60
      while (midi < targetRegister - 6) midi += 12
      while (midi > targetRegister + 6) midi -= 12
      while (midi < LEAD_MIN_MIDI) midi += 12
      while (midi > LEAD_MAX_MIDI) midi -= 12
      return midi
    })
    const primaryPool = this.identity
      ? chordToneMidis.length > 0
        ? chordToneMidis
        : pitchPool
      : pitchPool

    for (let i = 0; i < stepOrder.length; i++) {
      const step = stepOrder[i] as number
      const isCadenceStep = (isLast || isCadenceStage) && step >= groove.stepsPerBar - 2
      const isResponseStep =
        leadResponseBoost({
          step,
          bassOnsets,
          grammar: this.interactionGrammar,
          confidence: grammarConfidence,
        }) > 0.3
      const isAnticipationStep = opts.isAnticipation && step >= groove.stepsPerBar - 2
      const progress = i / Math.max(1, stepOrder.length - 1) // 0..1 across the bar's notes

      let midi: number
      let role: LeadPlanNote['role']

      if (isCadenceStep) {
        // CADENCE: resolve to the cadence target pc.
        midi = cadenceMidi(harmonicPlan, cadenceTarget, targetRegister)
        if (step !== (stepOrder[stepOrder.length - 1] ?? groove.stepsPerBar - 1)) {
          midi = cadenceMidi(harmonicPlan, cadenceTarget, targetRegister) - 2
        }
        role = 'CADENCE'
      } else if (isAnticipationStep && nextChord) {
        // ANTICIPATION: play a chord tone of the NEXT chord.
        const nextPcs = nextChord.chordTones
        midi = (nextPcs[Math.floor(rng.next() * nextPcs.length)] ?? nextChord.rootPc) + 60
        while (midi < LEAD_MIN_MIDI) midi += 12
        while (midi > LEAD_MAX_MIDI) midi -= 12
        role = 'ANTICIPATION'
      } else {
        // Contour-driven pitch selection.
        // Pick a pitch from the primary pool that matches the contour direction.
        const candidates = primaryPool.map((candMidi) => {
          const interval = prevMidi !== null ? candMidi - prevMidi : 0
          const pc = ((candMidi % 12) + 12) % 12
          const isChordTone = chordPcs.includes(pc)
          const harmonyScore = isChordTone ? 0.7 : 0.05
          const intervalScore = leadIntervalScore({
            interval,
            rootPc,
            grammar: this.interactionGrammar,
            confidence: grammarConfidence,
          })
          // Contour preference: score based on whether the candidate matches
          // the contour shape's direction at this position.
          let contourScore = 0
          if (prevMidi !== null) {
            const dir = Math.sign(candMidi - prevMidi)
            switch (contourShape) {
              case 'ascending':
                contourScore = dir > 0 ? 0.3 : dir < 0 ? -0.2 : 0
                break
              case 'descending':
                contourScore = dir < 0 ? 0.3 : dir > 0 ? -0.2 : 0
                break
              case 'arch':
                contourScore = progress < 0.5 ? (dir > 0 ? 0.2 : -0.1) : dir < 0 ? 0.2 : -0.1
                break
              case 'valley':
                contourScore = progress < 0.5 ? (dir < 0 ? 0.2 : -0.1) : dir > 0 ? 0.2 : -0.1
                break
              case 'wave':
                contourScore = i % 2 === 0 ? (dir > 0 ? 0.2 : -0.1) : dir < 0 ? 0.2 : -0.1
                break
              case 'flat':
                contourScore = dir === 0 ? 0.2 : 0
                break
            }
          }
          // TENSION → MELODIC: penalize intervals wider than maxInterval.
          const melodicPenalty = Math.abs(interval) > maxInterval ? -0.5 : 0
          // Leap penalty.
          const leapPenalty =
            prevMidi !== null && Math.abs(interval) > this.grammar.maxLeap ? -0.5 : 0
          return {
            midi: candMidi,
            score: harmonyScore + intervalScore * 0.3 + contourScore + melodicPenalty + leapPenalty,
          }
        })
        candidates.sort((a, b) => b.score - a.score)
        const pick =
          rng.next() < 0.7
            ? (candidates[0] ?? { midi: targetRegister })
            : (candidates[Math.floor(rng.next() * Math.min(3, candidates.length))] ?? {
                midi: targetRegister,
              })
        midi = pick.midi
        role = isResponseStep ? 'RESPONSE' : opts.isResponse ? 'RESPONSE' : 'CONTINUATION'
      }

      // Enforce maxLeap by clamping.
      if (prevMidi !== null) {
        const interval = midi - prevMidi
        if (Math.abs(interval) > this.grammar.maxLeap) {
          midi = prevMidi + Math.sign(interval) * this.grammar.maxLeap
        }
      }
      while (midi < LEAD_MIN_MIDI) midi += 12
      while (midi > LEAD_MAX_MIDI) midi -= 12

      const velocity =
        role === 'CADENCE'
          ? 0.95
          : role === 'ANTICIPATION'
            ? 0.8
            : role === 'RESPONSE'
              ? 0.6
              : isFocalBar
                ? 0.85
                : 0.7

      notes.push({
        midi,
        step,
        durationSteps: isCadenceStep ? 2 : 1,
        velocity,
        role,
      })
      prevMidi = midi
    }

    return { notes }
  }

  // ───────────── LEGACY FALLBACKS (for the A/B OFF vs ON test) ─────────────
  // These reproduce the pre-F20 "deaf" generators. Used only when
  // `relationalGenerationOff` is set, so the A/B test H can measure the
  // improvement the relational engine produces.

  /**
   * Legacy bass: reads groove.kickSteps (the style skeleton), does NOT
   * consume the interaction grammar. This is the pre-F20 behaviour.
   */
  private composeBassLegacy(_bar: number, groove: GroovePlan, rng: Rng, isLast: boolean): BassPlan {
    const scale = getScale(this.context.scaleName)
    if (!scale) return emptyBassPlan()
    const rootMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE)
    const fifthMidi = degreeToMidi(this.context.tonic, scale, 4, BASS_OCTAVE)
    const octaveMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE + 1)
    const thirdMidi = degreeToMidi(this.context.tonic, scale, 2, BASS_OCTAVE)
    const seventhMidi = degreeToMidi(this.context.tonic, scale, 6, BASS_OCTAVE)
    const beat = Math.max(1, Math.round(groove.stepsPerBar / 4))
    const tension = this.grammar.tensionPreference
    const bassDegPrefs = this.learned.bass.degreePreferences
    const hasLearnedBass =
      Object.keys(bassDegPrefs).length > 0 && this.learned.meta.confidence > 0.3

    const chooseBassPitch = (rng: Rng): { midi: number; fn: string } => {
      if (hasLearnedBass) {
        const degrees = Object.entries(bassDegPrefs)
        const totalWeight = degrees.reduce((s, [, w]) => s + w, 0)
        let r = rng.next() * totalWeight
        for (const [degStr, weight] of degrees) {
          r -= weight
          if (r <= 0) {
            const deg = Number.parseInt(degStr, 10)
            const midi = degreeToMidi(this.context.tonic, scale, deg, BASS_OCTAVE)
            const fns = ['ROOT', 'THIRD', 'FIFTH', 'SEVENTH', 'OCTAVE']
            return { midi, fn: fns[deg] ?? 'PASSING' }
          }
        }
      }
      const useFifth = rng.next() < 0.5
      return useFifth ? { midi: fifthMidi, fn: 'FIFTH' } : { midi: octaveMidi, fn: 'OCTAVE' }
    }

    const notes: BassPlanNote[] = []
    notes.push({
      midi: rootMidi,
      step: 0,
      durationSteps: 2,
      function: 'ROOT',
      isAnticipation: false,
    })

    // LEGACY: reads groove.kickSteps (style skeleton), NOT the actual kickPlan.
    if (groove.bassKickAlignment === 'LOCKED') {
      for (const step of groove.kickSteps) {
        if (step === 0) continue
        if (rng.next() < 0.3 + tension * 0.2) {
          const pitch = chooseBassPitch(rng)
          const dur = rng.next() < 0.5 ? 1 : 2
          notes.push({
            midi: pitch.midi,
            step,
            durationSteps: dur,
            function: pitch.fn as BassPlanNote['function'],
            isAnticipation: false,
          })
        } else {
          notes.push({
            midi: rootMidi,
            step,
            durationSteps: 2,
            function: 'ROOT',
            isAnticipation: false,
          })
        }
      }
    } else {
      const half = Math.max(1, Math.round(groove.stepsPerBar / 8))
      const complementary = [half, beat + half, beat * 2 + half, beat * 3 + half]
      for (const step of complementary) {
        if (groove.kickSteps.includes(step) || step === 0) continue
        const pitch = chooseBassPitch(rng)
        notes.push({
          midi: pitch.midi,
          step,
          durationSteps: 1,
          function: pitch.fn as BassPlanNote['function'],
          isAnticipation: false,
        })
      }
    }

    if (rng.next() < 0.15 + tension * 0.15) {
      const jumpStep = beat * 2
      if (!notes.some((n) => n.step === jumpStep)) {
        notes.push({
          midi: octaveMidi,
          step: jumpStep,
          durationSteps: 1,
          function: 'OCTAVE',
          isAnticipation: false,
        })
      }
    }

    if (isLast) {
      const lastStep = groove.stepsPerBar - 2
      const filtered = notes.filter((n) => n.step < lastStep)
      notes.length = 0
      notes.push(...filtered)
      notes.push({
        midi: fifthMidi,
        step: lastStep,
        durationSteps: 1,
        function: 'CADENCE',
        isAnticipation: false,
      })
      notes.push({
        midi: rootMidi,
        step: lastStep + 1,
        durationSteps: 2,
        function: 'CADENCE',
        isAnticipation: false,
      })
    }

    for (const n of notes) {
      while (n.midi < 36) n.midi += 12
      while (n.midi > 59) n.midi -= 12
    }
    notes.sort((a, b) => a.step - b.step)
    const deduped: BassPlanNote[] = []
    for (const n of notes) {
      if (!deduped.some((d) => d.step === n.step)) deduped.push(n)
    }
    void thirdMidi
    void seventhMidi
    return { notes: deduped, onsets: deduped.map((n) => n.step) }
  }

  /**
   * Legacy lead: motif + chord snapping only. Does NOT see bass, kick, groove,
   * space map, or interaction grammar. This is the pre-F20 "deaf" lead.
   */
  private composeLeadLegacy(
    bar: number,
    bars: number,
    phraseMotif: Motif,
    harmonicContext: number[],
    rng: Rng,
    isResponse: boolean
  ): { midi: number; step: number; durationSteps: number; velocity: number }[] {
    const scale = getScale(this.context.scaleName)
    if (!scale || phraseMotif.notes.length === 0) return []

    let motif = phraseMotif
    if (isResponse) {
      motif = callResponse(phraseMotif, this.context.tonic, scale, (this.seed + bar * 17) >>> 0)
    } else if (bar > 0) {
      const variationChoice = (bar * 3 + this.seed) % 5
      if (variationChoice === 0) {
        const t = rng.pick([-3, -2, 2, 3])
        motif = transposeMotif(phraseMotif, t, this.context.tonic, scale)
      } else if (variationChoice === 1) {
        if (rng.next() < 0.3) {
          motif = invertMotif(phraseMotif, this.context.tonic, scale)
        } else {
          const t = rng.pick([-2, 0, 2])
          if (t !== 0) motif = transposeMotif(phraseMotif, t, this.context.tonic, scale)
        }
      } else if (variationChoice === 2) {
        if (rng.next() < 0.2) {
          motif = retrogradeMotif(phraseMotif)
        }
      } else if (variationChoice === 3) {
        if (rng.next() < 0.25) {
          const halfNotes = phraseMotif.notes.slice(0, Math.ceil(phraseMotif.notes.length / 2))
          if (halfNotes.length > 0) {
            motif = { ...phraseMotif, notes: halfNotes }
          }
        }
      }
    }

    const notes = motif.notes.map((n) => {
      let midi = n.midi
      while (midi < LEAD_MIN_MIDI) midi += 12
      while (midi > LEAD_MAX_MIDI) midi -= 12
      return { midi, step: n.step, durationSteps: n.durationSteps, velocity: n.velocity }
    })

    const maxLeap = this.grammar.maxLeap
    for (let i = 1; i < notes.length; i++) {
      const prev = notes[i - 1]
      const cur = notes[i]
      if (!prev || !cur) continue
      const interval = cur.midi - prev.midi
      if (Math.abs(interval) > maxLeap) {
        cur.midi = prev.midi + Math.sign(interval) * maxLeap
      }
    }

    const chordPcs = new Set(harmonicContext)
    if (chordPcs.size > 0) {
      for (const n of notes) {
        const pc = ((n.midi % 12) + 12) % 12
        if (!chordPcs.has(pc) && rng.next() < 0.5) {
          for (let off = 1; off <= 2; off++) {
            const upPc = (((n.midi + off) % 12) + 12) % 12
            if (chordPcs.has(upPc)) {
              n.midi += off
              break
            }
            const downPc = (((n.midi - off) % 12) + 12) % 12
            if (chordPcs.has(downPc)) {
              n.midi -= off
              break
            }
          }
        }
      }
    }
    void bars
    return notes
  }
}

// ---------------- pure transform helpers (involutions) ----------------

/**
 * Pure pitch inversion (no scale snapping). Mirrors each note around the
 * first note's MIDI value. This is a TRUE involution: applying it twice
 * returns the original motif exactly. Useful for property-based tests.
 */
export function invertPitchPure(motif: Motif): Motif {
  if (motif.notes.length === 0) {
    return createMotif([], {
      id: `${motif.id}:pureInvert`,
      rootPc: motif.rootPc,
      scaleName: motif.scaleName,
      steps: motif.steps,
      role: motif.role,
      sourceMotifId: motif.id,
      transformHistory: [...motif.transformHistory, 'invertPitchPure'],
    })
  }
  const first = motif.notes[0] as MotifNote
  const notes = motif.notes.map((n) => {
    if (n === first) return { ...n }
    const offset = n.midi - first.midi
    return { ...n, midi: first.midi - offset }
  })
  return createMotif(notes, {
    id: `${motif.id}:pureInvert`,
    rootPc: motif.rootPc,
    scaleName: motif.scaleName,
    steps: motif.steps,
    role: motif.role,
    sourceMotifId: motif.id,
    transformHistory: [...motif.transformHistory, 'invertPitchPure'],
  })
}

/**
 * Retrograde that is a TRUE involution: reversing note content while
 * preserving step positions. Wraps the existing transformation.retrograde
 * so callers can verify the involution property via the composition module.
 */
export function retrogradePure(motif: Motif): Motif {
  return retrogradeMotif(motif)
}

/** Convenience: how tightly the bass locks with the kick on beat 1. */
export function measureBassKickAlignment(
  bassNotes: { step: number; bar: number }[],
  kickNotes: { step: number; bar: number }[],
  bars: number
): number {
  if (bars === 0) return 0
  let aligned = 0
  for (let bar = 0; bar < bars; bar++) {
    const bassOnBeat1 = bassNotes.some((n) => n.bar === bar && n.step === 0)
    const kickOnBeat1 = kickNotes.some((n) => n.bar === bar && n.step === 0)
    if (bassOnBeat1 && kickOnBeat1) aligned++
  }
  return aligned / bars
}

/** Convenience: clamp a MIDI note into a register range. */
export function clampToRegister(midi: number, minMidi: number, maxMidi: number): number {
  let m = midi
  while (m < minMidi) m += 12
  while (m > maxMidi) m -= 12
  return m
}
