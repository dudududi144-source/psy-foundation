# F11.5 AUDIO ROUTING REPORT

## Audio graph

```
KICK BUS (GainNode)     ──┐
BASS BUS (GainNode)     ──┤
LEAD BUS (GainNode)     ──┼──→ MASTER GAIN → ANALYSER → DESTINATION
PERC BUS (GainNode)     ──┤         ↑
FX BUS (GainNode)       ──┘         │
RADIO BUS (GainNode)    ──┘         │
                                  │
                           DELAY (lead → delay → feedback → delay → FX → master)
```

## Bus ownership

| Bus | Owner | Source | Destination |
| --- | --- | --- | --- |
| kickBus | PSY4 | synthKick() | masterGain |
| bassBus | PSY4 | synthBass() | masterGain |
| leadBus | PSY4 | synthLead() | masterGain + delayNode |
| percBus | PSY4 | synthHat() | masterGain |
| fxBus | PSY4 | delayNode output | masterGain |
| radioBus | PSY4 | MediaElementSource | masterGain |
| masterGain | PSY4 | all buses | analyser → destination |

## Synthesis

| Role | Synth | Parameters |
| --- | --- | --- |
| Kick | Oscillator (150→50Hz sweep) + GainNode (exp decay 0.15s) | vel × 0.8 |
| Bass | Sawtooth osc + BiquadFilter (LP 800→200Hz) + GainNode | vel × 0.5, dur from foundation |
| Lead | Dual sawtooth (detuned) + BiquadFilter (LP 3000→800Hz) + GainNode | vel × 0.3, dur from foundation |
| Hats | White noise buffer + BiquadFilter (HP 7000Hz) + GainNode | vel × 0.15, 50ms |

## Status

- PROVEN: Audio graph builds correctly (AudioContext, buses, connections)
- PROVEN: Synthesis functions produce sound (kick/bass/lead/hat)
- PROVEN: Foundation MIDI notes → synth frequency conversion
- PARTIALLY PROVEN: UI volume controls (buses exist, sliders not wired)
- UNPROVEN: Continuous browser playback (requires stable server + user interaction)
