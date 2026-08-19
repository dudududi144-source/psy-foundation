# P5 ARCHITECTURE DIAGNOSIS

## Forensic audit result: the foundation has NO COMPOSER

### The problem

The current architecture is:

```
SectionPlanner → assigns roles + curves (metadata)
PhrasePlanner → picks motifs independently per bar
bass-behavior.ts → generates bass from its own K-B-B-B grammar
rhythm.ts → provides rhythm patterns but nobody coordinates them
candidate-scorer.ts → scores lead motifs in isolation
```

This is "generate lead + generate bass + generate drums + attach metadata."

It is NOT "establish groove → compose bass against groove → compose lead against bass."

### Specific findings

1. **No GroovePlan**: rhythm.ts has `fourOnFloor()`, `psyKick()`, `offbeatHats()` — but nobody calls them together. The kick, bass, and hats are independent patterns that never interlock.

2. **Bass doesn't listen to kick**: `generateBassBehavior()` takes `melodyNotes` and `harmonicContext` but NOT kick positions. The bass follows its own grammar without knowing where the kick hits. This means bass and kick can collide rhythmically.

3. **Lead doesn't listen to bass**: The PhrasePlanner generates lead motifs from memory + transformations. No constraint ensures the lead leaves space where the bass is active, or that the lead's register doesn't overlap the bass.

4. **No arrangement layer**: The SectionPlanner generates density/energy curves but doesn't decide which roles are active. Everything plays all the time. There's no BREAK section where kick goes silent, no DROP where everything hits together.

5. **Style is parameters, not grammar**: MusicalContext has `style: string` but it only affects density/energy values. A "dark" style doesn't actually change the harmonic vocabulary, register preference, or rhythmic identity.

6. **Harmony is metadata**: MusicalContext has `harmonicContext: number[]` but the lead generator doesn't query it. The HarmonicClassifier exists but isn't wired into motif generation.

7. **No cross-part metrics**: The diversity metrics measure each part independently. Nobody measures kick↔bass alignment, bass↔harmony alignment, or lead↔bass spacing.

### What must be rebuilt

1. **GroovePlan** — first-class scaffold defining kick skeleton, bass relationship, subdivision, accent grid, hat behavior, syncopation budget
2. **CompositionEngine** — single authoritative composer: groove → harmony → bass → lead → arrangement
3. **ArrangementState** — INTRO/GROOVE/BUILD/DROP/BREAK/DEVELOPMENT/PEAK/RELEASE/OUTRO with role activation
4. **MusicalSimulationHarness** — generates 64/128/256 bars, measures cross-part relationships
5. **Enhanced failure detector** — detects inter-part failures (KICK_MISSING, BASS_UNCOUPLED, LEAD_REGISTER_ESCAPE, etc.)

### What can be preserved

- Transport (CANONICAL, untouched)
- scales.ts, chords.ts (proven primitives)
- motif-v2.ts (structural motif representation is sound)
- motif-memory.ts (storage is fine)
- transformation.ts (transforms are correct, just need to be applied by the composer)
- MusicalLearning (learning is fine, but comes LAST)
- CandidateScorer (will be upgraded, not replaced)
- HarmonicClassifier (will be wired into the composer)
- RhythmicIdentity (will be used by GroovePlan)

### What must be deleted or deprecated

- phrase-planner.ts (generates bars independently — replaced by CompositionEngine)
- section-planner.ts (metadata only — replaced by ArrangementState)
- bass-behavior.ts (doesn't listen to kick — replaced by composer-driven bass)
- diversity.ts metrics that reward randomness (uniquePitchRatio as primary quality gate)
