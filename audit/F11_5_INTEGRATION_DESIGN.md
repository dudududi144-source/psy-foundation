# F11.5 INTEGRATION DESIGN

## Architecture

```
FOUNDATION (WHAT)                    PSY4 (WHEN/HOW)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CompositionEngine                    Transport (clock)
  → GroovePlan                       Scheduler (lookahead)
  → HarmonyPlan                      Synthesis (kick/bass/lead/hat)
  → Bass (LOCKED to kick)            Mixer (buses → master)
  → Lead (tessitura enforced)        FX (delay/reverb)
  → Arrangement (roles ON/OFF)
  → AdaptationLayer
    ← RadioMusicalContext
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FoundationMusicAdapter (SINGLE boundary)
  ComposedSection → PerformanceEvent[]
  beat-grid → AudioContext time
  intent → velocity/density adjustment
```

## Ownership

| Concept | Owner | Notes |
| --- | --- | --- |
| Form | Foundation | CompositionEngine |
| Harmony | Foundation | HarmonicClassifier |
| Groove | Foundation | GroovePlan |
| Phrase | Foundation | CompositionEngine.composePhrase |
| Motif | Foundation | MotifMemory |
| Arrangement | Foundation | ArrangementState |
| Adaptation | Foundation | CompositionAdaptation |
| Musical events | Foundation | ComposedBar → PerformanceEvent |
| Transport (clock) | PSY4 | Transport (from psy-foundation, canonical) |
| Scheduling | PSY4 | setInterval(25ms) + 0.15s lookahead |
| Synthesis | PSY4 | createOscillator/GainNode/BiquadFilter |
| Mixer | PSY4 | Buses → master → analyser → destination |
| FX | PSY4 | Delay, reverb sends |
| UI | PSY4 | React controls |
| Radio sensing | PSY4 | RadioObservationLayer → RadioMusicalContext |

## FoundationMusicAdapter

The SINGLE integration boundary. Translates:
- `ComposedSection` → `PerformanceEvent[]`
- Beat-grid coordinates → AudioContext time
- `AdaptedCompositionIntent` → velocity/density adjustments

Does NOT:
- Compose
- Change harmony
- Invent notes
- Hold clock
- Manage radio

## Audio routing

```
KICK BUS  ─┐
BASS BUS  ─┤
LEAD BUS  ─┼──→ MASTER GAIN → ANALYSER → DESTINATION
PERC BUS  ─┤     ↑
FX BUS    ─┘     │
RADIO BUS ─┘     │
                  ↑
           DELAY (lead → delay → feedback → delay → FX → master)
```

Each bus has one owner. No hidden connections.

## Composition caching

- Composition happens at phrase/section boundary (every 16 bars)
- NOT every scheduler tick (25ms)
- `FoundationMusicAdapter` caches `PerformanceEvent[]`
- Scheduler only reads cached events
- 1000 scheduler ticks → 0 repeated composition builds when context unchanged

## Radio flow

```
RADIO AUDIO
→ RadioObservationLayer (psy4)
→ RadioMusicalContext (foundation type)
→ CompositionAdaptation.adapt()
→ AdaptedCompositionIntent
→ FoundationMusicAdapter (applies intent to cached events)
→ Scheduler
→ Audio
```

Radio MUST NOT directly change oscillators, mute buses, reset composer, or modify Transport.

## Mid-phrase stability

- `phraseBar < 4` → no adaptation (finish current phrase)
- `phraseBar >= 4` → adapt at next bar boundary
- Radio changes are musical, not immediate resets

## Style

Style is owned by foundation (`StyleGrammar`). PSY4 exposes style selection but does not independently redefine style behavior. Same seed + key + BPM + different style → different foundation composition decisions.
