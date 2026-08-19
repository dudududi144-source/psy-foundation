# F12 COMPOSITION CONTRACT

## CompositionPlan (= ComposedSection)

```typescript
interface ComposedSection {
  bars: ComposedBar[]
  phrases: ComposedPhrase[]
  arrangement: ArrangementPlan
  groove: GroovePlan
  seed: number
}
```

## ComposedBar (the atomic musical unit)

```typescript
interface ComposedBar {
  barIndex: number                    // 0-based global bar index
  arrangementState: ArrangementState  // INTRO/GROOVE/DROP/BREAK/etc.
  groove: GroovePlan                  // kick skeleton, accents, subdivision
  kickNotes: number[]                 // step indices within bar (0..stepsPerBar-1)
  bassNotes: { midi: number; step: number; durationSteps: number; function: string }[]
  leadNotes: { midi: number; step: number; durationSteps: number; velocity: number }[]
  hatNotes: number[]                  // step indices
  harmonicContext: number[]           // active chord pitch classes (0-11)
  roles: RoleActivation               // which parts are active
}
```

## What the consumer receives

- Musical time only (bar indices, step indices, MIDI notes)
- No AudioContext time (consumer converts via Transport)
- No DOM/browser objects
- Fully serializable (JSON.stringify works)
- Deterministic (same seed + context = same output)

## What the consumer must NOT do

- Cannot modify ComposedSection (it's the foundation's output)
- Cannot add notes (foundation is sole musical authority)
- Cannot change harmony (foundation owns harmonic context)
- Cannot change groove (foundation owns groove plan)
- Cannot change arrangement (foundation owns role activation)

## What the consumer CAN do

- Convert step indices → AudioContext time (using Transport)
- Choose synthesis parameters (waveform, filter, FX sends)
- Apply volume/mute/solo per bus
- Apply AdaptedCompositionIntent (from adaptation layer)
- Skip events (if restPressure is high)
