# TRANSPORT CANONICAL DESIGN

Contract-first design for foundation Transport v1. Defines behavior, not
implementation. Every behavior is cross-referenced to the psy4 test that
proves it (A-P matrix + ADV-1..6).

## RULE 2 — Ownership

**Q: Who owns musical time?**
A: `Transport` is the SINGLE owner. No consumer, scheduler, or device may
maintain its own BPM, beat, bar, or phase. Consumers read `TransportSnapshot`
(immutable) and subscribe for changes.

## RULE 3 — The single clock

**Q: What is the only clock?**
A: `nowFn: () => number` — an injected function returning audio-context time
(seconds). In a browser, this is `() => audioContext.currentTime`. In tests,
it is a mock. `Date.now()`, `performance.now()`, and `setInterval` accumulators
are FORBIDDEN as sources of musical time.

## RULE 4 — Anchor model

**Q: What is an anchor?**
A: `{ anchorTime, anchorBeatIndex, bpm }`. Beat time is computed as:
```
beatTime = anchorTime + (beatIndex - anchorBeatIndex) * (60 / bpm)
```
This is **anchor-based** — no accumulation. The only drift source is BPM
estimation error. Re-anchoring resets the anchor without accumulating error.

## RULE 5 — Epoch

**Q: What is epoch?**
A: A monotonically increasing integer that increments on every clock
disruption. Consumers compare epoch to detect that the clock was disrupted.

**Epoch increments on:**
- `start()` — first anchor
- `stop()` — clock frozen
- `seek(beatIndex)` — position jump
- `setTempo(bpm, source)` — tempo change (re-anchor to preserve position)
- `reset()` — full reset
- `onAudioContextResume()` — AudioContext resumed (re-anchor)
- re-anchor during observation (large phase error)

**Epoch does NOT increment on:**
- `observeBeat()` (normal observation)
- `snapshot()` (read-only)
- `subscribe()` / `unsubscribe()`
- holdover entry/exit (confidence changes, not position)

## RULE 6 — Tempo change

**Q: What happens on tempo change?**
A: `setTempo(bpm, source)` re-anchors to preserve the CURRENT position. The
beat index and phase are NOT reset. Epoch increments so consumers can detect
the disruption. Beat continuity is preserved.

Test: C-TempoChange (120→150, beat continues, no phase reset).

## RULE 7 — Seek

**Q: What happens on seek?**
A: `seek(beatIndex)` jumps to the given beat. Anchor is set to the current
audio time at the given beat index. Epoch increments. Bar is derived:
`bar = floor(beatIndex / beatsPerBar)`.

Test: L-Seek (seek to beat 40 → bar 10).

## RULE 8 — Radio loss

**Q: What happens on radio loss?**
A: `loseSource()` enters holdover mode:
- `source` transitions to `'internal'`
- `locked` becomes `false`
- `confidence` drops immediately by 50%
- BPM continues at last known value
- Confidence decays exponentially (half-life configurable)
- Transport keeps running — NO hard stop

Test: J-RadioLossRecovery.

## RULE 9 — Radio recovery

**Q: What happens on radio recovery?**
A: The next `observeBeat()` with `source: 'radio'` exits holdover:
- `holdoverActive = false`
- `source` transitions to `'radio'`
- Confidence rebuilds from observations
- No phase jump (re-anchor is smooth, blended 30% per bar boundary)

Test: J-RadioLossRecovery.

## RULE 10 — Out-of-order observations

**Q: What happens on out-of-order observations?**
A: Observations where `obs.time <= lastObsTime` are REJECTED. The transport
does not process them. `lastObsTime` is NOT updated (the rejected observation
is discarded entirely).

Test: ADV-2-OutOfOrder.

## RULE 11 — Duplicate observations

**Q: What happens on duplicate observations?**
A: Observations at the exact same time (`obs.time === lastObsTime`) are
rejected (treated as out-of-order, since `observedInterval <= 0`).

Test: ADV-6-DuplicateKicks.

## RULE 12 — Half/double tempo

**Q: What happens on half/double tempo ambiguity?**
A: The transport tracks `TempoHypothesis[]` for base/×2/÷2. When ambiguity
is high, `locked` is `false` or confidence is reduced. The transport does NOT
false-lock. Hypotheses are available via `getHypotheses()`.

Tests: G-HalfTempo, H-DoubleTempo.

## RULE 13 — Snapshot

**Q: What is a snapshot?**
A: `TransportSnapshot` — an immutable (all fields `readonly`) view of
transport state at a moment in time. Contains: timestamp, bpm, confidence,
locked, beatTime, barTime, beat, bar, beatIndex, phase, barPhase, source,
epoch, beatsPerBar, beatDuration, nextBeatTime.

