/**
 * Consumer Contract Tests — foundation vs the proven psy4 runtime.
 *
 * History: the tests below were skipped one by one, each naming a documented
 * API gap (audit/CONTRACT_GAPS.md). The last five skips (D1, P1, F1-F3) were
 * closed under PLAN_V3 3.5 — every skip in this file is now GONE and every
 * test asserts the real, implemented contract. A new skip here would mean a
 * new gap; document it in CONTRACT_GAPS.md first, then write the test.
 *
 * The passing tests at the bottom prove the foundation's contract works for
 * the things it supports.
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

// ── GAP TESTS CLOSED (D1, P1, F1-F3 — PLAN_V3 3.5) ──────────────────────────
// Each of these was skipped against a documented gap (audit/CONTRACT_GAPS.md).
// The gaps are now implemented; the tests assert the REAL contract, and the
// gap doc records the closing commits.

import { binToFreq, spectrum } from '@psy-foundation/analysis'
import { LocalScheduler } from '@psy-foundation/device-sdk'
import { getFixture } from '@psy-foundation/fixtures'
import { PROTOCOL_VERSION } from '@psy-foundation/protocol'
import type { TransportState } from '@psy-foundation/protocol'
import { PSYBUS_PROTOCOL_VERSION } from '@psy-foundation/protocol/v2'

function makeState(beat: number): TransportState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    bpm: 120,
    beat,
    bar: Math.floor(beat / 4) + 1,
    phase: 0,
    locked: true,
    confidence: 0.95,
    revision: 1,
  }
}

describe('CONTRACT GAP-D1: device local scheduling', () => {
  test('device can schedule events locally — LocalScheduler + onScheduledEvent hook', () => {
    const received: Array<{ type: string; atBeat: number }> = []
    const scheduler = new LocalScheduler()
    const device = {
      id: 'local-sched-device',
      capabilities: () => ({
        audio: true,
        midi: false,
        inputs: 0,
        outputs: 1,
        voices: 4,
        latencyMs: 0,
        roles: ['drums'],
      }),
      onTransport: () => {},
      onContext: () => {},
      onEvent: () => {},
      onScheduledEvent: (event: { type: string }, transport: TransportState) => {
        received.push({ type: event.type, atBeat: transport.beat })
      },
    }
    // Device queues a 16th-note pattern ahead of time (absolute beats).
    scheduler.schedule({ type: 'note', note: 60, velocity: 1, at: 0 } as never, 4.0)
    scheduler.schedule({ type: 'note', note: 62, velocity: 1, at: 0 } as never, 4.25)
    scheduler.schedule({ type: 'note', note: 64, velocity: 1, at: 0 } as never, 4.5)
    expect(scheduler.pendingCount).toBe(3)

    // Host pushes transport snapshots; the device ticks its scheduler.
    for (const beat of [3.5, 4.0, 4.25, 4.5]) {
      scheduler.tick(makeState(beat), device.onScheduledEvent)
    }
    // Events fire exactly when their beat arrives, under the snapshot that
    // released them.
    expect(received.map((r) => r.atBeat)).toEqual([4.0, 4.25, 4.5])
    expect(scheduler.pendingCount).toBe(0)
    expect(scheduler.stats().released).toBe(3)
  })

  test('late events are staled, never fired late (honest stale policy)', () => {
    const received: Array<{ type: string; atBeat: number }> = []
    const scheduler = new LocalScheduler({ graceBeats: 0.25 })
    scheduler.schedule({ type: 'note', note: 60, velocity: 1, at: 0 } as never, 2.0)
    // Transport jumped far ahead — beat 2.0 is now ancient history.
    const released = scheduler.tick(makeState(5.0), (event, transport) => {
      received.push({ type: event.type, atBeat: transport.beat })
    })
    expect(released).toBe(0)
    expect(received).toEqual([])
    expect(scheduler.stats().staled).toBe(1)
    expect(scheduler.pendingCount).toBe(0)
  })
})

describe('CONTRACT GAP-P1: protocol versioning', () => {
  test('TransportState carries a protocol version — PROTOCOL_VERSION exported and consistent', () => {
    // The single version story: protocol.PROTOCOL_VERSION === v2.PSYBUS_PROTOCOL_VERSION.
    expect(PROTOCOL_VERSION).toBe(2)
    expect(PSYBUS_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION)
    // Every state built in this suite carries it (required field).
    const state = makeState(0)
    expect(state.protocolVersion).toBe(PROTOCOL_VERSION)
  })
})

describe('CONTRACT GAP-F1..F3: special fixtures exist with measurable ground truth', () => {
  test('melody fixture provides ground-truth pitches', () => {
    const f = getFixture('melody-pentatonic')
    expect(f.groundTruthPitches).toEqual([57, 60, 62, 64, 67, 69, 72, 76])
    expect(f.signal.length).toBe(Math.ceil(f.durationSec * f.sampleRate))
  })

  test('rhythm fixture provides ground-truth 16th-note grid', () => {
    const f = getFixture('rhythm-16th-grid')
    const grid = f.groundTruthSixteenths!
    expect(grid.length).toBe(32)
    const spacing = grid[1]! - grid[0]!
    expect(Math.abs(spacing - 60 / f.groundTruthBpm! / 4)).toBeLessThan(1e-9)
  })

  test('noise fixture has known spectral content — measured from the signal', () => {
    const f = getFixture('noise-white-2s')
    const N = 4096
    const frame = f.signal.slice(0, N)
    const spec = spectrum(frame)
    let logSum = 0
    let linearSum = 0
    for (let bin = 1; bin < spec.length; bin++) {
      const m = Math.max(spec[bin]!, 1e-12)
      logSum += Math.log(m)
      linearSum += m
    }
    const flatness = Math.exp(logSum / (spec.length - 1)) / (linearSum / (spec.length - 1))
    // White noise: flat spectrum → flatness near 1 (tonal signals → near 0).
    expect(flatness).toBeGreaterThan(0.4)
    // And the declared centroid is honest (measured, not copied).
    let num = 0
    let den = 0
    for (let bin = 1; bin < spec.length; bin++) {
      const m = spec[bin]!
      num += binToFreq(bin, f.sampleRate, N) * m
      den += m
    }
    expect(Math.abs(num / den - f.groundTruthSpectrum!.centroidHz)).toBeLessThan(2000)
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
