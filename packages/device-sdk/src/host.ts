import type {
  Channel,
  DeviceCapabilities,
  MusicalContext,
  MusicalEvent,
} from '@psy-foundation/protocol'
import type { MusicalTransport } from '@psy-foundation/transport'
import type { PsyDevice } from './device.ts'

/**
 * Phases of host→device invocation that are fault-isolated.
 *
 * Every device callback the host invokes is wrapped: a throwing device is
 * recorded and skipped, never allowed to break the host or starve other
 * devices (backport of the per-device try/catch the family shims carry).
 */
export type DeviceErrorPhase =
  | 'onStart'
  | 'onStop'
  | 'onEvent'
  | 'onTransport'
  | 'onContext'
  | 'capabilities'
  | 'onError'

/** Structured record of a device fault observed by the host. */
export interface DeviceErrorEvent {
  /** Device whose callback faulted. */
  readonly deviceId: string
  /** Which host→device invocation threw ('onError' = the onError callback itself faulted). */
  readonly phase: DeviceErrorPhase
  /** Normalized message of the thrown value. */
  readonly message: string
  /** Host monotonic clock (performance.now, ms). Diagnostics only — never a render-path clock. */
  readonly timestamp: number
  /** Beat carried by the routed event/transport when the fault happened; null otherwise. */
  readonly beat: number | null
  /** The raw thrown value, for debugging. */
  readonly error: unknown
}

export type DeviceErrorHandler = (error: DeviceErrorEvent) => void

export interface DeviceHostOptions {
  transportMinIntervalMs?: number
  transportDedupByRevision?: boolean
  /**
   * Opt-in fault observer. Invoked for every isolated device fault, after the
   * fault has been recorded in the ring. The host never propagates an
   * exception thrown by this callback: the callback's own fault is recorded
   * with phase 'onError' and is not re-dispatched (no recursion).
   */
  onError?: DeviceErrorHandler
  /** Bounded ring size for recentErrors(). Default 32; values < 1 are clamped to 1. */
  maxRecentErrors?: number
}

interface ResolvedOptions {
  transportMinIntervalMs: number
  transportDedupByRevision: boolean
  maxRecentErrors: number
  onError: DeviceErrorHandler | null
}

const DEFAULT_MAX_RECENT_ERRORS = 32

function describeThrown(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'unstringifiable thrown value'
  }
}

/**
 * Host for PsyDevices on a Channel.
 *
 * Error-isolation policy (phase 3.3):
 * - A device callback that throws never propagates out of the host.
 * - The fault is recorded (structured DeviceErrorEvent) in a bounded ring and
 *   reported to the opt-in `onError` callback.
 * - Routing continues: the same event/transport/context still reaches every
 *   remaining device, in registration order.
 * - register()/unregister()/dispose() of a faulted device always succeed.
 * - A device whose capabilities() throws is omitted from list()/findByRole()
 *   results for that call, with the fault recorded.
 * - The host itself never logs to the console; errors are data (ring +
 *   onError), and embedders decide how to surface them.
 */
export class DeviceHost {
  private readonly devices = new Map<string, PsyDevice>()
  private readonly channel: Channel
  private readonly opts: ResolvedOptions
  private channelUnsub: (() => void) | null = null
  private lastTransportRevision: number | null = null
  private lastTransportPushAt = 0
  private readonly errorRing: DeviceErrorEvent[] = []

  constructor(channel: Channel, opts: DeviceHostOptions = {}) {
    this.channel = channel
    this.opts = {
      transportMinIntervalMs: opts.transportMinIntervalMs ?? 0,
      transportDedupByRevision: opts.transportDedupByRevision ?? true,
      maxRecentErrors: Math.max(1, opts.maxRecentErrors ?? DEFAULT_MAX_RECENT_ERRORS),
      onError: opts.onError ?? null,
    }
    this.startEventRouting()
  }

  register(device: PsyDevice): void {
    if (this.devices.has(device.id)) throw new Error(`Device already registered: ${device.id}`)
    // Registered BEFORE onStart: a faulted device must still be a real
    // citizen of the registry (unregister/dispose have to reach it).
    this.devices.set(device.id, device)
    this.safeCall(device, 'onStart', null, (d) => d.onStart?.())
  }

