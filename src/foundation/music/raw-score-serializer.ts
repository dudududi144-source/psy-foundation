/**
 * RawScore Serializer (EXPERIMENTAL — Vertical Proof Freeze)
 *
 * This module is a READ-ONLY serializer. It does NOT modify CompositionEngine,
 * does NOT add fields, does NOT delete DEAD fields, and does NOT change any
 * existing types. It only reads the existing ComposedSection and produces a
 * deterministic JSON representation containing ONLY the REQUIRED musical
 * fields specified in the Vertical-Proof Freeze Instruction.
 *
 * DEAD/REDUNDANT fields (timbreIntent, synthRecipes, soundDNA, spaceMap,
 * kickPlan, bassPlan, leadPlan, harmonicPlan, activeChord, phraseArc on
 * ComposedPhrase, GroovePlan pocket fields, etc.) are EXCLUDED from this
 * experimental serialization. They remain in Foundation's source unchanged.
 *
 * swing and microtiming are EXPERIMENTAL/UNPROVEN — they are INCLUDED in the
 * RawScore so PSY4 can test whether it needs them, but their inclusion does
 * NOT constitute a contract commitment. They are flagged with `_experimental`
 * so PSY4 knows they are provisional.
 *
 * Determinism: same ComposedSection → same RawScore JSON, always. No Math.random,
 * no Date.now, no iteration-order dependence. Arrays are serialized in their
 * natural order.
 */

import type { ComposedSection } from './composition-engine.ts'

// ── RawScore Types (experimental — derived from existing ComposedSection) ──

export interface RawScore {
  bars: RawBar[]
  phrases: RawPhrase[]
  groove: RawGroove
  arrangement: RawArrangement
}

export interface RawBar {
  barIndex: number
  arrangementState: string
  roles: {
    kick: boolean
    bass: boolean
    lead: boolean
    hats: boolean
    percussion: boolean
    fills: boolean
    texture: boolean
  }
  kickNotes: number[]
  bassNotes: {
    midi: number
    step: number
    durationSteps: number
    function: string
  }[]
  leadNotes: {
    midi: number
    step: number
    durationSteps: number
    velocity: number
  }[]
  hatNotes: number[]
  harmonicContext: number[]
}

export interface RawPhrase {
  motifIds: string[]
  callbackTo?: string
  phraseMaterial?: RawPhraseMaterial
  developmentOperator?: string
}

export interface RawPhraseMaterial {
  motifId: string
  pitchContour: number[]
  intervalSequence: number[]
  rhythmPattern: number[]
  accentPattern: number[]
  noteDurations: number[]
  registerProfile: number
  harmonicTargets: number[]
  stepsPerBar: number
  transformHistory: string[]
  rhythmicCell: number[]
  contour: string
  cadenceTarget: number | null
  phraseArc: {
    stages: {
      stage: string
      barRange: [number, number]
      density: number
      register: number
      tension: number
    }[]
    focalBar: number
    cadenceBar: number
    tensionTrajectory: number[]
  }
}

export interface RawGroove {
  stepsPerBar: number
  bassKickAlignment: string
  accentSteps: number[]
  syncopationBudget: number
  fillBars: number[]
  accent: number[]
  // EXPERIMENTAL — included for PSY4 to test. NOT a contract commitment.
  _experimental?: {
    swing: number
    microtiming: number[]
    kickSteps: number[]
    hatSteps: number[]
  }
}

export interface RawArrangement {
  bars: number
  slots: {
    barIndex: number
    state: string
    roles: {
      kick: boolean
      bass: boolean
      lead: boolean
      hats: boolean
      percussion: boolean
      fills: boolean
      texture: boolean
    }
    density: number
    energy: number
  }[]
}

// ── Serializer ──

/**
 * Serialize an existing ComposedSection into an experimental RawScore.
 *
 * This function is PURE and READ-ONLY. It does not modify the input.
 * It extracts ONLY the REQUIRED fields specified in the Vertical-Proof
 * Freeze Instruction. DEAD/REDUNDANT fields are excluded.
 *
 * Determinism: same input → same output, always.
 */
