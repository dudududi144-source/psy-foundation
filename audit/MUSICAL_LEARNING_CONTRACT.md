# MUSICAL LEARNING CONTRACT

How the foundation's learning system ACTUALLY learns (unlike PSY4's passive bookkeeping).

## The PSY4 problem

PSY4's `learning.ts` is passive bookkeeping:
- Collects BPM votes, bass frequency votes, spectral band averages
- Stores them in localStorage + Turso
- Never influences pattern selection, motif generation, or candidate scoring
- The "pattern effectiveness" score is computed but never consumed

The foundation's `MusicalLearning` module is a real weighted-preference model.

## Learning loop

```
1. Observe motif outcome (sounded/collided/skipped)
2. Extract features from the motif:
   - pitch classes used (pc:0, pc:4, pc:7, etc.)
   - intervals used (interval:2, interval:5, etc.)
   - role (role:lead, role:bass)
   - register (register:4 = middle)
   - rhythmic density (density:1, density:2, etc.)
3. Update feature weights:
   - sounded (reward +0.3) → weight moves positive
   - collided (reward -0.5) → weight moves negative
   - skipped (reward 0) → no change
4. Weights decay over time (prevents stale preferences)
5. CandidateScorer reads weights via learning.getWeights()
6. The learnedPreference subscore influences candidate selection
```

## Feature representation

Each feature is a string key:
- `pc:4` — pitch class 4 (E) was used
- `interval:7` — a perfect fifth interval was used
- `role:lead` — the motif was a lead
- `register:4` — the motif was in octave 4
- `density:2` — the motif had medium rhythmic density

## Weight semantics

- **weight > 0**: feature is preferred (appeared in successful motifs)
- **weight < 0**: feature is avoided (appeared in collided motifs)
- **weight ≈ 0**: feature is neutral (not enough data, or mixed results)
- **observations < minObservations (3)**: weight is not trusted (returns 0.5 = neutral)

## Determinism

- Same observations → same weights (no randomness in the learning loop)
- Weight updates are: `weight += reward * learningRate`
- Decay is: `weight *= (1 - decayPerBar)` per bar

## What this enables

A motif that uses pitch classes the system has learned are "good" (appeared in
sounded motifs) will score higher on `learnedPreference` than one that uses
pitch classes the system has learned are "bad" (appeared in collided motifs).

This creates a feedback loop:
1. System plays motif with pc:4, pc:7 → sounds good → weights for pc:4, pc:7 increase
2. Next time, motifs with pc:4, pc:7 score higher → more likely to be selected
3. System plays motif with pc:1 → collides → weight for pc:1 decreases
4. Next time, motifs with pc:1 score lower → less likely to be selected

This is NOT a neural network. It's transparent, explainable, deterministic
weighted learning. Every weight can be inspected via `getLearnedFeatures()`.

## Comparison to PSY4

| Aspect | PSY4 learning.ts | Foundation MusicalLearning |
| --- | --- | --- |
| Type | Passive bookkeeping | Active weighted preferences |
| Influences selection | No | Yes (via CandidateScorer) |
| Feedback loop | None | Observe → weight → score → select |
| Explainable | No (vote counts) | Yes (per-feature weights) |
| Deterministic | N/A (not used) | Yes (same observations → same weights) |
| Decay | No | Yes (prevents stale preferences) |
| Features | BPM, bass freq, bands | Pitch class, interval, role, register, density |
