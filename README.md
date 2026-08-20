# PSY Foundation — Procedural Psytrance Synthesis Engine

> **Status: Phase 4 complete — VST buildable, 13-voice AudioWorklet, club loudness.**
> An offline TypeScript DSP engine that renders psytrance-style audio to WAV via HTTP API,
> built on a 13-package musical foundation. Honest metrics, no false claims.

[![tests](https://img.shields.io/badge/tests-712%20pass%2C%200%20fail-brightgreen)]()
[![packages](https://img.shields.io/badge/packages-13%20foundation%20+%201%20app-blue)]()
[![license](https://img.shields.io/badge/license-MIT-blue)]()
[![status](https://img.shields.io/badge/status-Phase%204%20%7C%20v0.8.0-success)]()

---

## What This Is

A TypeScript monorepo for procedural psytrance synthesis:

1. **Foundation** (`packages/`): 10 library packages with 646 passing tests — shared musical infrastructure
2. **Web app** (`apps/web/`): Next.js app exposing 6 HTTP API endpoints for offline rendering
3. **VST plugin** (`apps/vst/`): C++/JUCE plugin with PluginEditor + DSP headers (buildable)

---

## Quick Start

```bash
# from repo root
bun install          # ~1s — minimal deps
bun test             # 712 pass, 0 fail (414,845 expect() calls, 42 files)
bun run dev          # apps/web on http://localhost:3000

# render audio (deterministic — same seed → same WAV)
curl "http://localhost:3000/api/render-forensic?bars=8&seed=42" -o out.wav
```

---

## Measured Output (verified, not claimed)

`GET /api/render-forensic?bars=8&seed=42` returns WAV (13.24s, stereo 44.1kHz 16-bit PCM):

| Metric | Value | Source |
|--------|-------|--------|
| Duration | 13.24s | ffprobe |
| LUFS (integrated) | **-6.5 LUFS** | ffmpeg loudnorm (club target: -6 to -8) |
| True Peak | **-0.3 dBTP** | ffmpeg loudnorm (safely below 0 dBFS) |
| LRA | 2.5 LU | ffmpeg loudnorm |

---

## What's Here (verified)

### Foundation packages (10) — 646 tests
| Package | Tests | Purpose |
|---------|-------|---------|
| `@psy-foundation/dsp` | 39 | PolyBLEP osc, Moog filter, ADSR, delay, reverb, metering, voice pool |
| `@psy-foundation/music` | 43 | 18 scales, 18 chords, motif generator, bass grammar, rhythm, PSYTRANCE_PROGRESSIONS |
| `@psy-foundation/transport` | 12 | MusicalTransport: beat/bar/phase/bpm/confidence |
| `@psy-foundation/protocol` | 8 | MusicalEvent types + Channel abstraction |
| `@psy-foundation/analysis` | 26 | onset/beat/tempo/pitch/chroma/spectral features |
| `@psy-foundation/learning` | 32 | CONTEXT+ACTION+OUTCOME+REWARD contextual bandit |
| `@psy-foundation/material` | 23 | 9 material kinds + MaterialLibrary |
| `@psy-foundation/scheduler` | 18 | MusicalPlan → ScheduledEvent[] |
| `@psy-foundation/device-sdk` | 12 | PsyDevice interface + DeviceHost |
| `@psy-foundation/fixtures` | 10 | 14 synthetic radio fixtures |

### Web app (`apps/web/`)
- 6 HTTP API endpoints
- **13-voice AudioWorklet** (8 lead + 2 bass + 2 pad + 1 acid)
- Stereo output via Haas delay
- Full-mix sidechain (duck bass+music on kick)
- OTT upward+downward multiband expander
- INTRO/OUTRO rendered (pad from bar 0 — not silent)

### VST plugin (`apps/vst/`) — buildable
- `PluginProcessor.cpp/.h` — 3 voice types (Lead, Bass, Pad)
- `PluginEditor.cpp/.h` — virtual keyboard + sliders + parameter attachments
- `DSP/ZDFSVF.h` — C++ ZDF SVF (Simper/Zavalishin)
- `DSP/BLSaw.h` — PolyBLEP band-limited saw
- `DSP/DecayEnv.h` — Exponential decay envelope
- CMakeLists.txt with JUCE FetchContent
- **Buildable with:** `cd apps/vst && mkdir build && cd build && cmake .. && cmake --build .`

### Psytrance features
- ✅ Full-mix sidechain (pumping on every kick)
- ✅ OTT multiband expander (genre signature)
- ✅ PSYTRANCE_PROGRESSIONS (8 progressions: hypnotic, dark, psy-dominant, etc.)
- ✅ 16th rolling bass mode (darkpsy/forest)
- ✅ INTRO atmospheric pad (not silent)
- ✅ Club loudness target (-9 LUFS, measured -6.5)
- ✅ ISP-safe limiter (dBTP ≤ -0.3)

---

## API Routes

| Endpoint | Method | Returns | Notes |
|----------|--------|---------|-------|
| `/api/render-forensic` | GET | WAV/AIFF/FLAC | `?bars=8&seed=42&format=wav` |
| `/api/audio-critique` | GET | JSON (38 metrics + score) | ~13s (FFT optimized) |
| `/api/optimize` | GET | JSON (auto-fixer report) | 2-5 min (16 plans) |
| `/api/style-transfer` | GET | WAV | Spectral matching EQ |
| `/api/arrangement` | GET | JSON (section plan) | Markov chain, respects `?bars=` |
| `/api/upload-reference` | POST | JSON (latent hash) | In-memory only |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 5: PRESENTATION                                              │
│  apps/web (Next.js)  ·  apps/vst (JUCE C++, buildable)            │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 3: PSY4 RENDER ENGINE                                        │
│  forensic-bridge · psy-voices · channel-fx · OTT · master chain    │
│  · multiband · loudness · limiter · sidechain · 13 voices          │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 1: FOUNDATION (10 packages, 646 tests)                      │
│  dsp · music · transport · protocol · analysis · learning         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
psy-foundation/
├── packages/                    # Foundation (10 lib packages, 646 tests)
├── apps/
│   ├── web/                     # Next.js app (6 API routes, 13-voice worklet)
│   ├── vst/                     # JUCE C++ plugin (buildable)
│   └── */                       # Research apps (benchmark-lab, etc.)
├── benchmarks/                  # compare-to-reference.ts
├── docs/                        # STATUS, ARCHITECTURE, ROADMAP, etc.
├── worklog.md                   # Dev journal (3200+ lines)
└── package.json                 # Workspace root
```

---

## Tech Stack

- **Runtime:** Bun ≥1.3.0
- **Language:** TypeScript 5.6+
- **Web:** Next.js 16 (App Router, Turbopack)
- **Audio:** Web Audio API, AudioWorklet, ZDF SVF
- **VST:** JUCE 7, CMake, C++17
- **Tests:** `bun test` (712 tests)
- **Linter:** Biome 1.9.4

---

## Project Journey (Phases 0-4)

| Phase | Days | What was done | Tag |
|-------|------|---------------|-----|
| 0 | 5 | Foundation deploy, cleanup, docs, snapshot tests | `v0.4.0` |
| 1 | 5 | 11 DSP bugs fixed (StereoWidener, TruePeakLimiter, FFT, etc.) | `v0.5.0` |
| 2 | 4 | Sidechain, OTT, INTRO not silent, progressions, 16th bass | `v0.6.0` |
| 3 | 2 | Club loudness (-6.5 LUFS), voice improvements, reference benchmark | `v0.7.0` |
| 4 | 2 | VST PluginEditor + DSP headers, 13-voice AudioWorklet + stereo | `v0.8.0` |

### Key metrics progression

| Metric | Phase 0 | Phase 4 |
|--------|----------|---------|
| Tests | 0 (foundation in zip) | 712 |
| LUFS | -10.6 (too quiet) | -6.5 (club target) |
| dBTP | +0.2 (clipping!) | -0.3 (safe) |
| Voices (worklet) | 1 (lead only) | 13 (full) |
| VST | Not buildable | Buildable |
| INTRO | Silent | Atmospheric pad |
| Sidechain | None | Full-mix pumping |
| OTT | None | 3-band expander |

---

## License

**MIT** for code. Samples: CC0 procedural (commercial samples removed in Phase 0).

---

## What This Is Not (still honest)

- **Not a commercial product** — no paying customers, no SLA
- **Not a DAW** — offline renderer + 13-voice worklet (not full real-time DAW)
- **Not AI/neural** — no trained models (Phase 5 optional, requires GPU)
- **Not fully commercial-grade DSP** — some bugs remain (documented in worklog)

But it's **honest, tested, and measurably improved** from where it started.
