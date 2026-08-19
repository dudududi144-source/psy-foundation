# F12.2 REALITY REPORT

## Baseline
- HEAD: bb74674 (F12.1)
- Tests: 491 pass / 14 skip / 0 fail
- typecheck + lint clean

## What was done
- 15 new detector contract tests (valid + invalid fixtures for KICK_MISSING, LEAD_REGISTER_ESCAPE, BASS_UNCOUPLED, BASS_ROOT_SPAM)
- 4 audit reports (failure detector contract, public contract, consumer readiness, reality report)
- No code changes to foundation modules (detector was correct — F12.1 test fixtures were wrong)

## F12.1 gap resolution

### KICK_MISSING
- F12.1 claim: "detects KICK_MISSING"
- F12.1 test: passed `kickNotes: []` but with incorrect fixture structure
- F12.2 fix: proper fixture with `{step, bar}[]` format + arrangement slots with state='DROP'
- Result: KICK_MISSING correctly fires FAIL when kick absent in DROP/GROOVE/PEAK

### LEAD_REGISTER_ESCAPE
- F12.1 claim: "detects LEAD_REGISTER_ESCAPE"
- F12.1 test: passed `notes: [{midi: 90}]` (wrong field name — detector reads `leadNotes`)
- F12.2 fix: proper fixture with `leadNotes: [{midi: 90, step: 0, bar: 0, velocity: 0.7}]`
- Result: LEAD_REGISTER_ESCAPE correctly fires WARNING when midi > 84

**Root cause of both gaps**: test fixture construction errors, not detector bugs. The detector logic was correct in F12.

## Current state

| Metric | Value |
| --- | --- |
| HEAD | (post-commit) |
| Tests | 506 pass / 14 skip / 0 fail (521 total) |
| typecheck | clean |
| lint | clean |
| worktree | clean |

## Failure detector proven types

| Type | Valid fixture | Invalid fixture | Status |
| --- | --- | --- | --- |
| KICK_MISSING | ✅ (kick present → OK) | ✅ (empty in DROP → FAIL) | PROVEN |
| LEAD_REGISTER_ESCAPE | ✅ (MIDI 64 → OK) | ✅ (MIDI 85+ → WARNING) | PROVEN |
| BASS_UNCOUPLED | ✅ (bass on step 0 → OK) | ✅ (bass off beat 1 → FAIL) | PROVEN |
| BASS_ROOT_SPAM | ✅ (ROOT+FIFTH → OK) | ✅ (root-only → WARNING) | PROVEN |
| KICK_DROPOUT | (not tested — needs multi-bar fixture) | — | UNPROVEN |
| LEAD_HIGH_NOTE_SPAM | (not tested) | — | UNPROVEN |
| LEAD_NO_IDENTITY | (not tested) | — | UNPROVEN |
| LEAD_TOO_DENSE | (not tested) | — | UNPROVEN |
| LEAD_TOO_SPARSE | (not tested) | — | UNPROVEN |
| RANDOM_WALK_MELODY | (not tested) | — | UNPROVEN |
| HARMONY_IGNORED | (not tested) | — | UNPROVEN |
| STYLE_COLLAPSE | (not tested) | — | UNPROVEN |
| SECTION_COLLAPSE | (not tested) | — | UNPROVEN |
| ARRANGEMENT_COLLAPSE | (not tested) | — | UNPROVEN |
| GROOVE_COLLAPSE | (not tested) | — | UNPROVEN |
| EXCESSIVE_VARIATION | ✅ (normal → OK) | (not tested) | PARTIALLY PROVEN |
| ZERO_VARIATION | (not tested) | — | UNPROVEN |
| NO_CADENCE | (not tested) | — | UNPROVEN |
| NO_SPACE | ✅ (with silence → OK) | (not tested) | PARTIALLY PROVEN |
| PARTS_NOT_INTERLOCKED | ✅ (aligned → OK) | (not tested) | PARTIALLY PROVEN |

## PSY4 integration

NOT INTEGRATED / CONTRACT READY

## Unproven
- 13 failure types have valid-only fixtures (no deliberate bad case)
- PSY4 has not consumed this contract
- Real radio analyser not wired
- No audible browser proof
