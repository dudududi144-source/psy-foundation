# Harmony Engine

> Ported from PSYSTAR (src/domain/harmony.ts)

## Scales (8 types)

| Scale | Intervals | Character |
|-------|-----------|-----------|
| major | 0,2,4,5,7,9,11 | Bright, happy |
| naturalMinor | 0,2,3,5,7,8,10 | Dark, sad |
| pentatonicMajor | 0,2,4,7,9 | Open, clean |
| pentatonicMinor | 0,3,5,7,10 | Blues, rock |
| dorian | 0,2,3,5,7,9,10 | Modal, jazzy |
| phrygian | 0,1,3,5,7,8,10 | Dark, exotic |
| **phrygianDominant** | 0,1,4,5,7,8,10 | **Psytrance standard** |
| mixolydian | 0,2,4,5,7,9,10 | Bluesy, dominant |

## Chord Types (9)

| Type | Intervals | Name |
|------|-----------|------|
| maj | 0,4,7 | Major |
| min | 0,3,7 | Minor |
| dim | 0,3,6 | Diminished |
| aug | 0,4,8 | Augmented |
| maj7 | 0,4,7,11 | Major 7 |
| min7 | 0,3,7,10 | Minor 7 |
| dom7 | 0,4,7,10 | Dominant 7 |
| sus4 | 0,5,7 | Suspended 4 |
| power | 0,7 | Power chord |

## Psytrance Progressions (7 patterns)

| Name | Degrees | Character |
|------|---------|-----------|
| hypnotic | I-I-I-I | Drone, trance |
| dark | I-II-I-II | Phrygian, dark |
| uplifting | I-vi-IV-V | Major, uplifting |
| epic | I-IV-vi-V | Epic, trance |
| classic | I-V-vi-IV | Pop/classic |
| minor | i-VI-III-VII | Minor |
| **psy-dominant** | I-II-I-VII | **Classic psytrance** |

## Usage

```typescript
import { buildProgression, PSYTRANCE_PROGRESSIONS } from './harmony'

const prog = buildProgression(64, 'phrygianDominant', PSYTRANCE_PROGRESSIONS['psy-dominant'])
// → [E, Fmaj7, E, Dm7]
```

## In psy-foundation

Pad voice uses harmony progression:
- Every 2 bars → next chord
- Phrygian dominant scale
- psy-dominant progression (I-II-I-VII)

File: `src/lib/psy4/harmony.ts`
