# FOUNDATION RECONCILIATION

Cross-repo audit: `psy-foundation` vs `psy4` (reference runtime).

PSY4 is the **proven runtime**. Foundation is the **canonical shared infrastructure
target**. This audit determines, per domain, what is canonical, what is reference-only,
and what requires an adapter or rewrite.

## PSY4 reference runtime

```
RADIO → RadioObservationLayer → MusicalTransport → Scheduler → AudioContext → continuous playback
```

PSY4 proven test counts (from `tests/foundation/*-results.json`):

| Suite | Tests | Status |
| --- | --- | --- |
| transport-tests | 21 | pass |
| transport-adversarial | 6 | pass |
| transport-runtime-ownership | 15 | pass |
| playback-reality | 18 | pass |
| radio-observation-tests | 20 | pass |
| radio-adversarial | 12 | pass |
| radio-integration-tests | 12 | pass |
| **Foundation total** | **104** | **all pass** |

Plus pre-foundation verified subsystems: BeatPLL (48 tests), MelodyObserver/YIN (13 tests),
PatternMutator (3+200-cycle), RadioStateGate (8 tests), Learning (4 tests).

PSY4 HEAD at audit: `6d15032` — "FOUNDATION RECONCILIATION: audit psy4 vs psy-foundation".

## psy-foundation current state

- HEAD: `9063064` (post-final-polish)
- 13 packages, 250 tests, all green
- typecheck + lint clean
- No browser verification yet (mock-clock only)

## Domain-by-domain reconciliation

### TRANSPORT

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| Implementation | `packages/transport/src/transport.ts` — TransportClock | `foundation/transport/MusicalTransport.ts` (295 lines) |
| Clock source | injected `atAudioTime` parameter | `nowFn: () => number` (AudioContext.currentTime) |
| Anchor model | origin `{audioTime, beatIndex, bpm}` | anchor `{anchorTime, anchorBeatIndex}` + `beatDuration` |
| `beatTime` | derived (beatFloat * secPerBeat) | explicit field (audio time of last beat boundary) |
| `barTime` | derived | explicit field |
| `phase` / `barPhase` | ✓ | ✓ |
| `epoch` | ✗ (has `revision`, similar but weaker) | ✓ — increments on seek/reset/start/resume/re-anchor |
| `source` | ✗ | ✓ — `'internal'\|'radio'\|'external'\|'manual'` |
| `holdover` | ✗ (gap handling only) | ✓ — `loseSource()`, holdover with decaying confidence |
| `onAudioContextResume` | ✗ | ✓ — re-anchors on resume, increments epoch |
| `predictBeats(horizonSec)` | ✗ (has `predict(atTime)` only) | ✓ — returns array of upcoming beat times |
| `subscribe(listener)` | ✗ (has `onRevision` only) | ✓ — full subscription with unsubscribe |
| `seek(beatIndex)` | ✗ | ✓ |
| `setTempo(bpm, source)` | ✗ | ✓ — re-anchors to preserve position |
| Immutable snapshot | ✓ (returns object) | ✓ (readonly TransportSnapshot) |
| Half/double tempo | octave-fold in BeatEstimator | hypotheses tracked (`getHypotheses()`) |
| Out-of-order observations | not handled | rejected (ADV-2 test) |
| Stale event policy | ✗ | DROP STALE (documented) |
| AudioContext integration | ✗ (pure logic) | ✓ (designed around `nowFn`) |
| Tab suspension | ✗ | designed for (epoch + drop-stale) |
| Tests | 12 | 60 (21+6+15+18) |
| Runtime proven | ✗ | ✓ (browser, continuous playback) |
| API quality | medium | high |
| Performance | unmeasured at runtime | 30-min drift 0.00ms, P95 0.00ms |

**STATUS**: NOT CANONICAL

**RECOMMENDATION**: PSY4 REFERENCE ONLY. Foundation transport is missing epoch, source,
holdover, AudioContext integration, predictBeats, subscribe, seek. PSY4's transport is
the proven canonical model. **Do NOT replace it.** Create a migration plan (see
MIGRATION_PLAN.md) to bring foundation up to PSY4's level feature-by-feature, but only
after consumer contract tests prove the foundation API can express everything PSY4 needs.

