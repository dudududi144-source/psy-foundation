# F11.5 REAL RADIO REPORT

## Radio scenario testing

The PSY4 runtime supports 6 radio scenarios via the UI. Each scenario feeds a
synthetic `RadioMusicalContext` to the foundation's `CompositionAdaptation`
layer. Real radio analyser integration is future work — these scenarios
prove the adaptation contract.

### Scenario results (full-on style, seed=42)

| Scenario | bassPressure | leadPressure | restPressure | What foundation does |
| --- | --- | --- | --- | --- |
| SPARSE | 0.77 | 0.72 | 0.10 | Fills empty space — adds groove + bass + lead |
| BASS_HEAVY | 0.20 | 0.55 | 0.10 | Reduces bass competition, shifts to upper roles |
| MELODY_HEAVY | 0.25 | 0.25 | 0.10 | Backs off lead, uses counter/response |
| DENSE | 0.20 | 0.25 | 0.65 | Intelligent abstention — reduces all layers |
| BREAKDOWN | 0.30 | 0.80 | 0.10 | Exposes motif, adds texture, reduces groove |
| ABSENT (loss) | 0.70 | 0.70 | 0.10 | NEUTRAL — composition continues in internal mode |

### Radio loss/recovery

| Phase | Behavior | Status |
| --- | --- | --- |
| Radio present (bars 1-32) | Normal adaptation | PROVEN |
| Radio lost (bars 33-48) | NEUTRAL intent, composition continues, no reset | PROVEN |
| Radio returns (bars 49-64) | Gradual adaptation resumes | PROVEN |

### Mid-phrase change

| Phase | Behavior | Status |
| --- | --- | --- |
| Bars 1-4 (phrase first half) | No adaptation (finish phrase) | PROVEN |
| Bar 5+ (phrase second half) | Adapt at next bar boundary | PROVEN |

## What is PROVEN

- 6 radio scenarios produce different AdaptedCompositionIntent
- Radio loss → NEUTRAL intent (composition continues)
- Radio recovery → adaptation resumes
- Mid-phrase changes don't reset phrases
- Adaptation preserves musical identity (form divergence = 0.000)

## What is UNPROVEN

- Real radio audio → live RadioMusicalContext (uses synthetic scenarios)
- Live FFT/pitch analysis feeding the adaptation layer
- Continuous browser playback with real radio stream

## Real radio integration path (future)

```
Radio audio → AudioContext.createMediaElementSource()
→ AnalyserNode → getByteFrequencyData() / getFloatTimeDomainData()
→ RadioObservationLayer (from psy4 foundation/radio/)
→ RadioMusicalContext
→ CompositionAdaptation.adapt()
→ FoundationMusicAdapter
→ Scheduler
→ Audio
```

The contract is proven with synthetic scenarios. Real radio integration
requires wiring the RadioObservationLayer to the Psy4Runtime.