  unregister(id: string): void {
    const device = this.devices.get(id)
    if (!device) return
    // Removed BEFORE onStop: even if onStop throws, the device is gone.
    this.devices.delete(id)
    this.safeCall(device, 'onStop', null, (d) => d.onStop?.())
  }

  list(): Array<{ id: string; capabilities: DeviceCapabilities }> {
    const out: Array<{ id: string; capabilities: DeviceCapabilities }> = []
    for (const device of this.devices.values()) {
      try {
        out.push({ id: device.id, capabilities: device.capabilities() })
      } catch (err) {
        this.recordFault(device.id, 'capabilities', null, err)
      }
    }
    return out
  }

  findByRole(role: string): PsyDevice[] {
    const out: PsyDevice[] = []
    for (const device of this.devices.values()) {
      try {
        if (device.capabilities().roles.includes(role)) out.push(device)
      } catch (err) {
        this.recordFault(device.id, 'capabilities', null, err)
      }
    }
    return out
  }

  pushTransport(transport: MusicalTransport, nowMs: number): void {
    if (this.opts.transportDedupByRevision) {
      if (this.lastTransportRevision === transport.revision) return
      this.lastTransportRevision = transport.revision
    }
    if (this.opts.transportMinIntervalMs > 0) {
      if (nowMs - this.lastTransportPushAt < this.opts.transportMinIntervalMs) return
      this.lastTransportPushAt = nowMs
    }
    for (const device of this.devices.values()) {
      this.safeCall(device, 'onTransport', transport.beat, (d) => d.onTransport(transport))
    }
  }

  pushContext(context: MusicalContext): void {
    for (const device of this.devices.values()) {
      this.safeCall(device, 'onContext', null, (d) => d.onContext(context))
    }
  }

  publish(event: MusicalEvent): void {
    this.channel.publish(event)
  }

  dispose(): void {
    const stopped = Array.from(this.devices.values())
    this.devices.clear()
    for (const device of stopped) {
      this.safeCall(device, 'onStop', null, (d) => d.onStop?.())
    }
    this.channelUnsub?.()
    this.channelUnsub = null
  }

  /** Last N device faults, oldest first (newest last). Returns a copy. */
  recentErrors(): readonly DeviceErrorEvent[] {
    return Array.from(this.errorRing)
  }

  get deviceCount(): number {
    return this.devices.size
  }

  private safeCall(
    device: PsyDevice,
    phase: DeviceErrorPhase,
    beat: number | null,
    invoke: (d: PsyDevice) => void
  ): void {
    try {
      invoke(device)
    } catch (err) {
      this.recordFault(device.id, phase, beat, err)
    }
  }

  private recordFault(
    deviceId: string,
    phase: DeviceErrorPhase,
    beat: number | null,
    error: unknown
  ): void {
    const entry: DeviceErrorEvent = {
      deviceId,
      phase,
      beat,
      message: describeThrown(error),
      timestamp: performance.now(),
      error,
    }
    this.pushError(entry)
    const onError = this.opts.onError
    if (!onError) return
    // Isolate the isolator: a throwing onError must never reach the caller
    // and must not recurse. Its fault is recorded with phase 'onError'.
    try {
      onError(entry)
    } catch (cbErr) {
      this.pushError({
        deviceId,
        phase: 'onError',
        beat,
        message: describeThrown(cbErr),
        timestamp: performance.now(),
        error: cbErr,
      })
    }
  }

  private pushError(entry: DeviceErrorEvent): void {
    this.errorRing.push(entry)
    while (this.errorRing.length > this.opts.maxRecentErrors) this.errorRing.shift()
  }

  private startEventRouting(): void {
    this.channelUnsub = this.channel.subscribe((event: MusicalEvent) => {
      const beat = event.type === 'beat' ? event.beat : null
      for (const device of this.devices.values()) {
        this.safeCall(device, 'onEvent', beat, (d) => d.onEvent(event))
      }
    })
  }
}
