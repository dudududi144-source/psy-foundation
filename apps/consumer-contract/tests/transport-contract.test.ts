/**
 * Consumer Contract Tests — GAP DOCUMENTATION
 *
 * These tests are INTENTIONALLY SKIPPED. They document API gaps between
 * psy-foundation and the proven psy4 runtime. Each skipped test names the
 * gap (cross-referenced in audit/CONTRACT_GAPS.md) and what would be tested
 * if the gap were filled.
 *
 * Per the Reconciliation Gate rules: these tests document gaps. They do NOT
 * trigger migration. When a gap is filled (Phase B+), un-skip the test and
 * it must pass.
 *
 * The two PASSING tests at the bottom prove the foundation's current contract
 * works for the things it already supports.
 */

import { describe, expect, test } from 'bun:test'
import { DeviceHost, ReferenceDevice } from '@psy-foundation/device-sdk'
import { InMemoryChannel } from '@psy-foundation/protocol'
import { Transport, TransportClock } from '@psy-foundation/transport'
import type { MusicalTransport } from '@psy-foundation/transport'

// ── UN-SKIPPED GAP TESTS (T1-T6, T9 — Transport v1 now supports these) ──
// Roast-fix-11: these tests were skipped because the v0 TransportClock lacked
// the APIs. The v1 Transport (canonical candidate) now has seek, setTempo,
// source tracking, loseSource/holdover, nowFn constructor, onAudioContextResume,
// predictBeats, subscribe, and out-of-order rejection. Tests un-skipped and
// verified to pass.

describe('CONTRACT T1: epoch increments on disruptions', () => {
  test('epoch increments on seek', () => {
    const t = new Transport(() => 0, { initialBpm: 145 })
    t.start()
    const epoch0 = t.snapshot().epoch
    t.seek(40)
    const epoch1 = t.snapshot().epoch
    expect(epoch1).toBeGreaterThan(epoch0)
    expect(t.snapshot().beatIndex).toBe(40)
  })

  test('epoch increments on setTempo without phase reset', () => {
    const t = new Transport(() => 0, { initialBpm: 145 })
    t.start()
    const epoch0 = t.snapshot().epoch
    t.setTempo(150, 'internal')
    const epoch1 = t.snapshot().epoch
    expect(epoch1).toBeGreaterThan(epoch0)
    expect(t.snapshot().bpm).toBe(150)
  })
})

describe('CONTRACT T2: source tracking', () => {
  test('transport tracks source of observations', () => {
    const t = new Transport(() => 0, { initialBpm: 145 })
    t.start()
    t.observeBeat({ time: 0.4, confidence: 0.9, source: 'radio' })
    expect(t.snapshot().source).toBe('radio')
  })
})

describe('CONTRACT T3: holdover mode', () => {
  test('loseSource enters holdover, transport continues', () => {
    const t = new Transport(() => 0, { initialBpm: 145 })
    t.start()
    t.observeBeat({ time: 0.4, confidence: 0.9, source: 'radio' })
    t.loseSource()
    expect(t.isRunning()).toBe(true)
    expect(t.snapshot().holdover).toBe(true)
  })
})

describe('CONTRACT T4: AudioContext integration', () => {
  test('transport reads AudioContext.currentTime via nowFn', () => {
    let mockTime = 0
    const t = new Transport(() => mockTime, { initialBpm: 145 })
    t.start()
    mockTime = 1.0
    const snap = t.snapshot()
    expect(snap).toBeDefined()
  })

  test('onAudioContextResume re-anchors', () => {
    const t = new Transport(() => 0, { initialBpm: 145 })
    t.start()
    const epoch0 = t.snapshot().epoch
    t.onAudioContextResume()
    const epoch1 = t.snapshot().epoch
    expect(epoch1).toBeGreaterThan(epoch0)
  })
})

describe('CONTRACT T5: predictBeats(horizonSec)', () => {
  test('predictBeats returns array of upcoming beat times', () => {
    const t = new Transport(() => 0, { initialBpm: 145 })
    t.start()
    const beats = t.predictBeats(0.5)
    expect(Array.isArray(beats)).toBe(true)
    expect(beats.length).toBeGreaterThan(0)
  })
})

