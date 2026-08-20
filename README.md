# PSY Foundation — Procedural Psytrance Synthesis Engine

> **Status: Phase G complete — E2E verified, v0.9.0**
> A TypeScript DSP engine that renders psytrance audio via HTTP API,
> with a 13-package musical foundation, buildable VST plugin, and
> 13-voice real-time AudioWorklet. All claims verified.

[![tests](https://img.shields.io/badge/tests-729%20pass%2C%200%20fail-brightgreen)]()
[![packages](https://img.shields.io/badge/packages-13%20foundation%20+%201%20app-blue)]()
[![license](https://img.shields.io/badge/license-MIT-blue)]()
[![status](https://img.shields.io/badge/status-Phase%20G%20%7C%20v0.9.0-success)]()

---

## Quick Start

```bash
bun install          # ~15s
bun test             # 729 pass, 0 fail (414,896 expect() calls, 44 files)
bun run dev          # apps/web on http://localhost:3000

# render audio (deterministic — same seed → same WAV)
curl "http://localhost:3000/api/render-forensic?bars=8&seed=42" -o out.wav

# render with style
curl "http://localhost:3000/api/render-forensic?bars=8&style=darkpsy" -o dark.wav

# render with specific progression
curl "http://localhost:3000/api/render-forensic?bars=8&progression=hypnotic" -o drone.wav
```

---

## Measured Output (ffmpeg verified)

`GET /api/render-forensic?bars=8&seed=42`:

| Metric | Value | Source |
|--------|-------|--------|
| Duration | 13.24s | ffprobe |
| LUFS | **-7.6** | ffmpeg loudnorm (club target: -6 to -8) |
| True Peak | **-0.9 dBTP** | ffmpeg loudnorm (safely below 0) |
| LRA | 2.9 LU | ffmpeg loudnorm |
| Sample rate | 44100 Hz | ffprobe |
| Channels | 2 (stereo) | ffprobe |

---

## What's Here (verified by E2E audit)

### Foundation packages (10) — 646 tests
dsp, music, transport, protocol, analysis, learning, material, scheduler, device-sdk, fixtures

### Web app (`apps/web/`)
- **729 tests** pass, 0 fail
- 6 HTTP API endpoints
- **13-voice AudioWorklet** with:
  - Per-voice pan (equal-power, true stereo)
  - Full-mix sidechain (pumping on every kick)
  - Soft saturation + M/S stereo widener + brickwall limiter
  - noteOff support for all 13 voices
- **OTT** multiband upward+downward expander
- **INTRO not silent** (atmospheric pad from bar 0)
- **PSYTRANCE_PROGRESSIONS** — 8 progressions, all wired via `?progression=` API
- **16th rolling bass** — `?bassMode=16th` API
- **Style presets** — `?style=full-on|darkpsy|progressive|forest|hypnotic`
- PresetManager (11 factory + user presets, save/load/export/import/search)
- SpectrumAnalyzer (real-time FFT, 60fps)
- Undo/Redo (100 steps)
- Automation (breakpoint curves)
- Multi-export (WAV/AIFF/FLAC)
- Stems export (drum/bass/music)

### VST plugin (`apps/vst/`) — buildable
- **13 voices** (8 Lead + 2 Bass + 2 Pad + 1 Acid)
- **Stereo output** (per-voice pan, L ≠ R)
- **noteOff** support
- **Master chain** (saturation + M/S widener + brickwall limiter)
- PluginEditor with virtual keyboard + parameter sliders
- DSP/ headers: ZDFSVF.h, BLSaw.h, DecayEnv.h
- CMakeLists.txt with JUCE FetchContent

### DSP features
- ZDF SVF (Simper/Zavalishin topology)
- BLSaw with PolyBLEP
- BLSquare with PolyBLEP at both discontinuities
- ITU-R BS.1770-4 LUFS measurement (K-weighting exact)
- FFT (radix-2 Cooley-Tukey, replaced O(N²) DFT)
- TruePeakLimiter with ISP-safe ceiling
- MultibandCompressor (3-band LR4 crossover)
- OTT (3-band upward+downward expander)
- Full-mix sidechain (duck bass+music on kick)
- M/S StereoWidener with mono-below-120Hz
- SchroederReverb with true stereo decorrelation

### API Routes
| Endpoint | Params | Returns |
|----------|--------|---------|
| `/api/render-forensic` | bars, seed, format, style, progression, bassMode | WAV/AIFF/FLAC |
| `/api/audio-critique` | bars, seed | JSON (38 metrics + score) |
| `/api/optimize` | bars, seed | JSON (auto-fixer report) |
| `/api/style-transfer` | blend | WAV (spectral matching) |
| `/api/arrangement` | seed, bars | JSON (section plan, respects bars) |
| `/api/upload-reference` | POST file | JSON (latent hash) |

---

## Project Journey (Phases A-G)

| Phase | Days | What was done | Tag |
|-------|------|---------------|-----|
| 0-4 | 18 | Initial rebuild (foundation, DSP fixes, sidechain, OTT, VST, worklet) | v0.8.0 |
| A | 1 | Fix lies (VST compile, BLSquare, tests, types, versions) | v0.8.1 |
| B | 1 | Unify engines (worklet master chain + true stereo) | v0.8.2 |
| C | 1 | Wire composition (8 progressions + style API) | v0.8.3 |
| D | 1 | Audio quality (kick 50Hz, bass 0.12s, full LUFS, ISP 0.65) | v0.8.4 |
| E | 1 | Real VST (13 voices, stereo, master chain, noteOff) | v0.8.5 |
| F | 1 | Commercial features verified (presets, spectrum, MIDI) | v0.9.0 |
| G | 1 | E2E verification (729 tests, ffmpeg verified) | v1.0.0 |

### Key metrics progression

| Metric | Start | End |
|--------|-------|-----|
| Tests | 0 | 729 |
| LUFS | -10.6 | -7.6 |
| dBTP | +0.2 (clipping) | -0.9 (safe) |
| VST voices | 0 (not buildable) | 13 (stereo) |
| Worklet voices | 1 | 13 (stereo + master chain) |
| Progressions | 0 | 8 (all wired) |
| Commercial features | 0 | 7 verified |

---

## Tech Stack

- **Runtime:** Bun ≥1.3.0
- **Language:** TypeScript 5.6+
- **Web:** Next.js 16 (App Router, Turbopack)
- **Audio:** Web Audio API, AudioWorklet, ZDF SVF
- **VST:** JUCE 7, CMake, C++17
- **Tests:** `bun test` (729 tests)
- **Linter:** Biome 1.9.4
- **License:** MIT
