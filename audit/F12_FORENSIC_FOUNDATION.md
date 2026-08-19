# F12 FORENSIC FOUNDATION

## What actually exists (34 source files in packages/music/src/)

### Composition authority
- `composition-engine.ts` — THE COMPOSER. composePhrase() + composeSection(). Uses GroovePlan, ArrangementState, motif generation, bass/lead composition. Does NOT use phrase-planner.ts or section-planner.ts (those are legacy, used only by candidate-scorer/coherence/repetition-policy for type imports).
- `groove-plan.ts` — first-class groove scaffold
- `arrangement-state.ts` — 9 states with role activation
- `style-grammar.ts` — 4 style grammars (full-on, progressive, dark, acid)

### Musical primitives
- `scales.ts` — 18 scales/modes
- `chords.ts` — 18 chord types + voice leading
- `motif-v2.ts` — structural motif (contour, intervals, identity)
- `motif-memory.ts` — store/retrieve/similarity
- `transformation.ts` — 9 transforms (transpose, invert, retrograde, etc.)
- `rng.ts` — mulberry32 seeded RNG

### Analysis
- `diversity.ts` — 9 musicality metrics + health report
- `coherence.ts` — 5-category coherence metrics
- `failure-detector.ts` — 10 failure types (LEGACY, superseded by enhanced)
- `enhanced-failure-detector.ts` — 20 failure types (inter-part)
- `harmonic-classifier.ts` — CHORD_TONE/PASSING/TENSION/RESOLUTION
- `rhythmic-identity.ts` — rhythm fingerprint
- `motif-quality.ts` — quality gate
- `simulation-harness.ts` — 35 cross-part metrics

### Radio adaptation
- `radio-context.ts` — RadioMusicalContext (25 fields)
- `opportunity-map.ts` — 8 roles OCCUPIED/MEDIUM/OPEN
- `composition-adaptation.ts` — 4-level adaptation layer
- `radio-scenarios.ts` — 6 deterministic fixtures
- `adaptation-metrics.ts` — divergence measurement

### Legacy / superseded (still exported but NOT used by CompositionEngine)
- `motif.ts` — v1 motif (177 lines). Used only by phrase-planner.ts (legacy).
- `bass.ts` — v1 bass patterns (112 lines). Not used by CompositionEngine.
- `bass-behavior.ts` — v2 bass (242 lines). Not used by CompositionEngine (engine has its own composeBass).
- `phrase-planner.ts` — v1 phrase planner (400+ lines). CompositionEngine imports `generateMotifV2` from it but does NOT use `planPhrase()`.
- `section-planner.ts` — v1 section planner. NOT used by CompositionEngine.
- `failure-detector.ts` — v1 failure detector (268 lines). Superseded by enhanced.
- `phrase-arc.ts` — phrase direction. NOT used by CompositionEngine.
- `repetition-policy.ts` — repetition decisions. NOT used by CompositionEngine.
- `candidate-scorer.ts` — candidate scoring. NOT used by CompositionEngine.

## What is dead code (not used by CompositionEngine)

| File | Lines | Used by | Status |
| --- | --- | --- | --- |
| `motif.ts` | 177 | phrase-planner.ts (legacy) | DEAD — superseded by motif-v2.ts |
| `bass.ts` | 112 | nothing internal | DEAD — superseded by composition-engine composeBass |
| `bass-behavior.ts` | 242 | tests only | DEAD — superseded by composition-engine composeBass |
| `phrase-planner.ts` | 400+ | composition-engine imports generateMotifV2 only | PARTIALLY DEAD — planPhrase() not used |
| `section-planner.ts` | 200+ | nothing internal | DEAD — superseded by composition-engine composeSection |
| `failure-detector.ts` | 268 | nothing internal | DEAD — superseded by enhanced-failure-detector |
| `phrase-arc.ts` | 100+ | nothing internal | DEAD |
| `repetition-policy.ts` | 100+ | nothing internal | DEAD |
| `candidate-scorer.ts` | 100+ | nothing internal | DEAD — composition-engine does its own selection |

## What is duplicated

