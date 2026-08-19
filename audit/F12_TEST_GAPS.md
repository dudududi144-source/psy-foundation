# F12 TEST GAPS

## Foundation proof (proven by 479 tests)

- Transport canonical (P1/P2): 80 tests
- Musical substrate (P3): 49 tests
- Coherence (P4): 25 tests
- Composition engine (P5): 33 tests
- Radio adaptation (P5.5): 40 tests
- Legacy music (M3): 43 tests
- Other packages: 209 tests

## PSY4 integration proof (NOT proven)

| Test | Description | Status |
| --- | --- | --- |
| INT-01 | Foundation plan → PSY4 events | NOT PROVEN (sandbox only, not real psy4) |
| INT-02 | Foundation key/scale → actual notes | NOT PROVEN |
| INT-03 | Foundation groove → kick/bass output | NOT PROVEN |
| INT-04 | Foundation style → performance difference | NOT PROVEN |
| INT-05..08 | Radio scenarios | NOT PROVEN |
| INT-09 | Mid-phrase radio change | NOT PROVEN |
| INT-10..11 | Radio loss/recovery | NOT PROVEN |
| INT-12..13 | No duplicate/stale events | NOT PROVEN |
| INT-14 | UI control → foundation change | NOT PROVEN |
| INT-15 | Mixer → GainNode | NOT PROVEN |
| INT-16 | FX → send/parameter | NOT PROVEN |

## Consumer fixture (needed)

A contract test in foundation that proves a "dumb consumer" can consume
ComposedSection without making musical decisions. This is NOT psy4 —
it's a test that proves the contract is consumable.

## What the consumer fixture must prove

1. ComposedSection is serializable
2. All events have enough information for synthesis (midi, step, velocity)
3. Rest semantics are unambiguous (empty array = silence)
4. Role activation prevents playing inactive parts
5. No AudioContext/DOM/browser dependency needed to consume
6. Deterministic replay (same seed = same output)
7. Consumer never needs to make a musical decision

## Existing test gaps in foundation

| Gap | Description | Risk |
| --- | --- | --- |
| No `FOUNDATION_CONTRACT_VERSION` export | Contract versioning not enforced | LOW |
| `bassNotes.function` is string not enum | Type safety gap | LOW |
| No explicit `MusicalEvent` type | Consumer interprets ComposedBar fields | MEDIUM |
| Dead code still exported | 9 legacy modules in index.ts | LOW (cleanup) |
| No 1000-motif memory stress test | Performance at scale | LOW |
