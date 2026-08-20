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
import { TransportClock } from '@psy-foundation/transport'
import type { MusicalTransport } from '@psy-foundation/transport'

// ── GAP TESTS (skipped — document what's missing) ──

describe('CONTRACT GAP-T1: epoch increments on disruptions', () => {
  test.skip('epoch increments on seek — GAP: foundation has no seek() API', () => {
    // PSY4: transport.seek(40) → epoch++, beat=40, bar=10.
    // Foundation: no seek(). See CONTRACT_GAPS.md GAP-T7.
  })

  test.skip('epoch increments on setTempo without phase reset — GAP: no setTempo() API', () => {
    // PSY4: transport.setTempo(145, 'internal') → bpm changes, epoch++, phase preserved.
    // Foundation: tempo only changes via observation smoothing. See GAP-T8.
  })
})

describe('CONTRACT GAP-T2: source tracking', () => {
  test.skip('transport tracks source of observations — GAP: no source field', () => {
    // PSY4: snapshot.source ∈ {'internal','radio','external','manual'}.
    // Foundation: no source field. See GAP-T2.
  })
})

describe('CONTRACT GAP-T3: holdover mode', () => {
  test.skip('loseSource enters holdover, transport continues — GAP: no loseSource() API', () => {
    // PSY4: transport.loseSource() → holdover, confidence decays, BPM continues.
    // Foundation: no holdover. See GAP-T3.
  })
})

describe('CONTRACT GAP-T4: AudioContext integration', () => {
  test.skip('transport reads AudioContext.currentTime via nowFn — GAP: no nowFn constructor', () => {
    // PSY4: new MusicalTransport(() => audioContext.currentTime, config).
    // Foundation: TransportClock(config) — caller passes time to snapshot().
    // See GAP-T4.
  })

  test.skip('onAudioContextResume re-anchors — GAP: no onAudioContextResume() API', () => {
    // PSY4: transport.onAudioContextResume() → re-anchor, epoch++.
    // Foundation: no resume handling. See GAP-T4.
  })
})

describe('CONTRACT GAP-T5: predictBeats(horizonSec)', () => {
  test.skip('predictBeats returns array of upcoming beat times — GAP: no predictBeats()', () => {
    // PSY4: transport.predictBeats(0.5) → [1.4, 1.8, 2.2] (array of times).
    // Foundation: clock.predict(atTime) → single float (beat index). See GAP-T5.
  })
})

describe('CONTRACT GAP-T6: subscribe(listener)', () => {
  test.skip('subscribe receives snapshots on every change — GAP: only onRevision', () => {
    // PSY4: transport.subscribe(listener) → listener fires on every snapshot change.
    // Foundation: clock.onRevision(cb) → only on revision bumps. See GAP-T6.
  })
})

describe('CONTRACT GAP-T9: out-of-order observation rejection', () => {
  test.skip('out-of-order observation rejected — GAP: not rejected at transport level', () => {
    // PSY4: observation with time < lastObsTime → rejected (ADV-2 test).
    // Foundation: BeatEstimator checks intervalSec>0 but transport accepts it.
    // See GAP-T9.
  })
})

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
