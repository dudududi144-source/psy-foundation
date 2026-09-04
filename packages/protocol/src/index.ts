export type {
  EventTime,
  MusicalEvent,
  BeatEvent,
  SectionEvent,
  EnergyEvent,
  DropEvent,
  NoteEvent,
  PatternEvent,
  EventOfType,
} from './events.ts'
export type {
  TransportState,
  MusicalContext,
  DeviceCapabilities,
  DeviceState,
  SessionState,
  Material,
  MaterialType,
  MusicalAction,
  MusicalOutcome,
  Experience,
} from './state.ts'
export { PROTOCOL_VERSION } from './state.ts'
export type { Channel, ChannelListener, Unsubscribe } from './channel.ts'
export { InMemoryChannel } from './channel.ts'

/** PSYBUS v2 — the canonical bus envelope (phase 3.6). Legacy shapes above are deprecated in favor of it. */
export * as v2 from './v2.ts'
