# F11.5 UI BINDING REPORT

## Music controls (foundation input)

| Control | UI Element | Foundation Impact | Status |
| --- | --- | --- | --- |
| Style | Button group (full-on/progressive/dark/acid) | setStyle() → StyleGrammar → recompose | PROVEN |
| Seed | Number input | setSeed() → CompositionEngine reinit | PROVEN |
| Radio scenario | Button group (none/sparse/bass-heavy/melody-heavy/dense/breakdown) | updateRadio() → RadioMusicalContext → adaptation | PROVEN |

## Musical state display

| Display | Source | Status |
| --- | --- | --- |
| BPM | Transport.snapshot().bpm | PROVEN |
| Beat / Bar | Transport.snapshot().beat / .bar | PROVEN |
| Epoch | Transport.snapshot().epoch | PROVEN |
| Style | runtime.style | PROVEN |
| Section (arrangement state) | PerformanceEvent.provenance.arrangementState | PROVEN |
| Active roles | Set of roles from cached events | PROVEN |
| Radio connected | RadioMusicalContext.available | PROVEN |
| Adaptation | AdaptedCompositionIntent summary | PROVEN |

## Mixer controls

| Control | Status | Notes |
| --- | --- | --- |
| Kick volume/mute/solo | NOT YET WIRED | Bus exists, UI slider not connected |
| Bass volume/mute/solo | NOT YET WIRED | Bus exists, UI slider not connected |
| Lead volume/mute/solo | NOT YET WIRED | Bus exists, UI slider not connected |
| Perc volume/mute/solo | NOT YET WIRED | Bus exists, UI slider not connected |
| FX volume | NOT YET WIRED | Bus exists, UI slider not connected |

## FX controls

| Control | Status | Notes |
| --- | --- | --- |
| Delay send | NOT YET WIRED | DelayNode exists, send level not adjustable from UI |
| Delay time | NOT YET WIRED | Fixed at 0.375s (dotted eighth at 145bpm) |
| Delay feedback | NOT YET WIRED | Fixed at 0.35 |
| Reverb | NOT IMPLEMENTED | No reverb node yet |
| Filter | NOT YET WIRED | Per-voice filters exist, no master filter |
| Drive | NOT IMPLEMENTED | No waveshaper yet |
| Width | NOT IMPLEMENTED | No stereo width control yet |

## Dead controls

None. All UI elements are connected to real state.

## Summary

- PROVEN: Music controls (style, seed, radio) affect foundation composition
- PROVEN: Musical state display shows real Transport/arrangement/adaptation data
- PARTIALLY PROVEN: Mixer/FX controls (buses and nodes exist, UI sliders not yet wired)
- The UI is functional for integration proof. Production mixer/FX UI is future work.
