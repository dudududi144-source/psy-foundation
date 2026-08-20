# F12 RADIO CONTRACT

## Radio is INPUT only

```
RadioObservation (psy4)
→ RadioMusicalContext (foundation type)
→ OpportunityMap (foundation)
→ CompositionAdaptation.adapt() (foundation)
→ AdaptedCompositionIntent (foundation)
→ Applied to cached ComposedSection (foundation)
```

## What radio MUST NOT do

- Replace composition
- Change Transport
- Produce AudioEvent
- Activate AudioContext
- Bypass CompositionEngine
- Reset form
- Delete motifs
- Change key without confidence

## What radio CAN do

- Provide occupancy data (kick/bass/lead/percussion/harmonic)
- Provide energy/density
- Provide style guess
- Provide confidence

## Loss/recovery

- Radio loss: `available = false` → adaptation returns NEUTRAL intent → composition continues in internal mode
- Radio recovery: next observation → adaptation resumes gradually
- No transport reset, no composition reset, no motif reset

## Mid-phrase stability

- `phraseBar < 4`: adaptation returns NEUTRAL (finish current phrase)
- `phraseBar >= 4`: adaptation applied at next bar boundary
- Radio changes never restart phrases

## Identity preservation

Same seed + style + context, different radio:
- Form identity: preserved (formDivergence = 0.000)
- Motif identity: preserved (same motifs used, different emphasis)
- Harmonic identity: preserved (same key/scale)
- Arrangement expression: changed (different role pressures)
