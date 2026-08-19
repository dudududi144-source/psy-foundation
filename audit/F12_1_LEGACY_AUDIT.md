# F12.1 LEGACY AUDIT

## Legacy modules (9 files identified in F12 as dead code)

### 1. `motif.ts` (177 lines) — v1 motif
- **Imported by**: `phrase-planner.ts` (imports `generateMotif as generateLegacyMotif`)
- **Runtime path**: NOT used by CompositionEngine
- **Tests**: 43 tests in `tests/music.test.ts` (legacy tests)
- **Public API**: exported in `index.ts`
- **Duplicate authority**: YES — `motif-v2.ts` is the canonical motif representation
- **Status**: DEAD in runtime, alive in tests/exports. Safe to deprecate.

### 2. `bass.ts` (112 lines) — v1 bass patterns
- **Imported by**: nothing internal
- **Runtime path**: NOT used by CompositionEngine
- **Tests**: covered by legacy music.test.ts
- **Public API**: exported in `index.ts`
- **Duplicate authority**: YES — `composition-engine.ts composeBass()` is canonical
- **Status**: DEAD. Safe to remove from exports.

### 3. `bass-behavior.ts` (242 lines) — v2 bass (standalone)
- **Imported by**: `failure-detector.ts` (imports `BassNote` type only)
- **Runtime path**: NOT used by CompositionEngine
- **Tests**: covered by coherence.test.ts
- **Public API**: exported in `index.ts`
- **Duplicate authority**: YES — `composition-engine.ts composeBass()` is canonical
- **Status**: DEAD in runtime. Type import by failure-detector is the only dependency. Safe to deprecate after extracting BassNote type.

### 4. `phrase-planner.ts` (400+ lines) — v1 phrase planner
- **Imported by**: `composition-engine.ts` (imports `generateMotifV2`), `candidate-scorer.ts`, `section-planner.ts`, `coherence.ts`
- **Runtime path**: PARTIALLY USED — CompositionEngine imports `generateMotifV2` but does NOT call `planPhrase()`
- **Tests**: covered by music.test.ts
- **Public API**: exported in `index.ts`
- **Duplicate authority**: YES for `planPhrase()`. NO for `generateMotifV2()` (that's used by the engine).
- **Status**: PARTIALLY DEAD. `generateMotifV2` should be extracted to its own file or into `motif-v2.ts`. `planPhrase` is dead.

### 5. `section-planner.ts` (200+ lines) — v1 section planner
- **Imported by**: `coherence.ts`, `repetition-policy.ts` (type imports only)
- **Runtime path**: NOT used by CompositionEngine
- **Tests**: covered by music.test.ts
- **Public API**: exported in `index.ts`
- **Duplicate authority**: YES — `composition-engine.ts composeSection()` is canonical
- **Status**: DEAD in runtime. Type imports by coherence/repetition-policy. Safe to deprecate.

### 6. `failure-detector.ts` (268 lines) — v1 failure detector
- **Imported by**: nothing internal
- **Runtime path**: NOT used by CompositionEngine
- **Tests**: covered by coherence.test.ts
- **Public API**: exported in `index.ts`
- **Duplicate authority**: YES — `enhanced-failure-detector.ts` is canonical
- **Status**: DEAD. Superseded by enhanced-failure-detector. Safe to remove from exports.

### 7. `phrase-arc.ts` (100+ lines) — phrase direction
- **Imported by**: nothing internal
- **Runtime path**: NOT used by CompositionEngine
- **Tests**: covered by coherence.test.ts
- **Public API**: exported in `index.ts`
- **Duplicate authority**: NO (unique concept) but NOT USED by the engine
- **Status**: DEAD in runtime. Safe to deprecate.

### 8. `repetition-policy.ts` (100+ lines) — repetition decisions
- **Imported by**: nothing internal
- **Runtime path**: NOT used by CompositionEngine
- **Tests**: covered by coherence.test.ts
- **Public API**: exported in `index.ts`
- **Duplicate authority**: NO (unique concept) but NOT USED by the engine
- **Status**: DEAD in runtime. Safe to deprecate.

### 9. `candidate-scorer.ts` (100+ lines) — candidate scoring
- **Imported by**: nothing internal
- **Runtime path**: NOT used by CompositionEngine
- **Tests**: covered by music.test.ts
- **Public API**: exported in `index.ts`
- **Duplicate authority**: NO (unique concept) but NOT USED by the engine
- **Status**: DEAD in runtime. Safe to deprecate.

## Summary

| Module | Lines | Runtime used? | Duplicate? | Safe to deprecate? |
| --- | --- | --- | --- | --- |
| motif.ts | 177 | NO | YES (motif-v2) | YES |
| bass.ts | 112 | NO | YES (engine) | YES |
| bass-behavior.ts | 242 | NO (type import only) | YES (engine) | YES (after type extraction) |
| phrase-planner.ts | 400+ | PARTIAL (generateMotifV2 only) | YES for planPhrase | YES (after extracting generateMotifV2) |
| section-planner.ts | 200+ | NO | YES (engine) | YES |
| failure-detector.ts | 268 | NO | YES (enhanced) | YES |
| phrase-arc.ts | 100+ | NO | NO but unused | YES |
| repetition-policy.ts | 100+ | NO | NO but unused | YES |
| candidate-scorer.ts | 100+ | NO | NO but unused | YES |

## Decision

NO DELETION in F12.1. The modules are dead in runtime but their tests still
pass (43 legacy tests in music.test.ts). Deletion is a cleanup task for a
future gate, not a correctness issue. The CompositionEngine is the sole
musical authority — these modules do not compete.
