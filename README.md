# PSY Foundation — Procedural Psytrance Synthesis Engine

> **Status: In development — not commercial-ready.**
> An offline TypeScript DSP engine that renders psytrance-style audio to WAV via HTTP API,
> built on a 13-package musical foundation. Honest metrics, no false claims.

[![tests](https://img.shields.io/badge/tests-646%20pass%2C%200%20fail-brightgreen)]()
[![packages](https://img.shields.io/badge/packages-13%20foundation%20+%201%20app-blue)]()
[![license](https://img.shields.io/badge/license-MIT-blue)]()
[![status](https://img.shields.io/badge/status-Phase%200%20%7C%20rebuild-orange)]()

---

## What This Is

A TypeScript monorepo for procedural psytrance synthesis. Two layers:

1. **Foundation** (`packages/`): 10 library packages with 646 passing tests — shared musical infrastructure (transport, protocol, analysis, music, learning, dsp, etc.)
2. **Web app** (`apps/web/`): Next.js app exposing 6 HTTP API endpoints for offline rendering

Plus an **experimental VST stub** (`apps/vst/`) — C++ skeleton with ZDF SVF, not yet buildable.

---

## Quick Start

```bash
# from repo root
bun install          # ~1s — minimal deps
bun test             # 646 pass, 0 fail (391,380 expect() calls, 34 files)
bun run dev          # apps/web on http://localhost:3000

# render audio (deterministic — same seed → same WAV)
curl "http://localhost:3000/api/render-forensic?bars=8&seed=42" -o out.wav
```

---

## Measured Output (verified, not claimed)

`GET /api/render-forensic?bars=8&seed=42` returns WAV (1.75MB, 9.93s, stereo 44.1kHz 16-bit PCM):

| Metric | Value | Source |
|--------|-------|--------|
| Duration | 9.93s | ffprobe |
| Sample rate | 44100 Hz | ffprobe |
| Channels | 2 (stereo) | ffprobe |
| LUFS (integrated) | **-10.6 LUFS** | ffmpeg loudnorm |
| True Peak | **+0.2 dBTP** ⚠️ | ffmpeg loudnorm |
| LRA | 1.9 LU | ffmpeg loudnorm |
| BPM (detected) | 143 | AudioCritic internal |
| WAV md5 | `0e1294f1e9f8b5280893ad01f9ca6326` | deterministic baseline |

**Note:** dBTP exceeds 0 dBFS — this is the TruePeakLimiter bug documented for Phase 1 Day 3-4 (currently applies gain at 1× rate, should be 4×).

---

## What's Here (verified)

### Foundation packages (10)
| Package | Tests | Purpose |
|---------|-------|---------|
| `@psy-foundation/dsp` | 39 | PolyBLEP osc, Moog filter, ADSR, delay, reverb, metering, voice pool |
| `@psy-foundation/music` | 43 | 18 scales, 18 chords, motif generator, variation ops, bass grammar, rhythm |
| `@psy-foundation/transport` | 12 | MusicalTransport: beat/bar/phase/bpm/confidence. Observer-fed PLL with octave-fold |
| `@psy-foundation/protocol` | 8 | MusicalEvent types + Channel abstraction. Transport-agnostic messaging |
| `@psy-foundation/analysis` | 26 | onset/beat/tempo/pitch/chroma/spectral features. Multi-hypothesis tempo |
| `@psy-foundation/learning` | 32 | CONTEXT+ACTION+OUTCOME+REWARD. DO NOTHING is legal. Contextual bandit |
| `@psy-foundation/material` | 23 | 9 material kinds + MaterialLibrary + seed library |
| `@psy-foundation/scheduler` | 18 | MusicalPlan → ScheduledEvent[]. Deterministic pure function |
| `@psy-foundation/device-sdk` | 12 | PsyDevice interface + DeviceHost + ReferenceDevice |
| `@psy-foundation/fixtures` | 10 | 14 synthetic radio fixtures (deterministic, seeded) |

### Research apps (5)
- `apps/benchmark-lab`, `apps/consumer-contract`, `apps/differential-lab`, `apps/reference-lab`, `apps/sync-lab`, `apps/transport-runtime-lab` — research / contract test apps

### Web app (`apps/web/`)
- 6 HTTP API endpoints (see below)
- Single-page UI for triggering renders + critique
- AudioWorklet (1 voice only — lead. **Not 13 voices as previously claimed.**)

### VST stub (`apps/vst/`)
- 527 LOC C++ (PluginProcessor.cpp + .h)
- 3 voice classes (LeadVoice, BassVoice, PadVoice) — **real DSP, ported from TypeScript**
- ZDF SVF + BLSaw + DecayEnv — **real implementations**
- **Cannot build** — PluginEditor.cpp missing, CMakeLists references non-existent files
- Status: experimental stub, marked as such in `apps/vst/README.md`

---

## API Routes

| Endpoint | Method | Returns | Notes |
|----------|--------|---------|-------|
| `/api/render-forensic` | GET | WAV/AIFF/FLAC | `?bars=8&seed=42&format=wav` |
| `/api/audio-critique` | GET | JSON (38 metrics + score) | ~30s response (O(N²) DFT — Phase 1 fix) |
| `/api/optimize` | GET | JSON (auto-fixer report) | 2-5 min response (16 hardcoded plans) |
| `/api/style-transfer` | GET | WAV | Spectral matching EQ — NOT neural |
| `/api/arrangement` | GET | JSON (section plan) | Markov chain. **Bug: ignores `?bars=`** (Phase 1 fix) |
| `/api/upload-reference` | POST | JSON (latent hash) | Stored in-memory only, no consumer |

---

## Known Gaps (honestly tracked)

### Critical bugs (Phase 1 fixes)
- [ ] **TruePeakLimiter doesn't catch ISPs** — render exceeds 0 dBFS (+0.2 dBTP)
- [ ] **`/api/audio-critique` takes 30s** — O(N²) DFT, should be FFT (~3s target)
- [ ] **`/api/arrangement` ignores `?bars=`** — returns 30 bars when asked for 16
- [ ] **`StereoWidener.process` broken at width=1** — math error (Phase 1 Day 1)
- [ ] **`MoogLadder` mislabeled** — docstring says Huovilainen 2004, actually Stilson-Smith
- [ ] **`BLTriangle` wrong PolyBLEP residual** — adds aliasing instead of removing
- [ ] **`OversampledSaturation` not oversampling** — linear interp upsample (~3 dB reduction)
- [ ] **`SchroederReverb` fake stereo** — L post-allpass, R pre-allpass, shared state
- [ ] **Hard-coded `SR = 44100`** in 8 files — won't work at 48kHz/96kHz
- [ ] **`learning-kernel.ts:622` precedence bug** — normalizeWeights is a no-op
- [ ] **`learning-kernel.ts:172` wrong interval→degree** — minor third maps to degree 3 (should be 2)

### Incomplete features (Phase 2 fixes)
- [ ] Real-time AudioWorklet: 1 voice only (lead), not 13 aspired
- [ ] SoundDNA computed but not consumed by audio-renderer (loop not closed)
- [ ] Motif transformations written but not called by F20 composeLeadPlan
- [ ] No sidechain (only bass-only dynamic EQ duck)
- [ ] No OTT (genre signature missing)
- [ ] No 16th rolling bass mode (8th off-beats only)
- [ ] INTRO state silent (no texture voice)

### Honest about what we don't have (Phase 4-5 or never)
- [ ] VST plugin not buildable (PluginEditor.cpp missing)
- [ ] No trained neural models (ONNX module broken: missing `await`)
- [ ] Style transfer uses self-reference (render compared to itself, no real reference upload)
- [ ] AudioCritic score (0.66 on self-defined metric) is self-referential
- [ ] 0 producer blind tests done
- [ ] `targetLufs = -12` is neither club (-9) nor streaming (-14)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 5: PRESENTATION                                              │
│  apps/web (Next.js)  ·  apps/vst (JUCE C++ stub)  ·  CLI (Bun)     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 4: APPLICATION SERVICES                                       │
│  RenderService · CritiqueService · OptimizeService · ExportService │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 3: DOMAIN — PSY4 RENDER ENGINE                               │
│  forensic-bridge · psy-voices · channel-fx · master chain          │
│  · multiband · ms-processor · loudness · limiter · modulation-matrix│
│  · audio-critic · auto-fixer · arrangement · presets · automation │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 2: DOMAIN — COMPOSITION (in @psy-foundation/music)           │
│  composition-engine · motif-v2 · transformation · phrase-*        │
│  · harmonic-plan · bass-vocabulary · groove-plan · style-grammar  │
│  · sound-dna · enhanced-failure-detector · learning-kernel         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 1: FOUNDATION (10 packages, 646 tests)                       │
│  dsp · music · transport · protocol · analysis · learning         │
│  · material · scheduler · device-sdk · fixtures                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Dependency rule:** Layer N may only import from Layer N-1 and below.
- Foundation packages import nothing above.
- Layer 2 imports from Layer 1 only.
- Layer 3 imports from Layer 1 + 2.
- Layer 4 imports from any below.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for full details.

---

## Repository Structure

```
psy-foundation/
├── packages/                          # Foundation (10 lib packages + 646 tests)
│   ├── dsp/                            # @psy-foundation/dsp
│   ├── music/                          # @psy-foundation/music
│   ├── transport/                      # @psy-foundation/transport
│   ├── protocol/                       # @psy-foundation/protocol
│   ├── analysis/                       # @psy-foundation/analysis
│   ├── learning/                       # @psy-foundation/learning
│   ├── material/                       # @psy-foundation/material
│   ├── scheduler/                      # @psy-foundation/scheduler
│   ├── device-sdk/                     # @psy-foundation/device-sdk
│   └── fixtures/                       # @psy-foundation/fixtures
├── apps/
│   ├── web/                            # Next.js app (6 API routes)
│   │   ├── src/
│   │   │   ├── app/                    # Next.js App Router
│   │   │   ├── components/             # spectrum-analyzer + ui (toast only)
│   │   │   ├── hooks/
│   │   │   └── lib/psy4/              # PSY4 render engine (Layer 3)
│   │   ├── public/                    # samples (CC0 only, real/ deleted Phase 0)
│   │   └── package.json
│   ├── vst/                            # JUCE C++ stub (experimental)
│   ├── benchmark-lab/                 # Reference analysis lab
│   ├── consumer-contract/             # Contract tests
│   ├── differential-lab/             # A/B comparison
│   ├── reference-lab/                 # Audio → BPM/beat/key
│   ├── sync-lab/                      # Multi-device sync simulation
│   └── transport-runtime-lab/        # Runtime transport tests
├── benchmarks/                        # Performance benchmarks
├── integration/                       # Integration test fixtures
├── audit/                             # Contract gap audits
├── data/                              # Reference data (scales, rhythms, styles)
├── docs/                              # All docs (status, architecture, roadmap)
│   └── archive/                       # Old marketing/roast docs (kept for history)
├── worklog.md                        # Dev journal (280KB, 2340+ lines)
├── biome.json                         # Linter config (foundation's, from zip)
├── tsconfig.base.json                 # Shared TS config
└── package.json                       # Workspace root
```

---

## Tech Stack

- **Runtime:** Bun ≥1.3.0 (workspace root, tests, scripts)
- **Language:** TypeScript 5.6+
- **Web framework:** Next.js 16 (App Router, Turbopack)
- **Audio:** Web Audio API, AudioWorklet, ZDF SVF
- **Linter:** Biome 1.9.4 (replaces ESLint — foundation's choice)
- **UI:** Tailwind CSS 4 + minimal shadcn (toast only)
- **Tests:** `bun test` (built-in)
- **VST (experimental):** JUCE 7, CMake, C++17

---

## License

**MIT** for code.

**Samples:** `apps/web/public/samples/` contains 6 procedural CC0 WAVs (kick, clap, hat_closed, hat_open, bass_A, lead). The previous 141 commercial 909/MD/Nord samples were removed in Phase 0 Day 2 (license violation — see `worklog.md`).

---

## Status & Roadmap

**Current:** Phase 0 Day 2 complete (cleanup done). Phase 0 Day 3 in progress (docs rewrite).

**Roadmap:** [`docs/ROADMAP.md`](docs/ROADMAP.md) — Phases 0-5, 16-20 weeks total.

| Phase | Weeks | Goal |
|-------|-------|------|
| 0 | 1 | Foundation unpack + cleanup + docs |
| 1 | 2-4 | DSP bug fixes + tests |
| 2 | 5-8 | Composition engine loop closure |
| 3 | 9-14 | Audio quality vs reference tracks |
| 4 | 15-20 | VST build + AudioWorklet 13 voices |
| 5 | optional | RAVE training (requires GPU) |

**Quality gates:** [`docs/QUALITY_GATES.md`](docs/QUALITY_GATES.md) — what must be true before each phase is "done".

**Risks:** [`docs/RISK_REGISTER.md`](docs/RISK_REGISTER.md) — 14 documented risks with mitigations.

---

## What This Is Not

To be explicit (per the project's "no false claims" rule):

- **Not a commercial product** — no paying customers, no SLA, no support
- **Not a DAW** — no real-time playback with 13 voices (1 voice only)
- **Not a VST plugin you can install** — C++ stub can't build yet
- **Not AI/neural** — no trained models, no ONNX inference working
- **Not commercial-grade DSP** — multiple bugs documented (see Known Gaps above)
- **Not ready for production** — see [`docs/STATUS.md`](docs/STATUS.md)

If you fork this, expect to do real work before it's useful. Phase 1 is where the DSP bugs get fixed.