export function serializeRawScore(section: ComposedSection): RawScore {
  return {
    bars: section.bars.map(serializeBar),
    phrases: section.phrases.map(serializePhrase),
    groove: serializeGroove(section.groove),
    arrangement: serializeArrangement(section.arrangement),
  }
}

function serializeBar(bar: ComposedSection['bars'][number]): RawBar {
  return {
    barIndex: bar.barIndex,
    arrangementState: bar.arrangementState,
    roles: { ...bar.roles },
    kickNotes: bar.kickNotes.slice(),
    bassNotes: bar.bassNotes.map((n) => ({
      midi: n.midi,
      step: n.step,
      durationSteps: n.durationSteps,
      function: n.function,
    })),
    leadNotes: bar.leadNotes.map((n) => ({
      midi: n.midi,
      step: n.step,
      durationSteps: n.durationSteps,
      velocity: n.velocity,
    })),
    hatNotes: bar.hatNotes.slice(),
    harmonicContext: bar.harmonicContext.slice(),
  }
}

function serializePhrase(phrase: ComposedSection['phrases'][number]): RawPhrase {
  const result: RawPhrase = {
    motifIds: phrase.motifIds.slice(),
  }
  if (phrase.callbackTo !== undefined) {
    result.callbackTo = phrase.callbackTo
  }
  if (phrase.developmentOperator !== undefined) {
    result.developmentOperator = phrase.developmentOperator
  }
  if (phrase.phraseMaterial) {
    result.phraseMaterial = serializePhraseMaterial(phrase.phraseMaterial)
  }
  return result
}

function serializePhraseMaterial(
  pm: NonNullable<ComposedSection['phrases'][number]['phraseMaterial']>
): RawPhraseMaterial {
  return {
    motifId: pm.motifId,
    pitchContour: pm.pitchContour.slice(),
    intervalSequence: pm.intervalSequence.slice(),
    rhythmPattern: pm.rhythmPattern.slice(),
    accentPattern: pm.accentPattern.slice(),
    noteDurations: pm.noteDurations.slice(),
    registerProfile: pm.registerProfile,
    harmonicTargets: pm.harmonicTargets.slice(),
    stepsPerBar: pm.stepsPerBar,
    transformHistory: pm.transformHistory.slice(),
    rhythmicCell: pm.rhythmicCell.slice(),
    contour: pm.contour,
    cadenceTarget: pm.cadenceTarget,
    phraseArc: {
      stages: pm.phraseArc.stages.map((s) => ({
        stage: s.stage,
        barRange: [s.barRange[0], s.barRange[1]] as [number, number],
        density: s.density,
        register: s.register,
        tension: s.tension,
      })),
      focalBar: pm.phraseArc.focalBar,
      cadenceBar: pm.phraseArc.cadenceBar,
      tensionTrajectory: pm.phraseArc.tensionTrajectory.slice(),
    },
  }
}

function serializeGroove(groove: ComposedSection['groove']): RawGroove {
  return {
    stepsPerBar: groove.stepsPerBar,
    bassKickAlignment: groove.bassKickAlignment,
    accentSteps: groove.accentSteps.slice(),
    syncopationBudget: groove.syncopationBudget,
    fillBars: groove.fillBars.slice(),
    accent: groove.accent.slice(),
    // EXPERIMENTAL — included for PSY4 to test. NOT a contract commitment.
    _experimental: {
      swing: groove.swing,
      microtiming: groove.microtiming.slice(),
      kickSteps: groove.kickSteps.slice(),
      hatSteps: groove.hatSteps.slice(),
    },
  }
}

function serializeArrangement(arr: ComposedSection['arrangement']): RawArrangement {
  return {
    bars: arr.bars,
    slots: arr.slots.map((s) => ({
      barIndex: s.barIndex,
      state: s.state,
      roles: { ...s.roles },
      density: s.density,
      energy: s.energy,
    })),
  }
}

/**
 * Serialize a ComposedSection to a deterministic JSON string.
 *
 * Same input → same JSON string, always. Suitable for writing to a file
 * for PSY4 to consume.
 */
export function serializeRawScoreJSON(section: ComposedSection): string {
  return JSON.stringify(serializeRawScore(section), null, 2)
}
