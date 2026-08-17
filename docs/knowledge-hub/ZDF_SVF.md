# ZDF State-Variable Filter

> Ported from PsySynthPro (src/synth-engine.js) and PSYDRUM.

## What is ZDF SVF?

Zero-Delay Feedback State-Variable Filter — the standard filter topology in professional softsynths (Serum, Massive, Vital, u-he).

## Why ZDF over Moog Ladder?

| Property | Moog Ladder (naive) | ZDF SVF |
|----------|---------------------|---------|
| Feedback | Naive (1-sample delay) | Zero-delay (solved analytically) |
| Stability | Can blow up at high res | Mathematically stable |
| Aliasing | Yes, at high res | No |
| Outputs | LP only | LP + BP + HP simultaneously |
| Resonance | Self-oscillates unpredictably | Clean self-oscillation |
| Character | Warm (tanh saturation) | Clean/precise |

## Implementation

```typescript
const g = Math.tan(Math.PI * fc / sr)  // fc = cutoff / sampleRate
const k = Math.max(0.02, 2 - res * 2) // res 0..1 → k 2..0.02

const a1 = 1 / (1 + g * (g + k))
const a2 = g * a1
const a3 = g * a2

const v3 = x - ic2eq
const v1 = a1 * ic1eq + a2 * v3
const v2 = ic2eq + a2 * ic1eq + a3 * v3

ic1eq = 2 * v1 - ic1eq
ic2eq = 2 * v2 - ic2eq

// Outputs:
// LP = v2
// BP = v1
// HP = x - k * v1 - v2
```

## In psy-foundation

Used in: lead, pad, acid, texture (4 voices)
MoogLadder kept in: bass (needs tanh warmth), kick (needs character)

File: `src/lib/psy4/forensic/dsp.ts` — class `ZDFSVF`

## Source

- PsySynthPro: `src/synth-engine.js` (line ~179)
- Reference: Zavalishin "The Art of VA Filter Design", Simper (2011)
