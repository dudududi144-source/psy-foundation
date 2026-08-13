/**
 * FoundationMusicAdapter — the SINGLE integration boundary between
 * psy-foundation (WHAT) and psy4 (WHEN/HOW).
 *
 * RESPONSIBILITIES:
 * - Translate foundation ComposedSection → psy4 PerformanceEvents
 * - Convert beat-grid coordinates → AudioContext time
 * - Apply AdaptedCompositionIntent to cached events
 * - Never compose, never change harmony, never invent notes
 *
 * FLOW:
 *   Foundation CompositionEngine → ComposedSection
 *   → FoundationMusicAdapter.adaptSection()
 *   → PerformanceEvent[]
 *   → psy4 Scheduler (schedules to AudioContext)
 */

import type { ComposedSection, ComposedBar } from '@/foundation/music'
import type { AdaptedCompositionIntent } from '@/foundation/music'
import type { RadioMusicalContext } from '@/foundation/music'
import { buildOpportunityMap, type OpportunityMap } from '@/foundation/music'

// ── psy4 Performance types ──

export type InstrumentRole = 'kick' | 'bass' | 'lead' | 'hats' | 'texture'

export interface PerformanceEvent {
  /** AudioContext.currentTime when this event should sound */
  audioTime: number
  /** Which instrument role */
  role: InstrumentRole
  /** MIDI note number (0 for percussion) */
  pitch: number
  /** Duration in seconds */
  duration: number
  /** 0..1 velocity */
  velocity: number
  /** Which bus to route to */
  bus: string
  /** Articulation hint */
  articulation: 'pluck' | 'sustain' | 'hit' | 'filter-sweep'
  /** FX send levels */
  sends: { delay: number; reverb: number }
  /** Provenance — which bar/step/motif this came from */
  provenance: { bar: number; step: number; function?: string; arrangementState: string }
}

export interface AdaptedSection {
  events: PerformanceEvent[]
  bars: number
  arrangementStates: string[]
  activeRoles: Set<InstrumentRole>
}

// ── The Adapter ──

export class FoundationMusicAdapter {
  private cachedSection: ComposedSection | null = null
  private cachedEvents: PerformanceEvent[] = []
  private cachedBar: number = -1

