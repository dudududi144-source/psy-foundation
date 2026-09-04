/**
 * Protocol contract version (GAP-P1, PLAN_V3 3.5).
 *
 * ONE version number story for the foundation's wire/protocol contract:
 * this matches PSYBUS_PROTOCOL_VERSION (2, packages/protocol/src/v2/types.ts)
 * — the canonical bus envelope. Every TransportState snapshot carries the
 * version it was produced under, so consumers can reject or adapt to
 * mismatched peers instead of misreading fields.
 */
export const PROTOCOL_VERSION = 2

export interface TransportState {
  /** Protocol contract version of this snapshot (see PROTOCOL_VERSION). */
  protocolVersion: number
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
export interface DeviceState {
  id: string
  online: boolean
  lastSeen: number
  capabilities: DeviceCapabilities
}
export interface SessionState {
  id: string
  startedAt: number
  devices: DeviceState[]
}

export type MaterialType =
  | 'motif'
  | 'rhythm'
  | 'bass-pattern'
  | 'drum-pattern'
  | 'fill'
  | 'phrase'
  | 'fx-gesture'
  | 'preset'
  | 'texture'

export interface Material {
  id: string
  type: MaterialType
  role: string
  style: string
  tempoRange: [number, number]
  keyCompatibility: number[]
  energy: number
  novelty: number
  source: string
  confidence: number
  usageCount: number
  reward: number
  lastUsed: number | null
  payload: unknown
}

export type MusicalAction =
  | { type: 'play'; materialId: string }
  | { type: 'variation'; materialId: string; transform: string }
  | { type: 'do-nothing' }

export type MusicalOutcome =
  | { type: 'sounded'; durationSec: number }
  | { type: 'skipped' }
  | { type: 'collided'; reason: string }

export interface Experience {
  context: MusicalContext
  action: MusicalAction
  outcome: MusicalOutcome
  reward: number
  at: number
}
