import { describe, expect, test } from 'bun:test'
import { InMemoryChannel } from '@psy-foundation/protocol'
import type { BeatEvent, MusicalContext } from '@psy-foundation/protocol'
import { TransportClock } from '@psy-foundation/transport'
import { DeviceHost, ReferenceDevice } from '../src/index.ts'

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

function beatEvent(beat: number, revision: number): BeatEvent {
  return {
    type: 'beat',
    beat,
    bar: Math.floor(beat / 4),
    transport: {
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
      revision,
      origin: { audioTime: 0, beatIndex: 0, bpm: 150 },
      lastObservationAgo: 0,
      observationCount: beat + 1,
    },
    at: beat * 0.4,
  }
}

describe('DeviceHost — registration', () => {
  test('register/unregister a device', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const dev = new ReferenceDevice({ id: 'a' })
    host.register(dev)
    expect(host.deviceCount).toBe(1)
    expect(dev.isStarted).toBe(true)
    host.unregister('a')
    expect(host.deviceCount).toBe(0)
    expect(dev.isStopped).toBe(true)
    host.dispose()
  })

  test('rejects duplicate id', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    host.register(new ReferenceDevice({ id: 'a' }))
    expect(() => host.register(new ReferenceDevice({ id: 'a' }))).toThrow()
    host.dispose()
  })

  test('list returns capabilities', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    host.register(new ReferenceDevice({ id: 'a', roles: ['kick'] }))
    host.register(new ReferenceDevice({ id: 'b', roles: ['bass'] }))
    const list = host.list()
    expect(list).toHaveLength(2)
    expect(list.find((d) => d.id === 'a')?.capabilities.roles).toEqual(['kick'])
    host.dispose()
  })

  test('findByRole filters by role', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    host.register(new ReferenceDevice({ id: 'a', roles: ['kick', 'bass'] }))
    host.register(new ReferenceDevice({ id: 'b', roles: ['bass'] }))
    host.register(new ReferenceDevice({ id: 'c', roles: ['lead'] }))
    expect(
      host
        .findByRole('bass')
        .map((d) => d.id)
        .sort()
    ).toEqual(['a', 'b'])
    expect(host.findByRole('fx')).toHaveLength(0)
    host.dispose()
  })
})

describe('DeviceHost — transport routing', () => {
  test('pushTransport delivers to every device', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const a = new ReferenceDevice({ id: 'a' })
    const b = new ReferenceDevice({ id: 'b' })
    host.register(a)
    host.register(b)
    const clock = new TransportClock({ initialBpm: 150 })
    clock.observe({ observedAt: 1, strength: 1 })
    const snap = clock.snapshot(1)
    host.pushTransport(snap, performance.now())
    expect(a.transportUpdates).toBe(1)
    expect(b.transportUpdates).toBe(1)
    host.dispose()
  })

  test('deduplicates transport by revision', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const dev = new ReferenceDevice({ id: 'a' })
    host.register(dev)
    const clock = new TransportClock({ initialBpm: 150 })
    clock.observe({ observedAt: 1, strength: 1 })
    const snap1 = clock.snapshot(1)
    host.pushTransport(snap1, 0)
    host.pushTransport(snap1, 10)
    expect(dev.transportUpdates).toBe(1)
    clock.observe({ observedAt: 1.45, strength: 1 })
    const snap2 = clock.snapshot(1.45)
    expect(snap2.revision).toBeGreaterThan(snap1.revision)
    host.pushTransport(snap2, 30)
    expect(dev.transportUpdates).toBe(2)
    host.dispose()
  })

  test('can disable revision dedup', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch, { transportDedupByRevision: false })
    const dev = new ReferenceDevice({ id: 'a' })
    host.register(dev)
    const clock = new TransportClock()
    clock.observe({ observedAt: 1, strength: 1 })
    const snap = clock.snapshot(1)
    host.pushTransport(snap, 0)
    host.pushTransport(snap, 100)
    expect(dev.transportUpdates).toBe(2)
    host.dispose()
  })
})

describe('DeviceHost — context routing', () => {
  test('pushContext delivers to every device', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const a = new ReferenceDevice({ id: 'a' })
    const b = new ReferenceDevice({ id: 'b' })
    host.register(a)
    host.register(b)
    host.pushContext(ctx())
    expect(a.contextUpdates).toBe(1)
    expect(b.contextUpdates).toBe(1)
    host.dispose()
  })
})

describe('DeviceHost — event routing', () => {
  test('publish routes events to every device', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const a = new ReferenceDevice({ id: 'a' })
    const b = new ReferenceDevice({ id: 'b' })
    host.register(a)
    host.register(b)
    host.publish(beatEvent(0, 1))
    host.publish(beatEvent(1, 1))
    expect(a.eventsReceived).toBe(2)
    expect(b.eventsReceived).toBe(2)
    host.dispose()
  })

  test('events published directly on the channel also reach devices', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const dev = new ReferenceDevice({ id: 'a' })
    host.register(dev)
    ch.publish(beatEvent(5, 1))
    expect(dev.eventsReceived).toBe(1)
    host.dispose()
  })
})

describe('ReferenceDevice — graceful degradation', () => {
  test('keeps last-known transport after host disappears', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const dev = new ReferenceDevice({ id: 'a' })
    host.register(dev)
    const clock = new TransportClock({ initialBpm: 145 })
    clock.observe({ observedAt: 1, strength: 1 })
    host.pushTransport(clock.snapshot(1), 0)
    host.dispose()
    expect(dev.lastKnownTransport?.bpm).toBeGreaterThan(140)
    expect(dev.lastKnownTransport?.bpm).toBeLessThan(150)
  })
})

describe('DeviceHost — dispose', () => {
  test('dispose stops all devices and clears registry', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const a = new ReferenceDevice({ id: 'a' })
    const b = new ReferenceDevice({ id: 'b' })
    host.register(a)
    host.register(b)
    host.dispose()
    expect(a.isStopped).toBe(true)
    expect(b.isStopped).toBe(true)
    expect(host.deviceCount).toBe(0)
    ch.publish(beatEvent(0, 1))
    expect(a.eventsReceived).toBe(0)
  })
})