  /**
   * Convert a foundation ComposedSection into psy4 PerformanceEvents.
   * This is the ONLY place foundation musical content enters psy4.
   */
  adaptSection(
    section: ComposedSection,
    transportSnapshot: { bpm: number; beatDuration: number; beatTime: number; beatIndex: number },
    intent?: AdaptedCompositionIntent,
  ): AdaptedSection {
    const events: PerformanceEvent[] = []
    const activeRoles = new Set<InstrumentRole>()
    const arrangementStates: string[] = []
    const { bpm, beatDuration, beatTime, beatIndex: currentBeatIndex } = transportSnapshot

    for (const bar of section.bars) {
      arrangementStates.push(bar.arrangementState)
      const barBeatIndex = bar.barIndex * bar.groove.stepsPerBar / 4 // approx
      const barAudioTime = beatTime + (barBeatIndex - currentBeatIndex) * beatDuration
      const stepDuration = beatDuration / 4 // 16th note

      // Apply intent pressures
      const groovePressure = intent?.groovePressure ?? 1
      const bassPressure = intent?.bassPressure ?? 1
      const leadPressure = intent?.leadPressure ?? 1
      const restPressure = intent?.restPressure ?? 0
      const registerShift = intent?.registerShift ?? 0

      // ── Kick events ──
      if (bar.roles.kick && groovePressure > 0.3) {
        activeRoles.add('kick')
        for (const step of bar.kickNotes) {
          const audioTime = barAudioTime + step * stepDuration
          if (audioTime < 0) continue // skip past events
          events.push({
            audioTime,
            role: 'kick',
            pitch: 36, // C2
            duration: 0.15,
            velocity: 0.9 * groovePressure,
            bus: 'kick',
            articulation: 'hit',
            sends: { delay: 0, reverb: 0.1 },
            provenance: { bar: bar.barIndex, step, arrangementState: bar.arrangementState },
          })
        }
      }

      // ── Bass events ──
      if (bar.roles.bass && bassPressure > 0.2) {
        activeRoles.add('bass')
        for (const note of bar.bassNotes) {
          const audioTime = barAudioTime + note.step * stepDuration
          if (audioTime < 0) continue
          events.push({
            audioTime,
            role: 'bass',
            pitch: note.midi,
            duration: note.durationSteps * stepDuration,
            velocity: 0.7 * bassPressure,
            bus: 'bass',
            articulation: note.function === 'CADENCE' ? 'pluck' : 'sustain',
            sends: { delay: 0.1, reverb: 0.05 },
            provenance: {
              bar: bar.barIndex,
              step: note.step,
              function: note.function,
              arrangementState: bar.arrangementState,
            },
          })
        }
      }

      // ── Lead events ──
      if (bar.roles.lead && leadPressure > 0.2) {
        activeRoles.add('lead')
        for (const note of bar.leadNotes) {
          const audioTime = barAudioTime + note.step * stepDuration
          if (audioTime < 0) continue
          events.push({
            audioTime,
            role: 'lead',
            pitch: note.midi + registerShift * 12,
            duration: note.durationSteps * stepDuration,
            velocity: note.velocity * leadPressure,
            bus: 'lead',
            articulation: 'filter-sweep',
            sends: { delay: 0.2, reverb: 0.3 },
            provenance: { bar: bar.barIndex, step: note.step, arrangementState: bar.arrangementState },
          })
        }
      }

      // ── Hat events ──
      if (bar.roles.hats && groovePressure > 0.3) {
        activeRoles.add('hats')
        for (const step of bar.hatNotes) {
          const audioTime = barAudioTime + step * stepDuration
          if (audioTime < 0) continue
          events.push({
            audioTime,
            role: 'hats',
            pitch: 42, // closed hat
            duration: 0.05,
            velocity: 0.4 * groovePressure,
            bus: 'perc',
            articulation: 'hit',
            sends: { delay: 0.05, reverb: 0.1 },
            provenance: { bar: bar.barIndex, step, arrangementState: bar.arrangementState },
          })
        }
      }
    }

    // Sort by audio time
    events.sort((a, b) => a.audioTime - b.audioTime)

    // Apply rest pressure — if high, reduce events (intelligent abstention)
    if (restPressure > 0.5) {
      const keepRatio = 1 - restPressure * 0.5
      const keepCount = Math.floor(events.length * keepRatio)
      events.length = keepCount
    }

    this.cachedSection = section
    this.cachedEvents = events

    return { events, bars: section.bars.length, arrangementStates, activeRoles }
  }

  /** Get cached events (for scheduler to consume without recomposing) */
  getCachedEvents(): PerformanceEvent[] {
    return this.cachedEvents
  }

  /** Check if recomposition is needed */
  needsRecomposition(currentBar: number, phraseBoundary: number): boolean {
    return currentBar >= this.cachedBar + phraseBoundary
  }

  /** Update cached bar */
  updateCachedBar(bar: number): void {
    this.cachedBar = bar
  }

  /** Clear cache */
  clearCache(): void {
    this.cachedSection = null
    this.cachedEvents = []
    this.cachedBar = -1
  }
}

// ── Radio context builder (from psy4 radio analyser data) ──

export function buildRadioMusicalContext(radioData: {
  bpm: number
  bpmConfidence: number
  key: number
  scale: string
  keyConfidence: number
  energy: number
  density: number
  occupancy: { kick: number; bass: number; lead: number; percussion: number; harmonic: number }
  style: string
  styleConfidence: number
  syncopation: number
  available: boolean
  timestamp: number
}): RadioMusicalContext {
  return {
    bpm: radioData.bpm,
    bpmConfidence: radioData.bpmConfidence,
    key: radioData.key,
    scale: radioData.scale,
    keyConfidence: radioData.keyConfidence,
    energy: radioData.energy,
    density: radioData.density,
    energyConfidence: radioData.bpmConfidence,
    kickOccupancy: radioData.occupancy.kick,
    bassOccupancy: radioData.occupancy.bass,
    percussionOccupancy: radioData.occupancy.percussion,
    leadOccupancy: radioData.occupancy.lead,
    harmonicOccupancy: radioData.occupancy.harmonic,
    pitchVocabulary: [],
    rhythmicVocabulary: [],
    grooveSignature: '',
    syncopation: radioData.syncopation,
    style: radioData.style,
    styleConfidence: radioData.styleConfidence,
    phrasePosition: 0,
    sectionLikelihood: '',
    confidence: radioData.bpmConfidence,
    timestamp: radioData.timestamp,
    available: radioData.available,
  }
}

export { buildOpportunityMap, type OpportunityMap }
