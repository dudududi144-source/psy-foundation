# F14 FORENSIC — CALL GRAPH TRACE

## Evidence-based answers (from reading actual code)

### 1. Where is a motif created?
- `composition-engine.ts:308` — `generateMotifV2()` in `seedMemory()`
- `composition-engine.ts:335` — `generateMotifV2()` in `choosePhraseMotif()`
- **PROVEN**: motifs are created by `generateMotifV2` from `phrase-planner.ts`

### 2. Where is a motif scored?
- **NOWHERE in composition-engine.ts**. There is no scoring, no candidate evaluation, no preference check.
- `CandidateScorer` exists in `candidate-scorer.ts` but is NOT imported or used by `CompositionEngine`.
- **FALSE claim**: previous reports implied scoring exists. It does not in the composition path.

### 3. Where is reward stored?
- `MotifMemory.markUsed()` stores `usageCount` and `successCount`/`failCount`.
- `MusicalLearning.observe()` stores feature weights.
- **BUT**: `CompositionEngine` never calls `markUsed()` with success/fail data, and never calls `MusicalLearning.observe()`.
- **DEAD**: reward storage exists but is never fed from the composition path.

### 4. Where is reward READ during future generation?
- **NOWHERE**. `choosePhraseMotif()` does not query reward, preference, or learned weights.
- It either retrieves the previous phrase's motif (30% chance) or generates a fresh one.
- **FALSE claim**: learning influences selection. It does not.

### 5. Does learning change the actual selected motif?
- **NO**. `CompositionEngineOptions` does not accept a learning parameter.
- `choosePhraseMotif` does not consider learned preferences.
- **FALSE**: learning is not wired.

### 6. Where does style enter generation?
- `composition-engine.ts:114` — `this.grammar = getStyleGrammar(context.sectionRole)`
- `composition-engine.ts:194` — `grammar` passed to `buildGroovePlan`
- `composition-engine.ts:395` — `tension = this.grammar.tensionPreference` (used in composeBass)
- `composition-engine.ts:572` — `maxLeap = this.grammar.maxLeap` (used in composeLead)
- **PARTIAL**: style affects groove (kick pattern), bass tension, lead maxLeap. Does NOT affect: bass vocabulary, harmonic rhythm, motif transformation choice, velocity, register preference per style.

### 7. Which musical generators actually read style?
- `buildGroovePlan`: reads kickPattern, bassAlignment, syncopationBudget, swing ✅
- `composeBass`: reads tensionPreference ✅ (but only for probability, not pitch vocabulary)
- `composeLead`: reads maxLeap ✅ (but not tessituraCenter, densityTarget, developmentStyle)
- `chooseHarmonicForPhrase`: does NOT read chordChangeRate ❌
- `choosePhraseMotif`: does NOT read anything from grammar ❌
- **PARTIAL**

### 8. Where does radio adaptation enter composition?
- **NOWHERE in composition-engine.ts**. `composePhrase` and `composeSection` do not accept an `intent` parameter.
- `applyAdaptation()` in `composition-adaptation.ts` is a POST-FILTER that runs AFTER composition.
- **FALSE claim**: radio adaptation is wired into composition. It is not.

### 9. Does radio change generated material or only delete events?
- **ONLY DELETE EVENTS**. `applyAdaptation()` removes notes based on pressure thresholds.
- It never changes a note's pitch, rhythm, or duration.
- It never causes a different motif to be selected.
- **FALSE claim**: adaptation changes expression. It only changes event count.

### 10. Can two radio contexts with the same seed produce structurally different musical material?
- **NO**. The ComposedSection is identical regardless of radio. Only the post-filtered output differs.
- The same seed + same context always produces the same ComposedSection.
- Radio only removes events — it never adds or changes them.
- **FALSE**: radio does not produce structurally different material.

### 11. Does adaptation preserve motif identity?
- **YES** — because it only removes notes, the remaining notes are from the same motifs.
- **PROVEN** (trivially — filtering preserves identity).

### 12. Does adaptation preserve harmony?
- **YES** — `harmonicContext` is never changed by `applyAdaptation`.
- **PROVEN**.

### 13. Does adaptation preserve groove?
- **YES** — `groove` is never changed by `applyAdaptation`.
- **PROVEN**.

### 14. Does adaptation create complementary material?
- **NO**. It only removes material. It never creates counter-melodies, complementary rhythms, or new responses.
- **FALSE claim**: adaptation creates complementary material.

## Summary

| # | Question | Answer | Classification |
| --- | --- | --- | --- |
| 1 | Motif creation | generateMotifV2 | PROVEN |
| 2 | Motif scoring | nowhere in composition path | FALSE |
| 3 | Reward storage | exists but never fed | DEAD |
| 4 | Reward read | nowhere | FALSE |
| 5 | Learning changes selection | no | FALSE |
| 6 | Style enters generation | groove + bass tension + lead maxLeap | PARTIAL |
| 7 | Generators read style | 3 of 6 | PARTIAL |
| 8 | Radio enters composition | nowhere (post-filter only) | FALSE |
| 9 | Radio changes material | no, only deletes | FALSE |
| 10 | Different radio = different material | no | FALSE |
| 11 | Adaptation preserves identity | yes (trivially) | PROVEN |
| 12 | Adaptation preserves harmony | yes | PROVEN |
| 13 | Adaptation preserves groove | yes | PROVEN |
| 14 | Adaptation creates complement | no | FALSE |

## Root causes to fix

1. **P0: Learning not wired** — `choosePhraseMotif` must accept a preference function and bias selection
2. **P0: Radio not in composition** — `composePhrase` must accept `AdaptedCompositionIntent` and change what it composes
3. **P1: Style partial** — `composeBass` must use style-specific vocabulary, `chooseHarmonicForPhrase` must use `chordChangeRate`
4. **P1: Motif development mechanical** — variation is `(bar * 3 + seed) % 5` cycling, not phrase-aware
5. **P2: Harmony static** — 3 chord contexts cycling mechanically, no progression logic
