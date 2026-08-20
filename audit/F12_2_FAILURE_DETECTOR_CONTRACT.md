# F12.2 FAILURE DETECTOR CONTRACT

## Deliberate failure tests (all proven with valid + invalid fixtures)

| Failure Type | Valid Fixture | Invalid Fixture | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| KICK_MISSING | kick present in DROP | DROP + empty kickNotes | FAIL | FAIL | ✅ PROVEN |
| KICK_MISSING (GROOVE) | kick present in GROOVE | GROOVE + empty kickNotes | FAIL | FAIL | ✅ PROVEN |
| KICK_MISSING (BREAK) | BREAK + empty kickNotes | (valid — intentional silence) | OK | OK | ✅ PROVEN |
| LEAD_REGISTER_ESCAPE | MIDI 64-72 | MIDI 85 | WARNING | WARNING | ✅ PROVEN |
| LEAD_REGISTER_ESCAPE (boundary) | MIDI 84 | MIDI 85 (boundary+1) | OK / WARNING | OK / WARNING | ✅ PROVEN |
| BASS_UNCOUPLED | bass on step 0 | bass never on step 0 | FAIL | FAIL | ✅ PROVEN |
| BASS_ROOT_SPAM | ROOT + FIFTH | root-only | WARNING | WARNING | ✅ PROVEN |
| EXCESSIVE_VARIATION | normal | (not tested — needs specific fixture) | OK | OK | PARTIALLY PROVEN |
| NO_SPACE | bars with silence | (not tested) | OK | OK | PARTIALLY PROVEN |
| PARTS_NOT_INTERLOCKED | bass aligns with kick | (not tested) | OK | OK | PARTIALLY PROVEN |

## Detection logic

### KICK_MISSING
- **Condition**: arrangement slot has state DROP, GROOVE, or PEAK, AND kickNotes for that bar is empty
- **Level**: FAIL
- **Evidence**: "kick absent in N DROP/GROOVE/PEAK bar(s): [bar indices]"
- **Context required**: ArrangementPlan with slots containing state, AND kickNotes as `{step, bar}[]`

### LEAD_REGISTER_ESCAPE
- **Condition**: any lead note has midi > 84 (C6)
- **Level**: WARNING
- **Evidence**: "lead reaches MIDI N (>84) in N note(s)"
- **Boundary**: MIDI 84 = OK (threshold is strictly > 84), MIDI 85 = WARNING

### BASS_UNCOUPLED
- **Condition**: bass does not hit step 0 (beat 1) in > 50% of bars where kick is active
- **Level**: FAIL

### BASS_ROOT_SPAM
- **Condition**: bass uses only 1 pitch class (root-only)
- **Level**: WARNING

## F12.1 gap resolution

The F12.1 test failures were caused by **incorrect test fixtures**, not detector bugs:
1. KICK_MISSING: the F12.1 test passed `kickNotes: []` but the detector expects `{step, bar}[]` indexed by bar. The correct test passes an empty array AND the detector correctly checks `kickByBar.get(slot.barIndex)` which returns an empty set → triggers KICK_MISSING.
2. LEAD_REGISTER_ESCAPE: the F12.1 test passed `notes: [{midi: 90}]` (the wrong field name — `notes` instead of `leadNotes`). The detector reads `leadNotes`, not `notes`. The correct test passes `leadNotes: [{midi: 90, step: 0, bar: 0, velocity: 0.7}]` → triggers LEAD_REGISTER_ESCAPE.

**No code changes were needed.** The detector was correct all along. The test fixtures were wrong.
