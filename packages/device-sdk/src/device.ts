import type {
  DeviceCapabilities,
  MusicalContext,
  MusicalEvent,
  TransportState,
} from '@psy-foundation/protocol'
import type { MusicalTransport } from '@psy-foundation/transport'

export interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
  /**
   * GAP-D1 (PLAN_V3 3.5): local scheduling hook.
   *
   * A real device needs to schedule notes from transport snapshots — e.g. a
   * drum machine that fires its 16th-grid pattern from a beat horizon rather
   * than reacting to host events one at a time. A device implementing this
   * receives (event, transport) pairs it asked the host to deliver at a
   * specific beat: pair it with the {@link LocalScheduler} helper from this
   * package, which queues events and releases/stales them from transport
   * snapshots.
   *
   * Optional: devices that don't self-schedule simply omit it — the host
   * must tolerate its absence (and isolate its faults like any other
   * callback; see DeviceHost error isolation).
   */
  onScheduledEvent?(event: MusicalEvent, transport: TransportState): void
}
