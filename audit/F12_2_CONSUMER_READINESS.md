# F12.2 CONSUMER READINESS

## Consumer fixture results (12/12 pass)

| Test | Description | Status |
| --- | --- | --- |
| FOUNDATION_CONTRACT_VERSION exists | Version = 1 | ✅ |
| ComposedSection serializable | JSON.stringify works, no functions/undefined | ✅ |
| ComposedSection deserializable | JSON.parse preserves all fields | ✅ |
| All events have enough info | midi, step, durationSteps, velocity, function | ✅ |
| Rest semantics unambiguous | empty array = silence, not "generate" | ✅ |
| Role activation prevents inactive parts | roles.kick=false → no kick | ✅ |
| No AudioContext/DOM dependency | JSON contains no browser globals | ✅ |
| 100-run determinism | identical output (32,467 bytes) | ✅ |
| Consumer never makes musical decisions | all fields present, consumer just iterates | ✅ |
| 64-bar complete | all bars have all fields | ✅ |
| 128-bar stable | no NaN, all finite | ✅ |
| Performance < 100ms | 64 bars in < 6ms | ✅ |

## Consumer import path

```typescript
// The ONLY import a consumer needs:
import { CompositionEngine, CompositionAdaptation, detectMusicalFailures, FOUNDATION_CONTRACT_VERSION } from '@psy-foundation/music'
import type { ComposedSection, MusicalContext, RadioMusicalContext, AdaptedCompositionIntent } from '@psy-foundation/music'
```

No internal file paths needed. No private helpers. No implementation knowledge.

## Serialization contract

| Output | JSON.stringify | JSON.parse | Round-trip valid |
| --- | --- | --- | --- |
| ComposedSection (64 bars) | ✅ | ✅ | ✅ |
| ComposedSection (128 bars) | ✅ | ✅ | ✅ |
| ComposedSection (256 bars) | ✅ | ✅ | ✅ |
| AdaptedCompositionIntent | ✅ | ✅ | ✅ |
| RadioMusicalContext | ✅ | ✅ | ✅ |

No functions, no class instances, no undefined, no DOM, no AudioContext leak into serialized output.

## Performance contract

| Operation | Time |
| --- | --- |
| 64-bar composition | 3.8ms |
| 128-bar composition | 1.9ms |
| 256-bar composition | 3.0ms |
| Adaptation (per call) | < 0.01ms |
| 1000 repeated adaptation calls | < 10ms |
| Consumer fixture (12 tests) | 71ms total |

Consumers may safely cache ComposedSection output. No recomposition needed unless context changes.

## Determinism contract

Same seed + same MusicalContext = identical ComposedSection (byte-for-byte).
Proven with 100 runs, 32,467 bytes each, zero divergence.

## PSY4 readiness

The contract is READY for psy4 consumption. PSY4 has NOT consumed it.
