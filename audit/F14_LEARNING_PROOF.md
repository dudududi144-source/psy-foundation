# F14 LEARNING PROOF

## Acceptance test result: PASS

### Setup
- Session A: neutral (no learning function)
- Session B: learning rewards high-register motifs (20 positive observations), penalizes low-register (20 negative)

### Evidence

```
Session A motif IDs: ["seed-5co3-lead", "seed-bpk9-lead", "seed-ivwk-lead", "seed-4po5-lead", ...]
Session B motif IDs: ["seed-5co3-lead", "seed-hfj4-lead", "seed-gdrf-lead", "seed-4po5-lead", ...]
Same motifs? false
Learning changes selection? true

Avg lead MIDI A (neutral): 66.7
Avg lead MIDI B (learning): 67.7
Learning shifts register? true
```

### What changed
- 2 of 9 motif IDs differ between session A and B
- Average lead register shifted up by 1.0 MIDI note (66.7 → 67.7)
- The learned preference function (which rewards high-register features) caused `choosePhraseMotif` to select different candidates from the 3 generated options

### How it works
1. `CompositionEngine` now accepts `preferenceFor?: (motif: Motif) => number` in constructor
2. `choosePhraseMotif()` generates 3 candidate motifs per phrase
3. If `preferenceFor` is provided, candidates are scored and the highest is selected (70% exploit, 30% explore)
4. If not provided, the first candidate is selected (deterministic, same as before)

### Negative learning proof
- Bad motif (low register) received 20 negative observations → preference = 0.450
- Good motif (high register) received 20 positive observations → preference = 0.970
- The preference difference (0.52) causes different motif selection

### Determinism
- Same seed + same preferenceFor function = same output (deterministic)
- Different preferenceFor = potentially different output (learning influence)
- Reset (no preferenceFor) = returns to original behavior

## Before/After

| Metric | Before (F13) | After (F14) |
| --- | --- | --- |
| Learning wired into composition | NO | YES |
| Preference affects motif selection | NO | YES (70% exploit, 30% explore) |
| Different motifs selected with learning | NO | YES (2/9 differ) |
| Register shift measurable | NO | YES (+1.0 MIDI) |
| Deterministic | YES | YES (same seed+pref = same output) |
