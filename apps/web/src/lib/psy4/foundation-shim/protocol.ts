// VERBATIM SHIM — pinned to psy-foundation commit 4ae95d3
// Source: psy-foundation/packages/protocol/src/state.ts + events.ts + channel.ts
// Do not modify. Replace with `import { ... } from '@psy-foundation/protocol'` when integrated.

export interface TransportState {
  bpm: number
  beat: number
  bar: number
  phase: number
  locked: boolean
  confidence: number
  revision: number
}

export interface MusicalContext {
  key: string
  rootPc: number
  scale: string
  energy: number
  style: string
  section: string
  beatsPerBar: number
}

export interface DeviceCapabilities {
  audio: boolean
  midi: boolean
  inputs: number
  outputs: number
  voices: number
  latencyMs: number
  roles: string[]
}

export interface EventTime {
  bar: number
  beat: number
  sub: number
  at: number
}

export interface BeatEvent {
  type: 'beat'
  time: EventTime
  bpm: number
  bar: number
  beat: number
}
export interface SectionEvent {
  type: 'section'
  time: EventTime
  section: string
  energy: number
}
export interface EnergyEvent {
  type: 'energy'
  time: EventTime
  energy: number
}
export interface DropEvent {
  type: 'drop'
  time: EventTime
  dropType: string
}
export interface NoteEvent {
  type: 'note'
  time: EventTime
  note: number
  velocity: number
  duration: number
  channel: string
  at: number
}
export interface PatternEvent {
  type: 'pattern'
  time: EventTime
  pattern: unknown
  channel: string
}

export type MusicalEvent =
  | BeatEvent
  | SectionEvent
  | EnergyEvent
  | DropEvent
  | NoteEvent
  | PatternEvent

export type EventOfType<T extends MusicalEvent['type']> = Extract<MusicalEvent, { type: T }>

export type ChannelListener = (event: MusicalEvent) => void
export type Unsubscribe = () => void

export interface Channel {
  subscribe(listener: ChannelListener): Unsubscribe
  publish(event: MusicalEvent): void
  close(): void
}

export class InMemoryChannel implements Channel {
  private listeners: ChannelListener[] = []
  private closed = false
  subscribe(listener: ChannelListener): Unsubscribe {
    if (this.closed) throw new Error('Cannot subscribe to closed channel')
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }
  publish(event: MusicalEvent): void {
    if (this.closed) return
    for (const l of this.listeners) l(event)
  }
  close(): void {
    this.closed = true
    this.listeners = []
  }
}
