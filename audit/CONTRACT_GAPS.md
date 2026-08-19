# CONTRACT GAPS

Documented API gaps between `psy-foundation` and the proven `psy4` runtime.
Each gap is a contract that the foundation MUST satisfy before it can be
canonical for that domain. These gaps are proven by the consumer contract
tests in `tests/consumer-contract/` (which FAIL until the gaps are filled).

## Transport gaps (CRITICAL)

### GAP-T1: epoch

**PSY4**: `TransportSnapshot.epoch` increments on every re-anchor/seek/reset/
start/resume. Consumers compare epoch to detect clock disruptions.

**Foundation**: has `revision` (similar concept) but:
- Does NOT increment on AudioContext resume (no such concept).
- Does NOT increment on seek (no seek API).
- Does NOT increment on setTempo (no setTempo API).
- Semantics are weaker (revision bumps on relock, not on every disruption).

**Contract test**: `tests/consumer-contract/transport-contract.test.ts` —
"epoch increments on seek" → FAILS (no seek API).

**Fix**: Add `epoch` to MusicalTransport. Increment on start/stop/seek/
reset/resume/re-anchor. Replace `revision` or merge semantics.

---

### GAP-T2: source

**PSY4**: `TransportSnapshot.source` is `'internal' | 'radio' | 'external' | 'manual'`.
Transport tracks what is driving the tempo.

**Foundation**: no source field. Transport assumes all observations are equal.

**Contract test**: "source reflects observation origin" → FAILS.

**Fix**: Add `source` to MusicalTransport. Track per-observation source.
Default to `'internal'`; switch to `'radio'` when radio observations arrive.

---

### GAP-T3: holdover

**PSY4**: `loseSource()` enters holdover mode. Transport continues at last
known BPM with decaying confidence. No hard stop.

**Foundation**: no holdover. When observations stop, confidence decays via
`gapTimeout`, but there's no explicit holdover state or `loseSource()` API.

**Contract test**: "loseSource enters holdover, transport continues" → FAILS.

**Fix**: Add `loseSource()` and `holdover` state. Confidence decays on a
defined curve. Transport keeps running at last BPM.

---

### GAP-T4: AudioContext integration

**PSY4**: `MusicalTransport(nowFn)` where `nowFn = () => audioContext.currentTime`.
All time is AudioContext domain. `onAudioContextResume()` re-anchors.

**Foundation**: `snapshot(atAudioTime)` — caller passes time in. No `nowFn`.
No `onAudioContextResume`.

**Contract test**: "transport reads AudioContext.currentTime via nowFn" → FAILS.

**Fix**: Add `nowFn` constructor parameter. Add `onAudioContextResume()`.

---

### GAP-T5: predictBeats(horizonSec)

**PSY4**: `predictBeats(0.2)` returns array of upcoming beat times within 0.2s.
Used by scheduler for lookahead. (Note: the 414ms bug was caused by misusing
this for 16th-note scheduling — see SCHEDULER gaps.)

**Foundation**: `predict(atAudioTime)` returns a single float (beat index at a
future time). No array-of-times API.

**Contract test**: "predictBeats returns array of upcoming beat times" → FAILS.

**Fix**: Add `predictBeats(horizonSec): number[]`.

---

### GAP-T6: subscribe(listener)

**PSY4**: `subscribe(listener)` returns a subscription with unsubscribe.
Listeners receive TransportSnapshot on every state change.

**Foundation**: `onRevision(cb)` — only fires on revision bumps, not on every
snapshot. No general subscribe.

**Contract test**: "subscribe receives snapshots on every change" → FAILS.

**Fix**: Add `subscribe(listener): { unsubscribe }`.

---

### GAP-T7: seek(beatIndex)

**PSY4**: `seek(beatIndex)` jumps to a specific beat. Increments epoch.

**Foundation**: no seek. Only `reset()`.

**Contract test**: "seek jumps to beat 40, bar becomes 10" → FAILS.

**Fix**: Add `seek(beatIndex)`.

---

### GAP-T8: setTempo(bpm, source) without phase reset

**PSY4**: `setTempo(bpm, source)` changes tempo WITHOUT resetting phase.
Re-anchors to preserve position. Increments epoch.

**Foundation**: tempo only changes via observation smoothing. No explicit
setTempo API.

**Contract test**: "setTempo changes BPM, beat continues, epoch increments" → FAILS.

**Fix**: Add `setTempo(bpm, source)`.

---

### GAP-T9: out-of-order observation rejection

**PSY4**: observations with `time < lastObsTime` are rejected (ADV-2 test).

**Foundation**: `BeatEstimator.ingest` checks `intervalSec > 0` but does not
explicitly reject out-of-order observations at the transport level.

**Contract test**: "out-of-order observation rejected, no backward time" → FAILS.

**Fix**: Reject observations where `observedAt < lastObservedAt` in TransportClock.

---

### GAP-T10: stale event policy

**PSY4**: DROP STALE — when scheduler wakes after a stall, it computes position
from AudioContext time, not from accumulated counters. Stale events are dropped.

**Foundation**: no stale event concept (offline scheduler).

**Contract test**: N/A (scheduler gap, not transport).

**Fix**: Documented in scheduler gaps.

## Radio gaps (CRITICAL)

