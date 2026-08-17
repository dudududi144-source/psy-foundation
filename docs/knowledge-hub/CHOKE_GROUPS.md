# Choke Groups & Velocity-to-Timbre

> Ported from PSYDRUM (src/psy-drum/choke.ts, variance-rules.ts)

## Choke Groups

### Problem
Open hat and closed hat playing simultaneously creates mud. In real drum machines, hitting open hat chokes (silences) the closed hat.

### Solution
When open hat triggers, set all active closed hats to inactive.

```typescript
// When open hat triggers:
for (const h of hats) {
  if (h.active && !h.open) h.active = false
}
hats[idx].trigger(vel, true) // open = true
```

### Choke Rules (from PSYDRUM)
| Drum | Chokes | Choked by |
|------|--------|-----------|
| Open hat | Closed hat | Closed hat |
| Closed hat | — | Open hat |
| Crash | Oldest crash (if > maxPoly) | New crash |
| Ride | Oldest ride (if > maxPoly) | New ride |
| Kick/Snare/Clap/Tom/Perc | Never | Never |

## Velocity-to-Timbre

### Problem
In most synths, velocity only changes amplitude. But real drums get **brighter** when hit harder — the transient has more high-frequency content.

### Solution
Map velocity to click level (and optionally filter cutoff):

```typescript
// Velocity modulates click brightness: 0.5x at vel=0, 1.5x at vel=1
const velToTimbre = 0.5 + this.amp * 1.0
const click = hpOut * clickEnv * KICK_SPEC.clickLevel * velToTimbre
```

### Mapping (from PSYDRUM)
- Velocity 0.0 → timbre 0.5x (soft, dark)
- Velocity 0.5 → timbre 1.0x (normal)
- Velocity 1.0 → timbre 1.5x (hard, bright)

## In psy-foundation

- Choke: `src/lib/psy4/forensic-bridge.ts` — open hat event handler
- Velocity-to-timbre: `src/lib/psy4/psy-voices.ts` — PsyKick.render()
