# F13 FORENSIC MUSICAL — HONEST DIAGNOSIS

## Executive Summary

The foundation has a clean contract, deterministic output, and working tests.
But the **musical output is weak** in several critical ways. This audit found
5 root causes that must be fixed before F13 can pass.

## Root Causes (prioritized by audible impact)

### P0-1: BASS IS ROOT + FIFTH ONLY (2 unique MIDI notes across 870 bars)

**Evidence**: Across all 4 styles × 3 seeds × 870 bars, bass uses only 2 MIDI
notes (40 and 47 = E2 and B2). The bass NEVER uses passing tones, approach
notes, or register movement in the actual composition output.

**Root cause**: `composeBass()` in composition-engine.ts generates ROOT on
kick steps and FIFTH/OCTAVE on offbeats — but the COMPLEMENTARY path
(which would add variety) is only activated when `bassAlignment === 'COMPLEMENTARY'`,
and the LOCKED path only produces ROOT on every kick step. No passing tones,
no approach notes, no octave jumps, no rhythmic variation beyond the kick grid.

**Musical impact**: The bass sounds like a drone on two notes. This is the
single biggest audible weakness.

**Fix**: Rewrite `composeBass()` to:
- Use approach tones on the bar before a cadence
- Use passing tones between root and fifth
- Vary note lengths (not always durationSteps=2)
- Occasionally jump octaves for energy
- Use the harmonicContext to choose non-root chord tones

### P0-2: LONG-FORM REPETITION IS 90%+ FOR FULL-ON AND DARK STYLES

**Evidence**: 870-bar generation:
- full-on: 90.5% exact bar repeat (83 unique bars out of 870)
- dark: 80-85% exact bar repeat
- progressive: 34-38% (acceptable)
- acid: 43-50% (acceptable)

**Root cause**: The CompositionEngine generates one groove plan per section
and reuses it for every bar. The only variation comes from:
1. Arrangement state changes (which roles are active)
2. Lead motif transposition (±2 semitones, 50% chance)
3. Call/response on response bars

But kick/bass/hats are identical for every bar with the same arrangement
state. There is no:
- Bar-to-bar bass variation
- Rhythmic evolution
- Density curve within a phrase
- Fill bars
- Development of the groove over time

**Musical impact**: 5 minutes of full-on sounds like the same 8-bar loop
repeated 100 times.

**Fix**: Add per-bar variation:
- Bass: vary note choice on offbeats (not always root)
- Kick: occasional ghost kicks or missed kicks (with low probability)
- Hats: vary hat density per bar based on energy curve
- Lead: more aggressive transformation (not just ±2 semitones)
- Add fill bars at phrase boundaries

### P1-1: LEARNING IS NOT WIRED INTO COMPOSITION

**Evidence**: `CompositionEngine` constructor accepts `{ seed, context, memory?, grammar? }`.
It does NOT accept a learning parameter. `MusicalLearning` produces weights
but nothing in the composition path reads them.

**Root cause**: Learning was built as a separate module (P3) and never
integrated into the CompositionEngine. The CandidateScorer (which could
use learning weights) is also not used by the engine.

**Musical impact**: Learning is pure bookkeeping. It does not influence
what motifs are selected, what transformations are applied, or what
arrangement decisions are made.

**Fix**: Wire learning into CompositionEngine:
- Accept `learning?: MusicalLearning` in constructor
- In `choosePhraseMotif()`, use `learning.preferenceFor(motif)` to bias selection
- In `composeLead()`, use learning to choose transformation amounts
- In `composeBass()`, use learning to choose note functions

### P1-2: STYLE GRAMMAR IS PARTIAL — KICK PATTERN DIFFERENTIATES BUT BASS/HARMONY/MELODY DON'T ENOUGH

**Evidence**: Style comparison (same seed, bar 5):
- full-on vs dark: kick different ✅ (FOUR_ON_FLOOR vs PSY_KICK)
- full-on vs acid: kick different ✅ (FOUR_ON_FLOOR vs BROKEN)
- full-on vs progressive: kick SAME ❌ (both FOUR_ON_FLOOR)
- full-on vs dark: bass different ✅ (LOCKED root-only vs LOCKED root-only but different kick grid)
- Bass pitches are the same across all styles (40, 47)

**Root cause**: StyleGrammar changes kick pattern, bass alignment, syncopation,
tessitura, maxLeap, density, and tension — but:
- Bass pitch vocabulary is the same (root + fifth) regardless of style
- Harmony changes (chordChangeRate) exist in grammar but are not implemented
- Tension preference exists but doesn't change which notes are chosen
- Development style (GRADUAL/SUDDEN/LINEAR) exists but doesn't change phrase structure

**Musical impact**: Styles sound different in rhythm but similar in pitch content.

**Fix**: Make style grammar affect:
- Bass vocabulary (dark = root+fifth only, acid = chromatic approach, progressive = wider intervals)
- Harmony rhythm (dark = slow chord changes, acid = fast)
- Lead motif character (dark = narrow contour, acid = repeated figure)

### P1-3: RADIO ADAPTATION CHANGES EVENT COUNT BUT NOT MUSICAL CHARACTER

**Evidence**: Radio adaptation changes event counts:
- BASS_HEAVY: bass 126→0 (complete removal)
- MELODY_HEAVY: lead 66→0 (complete removal)
- DENSE: bass+lead 192→0 (near-total abstention)

But when events ARE present, they are the SAME notes. Adaptation only
filters (removes events) — it doesn't change:
- Which notes are played
- The rhythm of remaining notes
- The register of remaining notes
- The motif choice

**Root cause**: `applyAdaptation()` in composition-adaptation.ts only filters
events based on pressure thresholds. It does not:
- Transpose remaining notes
- Change rhythmic density of remaining parts
- Select different motifs
- Adjust register

**Musical impact**: Radio adaptation sounds like muting channels, not like
a musician responding to what's happening.

**Fix**: Make adaptation affect the COMPOSITION, not just the FILTERING:
- When radio is bass-heavy, compose LESS bass (not just filter it out)
- When radio is melody-heavy, compose DIFFERENT lead (counter-melody, not just silence)
- When radio is dense, compose SPARSER (not just remove everything)
- This requires wiring adaptation into composePhrase, not just post-filtering

## Summary of findings

| Finding | Severity | Root Cause | Fix |
| --- | --- | --- | --- |
| Bass = 2 notes only | P0 | composeBass too simple | Rewrite with passing/approach/octave |
| 90% long-form repetition | P0 | No per-bar variation | Add evolution, fills, development |
| Learning not wired | P1 | Missing constructor param | Wire into motif/bass/lead selection |
| Style = partial | P1 | Grammar doesn't affect pitch | Make grammar change bass/harmony/melody |
| Adaptation = filtering only | P1 | applyAdaptation is post-filter | Wire into composition, not post-filter |
| Harmony = 3 contexts only | P2 | Static harmonic plan | Add harmonic progression |
| Lead 70% repetition | P2 | Only ±2 transposition | Add inversion/retrograde/fragmentation |

## What is GOOD (keep)

- Groove-first architecture (groove → harmony → bass → lead)
- Arrangement states with intentional silence
- Bass-kick alignment (1.000)
- Determinism (100 runs identical)
- Serializable contract
- Consumer fixture (12/12)
- Kick pattern differentiation across styles
- Radio loss/recovery (NEUTRAL intent, composition continues)