### GAP-R1: signal state vs observation state separation

**PSY4**: `RadioSignalState` (9 states: NO_SIGNAL, WEAK, STABLE, LOST, etc.)
is SEPARATE from `RadioObservationState` (6 states: LOCKING, FOLLOWING, etc.).

**Foundation**: `Analyzer` mixes signal and observation. No explicit states.

**Contract test**: "signal state and observation state are separate" → FAILS.

**Fix**: Split `packages/analysis` into signal layer + observation layer.

---

### GAP-R2: real confidence (not loudness)

**PSY4**: confidence = onsetStrength×0.5 + regularityFit×0.3 + signalQuality×0.2.

**Foundation**: confidence = onset strength (loudness proxy).

**Contract test**: "confidence is not loudness" → FAILS.

**Fix**: Compute real confidence in the observation layer.

---

### GAP-R3: triple timestamp model

**PSY4**: every observation carries `observedAt` + `estimatedAt` + `predictedAt`
(latency-corrected).

**Foundation**: only `observedAt`.

**Contract test**: "observations carry estimatedAt (latency-corrected)" → FAILS.

**Fix**: Add latency model to observation layer.

---

### GAP-R4: transport boundary strictness

**PSY4**: only `{time, confidence, source}` crosses into Transport. No raw audio,
FFT, spectral features, or occupancy.

**Foundation**: `Analyzer` exposes features that could leak into transport.

**Contract test**: "transport receives only {time, confidence, source}" → FAILS.

**Fix**: Enforce the boundary in the observation layer's output type.

## Scheduler gaps (HIGH RISK)

### GAP-S1: lookahead scheduling

**PSY4**: `scheduleAheadTime = 0.15s`. Scheduler wakes every 25ms and schedules
all 16th notes within the lookahead window.

**Foundation**: offline `schedule()` has no lookahead concept.

**Contract test**: "runtime scheduler schedules ahead by 150ms" → FAILS.

**Fix**: Build a runtime scheduler adapter (Phase B of migration plan).

---

### GAP-S2: 16th-note scheduling from beat grid (the 414ms fix)

**PSY4**: computes 16th-note times as `beatTime + k * stepDur` (k=0,1,2,3).
NOT `predictBeats(0.15)` which returns beat boundaries (414ms apart at 145 BPM).

**Foundation**: scheduler works per-bar, not per-16th-note-from-beat-grid.

**Contract test**: "scheduler schedules 16th notes continuously at 145 BPM" → FAILS.

**Fix**: Add 16th-note scheduling mode to the runtime scheduler adapter.

---

### GAP-S3: stale event dropping

**PSY4**: `if (stepTime > now && stepIdx > lastScheduledBeatIndex)` — drops
stale events after tab suspension.

**Foundation**: no stale concept.

**Contract test**: "stale events dropped after suspension" → FAILS.

**Fix**: Add stale-event policy to runtime scheduler adapter.

## Protocol gaps (LOW RISK)

### GAP-P1: versioning

**Foundation**: no version field on protocol types.

**Contract test**: "protocol types carry a version" → FAILS.

**Fix**: Add `protocolVersion: 1` to TransportState / MusicalEvent / etc.

## Device SDK gaps (LOW RISK)

### GAP-D1: local scheduling hooks

**Foundation**: PsyDevice has no `scheduleLocal(events)` method.

**Contract test**: "device can schedule events locally from transport snapshots" → FAILS.

**Fix**: Add optional `onScheduledEvent` + a local scheduling helper.

## Material gaps (LOW RISK)

### GAP-M1: validation

**Foundation**: no `validateMaterial(material)` function.

**Contract test**: "invalid material throws" → FAILS.

**Fix**: Add validation function.

### GAP-M2: provenance

**Foundation**: `source` field is a string, no structured provenance.

**Contract test**: "provenance tracks origin repo + commit" → FAILS.

**Fix**: Add structured provenance `{repo, commit, author, extractedAt}`.

## Fixtures gaps (LOW RISK)

### GAP-F1: melody fixtures

**Foundation**: no melody fixtures (only rhythmic/tempo).

**Contract test**: "melody fixture provides ground-truth pitches" → FAILS.

**Fix**: Add melody fixtures (sine tones at known pitches).

### GAP-F2: rhythm fixtures

**Foundation**: no rhythm fixtures (only beat onsets).

**Contract test**: "rhythm fixture provides ground-truth 16th-note grid" → FAILS.

**Fix**: Add rhythm fixtures.

### GAP-F3: noise fixtures

**Foundation**: no noise fixtures.

**Contract test**: "noise fixture has known spectral content" → FAILS.

**Fix**: Add white/pink noise fixtures.

## Summary

| Domain | Critical gaps | Low-risk gaps |
| --- | --- | --- |
| Transport | 10 | 0 |
| Radio | 4 | 0 |
| Scheduler | 3 | 0 |
| Protocol | 0 | 1 |
| Device SDK | 0 | 1 |
| Material | 0 | 2 |
| Fixtures | 0 | 3 |

**Blocking conflicts**: Transport (10 critical) + Radio (4 critical) + Scheduler (3 critical) = 17 critical gaps that MUST be closed before foundation can be canonical for those domains.

**Current runtime safety**: SAFE. No migration is performed. PSY4's runtime is untouched.