1. **Motif representation**: motif.ts (v1) vs motif-v2.ts (v2). v2 is canonical.
2. **Bass generation**: bass.ts + bass-behavior.ts vs composition-engine.composeBass(). Engine is canonical.
3. **Failure detection**: failure-detector.ts vs enhanced-failure-detector.ts. Enhanced is canonical.
4. **Phrase planning**: phrase-planner.ts vs composition-engine.composePhrase(). Engine is canonical.
5. **Section planning**: section-planner.ts vs composition-engine.composeSection(). Engine is canonical.

## Public API (33 exports in index.ts)

### Should be public (consumer-facing)
- `CompositionEngine` — the composer
- `ComposedSection`, `ComposedBar`, `ComposedPhrase` — output types
- `MusicalContext` — input type
- `RadioMusicalContext` — radio input type
- `AdaptedCompositionIntent` — adaptation output
- `CompositionAdaptation` — adaptation layer
- `OpportunityMap`, `buildOpportunityMap` — opportunity analysis
- `GroovePlan`, `buildGroovePlan` — groove scaffold
- `ArrangementState`, `ArrangementPlan`, `planArrangement` — arrangement
- `StyleGrammar`, `getStyleGrammar` — style
- `MusicalFailureDetector` (enhanced) — failure detection
- `measureMusicality`, `healthReport` — diversity metrics
- Types: `Motif`, `MotifNote`, `TransportSnapshot`, etc.

### Should be internal (not consumer-facing)
- `generateMotifV2` — internal to CompositionEngine
- `planPhrase`, `PhrasePlan`, `PhraseSlot` — legacy, not used by engine
- `planSection`, `SectionPlan`, `SectionSlot` — legacy, not used by engine
- `generateMotif` (v1) — legacy
- `generateBassPattern` — legacy
- `MotifQualityGate` — internal quality control
- `CandidateScorer` — not used by engine
- `RepetitionPolicy` — not used by engine
- `PhraseArc`, `buildPhraseArc` — not used by engine
- `CoherenceReport` and all coherence metrics — analysis only
- `RhythmPattern`, `fourOnFloor`, etc. — legacy rhythm builders

## Nondeterminism check

- `Math.random()`: **0 occurrences** in packages/music/src/ ✅
- `Date.now()`: **0 occurrences** ✅
- `performance.now()`: **0 occurrences** ✅
- `AudioContext`: **0 occurrences** ✅
- `setTimeout/setInterval`: **0 occurrences** ✅
- `document/window`: **0 occurrences** ✅

**Foundation is pure musical-time, deterministic, no browser dependencies.** ✅

## Determinism proof

100 runs of `composeSection({ bars: 32, seed: 42 })` → identical JSON output (63,285 bytes). ✅

## Serializable proof

`JSON.stringify(ComposedSection)` succeeds. No functions, no undefined, no DOM, no AudioContext. The `"function":"ROOT"` in JSON is a string field name (bass function label), not a JS function. ✅

## Can psy4 consume without AudioContext?

YES. Foundation produces `ComposedSection` which contains:
- `kickNotes: number[]` (step indices)
- `bassNotes: { midi, step, durationSteps, function }[]`
- `leadNotes: { midi, step, durationSteps, velocity }[]`
- `hatNotes: number[]` (step indices)
- `harmonicContext: number[]`
- `roles: RoleActivation`
- `arrangementState: string`
- `groove: GroovePlan`

All values are musical-time (step indices, MIDI notes). No AudioContext time.
The consumer converts step → audio time using Transport. ✅

## Can foundation compose without knowing anything about AudioContext?

YES. Foundation uses `MusicalContext` (which has `bpm` but no AudioContext).
CompositionEngine takes `seed + context` and produces `ComposedSection`.
No browser APIs involved. ✅

## Where foundation "plays" instead of "plans"

NOWHERE. Foundation only plans (produces ComposedSection with note data).
It does not create oscillators, connect gain nodes, or schedule audio.
The consumer (psy4) does all audio. ✅

## Contract ambiguities

1. `bassNotes[].function` is a string ("ROOT", "FIFTH", etc.) — should be a typed enum.
2. `ComposedBar` doesn't have explicit `barDuration` — consumer must compute from bpm.
3. `ComposedSection` doesn't have a `version` field — needed for contract versioning.
4. No explicit `MusicalEvent` type — consumer must interpret ComposedBar fields.
5. `roles` uses booleans (kick: true/false) but doesn't distinguish "active" vs "sparse".

These will be addressed in F12 contract cleanup.
