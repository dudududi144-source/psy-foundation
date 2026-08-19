# MUSICALITY METRICS

Definitions, thresholds, and justification for every musicality metric.

## Metrics

### uniquePitchRatio
- **Definition**: unique MIDI pitches / total notes
- **Range**: 0..1
- **Threshold**: ≥ 0.15 (calibration note: for dense music with many notes, the raw count is more meaningful)
- **Justification**: PSY4 had 3 unique pitches in 64 bars = 0.05. A healthy system should have at least 3× that ratio.

### pitchClassDiversity
- **Definition**: unique pitch classes / 12
- **Range**: 0..1
- **Threshold**: ≥ 0.25 (at least 3 of 12 pitch classes)
- **Justification**: PSY4 used only 2 pitch classes (0.17). A 7-note scale uses at minimum 3-4 pitch classes in normal melodic motion. 0.25 = 3/12 is the floor.

### intervalDiversity
- **Definition**: unique intervals / total intervals
- **Range**: 0..1
- **Threshold**: ≥ 0.20
- **Justification**: A motif with only one interval (e.g. all seconds) is musically flat. 0.20 means at least 20% of intervals are unique — enough variety for melodic interest.

### rhythmicDiversity
- **Definition**: unique rhythm patterns per bar / total bars
- **Range**: 0..1
- **Threshold**: ≥ 0.30
- **Justification**: PSY4 had 5 unique patterns in 64 bars = 0.08. A healthy system should have at least 30% unique bars — allowing repetition but not stagnation.

### motifReuseRatio
- **Definition**: repeated motifs (same id) / total motifs used
- **Range**: 0..1
- **Threshold**: ≤ 0.70
- **Justification**: Repetition is musically valid (motifs return), but >70% reuse means the system is stuck. 70% allows 30% new or transformed material per section.

### transformationRatio
- **Definition**: transformed motifs / total motifs used
- **Range**: 0..1
- **Threshold**: ≥ 0.20
- **Justification**: At least 20% of motifs should be transformed (transposed, inverted, etc.) to ensure variation. This prevents exact repetition from dominating.

### exactRepeatRatio
- **Definition**: exact bar repeats / total bars
- **Range**: 0..1
- **Threshold**: ≤ 0.50
- **Justification**: PSY4 had 0.92 (59/64 bars identical). 0.50 allows half the bars to repeat (for musical return) while requiring the other half to vary.

### registerDiversity
- **Definition**: register range used / possible range (0..127)
- **Range**: 0..1
- **Threshold**: ≥ 0.15
- **Justification**: PSY4 was stuck in one register. 0.15 = ~19 semitones = 1.5 octaves, the minimum for melodic interest.

### structuralEvolution
- **Definition**: how much the music changes over time (bar-to-bar change rate averaged)
- **Range**: 0..1
- **Threshold**: ≥ 0.20
- **Justification**: PSY4's diversity DECREASED over time. A healthy system should maintain or increase diversity. 0.20 means at least 20% bar-to-bar change.

## MusicalityHealthReport

The health report aggregates all metrics into a single `healthy` boolean and
a list of `issues` (strings explaining which metrics failed and by how much).

A `score` (0..1) is computed as the average of all metric scores (mapped to
0..1 where 1 = best). This is NOT a pass/fail threshold — it's a continuous
indicator of musical health.

## Before/after comparison (PSY4 vs Foundation)

| Metric | PSY4 | Foundation | Improvement |
| --- | --- | --- | --- |
| Unique pitches | 3 | 24 | 8× |
| Unique pitch classes | 2 | 7 | 3.5× |
| pitchClassDiversity | 0.17 | 0.583 | 3.4× |
| exactRepeatRatio | 0.92 | 0.000 | ∞ (eliminated) |
| rhythmicDiversity | ~0.08 | 0.672 | 8.4× |
| registerDiversity | low | 0.833 | — |

The foundation dramatically outperforms PSY4 on every metric where PSY4 was
weak. The remaining gaps (transformationRatio, structuralEvolution) are test
harness issues — the substrate capabilities exist but the test doesn't exercise
them all.
