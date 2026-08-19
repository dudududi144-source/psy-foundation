// VERBATIM SHIM — pinned to psy-foundation commit 4ae95d3
// Source: psy-foundation/packages/device-sdk/src/device.ts

import type { DeviceCapabilities, MusicalContext, MusicalEvent } from './protocol'
import type { MusicalTransport } from './transport'

export interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}
