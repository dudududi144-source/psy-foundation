import { describe, expect, test } from 'bun:test'
import { InMemoryChannel } from '@psy-foundation/protocol'
import type {
  BeatEvent,
  DeviceCapabilities,
  MusicalContext,
  MusicalEvent,
} from '@psy-foundation/protocol'
import type { MusicalTransport } from '@psy-foundation/transport'
import { DeviceHost } from '../src/index.ts'
import type { DeviceErrorEvent } from '../src/index.ts'

function noteEvent(note = 60): MusicalEvent {
  return { type: 'note', note, velocity: 0.8, duration: 0.25, channel: 'test', at: 0 }
}

function transportOf(beat: number): MusicalTransport {
  return {
    bpm: 150,
    beat,
    bar: Math.floor(beat / 4),
    beatsPerBar: 4,
    beatTime: beat * 0.4,
    barTime: (beat % 4) * 0.4,
    phase: 0,
    barPhase: 0,
    confidence: 0.9,
    locked: true,
    revision: 1,
    origin: { audioTime: 0, beatIndex: 0, bpm: 150 },
    lastObservationAgo: 0,
    observationCount: beat + 1,
  }
}

function beatEvent(beat: number): BeatEvent {
  return {
    type: 'beat',
    beat,
    bar: Math.floor(beat / 4),
    transport: transportOf(beat),
    at: beat * 0.4,
  }
}

function ctx(): MusicalContext {
  return {
    key: 'A',
    rootPc: 9,
    scale: 'phrygian-dominant',
    energy: 0.7,
    style: 'full-on',
    section: 'drop',
    beatsPerBar: 4,
  }
}

interface FaultPlan {
  onStart?: string
  onStop?: string
  onEvent?: string
  onTransport?: string
  onContext?: string
  capabilities?: string
}

/** Device whose callbacks throw per configured phase; unplanned callbacks record honestly. */
class FaultyDevice {
  readonly id: string
  readonly received: MusicalEvent[] = []
  faultCount = 0
  constructor(
    id: string,
    private readonly plan: FaultPlan = {}
  ) {
    this.id = id
  }
  capabilities(): DeviceCapabilities {
    if (this.plan.capabilities) throw new Error(this.plan.capabilities)
    return {
      audio: false,
      midi: false,
      inputs: 0,
      outputs: 0,
      voices: 0,
      latencyMs: 0,
      roles: ['test'],
    }
  }
  onTransport(_transport: MusicalTransport): void {
    if (this.plan.onTransport) throw new Error(this.plan.onTransport)
  }
  onContext(_context: MusicalContext): void {
    if (this.plan.onContext) throw new Error(this.plan.onContext)
  }
  onEvent(event: MusicalEvent): void {
    if (this.plan.onEvent) {
      this.faultCount += 1
      throw new Error(this.plan.onEvent)
    }
    this.received.push(event)
  }
  onStart(): void {
    if (this.plan.onStart) throw new Error(this.plan.onStart)
  }
  onStop(): void {
    if (this.plan.onStop) throw new Error(this.plan.onStop)
  }
}

