# P4 BASELINE

Baseline captured at the start of GATE P4 — Musical Quality Hardening.

## State

| Field | Value |
| --- | --- |
| HEAD | `c41dfc67dc6ac5da66f608336fb56cce32dc9655` |
| remote HEAD (origin/main) | `c41dfc67dc6ac5da66f608336fb56cce32dc9655` |
| Branch | `main` |
| Worktree | clean |
| Tests | 381 pass / 14 skip / 0 fail (395 total, 20 files) |
| Typecheck | clean |
| Lint | clean (138 files) |

## P3 achievements (baseline for P4)

- Transport = CANONICAL
- Musical substrate = BUILT (MusicalContext, Motif, MotifMemory, Transformations, PhrasePlanner, SectionPlanner, Diversity, CandidateScorer)
- MusicalLearning = BUILT (weighted preferences)
- 64-bar test: 24 unique pitches (vs PSY4's 3), 7 pitch classes (vs 2), 0% exact repeats (vs 92%)

## P3 weaknesses (what P4 must fix)

P3 improved diversity but did NOT prove:
- Motif identity survives transformations (measured)
- Phrases have direction (opening → development → cadence)
- Repetition is purposeful (A → A' → A'' → B → A-return, not A→B→C→D→E)
- Harmonic sense (chord tones vs passing tones vs tension)
- Rhythmic identity (rhythm has recognizable character)
- Bass is not root-only loop
- Learning measurably improves future selection (not just "changes" it)
- Negative learning (avoid bad motifs)
- Failure detection (detect "flat loop" or "excessive variation")

## P4 goal

Turn the substrate from "diverse" into "coherent + developing + memorable".
Diversity may decrease if coherence increases — that is acceptable.
