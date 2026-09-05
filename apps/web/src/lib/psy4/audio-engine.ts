'use client'

/**
 * PSY4 Audio Engine — client-side real-time audio manager.
 *
 * Connects the AudioWorklet processor to the Web Audio API and MIDI.
 * This is the bridge between the UI and the real-time synthesis engine.
 *
 * Usage:
 *   const engine = new PSY4AudioEngine()
 *   await engine.init()
 *   engine.noteOn(64, 0.8)  // MIDI note 64, velocity 0.8
 *   engine.setCutoff(4000)
 */

import { DEFAULT_SR } from './constants'

// Minimal MIDI types (avoiding DOM lib dependency issues)
interface MIDIInput {
  name: string
  // biome-ignore lint/suspicious/noExplicitAny: MIDI message is dynamic
  onmidimessage: ((message: any) => void) | null
}

interface MIDIAccess {
  inputs: Map<string, MIDIInput>
  onstatechange: (() => void) | null
}

export type VoiceSection = 'lead' | 'bass' | 'pad' | 'acid'

export class PSY4AudioEngine {
  private audioContext: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private midiAccess: MIDIAccess | null = null
  private initialized = false
  /** Currently held notes (PLAN_V3 4.5): noteOn adds, noteOff releases that
   *  note in the worklet; keeps pointer/keyboard/MIDI inputs honest about
   *  which voices are still sounding. */
  private heldNotes = new Set<number>()

  async init(): Promise<boolean> {
    if (this.initialized) return true
    if (typeof window === 'undefined') return false

    try {
      this.audioContext = new AudioContext({ sampleRate: DEFAULT_SR, latencyHint: 'interactive' })
      await this.audioContext.audioWorklet.addModule('/worklets/psy4-processor.js')

      this.workletNode = new AudioWorkletNode(this.audioContext, 'psy4-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      })

      this.workletNode.connect(this.audioContext.destination)
      this.initialized = true
      return true
    } catch (e) {
      console.error('PSY4AudioEngine init failed:', e)
      return false
    }
  }

  async resume(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume()
    }
  }

  noteOn(midi: number, velocity = 0.8, voiceType?: string): void {
    if (!this.workletNode) return
    this.heldNotes.add(midi)
    this.workletNode.port.postMessage({ type: 'noteOn', midi, velocity, voiceType })
  }

  /** Release a specific held note (PLAN_V3 4.5). No-op if it is not held. */
  noteOff(midi?: number): void {
    if (!this.workletNode) return
    if (midi === undefined) {
      // Release-all (legacy semantics): clear the held set too.
      this.heldNotes.clear()
      this.workletNode.port.postMessage({ type: 'noteOff' })
      return
    }
    if (!this.heldNotes.has(midi)) return
    this.heldNotes.delete(midi)
    this.workletNode.port.postMessage({ type: 'noteOff', midi })
  }

  /** Is the note currently held (pointer/keyboard/MIDI)? */
  isHeld(midi: number): boolean {
    return this.heldNotes.has(midi)
  }

  /** Stop the transport cleanly: release every held note. */
  releaseAll(): void {
    this.noteOff()
  }

  /** Mixer strip (PLAN_V3 4.5): per-section gain 0..2 (mute = 0). */
  setVoiceGain(section: VoiceSection, value: number): void {
    if (!this.workletNode) return
    const v = Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 1
    this.workletNode.port.postMessage({ type: 'setVoiceGain', section, value: v })
  }

  setCutoff(value: number): void {
    if (!this.workletNode) return
    this.workletNode.port.postMessage({ type: 'setCutoff', value })
  }

  setResonance(value: number): void {
    if (!this.workletNode) return
    this.workletNode.port.postMessage({ type: 'setResonance', value })
  }

  setMasterGain(value: number): void {
    if (!this.workletNode) return
    this.workletNode.port.postMessage({ type: 'setMasterGain', value })
  }

  // Phase B: stereo width + sidechain depth controls
  setStereoWidth(value: number): void {
    if (!this.workletNode) return
    this.workletNode.port.postMessage({ type: 'setStereoWidth', value })
  }

  setSidechain(value: number): void {
    if (!this.workletNode) return
    this.workletNode.port.postMessage({ type: 'setSidechain', value })
  }

  async initMIDI(): Promise<boolean> {
    if (
      typeof navigator === 'undefined' ||
      !(
        // biome-ignore lint/suspicious/noExplicitAny: Web MIDI API
        (navigator as any).requestMIDIAccess
      )
    ) {
      return false
    }
    try {
      this.midiAccess = (await // biome-ignore lint/suspicious/noExplicitAny: Web MIDI API
      (navigator as any).requestMIDIAccess()) as MIDIAccess
      this.midiAccess.onstatechange = () => {
        // Could emit event for UI update
      }
      return true
    } catch (e) {
      console.error('MIDI access failed:', e)
      return false
    }
  }

  getMIDIInputs(): string[] {
    if (!this.midiAccess) return []
    const inputs: string[] = []
    for (const input of this.midiAccess.inputs.values()) {
      inputs.push(input.name)
    }
    return inputs
  }

  connectMIDIInput(name: string): boolean {
    if (!this.midiAccess) return false
    let found = false
    for (const input of this.midiAccess.inputs.values()) {
      if (input.name === name) {
        input.onmidimessage = (message) => {
          const [status, data1, data2] = message.data
          // Note on (144 with velocity > 0) → noteOn.
          // Note off (128, or 144 with velocity 0) → noteOff for THAT note
          // (the old handler dropped releases entirely — notes never stopped).
          if (status === 144 && data2 > 0) {
            this.noteOn(data1, data2 / 127)
          } else if (status === 128 || (status === 144 && data2 === 0)) {
            this.noteOff(data1)
          }
        }
        found = true
      }
    }
    return found
  }

  disconnectMIDIInputs(): void {
    if (!this.midiAccess) return
    for (const input of this.midiAccess.inputs.values()) {
      input.onmidimessage = null
    }
  }

  dispose(): void {
    this.disconnectMIDIInputs()
    this.heldNotes.clear()
    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode = null
    }
    if (this.audioContext) {
      void this.audioContext.close()
      this.audioContext = null
    }
    this.initialized = false
  }
}