---

### RADIO

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| Implementation | `packages/analysis/src/onset.ts` + `analyzer.ts` | `foundation/radio/RadioObservationLayer.ts` + `BeatObservationEngine.ts` |
| Layering | SIGNAL → FEATURES → INFERENCE (mixed in Analyzer) | SIGNAL → FEATURES → OBSERVATION → INFERENCE → TRANSPORT (strict separation) |
| Signal state | ✗ (just RMS) | ✓ — 9 states (NO_SIGNAL, WEAK, STABLE, LOST, DEGRADED, etc.) |
| Observation state | ✗ | ✓ — 6 states (NO_SIGNAL, SIGNAL_PRESENT, LOCKING, FOLLOWING, DEGRADED, LOST) |
| Confidence model | onset strength (loudness proxy) | onsetStrength×0.5 + regularityFit×0.3 + signalQuality×0.2 (real confidence) |
| Timestamp model | `observedAt` only | `observedAt` + `estimatedAt` + `predictedAt` (latency-corrected) |
| Transport boundary | fuzzy (Analyzer feeds transport directly) | strict — only `{time, confidence, source}` crosses |
| Pitch observation | in Analyzer (chroma) | separate PitchObserver wrapping MelodyObserver (YIN, ±10 cents) |
| Occupancy | leaks into transport | stays in RadioObservationLayer (for arranger only) |
| Bounded history | ✗ (unbounded in Analyzer) | ✓ (ring buffer, F2.11) |
| Tests | 26 (analysis) | 44 (20+12+12) |
| Runtime proven | ✗ | ✓ (radio integration tests) |

**STATUS**: NOT CANONICAL

**RECOMMENDATION**: PSY4 REFERENCE ONLY. Foundation analysis mixes signal/features/
inference. PSY4's RadioObservationLayer is the canonical separation. The foundation's
`packages/analysis` should be restructured to match PSY4's layering, but NOT during this
gate. Adapter required for any foundation consumer that needs radio.

---

### SCHEDULER

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| Implementation | `packages/scheduler/src/scheduler.ts` | inline in `psyLive.ts` (scheduler method) |
| Type | pure function: `schedule(plan, opts) → ScheduledEvent[]` | runtime scheduler with setInterval(25ms) + 0.15s lookahead |
| Lookahead | ✗ (offline, no lookahead concept) | ✓ — `scheduleAheadTime = 0.15` |
| AudioContext scheduling | ✗ (emits audio-time values) | ✓ — schedules 16th notes directly to AudioContext |
| Continuous 16th scheduling | ✗ (per-bar) | ✓ — computes stepTime from beat grid |
| Stale event policy | ✗ | ✓ — DROP STALE (stepIdx > lastScheduledBeatIndex) |
| STOP/PLAY | ✗ | ✓ (transport.start/stop) |
| Event deduplication | ✗ | ✓ — `lastScheduledBeatIndex` |
| Suspension handling | ✗ | ✓ — computes position from AudioContext, drops stale |
| The 414ms bug | N/A (offline) | FIXED — was `predictBeats(0.15)` returning empty at 145 BPM; now computes 16th-note times from beat grid |
| Tests | 18 | 18 (playback-reality) |
| Runtime proven | ✗ | ✓ (continuous playback verified) |

**STATUS**: NOT CANONICAL (different purpose)

**RECOMMENDATION**: ADAPTER REQUIRED. Foundation scheduler is an **offline plan→events**
converter. PSY4's scheduler is a **runtime AudioContext scheduler**. They are not the
same thing. The foundation scheduler is correct for what it does (deterministic plan
rendering), but it cannot drive runtime playback without an adapter that adds lookahead,
AudioContext integration, and stale-event policy. **Do NOT replace PSY4's scheduler.**
The foundation scheduler can serve as the plan→events layer that a future runtime
scheduler consumes.

---

