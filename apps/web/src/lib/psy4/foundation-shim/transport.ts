// VERBATIM SHIM — pinned to psy-foundation commit 4ae95d3
// Source: psy-foundation/packages/protocol/src/transport.ts

import type { MusicalEvent, TransportState } from './protocol'

export interface MusicalTransport {
  state: TransportState
  subscribe(listener: (event: MusicalEvent) => void): () => void
  emit(event: MusicalEvent): void
}