describe('DeviceHost — per-device error isolation (phase 3.3a)', () => {
  test('a faulting device does not starve others: B receives the same event A crashed on', () => {
    const host = new DeviceHost(new InMemoryChannel())
    const faulty = new FaultyDevice('faulty', { onEvent: 'device faulty exploded on event' })
    const healthy = new FaultyDevice('healthy')
    host.register(faulty)
    host.register(healthy)

    const event = noteEvent(42)
    expect(() => host.publish(event)).not.toThrow()
    expect(healthy.received).toHaveLength(1)
    expect(healthy.received[0]).toBe(event) // same event object, not a copy
    expect(faulty.faultCount).toBe(1)
    host.dispose()
  })

  test('fault lands in the ring and fires opt-in onError with device id + phase', () => {
    const seen: DeviceErrorEvent[] = []
    const host = new DeviceHost(new InMemoryChannel(), { onError: (e) => seen.push(e) })
    host.register(new FaultyDevice('faulty', { onEvent: 'device faulty exploded on event' }))

    host.publish(beatEvent(7))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.deviceId).toBe('faulty')
    expect(seen[0]?.phase).toBe('onEvent')
    expect(seen[0]?.message).toContain('exploded')
    expect(seen[0]?.beat).toBe(7) // beat context from the routed BeatEvent
    expect(seen[0]?.error).toBeInstanceOf(Error)

    const ring = host.recentErrors()
    expect(ring).toHaveLength(1)
    expect(ring[0]?.deviceId).toBe('faulty')
    host.dispose()
  })

  test('routing survives 100 consecutive faults; ring stays bounded at 32', () => {
    const faults: DeviceErrorEvent[] = []
    const host = new DeviceHost(new InMemoryChannel(), { onError: (e) => faults.push(e) })
    const faulty = new FaultyDevice('faulty', { onEvent: 'device faulty exploded on event' })
    const healthy = new FaultyDevice('healthy')
    host.register(faulty)
    host.register(healthy)

    for (let i = 0; i < 100; i++) {
      expect(() => host.publish(noteEvent(i))).not.toThrow()
    }
    expect(healthy.received).toHaveLength(100)
    expect(faulty.faultCount).toBe(100)
    expect(faults).toHaveLength(100)
    expect(host.recentErrors()).toHaveLength(32) // bounded ring, newest last
    expect(host.recentErrors()[31]?.message).toContain('exploded')
    host.dispose()
  })

  test('unregister of a faulted device works even when its onStop throws too', () => {
    const host = new DeviceHost(new InMemoryChannel())
    const faulty = new FaultyDevice('faulty', {
      onEvent: 'event kaboom',
      onStop: 'stop also explodes',
    })
    const healthy = new FaultyDevice('healthy')
    host.register(faulty)
    host.register(healthy)
    host.publish(noteEvent())
    expect(healthy.received).toHaveLength(1)

    expect(() => host.unregister('faulty')).not.toThrow() // onStop throws inside — isolated
    expect(host.deviceCount).toBe(1)
    const ringAfterUnregister = host.recentErrors().length

    host.publish(noteEvent())
    expect(healthy.received).toHaveLength(2)
    expect(host.recentErrors().length).toBe(ringAfterUnregister) // no new faults — faulty is gone
    host.dispose()
  })

  test('a throwing onError callback never reaches the caller (isolate the isolator)', () => {
    const host = new DeviceHost(new InMemoryChannel(), {
      onError: () => {
        throw new Error('the isolator itself is broken')
      },
    })
    const faulty = new FaultyDevice('faulty', { onEvent: 'device faulty exploded on event' })
    const healthy = new FaultyDevice('healthy')
    host.register(faulty)
    host.register(healthy)

    expect(() => host.publish(noteEvent())).not.toThrow()
    expect(healthy.received).toHaveLength(1)
    const ring = host.recentErrors()
    expect(ring.some((e) => e.phase === 'onError' && e.message.includes('isolator'))).toBe(true)
    expect(ring.some((e) => e.phase === 'onEvent' && e.deviceId === 'faulty')).toBe(true)
    host.dispose()
  })

  test('lifecycle and routing phases are isolated too (onStart/onStop/onTransport/onContext/capabilities)', () => {
    const seen: DeviceErrorEvent[] = []
    const host = new DeviceHost(new InMemoryChannel(), { onError: (e) => seen.push(e) })
    const bad = new FaultyDevice('bad', {
      onStart: 'start boom',
      onStop: 'stop boom',
      onTransport: 'transport boom',
      onContext: 'context boom',
      capabilities: 'capabilities boom',
    })
    const healthy = new FaultyDevice('healthy')

    expect(() => host.register(bad)).not.toThrow()
    host.register(healthy)
    expect(host.deviceCount).toBe(2) // registered despite the onStart fault

    expect(() => host.pushTransport(transportOf(3), 0)).not.toThrow()
    expect(() => host.pushContext(ctx())).not.toThrow()
    expect(() => host.list()).not.toThrow()
    expect(host.list().map((d) => d.id)).toEqual(['healthy']) // bad's capabilities() throws → omitted + recorded
    expect(host.findByRole('test').map((d) => d.id)).toEqual(['healthy'])
    expect(() => host.unregister('bad')).not.toThrow()
    expect(host.deviceCount).toBe(1) // only healthy remains

    expect(seen.map((e) => e.phase)).toEqual([
      'onStart',
      'onTransport',
      'onContext',
      // list() x2 + findByRole() each hit bad's throwing capabilities()
      'capabilities',
      'capabilities',
      'capabilities',
      'onStop',
    ])
    expect(seen.find((e) => e.phase === 'onTransport')?.beat).toBe(3) // beat from transport
    expect(seen.every((e) => e.deviceId === 'bad')).toBe(true)
    expect(healthy.received).toHaveLength(0) // healthy unaffected throughout
    expect(() => host.dispose()).not.toThrow()
  })

  test('non-Error throw values and events without a beat are recorded honestly', () => {
    const host = new DeviceHost(new InMemoryChannel())
    const stringThrower = new FaultyDevice('string-thrower')
    stringThrower.onEvent = () => {
      throw 'not-an-error'
    }
    host.register(stringThrower)
    host.publish({ type: 'energy', energy: 0.9, at: 0 })
    const ring = host.recentErrors()
    expect(ring).toHaveLength(1)
    expect(ring[0]?.message).toBe('not-an-error')
    expect(ring[0]?.beat).toBeNull() // energy events carry no beat
    host.dispose()
  })
})
