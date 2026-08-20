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

export class PSY4AudioEngine {
  private audioContext: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private midiAccess: MIDIAccess | null = null
  private initialized = false

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
    this.workletNode.port.postMessage({ type: 'noteOn', midi, velocity, voiceType })
  }

  // Phase 4 Day 2: noteOff support
  noteOff(_midi?: number): void {
    if (!this.workletNode) return
    this.workletNode.port.postMessage({ type: 'noteOff' })
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
    this.midiAccess.inputs.forEach((input) => {
      inputs.push(input.name)
    })
    return inputs
  }

  connectMIDIInput(name: string): boolean {
    if (!this.midiAccess) return false
    let found = false
    this.midiAccess.inputs.forEach((input) => {
      if (input.name === name) {
        input.onmidimessage = (message) => {
          const [status, data1, data2] = message.data
          if (status === 144 && data2 > 0) {
            this.noteOn(data1, data2 / 127)
          }
        }
        found = true
      }
    })
    return found
  }

  dispose(): void {
    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode = null
    }
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    this.initialized = false
  }
}
