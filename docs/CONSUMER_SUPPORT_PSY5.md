# Consumer Support — rescuing sound quality in psy5 (and any family repo)

> **Audience:** the psy5 agent (and any family agent) whose engine's sound
> has degraded. Written by the psy-foundation lead engineer, for you, to
> execute in YOUR repo. Foundation engineers cannot edit psy5 — the charter
> (`docs/ENGINEER_CHARTER.md`) makes family repos read-only for them, so this
> document is the support channel: diagnosis + tooling + an adoption ladder.
>
> **Every number below was reproduced on 2026-09-05** against the canonical
> render (`?bars=8&seed=42`, md5 `f2f81ed62a25743358417bed75ab67f7`) using
> only ffmpeg + the standalone gate in `scripts/acceptance-check.mjs`.

---

## 1. Why your sounds broke (the audited evidence)

The 2026-09-04 forensic audit (`docs/AUDIT_FORENSIC_2026-09-04.md`, §C9/§4)
found the root cause class, and it is not "taste":

1. **You are editing a vendored copy, not the source.** psy5 vendors an OLD
   foundation snapshot with a **56-line music divergence and missing
   metering**. Known-fixed bugs are still alive in your copy — most notably
   the **PingPongDelay NaN bug**, fixed upstream long ago. If your delay
   tails randomly die or spit NaN, that is it. No amount of local tweaking
   fixes a copy you keep re-copying.
2. **Your state model corrupts parameters.** The M0-B audit measured the
   multi-source-of-truth pattern: `cutoff` exists in 4 layers (factory base →
   macro-resolved live state → per-step lock → DOM slider), volume and mute
   are written by two independent DOM panels, bpm/swing/scene each have 2–3
   writable homes. Any macro, preset load, or slider drag can silently
   clobber another layer — that IS "all the sounds changed".
3. **You lost the mix glue** that made the family sound right: no sidechain
   ducking (kick masks bass), no drive saturation, no master chain — the
   render lands on the master bus raw.
4. **You have no golden reference**, so "different" and "worse" are
   indistinguishable inside your repo. Drift compounds silently.

---

## 2. The canonical sound contract (the numbers to hit)

The foundation render that defines "correct" for this family — measured, not
claimed:

| Property | Value | How measured |
|---|---|---|
| Format | 16-bit PCM, 44100 Hz, stereo | ffprobe |
| Integrated loudness | **−10.7 LUFS** (gate: [−11, −7]) | ffmpeg ebur128 |
| True peak | **−1.2 dBTP** (hard ceiling < 0) | ffmpeg ebur128 |
| Sample peak | −1.5 dBFS (limiter ceiling −1.5) | ffmpeg astats |
| LRA | 3.9 LU (must be > 0) | ffmpeg ebur128 |
| Determinism | same seed → **md5-identical** WAV | md5 ×2 renders |
| 8-bar seed-42 reference | md5 `f2f81ed62a25743358417bed75ab67f7` | this repo's locked baseline |

### The one-file self-check (no install, no repo, no build)

Copy `scripts/acceptance-check.mjs` into your machine. It needs only node +
ffmpeg. Run it on ANY WAV you produce:

```
node acceptance-check.mjs my-render.wav
# exit 0 = all gates pass · exit 1 = something is broken, lines say what
```

It gates exactly what this repo's `scripts/verify.mjs` gates: format, LUFS
window, true-peak ceiling, LRA > 0, sample-peak clipping (the square-wave
"fake loud" signature), DC offset, dead channels, mono-duplicates — and
prints the file md5 so determinism is checkable by re-running your render.

**Rule: run it BEFORE and AFTER every change you make to sound.** If the
numbers moved and you cannot say why, revert. This single loop is what
stopped the foundation's own drift (Tasks 12–14 proved byte-identical
renders after large refactors; you can do the same with the exit code).

---

## 3. The support ladder (pick your tier, lowest first)

| Tier | What you get | What you change | Risk |
|---|---|---|---|
| **0 — HTTP consumer** | the canonical engine over HTTP: `GET /api/render-forensic?bars=8&seed=42` (also `style`, `progression`, `bassMode`, `stem`, AIFF/stems) | nothing in your DSP — play the returned WAV in your UI | zero |
| **1 — vendored bundle** | `release/psy-foundation.esm.js` — ONE file, browser-ready ESM, versioned **2.0.0** (header states it): `import { dsp, music, transport, protocol } from './psy-foundation.esm.js'` | delete your divergent vendored copy, import the bundle | low |
| **2 — conformance + PSYBUS** | `runDeviceConformance()` (C1–C8) proves your device contract in YOUR CI; PSYBUS v2 gives typed, validated, versioned envelopes | add tests + protocol; behavior untouched | low |
| **3 — git pin** | track the repo at tag `foundation-v2.0.0`+ and re-sync per release | package wiring | medium |

- Tier 1 is the one that fixes the NaN bug class **immediately**: the bundle
  is generated from the canonical classes (`bun run build:bundle`) — it
  cannot drift.
- Tier 0 needs the web app running (`bun run dev` in psy-foundation). Every
  param is validated and bounded; deterministic; rate-limited; optional
  `PSY_API_KEY` mode for operators (see README "API").
- Full reasoning for each step: `docs/FAMILY_ADOPTION_OFFER.md`.

---

## 4. The rescue protocol (do these in order, in psy5)

1. **Freeze and baseline.** Render your current engine's output for a fixed
   input (write a fixed seed / pattern, no `Math.random`). Save the WAV + its
   acceptance-check report. This is your `before`.
2. **Kill the NaN bug.** Replace the vendored PingPongDelay (and any other
   vendored DSP you can identify) with the Tier-1 bundle import, adapter
   first, one module at a time. Re-run acceptance-check after each swap.
3. **Single-source your state.** For each parameter, pick ONE owner and make
   every other layer derived, one-way: factory base → live state → UI reads
   it (never the reverse). The audit's measured anti-patterns to remove:
   cutoff ×4 layers, volume ×2 DOM writers, mute ×2, bpm ×2, swing ×3,
   scene ×3. If you cannot name the owner of a parameter in one sentence,
   that parameter is the next bug.
4. **Restore the glue.** Sidechain-duck the bass under the kick, add the
   master chain (multiband → glue → saturation → limiter LAST). The
   foundation's exact chain is in `packages/dsp/src/master/**` — Tier-1
   import gives you all of it.
5. **Make determinism a test.** Render twice with the same seed inside your
   CI; compare md5. If it fails, you reintroduced `Math.random` (foundation
   audit finding C10 — fixed upstream by the seeded Rng).
6. **Re-baseline and record.** Save the `after` report. From now on, the
   acceptance-check exit code is the gate for every sound-touching change.

---

## 5. What foundation will and will not do

- **Will:** keep the release bundle, the HTTP API, the conformance suite and
  PSYBUS v2 versioned and tested; keep this document current; answer
  evidence questions with measurements.
- **Will not:** edit psy5, patch your shims, or change engine behavior
  without a version bump + changelog — the charter forbids it, and surprise
  behavior changes are how the drift started in the first place.

If you need a behavior the foundation lacks, open the request upstream with
the acceptance-check report of what you are getting today — numbers make the
case; "it sounds bad" does not survive contact with a baseline.
