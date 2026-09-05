# Family Agent Support Kit — onboarding for any PSY-family repo/agent

> **Audience:** any agent or developer from the PSY family (psy-anthem,
> psyboss, psysynth, psydrum, psy5, …) sent to consume or integrate
> psy-foundation. Read this first; `docs/CONSUMER_SUPPORT_PSY5.md` is the
> worked example (a full diagnosis + rescue of one family repo).
>
> **Charter note (docs/ENGINEER_CHARTER.md):** foundation engineers never
> write in your repo. Support ships here — as docs, tools, and versioned
> artifacts. You execute in your repo; numbers travel between us.

---

## 0. What psy-foundation is (30 seconds)

A TypeScript DSP/music monorepo (10 packages, v2.0.0) that renders
psytrance deterministically: same seed → byte-identical WAV. One DSP build
is shared by the offline renderer, the HTTP API, and a generated
AudioWorklet. It also owns the family contracts: PSYBUS v2 envelopes, the
device conformance suite, and the release bundle.

## 1. The universal sound contract (the numbers "good" means here)

Reproduced live 2026-09-05 against `?bars=8&seed=42`
(md5 `f2f81ed62a25743358417bed75ab67f7`):

| Property | Value |
|---|---|
| Format | 16-bit PCM, 44100 Hz, stereo |
| Integrated loudness | −10.7 LUFS (club-master gate [−11, −7]) |
| True peak | −1.2 dBTP (hard ceiling < 0; canonical limiter ceiling −1.5) |
| Sample peak | −1.5 dBFS |
| LRA | 3.9 LU (never 0 — 0 means a static output) |
| Determinism | same seed → md5-identical (re-render and compare) |

### The gate tool (one file, no install)

`scripts/acceptance-check.mjs` — copy it anywhere, run `node
acceptance-check.mjs your.wav`. Exit 0 = all gates pass. It needs only node
+ ffmpeg. Run it before and after every sound-touching change you make; if
the numbers moved and you cannot say why, revert. The md5 it prints is your
determinism check.

## 2. Integration ladder (start at the lowest tier that solves your need)

| Tier | You get | Cost |
|---|---|---|
| **0a. HTTP consumer (foundation composes)** | canonical renders over `GET /api/render-forensic` (params: bars 1–88, seed, style, progression, bassMode, stem, AIFF/stems; FLAC = honest 501). Deterministic, bounded, rate-limited. | run `bun run dev` in this repo; touch no DSP |
| **0b. HTTP consumer (YOU compose — the WHAT→HOW wire)** | `POST /api/render-notes` with PSYBUS v2 note envelopes → your notes rendered FAITHFULLY through foundation's voices → ChannelFX → bus glue → master chain. No internal composition, no re-humanization; your timing/velocity render as sent. Deterministic; `?mode=json` returns metrics + md5. Envelope validation by foundation's own codec; unknown tracks → 400 with the supported list. | map your composition voices onto the 16 foundation track names; post JSON |
| **1. Release bundle** | `release/psy-foundation.esm.js` — single file, browser ESM, version in the header: `import { dsp, music, transport, protocol } from './psy-foundation.esm.js'` | delete your vendored/parallel copy |
| **2. Conformance + PSYBUS v2** | `runDeviceConformance()` (C1–C8) proves your device contract in your own CI; typed/validated/versioned bus envelopes | add tests + protocol layer |
| **3. Git pin** | track this repo (tag `foundation-v2.0.0` and later tags), re-sync per release | package wiring |

**Why Tier 1 matters:** the 2026-09-04 audit found the family's copies
diverge — fixes skew both directions (a PingPongDelay NaN bug, long fixed
upstream, was still alive in one repo's vendored copy; another repo vendored
a tree whose type-only imports don't even resolve). Editing a copy means
inheriting stale bugs; importing the bundle means inheriting fixes.

## 3. First-session checklist (for an incoming agent)

1. **Baseline before changing anything.** Render a fixed input from your
   engine (fixed seed, no `Math.random`), save the WAV + acceptance-check
   report. That report is your `before`.
2. **Name your parameter owners.** For each engine parameter, one sentence:
   "X is owned by Y, everyone else derives from it." If you cannot, that is
   your next bug (the audited anti-pattern: the same cutoff existing in 4
   layers, volume written by 2 DOM panels).
3. **Kill every parallel DSP copy.** Vendor the Tier-1 bundle behind a thin
   adapter instead. One swap per commit, acceptance-check after each.
4. **Restore the glue if you lost it:** sidechain duck (bass under kick) →
   master chain (multiband → glue → saturation → limiter LAST).
5. **Determinism test in your CI:** render twice, same seed, compare md5.
6. **Re-baseline and keep both reports.** Evidence is the support channel:
   when you need a change upstream, bring the before/after numbers, not
   adjectives.

## 4. Diagnosis template (fill this when you ask for help)

```
Repo:            <name>
What consumes foundation today:  <nothing | vendored copy at commit X | shim>
Sound baseline (acceptance-check of my current render):
  <paste tool output>
Determinism:     <md5 of two re-renders — equal or not>
State owners:    <list of parameters WITHOUT a single owner>
First 3 sounds broken:  <what, since when, what changed before it broke>
```

## 5. FAQ

- **"Can I just copy the DSP files again?"** No. That is how the family got
  7 independent PolyBLEPs and 3 incompatible LUFS meters. Import the bundle.
- **"Which version am I allowed to depend on?"** Anything with a version in
  the artifact header (`PSY-FOUNDATION-VERSION`). Pin it. Behavior changes
  ship with a version bump + changelog, never silently.
- **"The engine lacks a behavior I need."** Open the request upstream with
  your acceptance-check report. Foundation adds behavior versioned and
  measured; it does not fork into your repo.
- **"Why does the API reject `?bars=9999999`?"** Every param is bounded and
  validated on purpose (`400` with details) — unbounded renders were a DoS.
- **"Who owns what?"** DSP/master chain: `packages/dsp`. Voices + render:
  `packages/music`. Clock: `packages/transport`. Wire: `packages/protocol`.
  Device contract: `packages/device-sdk`. See `docs/ARCHITECTURE.md`.
- **"How do I get MY notes rendered by foundation?"** Tier 0b:
  `POST /api/render-notes` (see the ladder). Time comes from each envelope's
  `ts` (seconds) × bpm; `track` must be one of the 16 foundation voices;
  sparse note streams master to a lower LUFS than full mixes (quiet is a
  property of your arrangement, not a bug) — true peak safety is enforced
  by an FIR meter either way. Worked examples (all proven end-to-end with
  the same claim pattern): psy-anthem's repo (Task 17-b, 53/53 claims,
  `scripts/e2e-pipeline.ts`), psysampler's repo (Task 18, 23/23 claims,
  `scripts/e2e-pipeline.mjs` — plus a measured density/melody loudness-lever
  experiment: hat density bought +0.5 LU for +15.5 KB of wire, a sustained
  lead line bought +1.8 LU for −7 KB; melody is the loudness lever), and
  PSY6's repo (Task 19, 8/8 claims, `tools/e2e-pipeline.mjs` — the
  groovebox's own deterministic walker drives the wire; its measured line
  completes the economics table: song FORM bought structure, not loudness,
  −0.30 LU for +31.8 KB — density, not form, is the loudness lever).

## 6. The honest boundary

Foundation will not edit your repo (charter), will not ship surprise
behavior changes, and will not accept "it sounds bad" without numbers —
because "good" here is a table of measurements, and yours can be too.