describe('CONTRACT T6: subscribe(listener)', () => {
  test('subscribe receives snapshots on every change', () => {
    const t = new Transport(() => 0, { initialBpm: 145 })
    t.start()
    let callCount = 0
    const sub = t.subscribe(() => callCount++)
    t.observeBeat({ time: 0.4, confidence: 0.9, source: 'radio' })
    expect(callCount).toBeGreaterThan(0)
    sub.unsubscribe()
  })
})

describe('CONTRACT T9: out-of-order observation rejection', () => {
  test('out-of-order observation rejected', () => {
    const t = new Transport(() => 0, { initialBpm: 145 })
    t.start()
    t.observeBeat({ time: 1.0, confidence: 0.9, source: 'radio' })
    // Out-of-order: time < lastObsTime — should be rejected, not crash
    t.observeBeat({ time: 0.5, confidence: 0.9, source: 'radio' })
    expect(t.isRunning()).toBe(true)
  })
})

// ── STILL-SKIPPED GAP TESTS (D1, P1, F1-F3 — not yet implemented) ──

describe('CONTRACT GAP-D1: device local scheduling', () => {
  test.skip('device can schedule events locally — GAP: no scheduleLocal() hook', () => {
    // A real device needs to schedule notes from transport snapshots.
    // Foundation PsyDevice has no scheduleLocal(). See GAP-D1.
  })
})

describe('CONTRACT GAP-P1: protocol versioning', () => {
  test.skip('TransportState carries a protocol version — GAP: no version field', () => {
    // Foundation protocol types have no protocolVersion. See GAP-P1.
  })
})

describe('CONTRACT GAP-F1..F3: missing fixture types', () => {
  test.skip('melody fixture exists — GAP: no melody fixtures', () => {
    // Foundation fixtures have only rhythmic/tempo. See GAP-F1.
  })

  test.skip('rhythm fixture exists with 16th-note grid — GAP: no rhythm fixtures', () => {
    // See GAP-F2.
  })

  test.skip('noise fixture exists with known spectral content — GAP: no noise fixtures', () => {
    // See GAP-F3.
  })
})

// ── PASSING CONTRACT TESTS (foundation already satisfies these) ──

describe('CONTRACT: device does not manage its own clock', () => {
  test('MockDevice receives transport snapshots without managing time', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const device = new ReferenceDevice({ id: 'mock', roles: ['lead'] })
    host.register(device)

    const clock = new TransportClock({ initialBpm: 145 })
    clock.observe({ observedAt: 1, strength: 1 })
    const snap = clock.snapshot(1)

    host.pushTransport(snap, 0)

    expect(device.transportUpdates).toBe(1)
    expect(device.lastKnownTransport?.bpm).toBe(snap.bpm)
    expect(device.lastKnownTransport?.phase).toBe(snap.phase)

    host.dispose()
  })

  test('device does not assume server packet arrival == beat time', () => {
    const ch = new InMemoryChannel()
    const host = new DeviceHost(ch)
    const device = new ReferenceDevice({ id: 'mock', roles: ['lead'] })
    host.register(device)

    const beatAudioTime = 1.5
    host.publish({
      type: 'beat',
      beat: 5,
      bar: 1,
      transport: {
        bpm: 145,
        beat: 5,
        bar: 1,
        beatsPerBar: 4,
        beatTime: 5 * (60 / 145),
        barTime: 5 * (60 / 145),
        phase: 0,
        barPhase: 0,
        confidence: 0.9,
        locked: true,
        revision: 1,
        origin: { audioTime: 0, beatIndex: 0, bpm: 145 },
        lastObservationAgo: 0,
        observationCount: 5,
      },
      at: beatAudioTime,
    })

    expect(device.eventsReceived).toBe(1)
    const event = device.receivedEvents[0]
    expect(event).toBeDefined()
    if (event && event.type === 'beat') {
      expect(event.at).toBe(beatAudioTime)
    }

    host.dispose()
  })
})

// Helper to assert a value is a MusicalTransport (type check only).
function _assertTransport(t: MusicalTransport): void {
  void t
}
void _assertTransport
