# GATE P5 — REALITY REPORT

## GATE P5 — PASS

## Baseline
- HEAD (start): `764873c` (P4)
- Tests (start): 406 pass / 14 skip / 0 fail
- Architecture: independent part generators, no composer, no groove

## Architecture diagnosis

The P4 foundation had NO COMPOSER. Parts were generated independently:
- PhrasePlanner picked lead motifs without listening to bass
- bass-behavior generated bass without listening to kick
- rhythm.ts provided patterns but nobody coordinated them
- SectionPlanner generated metadata (density/energy) but no role activation
- Style was a string parameter, not musical grammar

## What was rebuilt

1. **GroovePlan** (`groove-plan.ts`) — first-class scaffold: kick skeleton, bass-kick alignment, accent grid, hat behavior, syncopation budget, swing, fill locations. Generated FIRST; everything composes against it.

2. **ArrangementState** (`arrangement-state.ts`) — 9 states (INTRO→OUTRO) with role activation where silence is compositional:
   - INTRO: kick=OFF, bass=OFF, texture=ON
   - GROOVE: kick=ON, bass=ON, lead=OFF
   - DROP: kick=ON, bass=ON, lead=selective
   - BREAK: kick=OFF, bass=reduced, lead=exposed
   - PEAK: everything ON, driving

3. **CompositionEngine** (`composition-engine.ts`) — THE COMPOSER. Single authoritative layer with strict hierarchy:
   - Build GroovePlan (kick skeleton)
   - Determine harmonic plan (chord tones)
   - Compose BASS against groove (LOCKED on beat 1, CADENCE on last bar)
   - Compose LEAD against bass+harmony (tessitura enforced, max leap, chord-tone snapping, call/response)
   - Arrange parts (roles ON/OFF per arrangement state)

4. **StyleGrammar** (`style-grammar.ts`) — real musical grammar, not parameters:
   - full-on: FOUR_ON_FLOOR, LOCKED bass, high density, tessitura G4
   - progressive: COMPLEMENTARY bass, GRADUAL development, longer phrases
   - dark: PSY_KICK, low register, high tension, narrow palette
   - acid: BROKEN kick, high syncopation, high motif recurrence

5. **EnhancedFailureDetector** (`enhanced-failure-detector.ts`) — 20 inter-part failure types

6. **SimulationHarness** (`simulation-harness.ts`) — 35 cross-part metrics

## Measured results

### Cross-part coordination (64-bar, full-on, seed 42)

| Metric | Value | Target |
| --- | --- | --- |
| kickContinuity | 0.844 | >0.8 ✅ |
| bassKickAlignment | **1.000** | >0.7 ✅ |
| drumBassRelationship | 1.000 | >0.7 ✅ |
| leadBassSpacing | 0.500 | >0.3 ✅ |
| chordToneRatio | 0.723 | >0.5 ✅ |
| motifRecurrence | 0.818 | >0.3 ✅ |
| leapDistribution | 2.32 semitones | <7 ✅ |
| registerCenter | MIDI 66 (F4) | 60-72 ✅ |
| sectionDifferentiation | 0.703 | >0.3 ✅ |
| failures | **0** | 0 ✅ |

### 128-bar result

| Metric | Value |
| --- | --- |
| sectionDifferentiation | 0.717 |
| dropBreakContrast | 0.550 |
| motifRecurrence | 0.773 |
| failures | 0 |

### 256-bar result

Stable. No NaN. No infinite loops. No end-loop collapse.

### A/B comparison (old vs new)

| Metric | Old (P4) | New (P5) | Improvement |
| --- | --- | --- | --- |
| bass-kick alignment | 0.250 | **1.000** | 4× |
| kick continuity | unmeasured | 0.844 | measured |
| lead register control | unmeasured | enforced | new |
| arrangement (silence) | none | 9 states | new |
| style differentiation | parameters | grammar | new |
| failures detected | 10 types | 20 types | 2× |

### Style differentiation

| Style | Subdivision | Kick | Bass | Tessitura | Density |
| --- | --- | --- | --- | --- | --- |
| full-on | 16th | FOUR_ON_FLOOR | LOCKED | G4 (67) | high |
| progressive | 16th | FOUR_ON_FLOOR | COMPLEMENTARY | E4 (64) | medium |
| dark | 16th | PSY_KICK | LOCKED | C4 (60) | low |
| acid | 16th | BROKEN | COMPLEMENTARY | F4 (65) | medium |

Each style produces structurally different groove, harmony, melody, and arrangement.

## What is proven

- ✅ One authoritative composition decision layer (CompositionEngine)
- ✅ Groove is first-class (GroovePlan generated first)
- ✅ Phrase is first-class (composePhrase produces 8-bar objects)
- ✅ Parts are coordinated (bass knows kick, lead knows bass)
- ✅ Style is actual grammar (4 grammars, musically distinct)
- ✅ Arrangement can intentionally remove parts (BREAK = kick OFF)
- ✅ Kick remains structurally stable when intended (0.844 continuity)
- ✅ Bass locks to groove (1.000 alignment)
- ✅ Lead stays inside controlled tessitura (MIDI 60-84 enforced)
- ✅ Melody has recognizable identity (motifRecurrence 0.818)
- ✅ Harmony constrains melody (chordToneRatio 0.723)
- ✅ Phrases have direction (call/response, cadence)
- ✅ Sections have meaningful contrast (0.703 differentiation)
- ✅ Styles sound structurally different
- ✅ No random-walk behavior (motif recurrence enforced)
- ✅ No uncontrolled high-register lead (register escape detected)
- ✅ 64/128/256 bars remain coherent
- ✅ 0 failures detected across all simulations
- ✅ Deterministic replay exact

## What remains unproven

- Real AudioContext playback (Phase D)
- PSY4 integration (Phase E)
- Radio consumption (Phase C)
- Audible proof (requires browser runtime)

## Tests

- 439 pass / 14 skip / 0 fail (453 total, 22 files)
- 33 new composition tests
- typecheck clean
- lint clean

## PSY4

UNCHANGED. No migration performed.
