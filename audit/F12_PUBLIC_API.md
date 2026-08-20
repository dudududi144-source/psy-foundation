# F12 PUBLIC API

## Minimal consumer-facing API

```typescript
// The ONLY things psy4 needs to import:
import { CompositionEngine } from '@psy-foundation/music'
import type { ComposedSection, MusicalContext, RadioMusicalContext } from '@psy-foundation/music'
import { CompositionAdaptation } from '@psy-foundation/music'
import type { AdaptedCompositionIntent } from '@psy-foundation/music'
import { MusicalFailureDetector } from '@psy-foundation/music'
import { FOUNDATION_CONTRACT_VERSION } from '@psy-foundation/music'
```

## composeSong (ideal future API)

```typescript
const section = engine.composeSection({ bars: 64 })
// → ComposedSection with all musical events in musical time
```

## adaptComposition

```typescript
const intent = adaptation.adapt({
  baseContext, radio: radioCtx, opportunities, currentBar, phraseBar
})
// → AdaptedCompositionIntent (pressures, targets, preferences)
```

## validateComposition

```typescript
const report = detector.detect({ kickNotes, bassNotes, leadNotes, ... })
// → MusicalFailureReport (OK/WARNING/FAIL + reasons)
```

## What is INTERNAL (not exported)

- `generateMotifV2` — engine internal
- `planPhrase` / `planSection` — legacy, not used
- `CandidateScorer` — not used by engine
- `RepetitionPolicy` — not used by engine
- `PhraseArc` — not used by engine
- `MotifQualityGate` — not used by engine
- All coherence measurement functions — analysis only
- `Rng` — internal
- `generateMotif` (v1) — legacy
- `generateBassPattern` — legacy
- `fourOnFloor`, `psyKick`, etc. — legacy rhythm builders

## Version

```typescript
export const FOUNDATION_CONTRACT_VERSION = 1
```

Breaking changes to `ComposedSection`, `MusicalContext`, or `AdaptedCompositionIntent` require version bump.