**Q: Is snapshot immutable?**
A: YES. All fields are `readonly`. Consumers cannot modify transport state
through a snapshot. (Test: P-ImmutableSnapshot.)

## RULE 14 — Subscribe

**Q: How does a consumer subscribe?**
A: `subscribe(listener)` returns `{ unsubscribe() }`. The listener receives
a `TransportSnapshot` on every state change (observation, tempo change, seek,
holdover, etc.). Notifications are synchronous within the call that triggered
them.

Test: N-Subscribers.

## RULE 15 — Scheduler time

**Q: How does the scheduler get time without becoming a clock owner?**
A: The scheduler calls `transport.snapshot()` to read the current beat grid,
then calls `transport.predictBeats(horizonSec)` or computes 16th-note times
directly from `snap.beatTime + k * stepDuration`. The scheduler NEVER
maintains its own BPM, beat, or phase.

## RULE 16 — Prediction / grid

**Q: How does prediction work?**
A: `predictBeats(horizonSec)` returns an array of upcoming beat times within
the horizon. `gridAt(audioTime)` returns the beat grid position at any audio
time (beat index, phase, bar). These are pure functions of the anchor — no
side effects.

## RULE 17 — Confidence

**Q: What is confidence?**
A: `confidence` is a 0..1 value representing how sure the transport is about
the current BPM and phase. It is NOT loudness. It increases with consistent
observations and decays during holdover. `locked` becomes true when
confidence > threshold AND enough observations have been received.

## RULE 18 — Phase error

**Q: What is phase error?**
A: The difference between the predicted beat time and the observed beat time.
If phase error exceeds `reanchorThresholdSec` at a bar boundary, the transport
re-anchors (blended 30% correction). If phase error exceeds 3× the threshold
mid-bar, the transport re-anchors immediately.

## RULE 19 — Determinism

**Q: Is the transport deterministic?**
A: YES — given the same `nowFn` sequence and the same observations, the
transport produces the same snapshots. No `Math.random()`, no wall-clock
dependency. All randomness in the system (jitter fixtures, etc.) is external
and seeded.

## RULE 20 — No cumulative drift

**Q: Is there cumulative drift?**
A: NO. The anchor-based model eliminates accumulation. The only drift source
is BPM estimation error, which the PLL handles. 30-minute simulated drift
target: 0ms measurable (Test: K-30minDrift).

## API surface

```typescript
type TransportSource = 'internal' | 'radio' | 'external' | 'manual';

interface TransportSnapshot {
  readonly timestamp: number;
  readonly bpm: number;
  readonly confidence: number;
  readonly locked: boolean;
  readonly beatTime: number;
  readonly barTime: number;
  readonly beat: number;
  readonly bar: number;
  readonly beatIndex: number;
  readonly phase: number;
  readonly barPhase: number;
  readonly source: TransportSource;
  readonly epoch: number;
  readonly beatsPerBar: number;
  readonly beatDuration: number;
  readonly nextBeatTime: number;
  readonly holdover: boolean;
}

interface TransportObservation {
  readonly time: number;
  readonly confidence: number;
  readonly source: TransportSource;
}

interface TransportConfig {
  readonly initialBpm: number;
  readonly beatsPerBar: number;
  readonly minBpm: number;
  readonly maxBpm: number;
  readonly lockThreshold: number;
  readonly minObservationsForLock: number;
  readonly holdoverHalfLifeSec: number;
  readonly reanchorThresholdSec: number;
}

interface TransportSubscription { unsubscribe(): void }

interface TempoHypothesis {
  readonly bpm: number;
  readonly confidence: number;
  readonly evidence: number;
}

class Transport {
  constructor(nowFn: () => number, config?: Partial<TransportConfig>);
  start(): void;
  stop(): void;
  seek(beatIndex: number): void;
  setTempo(bpm: number, source?: TransportSource): void;
  observeBeat(obs: TransportObservation): void;
  loseSource(): void;
  onAudioContextResume(): void;
  reset(): void;
  snapshot(): TransportSnapshot;
  predictBeats(horizonSec?: number): number[];
  gridAt(audioTime: number): { beatIndex: number; phase: number; bar: number };
  getHypotheses(): TempoHypothesis[];
  subscribe(listener: (snap: TransportSnapshot) => void): TransportSubscription;
  isRunning(): boolean;
}
```

## What is NOT in Transport

- AudioBuffer, FFT, analyser, radio decoder — that's Radio
- DSP, oscillators, filters — that's DSP
- UI, React — that's the device
- Scheduler implementation — scheduler reads Transport, doesn't live in it
- Presets, patterns — that's Material
