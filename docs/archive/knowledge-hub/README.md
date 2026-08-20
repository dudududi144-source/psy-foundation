# PSY Knowledge Hub

> Central knowledge repository for the PSY device family.
> All design rules, sound design principles, production knowledge, and lessons learned.

## Categories

### 1. Sound Design Rules (from PSY3)
- [PSY3_SOUND_DESIGN_RULES.md](./PSY3_SOUND_DESIGN_RULES.md) — 9 design rules extracted from PSY3 DSP
- [PSY3_PRODUCTION_KNOWLEDGE.md](./PSY3_PRODUCTION_KNOWLEDGE.md) — production technique map
- [PSY3_VS_PSY4.md](./PSY3_VS_PSY4.md) — comparison and knowledge transfer

### 2. Commercial Standards
- [COMMERCIAL_AUDIO_AUDIT.md](./COMMERCIAL_AUDIO_AUDIT.md) — 30 gaps to commercial sound
- [COMMERCIAL_ROADMAP.md](./COMMERCIAL_ROADMAP.md) — P0/P1/P2 priorities
- [COMMERCIAL_GAP_ANALYSIS.md](./COMMERCIAL_GAP_ANALYSIS.md) — gap analysis
- [COMMERCIAL_REFERENCE_FRAMEWORK.md](./COMMERCIAL_REFERENCE_FRAMEWORK.md) — reference architecture

### 3. DSP Knowledge
- [ZDF_SVF.md](./ZDF_SVF.md) — Zero-Delay Feedback State-Variable Filter design
- [CHOKE_GROUPS.md](./CHOKE_GROUPS.md) — Drum choke group patterns (from PSYDRUM)
- [VELOCITY_TO_TIMBRE.md](./VELOCITY_TO_TIMBRE.md) — Velocity→timbre mapping (from PSYDRUM)
- [HUMANIZER.md](./HUMANIZER.md) — Human feel: jitter, drift, ghost notes (from PSYSTAR)

### 4. Harmony & Music Theory
- [HARMONY_ENGINE.md](./HARMONY_ENGINE.md) — 8 scales, 9 chord types, 7 progressions (from PSYSTAR)
- [MUSICAL_GRAMMAR.md](./MUSICAL_GRAMMAR.md) — Musical grammar system
- [PSYTRANCE_PROGRESSIONS.md](./PSYTRANCE_PROGRESSIONS.md) — Psytrance chord progressions

### 5. Architecture
- [ARCHITECTURE.md](./ARCHITECTURE.md) — PSY4 architecture
- [SIGNAL_FLOW.md](./SIGNAL_FLOW.md) — Signal flow diagram
- [FOUNDATION_API.md](./FOUNDATION_API.md) — Foundation API contract
- [PSY_DEVICE_CONTRACT.md](./PSY_DEVICE_CONTRACT.md) — PsyDevice interface specification

### 6. Family Device Knowledge
- [PSYDRUM.md](./PSYDRUM.md) — Drum device design (choke, velocity-to-timbre, variance)
- [PSYSYNTHPRO.md](./PSYSYNTHPRO.md) — ZDF SVF + PolyBLEP + FM + convolution reverb
- [PSYSTAR.md](./PSYSTAR.md) — 59-phase platform (P2P, PWA, MIDI, harmony, humanizer)
- [PSYSYNTH.md](./PSYSYNTH.md) — Subtractive synth device (124 tests)
- [PSY_SAMPLER.md](./PSY_SAMPLER.md) — Sample playback device

### 7. Audio Analysis
- [AUDIO_CRITIC.md](./AUDIO_CRITIC.md) — 8 areas, 12 failure codes
- [REFERENCE_ANALYSIS.md](./REFERENCE_ANALYSIS.md) — Reference profile extraction
- [LUFS_MEASUREMENT.md](./LUFS_MEASUREMENT.md) — ITU-R BS.1770-4 implementation

### 8. Lessons Learned
- [PSY4_DEEP_ROAST.md](./PSY4_DEEP_ROAST.md) — 7 problems that made it sound amateur
- [BENCHMARK_REPORT.md](./BENCHMARK_REPORT.md) — PSY3 vs PSY4 benchmarks
- [LATENCY_FORENSIC.md](./LATENCY_FORENSIC.md) — Latency analysis

---

## Quick Reference

### The 9 Sound Design Rules (from PSY3):
1. **Sub over click** — kick sub 90x longer than click
2. **Bass leaves room** — filter drops to 150Hz
3. **Band-limited oscillators** — no aliasing (PolyBLEP/ZDF)
4. **Controlled mutation** — one note per 4 bars, not random
5. **Section-aware FX** — kick dry, lead delay, pad reverb
6. **Tension shapes** — arc/rise/fall per section
7. **Downbeat accent** — 1.4x probability on downbeat
8. **Subtle saturation** — 15% mix, not distortion
9. **Frequency-dependent stereo** — mono <120Hz, wide above

### The 30 Commercial Gaps:
See [COMMERCIAL_AUDIO_AUDIT.md](./COMMERCIAL_AUDIO_AUDIT.md) for the full list.

### Key DSP:
- **ZDF SVF** — zero-delay feedback, the standard in Serum/Massive/Vital
- **PolyBLEP** — band-limited oscillators, no aliasing
- **Choke groups** — open hat chokes closed hat (no mud)
- **Velocity-to-timbre** — louder = brighter (not just louder)
- **Mulberry32** — deterministic PRNG for humanizer
