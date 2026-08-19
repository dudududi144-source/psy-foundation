import { describe, expect, test } from 'bun:test'
import { InMemoryChannel } from '../src/channel.ts'
import type { BeatEvent, ChannelListener, MusicalEvent, NoteEvent } from '../src/index.ts'

function beatEvent(beat: number): BeatEvent {
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
      revision: 1,
      origin: { audioTime: 0, beatIndex: 0, bpm: 150 },
      lastObservationAgo: 0,
      observationCount: beat + 1,
    },
    at: beat * 0.4,
  }
}

function noteEvent(note: number): NoteEvent {
  return { type: 'note', note, velocity: 0.8, duration: 0.2, channel: 'lead', at: 0 }
}

describe('InMemoryChannel', () => {
  test('delivers published events to all subscribers', () => {
    const ch = new InMemoryChannel('test')
    const received: MusicalEvent[] = []
    ch.subscribe((e) => received.push(e))
    ch.subscribe((e) => received.push(e))
    ch.publish(beatEvent(1))
    expect(received).toHaveLength(2)
  })

  test('unsubscribe stops delivery', () => {
    const ch = new InMemoryChannel()
    let count = 0
    const unsub = ch.subscribe(() => count++)
    ch.publish(beatEvent(0))
    expect(count).toBe(1)
    unsub()
    ch.publish(beatEvent(1))
    expect(count).toBe(1)
  })

  test('close prevents further delivery and rejects new subscribers', () => {
    const ch = new InMemoryChannel()
    let count = 0
    ch.subscribe(() => count++)
    ch.close()
    ch.publish(beatEvent(0))
    expect(count).toBe(0)
    expect(() => ch.subscribe(() => {})).toThrow()
  })

  test('subscriberCount reflects subscriptions', () => {
    const ch = new InMemoryChannel()
    expect(ch.subscriberCount).toBe(0)
    const u1 = ch.subscribe(() => {})
    expect(ch.subscriberCount).toBe(1)
    const u2 = ch.subscribe(() => {})
    expect(ch.subscriberCount).toBe(2)
    u1()
    expect(ch.subscriberCount).toBe(1)
    u2()
    expect(ch.subscriberCount).toBe(0)
  })

  test('channel name is readable', () => {
    expect(new InMemoryChannel('sync-lab').name).toBe('sync-lab')
  })
})

describe('MusicalEvent typing', () => {
  test('BeatEvent and NoteEvent are distinguishable by type', () => {
    const be = beatEvent(0)
    const ne = noteEvent(60)
    expect(be.type).toBe('beat')
    expect(ne.type).toBe('note')
    if (be.type === 'beat') expect(be.beat).toBe(0)
    if (ne.type === 'note') expect(ne.note).toBe(60)
  })
})

describe('Channel contract', () => {
  test('any Channel impl must subscribe/publish/close', () => {
    const ch: InMemoryChannel = new InMemoryChannel()
    const listener: ChannelListener = (e) => void e
    const unsub = ch.subscribe(listener)
    expect(typeof unsub).toBe('function')
    expect(() => ch.publish(beatEvent(0))).not.toThrow()
    expect(() => ch.close()).not.toThrow()
  })
})
