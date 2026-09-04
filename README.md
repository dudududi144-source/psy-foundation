# PSY Foundation — Procedural Psytrance Synthesis Engine

> **Status: Phase 0 "Truth" complete (PLAN_V3_MASTER) — every claim below is
> reproduced by `node scripts/verify.mjs` (19 claims, 0 fail, ~48s).**
> A TypeScript DSP engine that renders psytrance audio via HTTP API,
> with a 10-package musical foundation, a JUCE plugin prototype, and a
> real-time AudioWorklet. Independent forensic audit: `docs/AUDIT_FORENSIC_2026-09-04.md`.

[![tests](https://img.shields.io/badge/tests-809%20pass%2C%200%20fail-brightgreen)]()
[![verify](https://img.shields.io/badge/verify-19%2F19%20claims%20green-success)]()
[![packages](https://img.shields.io/badge/packages-10%20foundation%20%2B%20web%20app-blue)]()
[![license](https://img.shields.io/badge/license-MIT-blue)]()

---

## Quick Start

```bash
bun install          # ~0.2s warm / ~10s cold
bun test             # 809 pass, 5 skip (documented GAPs), 0 fail
bun run dev          # apps/web on http://localhost:3000 (PORT env respected)
node scripts/verify.mjs   # executable truth: 19 endpoint/audio claims, exit≠0 on any failure

# render audio (deterministic — same seed → bit-identical WAV)
curl "http://localhost:3000/api/render-forensic?bars=8&seed=42" -o out.wav

# render with style
curl "http://localhost:3000/api/render-forensic?bars=8&style=darkpsy" -o dark.wav

# render with specific progression
curl "http://localhost:3000/api/render-forensic?bars=8&progression=hypnotic" -o drone.wav
```

---

## Measured Output (reproduce with `node scripts/verify.mjs`)

`GET /api/render-forensic?bars=8&seed=42` (measured 2026-09-04, ffmpeg 7.1.5,
**after the Phase 1.2 limiter rewrite**):

| Metric | Our meter | ffmpeg ebur128 | Source |
|--------|-----------|----------------|--------|
| Duration | 13.24s | 13.244s | ffprobe |
| Integrated LUFS | **-10.9** | -10.7 | ffmpeg ebur128 |
| True Peak | -1.5 (4x Catmull-Rom) | -1.5 (ITU FIR) | ffmpeg ebur128 |
| LRA | 3.9 LU | 3.9 LU | ffmpeg ebur128 |
| Sample rate / channels | 44100 Hz / 2 | 44100 Hz / 2 | ffprobe |

**Loudness honesty note (Phase 1.2):** the pre-audit README claimed -9 LUFS.
That figure was partly square-clip distortion: the broken limiter (audit C3)
squashed transients at ceiling×0.65. With a correct lookahead limiter and a
-1.5 dBTP ceiling, the honest integrated loudness is **-10.7 LUFS (ffmpeg)** —
inside the club-master gate [-11, -7] with TRUE peak safety. Reaching -9 LUFS
at -1.5 dBTP without clipping requires a more sophisticated release curve
(Plan backlog); we chose clean > fake-loud.

Determinism: two renders of the same params are **md5-identical** (verified
across server restarts). Different seeds/styles produce different audio.

---

## API (all 6 endpoints verified by verify.mjs)

| Endpoint | Params | Returns | Notes |
|----------|--------|---------|-------|
| `/api/render-forensic` | bars [1-88], seed [0-2^31), format, style, progression, bassMode, stem, preset | WAV/AIFF/stems | FLAC = honest 501 |
| `/api/audio-critique` | bars, seed | JSON (38 metrics + score) | ~17s |
| `/api/optimize` | bars, seed, iterations [1-32], target [0-1] | JSON (auto-fixer report) | ~8s per 2 iterations |
| `/api/style-transfer` | bars, seed, reference (hash), blend [0-1] | WAV + `X-Style-Transfer` header | upload a reference first |
| `/api/arrangement` | seed, bars (≤200), variations (≤24), mode | JSON (Σsection bars === targetBars **exactly**) | |
| `/api/upload-reference` | POST WAV (8/16/24/32-bit PCM or 32f) | JSON (latent + hash) | store bounded at 32 refs |

**Bounded by design:** every query param is validated (`400` with details on
violation) — `?bars=9999999` can no longer allocate 10M bars of events.
Failures are honest (`500` with the real error) — no silent sample-fallback
re-renders.

---

## What's Here

### Foundation packages (10)
dsp, music, transport, protocol, analysis, learning, material, scheduler, device-sdk, fixtures

### Web app (`apps/web/`)
- 809 tests pass, 0 fail (5 honest `GAP:` skips in consumer-contract)
- 6 HTTP API endpoints (all verified)
- Real-time AudioWorklet (13 voices) — **honesty note:** the worklet is a
  lighter engine than the offline renderer (4 synth types, simplified master
  chain); full parity is Phase 1-4 of `docs/PLAN_V3_MASTER.md`, not shipped yet
- PresetManager (11 factory + user presets), SpectrumAnalyzer (60fps)
- Multi-export WAV/AIFF (FLAC honestly rejected with 501)
- Stems export (drum/bass/music)

### VST plugin (`apps/vst/`) — prototype
Compiles-plausible JUCE 7 project. **Honesty note (audit finding):** no MIDI
note-off in processBlock, 8/11 parameters unwired, UI-thread data race.
Prototype only — do not ship. Fix-or-archive decision pending (Plan Phase 5).

### DSP features (offline renderer — the verified core)
- ZDF SVF (Simper/Zavalishin topology), BLSaw/BLSquare with PolyBLEP
- ITU-R BS.1770-4 LUFS measurement (K-weighting, gated) — ffmpeg-verified
- TruePeakLimiter (4x oversampled, real 5ms lookahead, ceiling-true brickwall — rewritten in Phase 1.2)
- 2-pass LUFS convergence (measure → gain → re-limit)
- MultibandCompressor (3-band LR4 crossover), OTT expander
- Full-mix sidechain, M/S StereoWidener, SchroederReverb
- 8 progressions, 5 style presets, 16th rolling bass — all wired via API

---

## Engineering governance

- **Plan:** `docs/PLAN_V3_MASTER.md` — 6 phases, per-task acceptance gates
- **Audit:** `docs/AUDIT_FORENSIC_2026-09-04.md` — independent measured audit (3.5/10 → target ≥7)
- **Charter:** `docs/ENGINEER_CHARTER.md` — continuous control protocol, Five Gates
- **Rule:** no README claim without a verify.mjs check behind it.

## Project Journey

| Phase | What was done | Tag |
|-------|---------------|-----|
| 0-4 | Initial rebuild (foundation, DSP fixes, sidechain, OTT, VST, worklet) | v0.8.0 |
| A-G | Fix lies → unify → compose → quality → VST → commercial → E2E | v1.0.0 |
| Roast 1-11 | 11 self-audit fix rounds (lint 0, tests 809, honest FLAC/rejections) | v1.2.0 |
| **Z.ai Phase 0** | **Truth: 2 dead endpoints fixed, DoS guards, exact-bars contract, tsc 0, verify.mjs, README regen** | `6f231ca` |
| **Z.ai Phase 1 core** | **Limiter rewrite (real lookahead + ceiling-true brickwall), MoogLadder stability clamp, worklet sample-rate fix, packages determinism (seeded hats/click), 2-pass LUFS convergence** | this commit |

## Tech Stack

- **Runtime:** Bun ≥1.3.0
- **Language:** TypeScript 5.6+
- **Web:** Next.js 16 (App Router)
- **Audio:** Web Audio API, AudioWorklet, ZDF SVF
- **VST:** JUCE 7, CMake, C++17 (prototype)
- **Tests:** `bun test` (809) + `scripts/verify.mjs` (19 live claims)
- **Linter:** Biome 1.9.4
- **License:** MIT
