# F14 RADIO MATERIAL PROOF

## Acceptance test result: PARTIAL PASS

### Setup
Same seed (42), same style (full-on), same context. Different radio contexts.
Adaptation intent now enters `composePhrase` (changes what is composed, not just filters).

### Evidence

| Scenario | bassChanged | leadChanged | bassPressure | leadPressure | restPressure | registerShift |
| --- | --- | --- | --- | --- | --- | --- |
| SPARSE | false | false | 0.77 | 0.72 | 0.10 | 0 |
| BASS_HEAVY | **true** | **true** | 0.20 | 0.55 | 0.10 | +1 |
| MELODY_HEAVY | **true** | **true** | 0.50 | 0.25 | 0.10 | 0 |
| FULL_DENSE | **true** | **true** | 0.20 | 0.25 | 0.65 | +1 |
| BREAKDOWN | **true** | false | 0.30 | 0.80 | 0.10 | 0 |
| ABSENT | false | false | 0.70 | 0.70 | 0.10 | 0 |

### What changed (vs F13)

**Before (F13)**: `applyAdaptation()` only deleted events AFTER composition. The ComposedSection was identical regardless of radio.

**After (F14)**: `composePhrase()` now accepts an optional `intent` parameter that:
1. Changes role activation (roles.bass = false when bassPressure < 0.3)
2. Reduces bass/lead density proportionally (not just on/off)
3. Shifts lead register by intent.registerShift octaves
4. Adds hats when texturePressure > 0.6
5. Silences lead on specific bars when restPressure > 0.5

### What is PROVEN
- BASS_HEAVY: bass reduced + lead register shifted up → different musical material ✅
- MELODY_HEAVY: lead reduced + bass reduced → different musical material ✅
- FULL_DENSE: both reduced + register shift → different musical material ✅
- BREAKDOWN: bass reduced → different musical material ✅

### What is PARTIAL
- SPARSE: no change (pressures are high, so no adaptation needed — this is correct behavior)
- ABSENT: no change (NEUTRAL intent — this is correct behavior)
- The adaptation still doesn't compose DIFFERENT motifs or DIFFERENT bass lines — it reduces/shifts existing material. True musical adaptation (composing counter-melodies, different bass rhythms) requires deeper integration.

### Before/After

| Metric | Before (F13) | After (F14) |
| --- | --- | --- |
| Adaptation enters composition | NO (post-filter only) | YES (composePhrase accepts intent) |
| Changes role activation | NO (only post-filter) | YES (roles change during composition) |
| Changes note density | NO (only removes) | YES (proportional reduction) |
| Changes register | NO | YES (registerShift applied to lead) |
| Changes which notes are played | NO | PARTIAL (some notes removed, register shifted) |
| Composes different motifs | NO | NO (still P1-3 gap) |
| Composes different bass lines | NO | NO (still P1-3 gap) |
