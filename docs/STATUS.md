# PSY Foundation — Status

> Last updated: **2026-09-05** (Task 15 — every number below re-verified this
> session by the Five Gates + a live canonical render; see `worklog.md` for
> the per-task evidence trail).

---

## Current State (one paragraph)

PLAN_V3_MASTER phases 0–5 are complete, plus the 4.2 streaming follow-up and
Tasks 12–15 (strict mode, dead-export audit, stereo-truth correction,
self-review + family support). The foundation is v2.0.0: one DSP build shared
by offline render and the generated AudioWorklet, 6 verified HTTP endpoints,
PSYBUS v2, device conformance, a release ESM bundle, and a standalone
consumer acceptance gate. Independent forensic audit score: **3.5 → 7.5**
with every internal finding closed on fresh evidence
(`docs/AUDIT_FOLLOWUP_2026-09-05.md`).

## The Five Gates (run this session, 2026-09-05 — Task 17)

| Gate | Result |
|---|---|
| `bun test` | **964 pass, 0 fail, 0 skip** (64 files, ~1.31M expect() calls) |
| `bunx tsc --noEmit` | **0 errors** (17 packages, `noUncheckedIndexedAccess: true` repo-wide) |
| `bunx biome check .` | **0 problems** (~261 files; `archive/**` ignored by policy) |
| `node scripts/verify.mjs` | **34/34 claims** (~143 s, real HTTP + real ffmpeg) |
| `node scripts/audit-exports.mjs` | **0 dead exports in packages** |

## Canonical render (reproduced live this session)

`GET /api/render-forensic?bars=8&seed=42` → 13.244 s, pcm_s16le / 44100 Hz /
stereo, **md5 `f2f81ed62a25743358417bed75ab67f7`** (locked baseline, byte-
identical across Tasks 12–15 refactors) — measured with ffmpeg ebur128:
I = **−10.7 LUFS**, TP = **−1.2 dBTP**, LRA = **3.9 LU**; sample peak
−1.5 dBFS. Streaming path: 88-bar `?bars=88&seed=7` md5 `88ecc4b826cd…`,
header-first TTFB ≪ 500 ms (verify-locked).

## What ships

- **10 packages** — dsp, music, transport, protocol, analysis, learning,
  material, scheduler, device-sdk, fixtures
- **apps/web** — 7 verified endpoints (render-forensic, **render-notes**,
  audio-critique, optimize, style-transfer, arrangement, upload-reference),
  rate limiting, render cache + coalescing, worker-pool off-loop rendering,
  streaming WAV, AudioWorklet generated from the canonical DSP (One-DSP)
- **The WHAT→HOW wire (Task 17)** — `POST /api/render-notes`: external
  PSYBUS v2 note streams render FAITHFULLY through voices → ChannelFX →
  bus glue → master chain (no internal composition, no re-humanization,
  no arrangement contour); FIR true-peak safety pass; deterministic.
  First consumer: psy-anthem (its full pipeline proof lives in its repo)
- **Release channel** — `release/psy-foundation.esm.js` (v2.0.0,
  single-file ESM), tag `foundation-v2.0.0`
- **Family support** — `docs/CONSUMER_SUPPORT_PSY5.md` +
  `scripts/acceptance-check.mjs` (standalone WAV gate, node+ffmpeg only,
  gates identical to verify.mjs; positive+negative tested)
- **Governance** — charter + Five Gates (`docs/ENGINEER_CHARTER.md`),
  device conformance, PSYBUS v2 (`packages/protocol/src/v2/`),
  `FAMILY_ADOPTION_OFFER.md`

## Remaining gaps (the honest list)

1. **Family adoption (external, by mandate).** 0/16 family repos consume
   foundation at runtime; the support ladder + rescue guide now exist, but
   the move is the owner's (per-repo approval required by the charter).
2. **npm publishing** — blocked on a license decision (UNLICENSED today).
3. Producer blind listening tests — never run; all quality evidence so far
   is instrumental (ffmpeg, AudioCritic, md5 baselines).

Everything else on the old scorecards (limiter, critic FFT, arrangement
bars, sidechain, OTT, rolling bass, dead exports, strictness, dead flags)
is closed — see `AUDIT_FOLLOWUP_2026-09-05.md` for the per-finding proof.

## Pointers

- Reproduce everything: `node scripts/verify.mjs` · `bun test` ·
  `node scripts/audit-exports.mjs --include-apps` ·
  `node scripts/acceptance-check.mjs <file.wav>`
- Journey + per-task hashes: `README.md` (Project Journey table)
- Full audit trail: `worklog.md`