### PROTOCOL

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| TransportState | ✓ | ✓ (TransportSnapshot) |
| MusicalContext | ✓ | ✗ (not formalized) |
| MusicalEvent | ✓ (6 types) | ✗ (no event bus) |
| DeviceCapabilities | ✓ | ✗ |
| DeviceState | ✓ | ✗ |
| Material | ✓ (rich schema) | ✗ |
| Experience | ✓ | ✗ |
| Channel abstraction | ✓ (InMemoryChannel) | ✗ |
| Device-agnostic | ✓ | ✓ (psy4 doesn't assume devices) |
| Browser-friendly | ✓ | ✓ |
| Versioned | ✗ | ✗ |
| Serializable | ✓ (JSON) | ✓ |

**STATUS**: CANONICAL CANDIDATE (with versioning)

**RECOMMENDATION**: CANONICAL FOUNDATION. Foundation protocol is more complete than
PSY4's (PSY4 has no formal protocol). Add versioning (see FOUNDATION_API.md) and it
becomes canonical. No migration needed — PSY4 doesn't have a competing protocol.

---

### DEVICE SDK

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| PsyDevice interface | ✓ | ✗ |
| DeviceHost | ✓ | ✗ |
| ReferenceDevice | ✓ | ✗ |
| Transport subscription | ✓ (pushTransport) | ✗ |
| Context subscription | ✓ (pushContext) | ✗ |
| Event subscription | ✓ (channel routing) | ✗ |
| Local scheduling hooks | ✗ | ✗ |
| Lifecycle | ✓ (onStart/onStop) | ✗ |
| Graceful fallback | ✓ (keeps last transport) | ✗ |
| React/Next.js coupling | ✗ (clean) | ✗ (clean) |
| Tests | 12 | 0 |

**STATUS**: CANONICAL CANDIDATE

**RECOMMENDATION**: CANONICAL FOUNDATION. PSY4 has no device SDK. Foundation's is
clean and decoupled. Add local scheduling hooks (consumer contract test will verify)
and it's canonical. No migration needed.

---

### MUSIC

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| Scales | 18 | ✗ (inline in psyLive) |
| Chords | 18 + voice leading | ✗ |
| Motif generator | ✓ (call-&-response from psy) | ✗ (psy4 uses psyLive patterns) |
| Variation operators | ✓ (transpose/invert/fragment/retrograde) | ✗ |
| Bass grammar | ✓ (kb3 + 3 styles) | inline in psyLive |
| Rhythm patterns | ✓ (5 builders) | inline in psyLive |
| Tension curves | ✓ | ✗ |
| Tests | 43 | 0 (psy4's music is inline) |

**STATUS**: CANONICAL CANDIDATE

**RECOMMENDATION**: CANONICAL FOUNDATION. Foundation music is more complete and
extracted. PSY4's music logic is inline in psyLive. No migration during this gate.

---

### MATERIAL

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| Schema | ✓ (9 types + metadata) | ✗ |
| MaterialLibrary | ✓ (query/usage/reward) | ✗ |
| Seed library | ✓ (18 materials) | ✗ |
| Serialization | ✓ (toJSON/fromJSON) | ✗ |
| Provenance | ✗ | ✗ |
| Validation | ✗ | ✗ |
| Tests | 23 | 0 |

**STATUS**: CANONICAL CANDIDATE (needs validation + provenance)

**RECOMMENDATION**: CANONICAL FOUNDATION after adding validation + provenance. PSY4
has no material library. No migration needed.

---

### DSP

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| Oscillators | ✓ (PolyBLEP, FM, wavetable) | inline in psyLive (createOscillator) |
| Filters | ✓ (OnePole, Biquad, Moog) | inline (createBiquadFilter) |
| Envelopes | ✓ (ADSR, PitchEnv) | inline (AudioParam ramps) |
| Effects | ✓ (Delay, Reverb) | inline |
| Metering | ✓ (RMS, Peak, LUFS) | ✗ |
| Voice pool | ✓ (pre-allocated) | ✗ (per-note create+destroy in psyLive) |
| AudioWorklet | ✗ | ✗ |
| Tests | 39 | 0 |

**STATUS**: CANONICAL CANDIDATE

**RECOMMENDATION**: CANONICAL FOUNDATION. Foundation DSP is extracted and tested.
PSY4 uses native Web Audio nodes inline. No migration during this gate.

---

### FIXTURES

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| Synthetic radio corpus | ✓ (14 fixtures) | ✗ (uses real radio streams) |
| Deterministic | ✓ (mulberry32 seeded) | ✗ |
| Tempo fixtures | ✓ | ✗ |
| Jitter fixtures | ✓ | ✗ |
| Dropout fixtures | ✓ (gap-500ms, gap-2s) | ✗ |
| Phase fixtures | ✓ | ✗ |
| Melody fixtures | ✗ | ✗ |
| Rhythm fixtures | ✗ | ✗ |
| Noise fixtures | ✗ | ✗ |
| Signal-loss fixtures | ✓ (breakdown) | ✗ |
| Tests | 10 | 0 |

**STATUS**: CANONICAL CANDIDATE (needs melody/rhythm/noise fixtures)

**RECOMMENDATION**: CANONICAL FOUNDATION after adding melody/rhythm/noise fixtures.
PSY4 has no synthetic fixtures. No migration needed.

---

### LEARNING

| Field | psy-foundation | psy4 |
| --- | --- | --- |
| Model | contextual bandit with abstention | statistical bookkeeping (vote tally) |
| CONTEXT+ACTION+OUTCOME+REWARD | ✓ | ✗ |
| DO NOTHING legal | ✓ | ✗ |
| Regret / retrieval quality | ✓ | ✗ |
| Tests | 32 | 4 (statistical) |

**STATUS**: CANONICAL CANDIDATE

**RECOMMENDATION**: CANONICAL FOUNDATION. Foundation learning is more advanced than
PSY4's statistical bookkeeping. No migration during this gate.

## Summary table

| Domain | Status | Recommendation |
| --- | --- | --- |
| TRANSPORT | NOT CANONICAL | PSY4 REFERENCE ONLY |
| RADIO | NOT CANONICAL | PSY4 REFERENCE ONLY |
| SCHEDULER | NOT CANONICAL (different purpose) | ADAPTER REQUIRED |
| PROTOCOL | CANONICAL CANDIDATE | CANONICAL FOUNDATION (add versioning) |
| DEVICE SDK | CANONICAL CANDIDATE | CANONICAL FOUNDATION (add local scheduling hooks) |
| MUSIC | CANONICAL CANDIDATE | CANONICAL FOUNDATION |
| MATERIAL | CANONICAL CANDIDATE | CANONICAL FOUNDATION (add validation + provenance) |
| DSP | CANONICAL CANDIDATE | CANONICAL FOUNDATION |
| FIXTURES | CANONICAL CANDIDATE | CANONICAL FOUNDATION (add melody/rhythm/noise fixtures) |
| LEARNING | CANONICAL CANDIDATE | CANONICAL FOUNDATION |

## Duplicate implementations

- **Transport**: foundation TransportClock vs psy4 MusicalTransport. PSY4 is richer.
- **Radio**: foundation Analyzer vs psy4 RadioObservationLayer. PSY4 is properly layered.
- **Scheduler**: foundation offline scheduler vs psy4 runtime scheduler. Different purposes.
- **BeatPLL**: foundation BeatEstimator vs psy4 `src/lib/beatPLL.ts`. PSY4's is proven (48 tests).

## The single most important finding

**Foundation transport is NOT ready to be canonical.** PSY4's MusicalTransport has:
epoch, source, holdover, AudioContext integration, predictBeats, subscribe, seek,
setTempo-without-phase-reset, out-of-order rejection, tab-suspension handling.
Foundation transport has none of these. Replacing PSY4's transport with foundation's
would be a regression.

The correct path: bring foundation transport up to PSY4's level (feature-by-feature,
test-by-test) BEFORE any migration. This is Phase B/C of the migration plan.
