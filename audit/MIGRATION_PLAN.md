# MIGRATION PLAN

**Rule 0: NO BIG BANG.** No migration is performed during this gate. This document
defines the phased path from the current state (PSY4 reference + foundation
parallel) to the target state (foundation canonical, PSY4 = research lab, PSY6 =
consumer).

## Target end state

```
psy-foundation  = canonical shared infrastructure (bottom layer)
       ↑
       │
     PSY6  = consumer/product
       │
       ├── product UI
       ├── product arrangement
       └── product-specific behavior

psy4 = reference/research/runtime integration lab
```

NOT: three parallel foundations (psy4-foundation + psy-foundation + psy6-foundation).

## Phases

### PHASE A — Foundation test-only consumption

**Goal**: Prove the foundation API can express everything PSY4's runtime needs,
without touching PSY4's runtime.

**Steps**:
1. Write consumer contract tests (`tests/consumer-contract/`) that simulate a
   PSY4-like device consuming foundation transport/protocol/device-sdk.
2. The tests MUST FAIL if the foundation API cannot express:
   - epoch-based disruption detection
   - source tracking (internal/radio/external/manual)
   - holdover mode
   - AudioContext-driven snapshots
   - predictBeats for lookahead scheduling
3. The failing tests document the API gaps. Do NOT fill them yet.

**Risk**: None. Tests only, no runtime change.
**Rollback**: Delete the tests.
**Tests**: consumer-contract tests must pass before Phase B.
**Browser verification**: None needed (mock clock).

**Status**: NOT STARTED. Consumer contract tests are created during this gate
(see `tests/consumer-contract/`), but they will FAIL — that is expected and
documents the gaps.

---

### PHASE B — Compatibility Adapter

**Goal**: Build an adapter that lets PSY4's runtime consume foundation transport
WITHOUT replacing PSY4's MusicalTransport.

**Steps**:
1. Bring foundation transport up to PSY4's feature level: add epoch, source,
   holdover, AudioContext `nowFn`, predictBeats, subscribe, seek,
   setTempo-without-phase-reset, out-of-order rejection.
2. Port PSY4's 60 transport tests to the foundation package.
3. Build `FoundationTransportAdapter` that wraps foundation TransportClock and
   exposes PSY4's TransportSnapshot interface.
4. PSY4 continues using its own MusicalTransport; the adapter is test-only.

**Risk**: Medium. Transport feature parity is subtle (epoch semantics, holdover
decay curve, anchor model). Get any of these wrong and the adapter is useless.
**Rollback**: Remove the adapter; foundation transport stays at current level.
**Tests**: All 60 PSY4 transport tests must pass against the foundation adapter.
**Browser verification**: Run the playback-reality suite against the adapter.

**Status**: NOT STARTED. This is post-gate work.

---

### PHASE C — One Proven Subsystem

**Goal**: Migrate ONE PSY4 subsystem to foundation, end-to-end, in PSY4's runtime.

**Candidate**: `protocol` (lowest risk — PSY4 has no competing protocol).

**Steps**:
1. PSY4 imports `@psy-foundation/protocol` types.
2. PSY4's internal event emission uses foundation MusicalEvent types.
3. PSY4's transport snapshot is mapped to foundation TransportState.
4. All PSY4 tests still pass.

**Risk**: Low. Protocol is types-only; no runtime behavior change.
**Rollback**: Revert the import; PSY4 goes back to inline types.
**Tests**: PSY4's 104 foundation tests + foundation's 250 tests.
**Browser verification**: PSY4 must still play continuously.

**Status**: NOT STARTED. This is post-gate work.

---

### PHASE D — Consumer Runtime Proof

**Goal**: A second device (not PSY4) consumes foundation and runs in a browser.

**Candidate**: A minimal PSY6 prototype or the sync-lab app, wired to real
AudioContext.

**Steps**:
1. Build a minimal device that uses foundation transport + device-sdk.
2. The device receives transport snapshots, schedules notes, plays audio.
3. Verify continuous playback in a real browser.
4. Verify the device does NOT manage its own musical clock (consumer contract).

**Risk**: Medium. First real browser test of foundation transport.
**Rollback**: Device reverts to its own clock.
**Tests**: Consumer contract tests + new browser-playback tests.
**Browser verification**: Required. Continuous playback for 60+ seconds.

**Status**: NOT STARTED. This is post-gate work.

---

### PHASE E — Remove Duplicate Implementation

**Goal**: PSY4 deletes its `foundation/transport` and `foundation/radio` and
consumes `psy-foundation` instead.

**Steps**:
1. Only after Phase D proves a second consumer works.
2. PSY4's `foundation/transport/MusicalTransport.ts` is deleted.
3. PSY4 imports `@psy-foundation/transport` instead.
4. PSY4's `foundation/radio/RadioObservationLayer.ts` is deleted.
5. PSY4 imports `@psy-foundation/analysis` (restructured to match PSY4's layering).
6. All PSY4 tests still pass.

**Risk**: HIGH. This is the irreversible step. If foundation transport has any
subtle difference from PSY4's, PSY4's runtime breaks.
**Rollback**: Restore PSY4's `foundation/` directory from git.
**Tests**: All 104 PSY4 foundation tests + 250 foundation tests.
**Browser verification**: Required. Full playback-reality suite.

**Status**: NOT STARTED. This is the final step, only after Phases A-D succeed.

## Per-phase risk matrix

| Phase | Risk | Reversible? | Browser test? | Blocks next? |
| --- | --- | --- | --- | --- |
| A (test-only) | none | yes (delete tests) | no | yes (documents gaps) |
| B (adapter) | medium | yes (remove adapter) | yes (playback-reality) | yes (proves parity) |
| C (one subsystem) | low | yes (revert import) | yes (continuous play) | yes (proves integration) |
| D (second consumer) | medium | yes (revert device) | yes (60s playback) | yes (proves reusability) |
| E (delete duplicate) | HIGH | yes (git revert) | yes (full suite) | no (final) |

## Stop condition for this gate

This gate performs **Phase A only** (consumer contract tests that document gaps).
Phases B-E are defined but NOT started. Per Rule 0: no migration, no runtime
replacement, no new musical engine.
