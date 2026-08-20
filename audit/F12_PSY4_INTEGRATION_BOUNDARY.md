# F12 PSY4 INTEGRATION BOUNDARY

## The SINGLE boundary

```
FOUNDATION (WHAT)                    PSY4 (WHEN/HOW)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CompositionEngine                    Transport (clock)
  composeSection()                   Scheduler (lookahead)
  → ComposedSection                  Synthesis (kick/bass/lead/hat)
                                     Mixer (buses → master)
CompositionAdaptation                FX (delay/reverb)
  adapt()                            UI (React)
  → AdaptedCompositionIntent         Radio sensing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         FoundationMusicAdapter (SINGLE boundary)
         ComposedSection → PerformanceEvent[]
         beat-grid → AudioContext time
```

## What psy4 must implement

1. `FoundationMusicAdapter` — translates ComposedSection → PerformanceEvent[]
2. `Transport` — already canonical (from psy-foundation)
3. `Scheduler` — reads cached events, schedules to AudioContext
4. `Synthesis` — kick/bass/lead/hat voice functions
5. `Mixer` — buses → master → analyser → destination
6. `Radio analyser` — produces RadioMusicalContext from radio audio

## What psy4 must NOT implement

1. Composition logic (foundation owns this)
2. Harmony decisions (foundation owns this)
3. Groove decisions (foundation owns this)
4. Motif generation (foundation owns this)
5. Arrangement decisions (foundation owns this)
5. Adaptation logic (foundation owns this)

## Integration status

**NOT INTEGRATED / CONTRACT READY**

The contract is defined, tested, and deterministic. PSY4 has NOT independently
consumed and proven this contract in its real repository. The sandbox demo
(F11.5) proved the contract works in principle but is NOT the real psy4.

## What "PROVEN" would require

1. Real psy4 repository imports `@psy-foundation/music`
2. Real psy4 replaces its hardcoded PRESETS with CompositionEngine
3. Real psy4 replaces patternMutator with foundation transformations
4. Real psy4 replaces learning.ts with MusicalLearning
5. Real psy4's 104 foundation tests pass against foundation
6. Real psy4's playback-reality suite passes
7. Real psy4 plays continuously in a browser with foundation as sole composer

None of these have been done. The contract is READY but NOT PROVEN in real psy4.
