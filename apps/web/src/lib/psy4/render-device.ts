/**
 * RenderDevice — PsyDevice consumer that renders NoteEvents to stereo PCM.
 *
 * This is the bridge between the PSY family (PSYSTAR, PSY6, psy4) and
 * the psy-foundation render engine. It receives NoteEvents via the
 * PsyDevice contract and produces WAV + AudioCritic analysis.
 *
 * Architecture:
 *   Host (PSYSTAR/PSY6) → NoteEvents → RenderDevice → renderFoundationSection → WAV + critique
 *
 * Usage:
 *   const device = createRenderDevice({ sampleRate: 44100 })
 *   device.onEvent(noteEvent)  // accumulate events
 *   const result = device.render()  // produce WAV
 */

import { type AudioCritique, critiqueAudio } from './audio-critic'
import {
  DEFAULT_RENDER_CONFIG,
  type RenderConfig,
  type RenderResult,
  encodeWav,
  renderFoundationSection,
} from './forensic-bridge'
import type {
  DeviceCapabilities,
  MusicalContext,
  MusicalEvent,
  NoteEvent,
  PsyDevice,
} from './foundation-shim'
import type { MusicalTransport } from './foundation-shim'

export interface RenderDeviceOptions {
  sampleRate?: number
  config?: Partial<RenderConfig>
  useSamples?: boolean
  bpm?: number
}

export interface RenderDeviceResult {
  wav: ArrayBuffer
  render: RenderResult
  critique: AudioCritique
}

export class RenderDevice implements PsyDevice {
  id = 'psy-foundation-render'
  private events: NoteEvent[] = []
  private bpm: number
  private config: RenderConfig
  private useSamples: boolean
  private ctx: MusicalContext | null = null

  constructor(opts: RenderDeviceOptions = {}) {
    this.bpm = opts.bpm ?? 145
    this.config = { ...DEFAULT_RENDER_CONFIG, ...opts.config }
    this.useSamples = opts.useSamples ?? true
  }

  capabilities(): DeviceCapabilities {
    return {
      audio: true,
      midi: false,
      inputs: 1,
      outputs: 1,
      voices: 13,
      latencyMs: 0,
      roles: ['render', 'master', 'analysis'],
    }
  }

  onTransport(_transport: MusicalTransport): void {
    // Transport info — we use it for BPM if available
  }

  onContext(context: MusicalContext): void {
    this.ctx = context
    if (context.energy !== undefined) {
      // Could adjust config based on context energy
    }
  }

  onEvent(event: MusicalEvent): void {
    if (event.type === 'note') {
      this.events.push(event as NoteEvent)
    }
  }

  onStart?(): void {
    this.events = []
  }

  onStop?(): void {
    // Could trigger final render
  }

  /**
   * Convert accumulated NoteEvents to a render and produce WAV + critique.
   * This is the main entry point for offline rendering.
   */
  async render(bars = 8, seed = 42): Promise<RenderDeviceResult> {
    // For now, we use the CompositionEngine to generate the section
    // (since NoteEvents from the family don't have a direct composition path yet)
    // Future: convert NoteEvents directly to RawScore

    const { CompositionEngine, createIdentityA } = await import('@psy-foundation/music')
    const ctx = {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      octave: 4,
      bpm: this.bpm,
      beatsPerBar: 4,
      beatPosition: 0,
      barPosition: 0,
      phrasePosition: 0,
      harmonicContext: [],
      density: 0.7,
      energy: 0.7,
      tension: 0.3,
      sectionRole: 'full-on',
      repetitionPressure: 0.3,
      noveltyPressure: 0.5,
    }

    const engine = new CompositionEngine({ seed, context: ctx, identity: createIdentityA() })
    const section = engine.composeSection({ bars })

    const renderResult = await renderFoundationSection(section, {
      useSamples: this.useSamples,
      bpm: this.bpm,
      config: this.config,
    })

    // Downmix to mono for AudioCritic
    const mono = new Float32Array(renderResult.samplesL.length)
    for (let i = 0; i < mono.length; i++) {
      mono[i] = ((renderResult.samplesL[i] ?? 0) + (renderResult.samplesR[i] ?? 0)) * 0.5
    }

    // D8.1: stereo + note events so the critic measures reality (no constants).
    const notes = section.bars.flatMap((bar) =>
      bar.leadNotes.map((n) => ({
        pitchMidi: n.midi,
        startStep: bar.barIndex * section.groove.stepsPerBar + n.step,
        durationSteps: n.durationSteps,
        velocity: n.velocity,
      }))
    )
    const critique = critiqueAudio(mono, renderResult.sampleRate, this.bpm, 16, {
      stereo: { left: renderResult.samplesL, right: renderResult.samplesR },
      notes,
    })
    const wav = encodeWav(renderResult.samplesL, renderResult.samplesR, renderResult.sampleRate)

    return { wav, render: renderResult, critique }
  }

  /** Get accumulated event count */
  getEventCount(): number {
    return this.events.length
  }

  /** Clear accumulated events */
  clear(): void {
    this.events = []
  }
}

/** Factory function */
export function createRenderDevice(opts?: RenderDeviceOptions): RenderDevice {
  return new RenderDevice(opts)
}
