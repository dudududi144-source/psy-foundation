# PSY Foundation — Procedural Psytrance Synthesis Engine

> **Status: Phases 0–3 complete, Phase 4 "Product" underway (PLAN_V3_MASTER).
> Foundation v2.0.0 — One DSP, honest metrics, PSYBUS v2, device conformance.
> Every claim below is reproduced by `node scripts/verify.mjs` (23 claims,
> 0 fail).** A TypeScript DSP engine that renders psytrance audio via HTTP API,
> with a 10-package musical foundation, a JUCE plugin prototype, and a
> real-time AudioWorklet. Independent forensic audit: `docs/AUDIT_FORENSIC_2026-09-04.md`.

[![tests](https://img.shields.io/badge/tests-942%20pass%2C%200%20fail-brightgreen)]()
[![verify](https://img.shields.io/badge/verify-23%2F23%20claims%20green-success)]()
[![version](https://img.shields.io/badge/foundation-v2.0.0-blue)]()
[![license](https://img.shields.io/badge/license-UNLICENSED-red)]()

---

## Quick Start

```bash
bun install          # ~0.2s warm / ~10s cold
bun test             # 942 pass, 0 fail, 0 skip
bun run dev          # apps/web on http://localhost:3000 (PORT env respected)
node scripts/verify.mjs   # executable truth: 23 endpoint/audio/infra claims, exit≠0 on any failure

# render audio (deterministic — same seed → bit-identical WAV)
curl "http://localhost:3000/api/render-forensic?bars=8&seed=42" -o out.wav

# render with style
curl "http://localhost:3000/api/render-forensic?bars=8&style=darkpsy" -o dark.wav

# render with specific progression
curl "http://localhost:3000/api/render-forensic?bars=8&progression=hypnotic" -o drone.wav

# operator/CI mode: PSY_API_KEY=... bun run dev, then:
curl -H "x-api-key: $PSY_API_KEY" "http://localhost:3000/api/render-forensic?bars=8&seed=42" -o out.wav
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

**Product hardening (Phase 4):**
- **Rate limiting** — per-IP token buckets per endpoint (render 4-burst,
  optimize 2, upload 3, style 4; refills per-second). Exhausted bucket →
  `429` + `Retry-After`. Bucket map is bounded (10k IPs, 10min idle TTL).
- **API-key mode** — set `PSY_API_KEY` and present `x-api-key` to bypass
  buckets (operator/CI). In key mode, keyless requests get `429` (never `401`
  — no free recon about which knob to turn).
- **Render cache + coalescing** — identical full-mix requests within the LRU
  window (8 entries / 64 MiB) are served from cache; concurrent identical
  requests share ONE render. `X-Render-Cache: hit|miss` reports honestly;
  `?nocache=1` forces a real re-render.
- **Off-loop rendering** — renders run inside a pool of forked worker
  processes (`X-Render-Worker: worker`), byte-identical to the in-thread path
  (parity-locked by test). Bounded queue → honest `503` under overload;
  worker crash → one reboot, then honest in-thread fallback.

---

## What's Here

### Foundation packages (10)
dsp, music, transport, protocol, analysis, learning, material, scheduler, device-sdk, fixtures

### Web app (`apps/web/`)
- 942 tests pass, 0 fail, 0 skip
- 6 HTTP API endpoints (all verified) + rate limiting + render cache + worker pool
- Real-time AudioWorklet (13 voices) — generated from the CANONICAL
  `@psy-foundation/dsp` classes by `bun run build:worklet` (One-DSP: the
  offline render and the worklet share one implementation; parity fixtures
  lock the generated artifact)
- PresetManager (11 factory + user presets), SpectrumAnalyzer (60fps)
- Multi-export WAV/AIFF (FLAC honestly rejected with 501)
- Stems export (drum/bass/music)

### VST plugin — ARCHIVED (Phase 5, decision B)
The JUCE prototype was moved to `archive/vst-prototype/` with an honest
post-mortem: no MIDI note-off, 8/11 parameters unwired, UI-thread data race,
and a third hand-maintained DSP copy. Fixing it = rewriting the wrapper; the
web app already ships the engine. See `archive/vst-prototype/README.md`.

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
| **Z.ai Phase 1** | **One DSP: master chain in @psy-foundation/dsp, worklet built from it, limiter rewrite, MoogLadder stability, worklet SR fix** | `75dad8a` |
| **Z.ai Phase 2** | **Honest metrics: critics de-gamed, hidden constants deleted, behavior locks** | `9a00067` |
| **Z.ai Phase 3** | **Foundation for the family: v2.0.0, release ESM bundle, PSYBUS v2, device conformance, transport GAP closure** | `a579001`, tag `foundation-v2.0.0` |
| **Z.ai Phase 4** | **Product: worker pool + render cache + coalescing, rate limiting + API-key mode, realtime tool-grade UI, session persistence** | `bc7abc2`, `c830c14` |
| **Z.ai Phase 5** | **VST honestly archived to `archive/vst-prototype/` (decision B) — PLAN_V3 all phases complete** | this commit |

## Tech Stack

- **Runtime:** Bun ≥1.3.0
- **Language:** TypeScript 5.6+
- **Web:** Next.js 16 (App Router)
- **Audio:** Web Audio API, AudioWorklet, ZDF SVF
- **VST:** archived prototype (`archive/vst-prototype/`) — honest post-mortem inside
- **Tests:** `bun test` (942) + `scripts/verify.mjs` (23 live claims)
- **Linter:** Biome 1.9.4
- **License:** UNLICENSED (private; family adoption under separate agreement — see `docs/FAMILY_ADOPTION_OFFER.md`)
