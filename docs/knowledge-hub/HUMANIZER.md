# Humanizer

> Ported from PSYSTAR (src/engine/humanizer.ts)

## What it does

Adds human feel to machine-generated music:
- **Velocity jitter**: ±18% variation per note
- **Time drift**: ±18ms timing variation
- **Ghost note skipping**: probabilistic note dropping

## Implementation

### PRNG: mulberry32
```typescript
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

### Velocity Jitter
```typescript
function jitterVelocity(velocity, amount, random) {
  const jitter = (random() * 2 - 1) * amount * 0.18
  return clamp(velocity * (1 + jitter), 0.2, 1.6)
}
```

### Time Drift
```typescript
function driftTime(amount, random) {
  return (random() * 2 - 1) * amount * 0.018 // ±18ms max
}
```

### Ghost Note Skipping
- Bass (row 0) **never** skipped — it's the foundation
- Only skips when amount > 0.5
- Skip chance = (amount - 0.5) * 0.3

## In psy-foundation

Applied in `forensic-bridge.ts`:
- All non-kick events get velocity jitter (amount=0.3)
- All events get timing drift (±18ms)
- Kick excluded (needs consistency for groove)
- Events re-sorted after drift

## Parameters
- **amount=0.3**: subtle, good for production psytrance
- **amount=0.5**: noticeable, good for live feel
- **amount=0.7**: extreme, good for experimental
