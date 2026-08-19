# MUSICAL FOUNDATION DESIGN

Ownership contract and architecture for the canonical musical substrate.

## The problem

PSY4's live output is musically weak:
- 64 bars → only 3 unique lead pitches, 2 bass pitches, 2 pitch classes
- 5 unique bar patterns across 64 bars
- Structural diversity DECREASED over time
- learning.ts is passive bookkeeping (vote counting), not driving decisions
- melodyObserver pitch output is not consumed by composition
- Scheduler is driven by 4 hardcoded presets

The foundation must provide the generative musical primitives that PSY4 lacks.

## RULE 2 — Ownership

### Foundation owns

- MusicalContext (tonic, scale, mode, register, meter, density, energy, tension, section role)
- Motif representation (pitch contour, rhythm, intervals, accent structure, register, harmonic relationship)
- MotifMemory (ingest, store, retrieve, similarity, age, usage, confidence, salience)
- Transformation engine (transpose, invert, retrograde, stretch, displace, mutate)
- PhrasePlanner (multi-bar structure, phrase roles)
- SectionPlanner (32-64 bar, density/energy/novelty curves)
- Diversity metrics (pitch, rhythm, interval, register, motif reuse, transformation ratio)
- MusicalityHealthReport (detect "flat loop" before it reaches the user)
- CandidateScorer (harmonic, rhythmic, novelty, learned preference — explainable)
- Learning contract (weighted preferences from observed/successful/rejected motifs)

### Foundation does NOT own

- AudioContext, WebAudio scheduling — that's DSP/scheduler
- UI — that's the device
- Radio connection — that's the radio layer
- Transport clock — that's Transport (canonical)
- Live device I/O — that's the device
- Final rendering — that's the audio engine
- LLM/neural generation — explicitly forbidden

## Architecture

```
OBSERVATION (from radio/transport)
    ↓
MUSICAL CONTEXT (key, scale, energy, tension, section role)
    ↓
MOTIF MEMORY (store, retrieve, similarity)
    ↓
PHRASE PLAN (2-bar motif, 2-bar response, 4-bar development)
    ↓
SECTION PLAN (32-64 bar: establish, develop, contrast, return, peak, release)
    ↓
VARIATION (transpose, invert, retrograde, stretch, mutate)
    ↓
CANDIDATE SCORE (harmonic, rhythmic, novelty, learned preference)
    ↓
MATERIAL REQUEST (to scheduler/device)
    ↓
CONSUMER (PSY4/device)
```

## Data flow

1. Radio observation → MusicalContext update (key detection, energy, tension)
2. MusicalContext + MotifMemory → PhrasePlanner generates phrase plan
3. PhrasePlan + SectionPlan → candidate motifs generated/transformed
4. CandidateScorer scores each candidate (explainable)
5. Best candidate → Material request → Scheduler → Audio
6. Outcome (sounded/collided/skipped) → Learning updates weights
7. Diversity metrics measure the output → MusicalityHealthReport

## Modules (in packages/music)

- `musical-context.ts` — canonical MusicalContext
- `motif.ts` — Motif representation (structural, not just MIDI)
- `motif-memory.ts` — MotifMemory (store, retrieve, similarity)
- `transformation.ts` — Transformation engine (identity-preserving)
- `phrase-planner.ts` — PhrasePlanner (8-bar, roles)
- `section-planner.ts` — SectionPlanner (32-64 bar, curves)
- `diversity.ts` — Diversity metrics + MusicalityHealthReport
- `candidate-scorer.ts` — CandidateScorer (explainable)

## Modules (in packages/learning)

- Extend existing Learner with real weighted preference learning
- `musical-learning.ts` — learns from motif success/failure, updates weights

## Determinism

All generation uses seeded RNG (mulberry32). Same seed + context + memory → same result.
No Math.random() in canonical generation paths.
