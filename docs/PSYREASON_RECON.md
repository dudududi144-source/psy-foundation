# PSYREASON RECON — the READ phase of the fourth adoption, done without writing

**Snapshot:** psyreason `e438ce9`, 2026-09-06. **This repo was READ-ONLY for
this recon**: another agent is actively working there (owner's words: use it,
don't write to it — concurrent writes would break each other). Every number
below is a dated snapshot and WILL stale as that agent pushes; re-measure at
adoption time. Nothing was written to psyreason: no branches, no issues, no
pushes. The local clone exists at `family/psyreason` (token scrubbed).

## 1. What psyreason is

A Reason-style rack in the browser (`0.2.0`, MIT): virtual devices
(Subtractor, NN-XT, Redrum, Thor, Mixer 14:2, Combinator, RPG-8, Matrix, 7
FX), SVG patch cables (audio + CV), a React/Vite UI (~52 MB with deps), and a
composition brain with 9 styles (PSYTRANCE, GOA, TECHNO, TRANCE, …). Sizes:
`foundation/` 1.2 MB, `devices/` 804 KB, `host/` 716 KB, `ui/` 52 MB.

## 2. Family DNA is ALREADY inside (the adoption's best news)

- `host/composition/engine.ts` exports **`createAnthemEngine(config:
  AnthemConfig): AnthemEngine`** — psy-anthem's composition engine is
  vendored here.
- `host/composition/rng.ts` opens with `// PSY ANTHEM — rng.ts` and is the
  seeded mulberry32 — the deterministic-RNG doctrine came along.
- psyreason's own `foundation/` directory (device-sdk, scheduler,
  `protocol/events.ts`, `music/sound-dna.ts`) references the family by name.
- `host/event-bus/` is a **PSYBUS tier-0 in-process device bus** (pub/sub with
  `src`/`dst` routing + `dsp:<id>:<seed>` provenance fingerprints) — a
  DIFFERENT dialect from foundation's PSYBUS v2 wire (note envelopes for HTTP
  render). Adoption does NOT replace tier-0; it MAPS composition output → v2
  envelopes, exactly like anthem/psysampler/psy5 did.
- `host/audio-engine/offline-render.ts`: deterministic offline WAV renderer —
  "given the same (pattern, seed, bpm, bars, sampleRate), renderOffline
  produces byte-identical WAV output across runs. Verified by tests." CAVEAT
  (their own honest doc): browser-only, OfflineAudioContext is a Web API — a
  server-side render path does NOT exist yet; the HTTP proof path will ride
  foundation's `/api/render-notes`, same as every prior adoption.

## 3. Gate snapshot (dated, HEAD `e438ce9`) — the honest numbers

| gate | result | detail |
|---|---|---|
| root `bun install` | **BROKEN** | `workspaces: [foundation, devices, host, ui]` but only `ui/` has a package.json → `Workspace not found "host"`; root scripts (`lint`, `typecheck`, `dev`, `build`) therefore fail after a fresh clone |
| `bun test tests/` | **71 pass / 7 fail** (exit 1) | failures: Mixer14 ×4 (`processes input to output`, `solo mutes other channels`, `volume control affects level`, `pan affects stereo balance`), `DigitalDelay > feedback creates repeats`, `ThorSynth > envelope releases after gate off`, `EuropaSynth > unison creates thicker sound` — all DSP-behavioral, consistent with the other agent's in-flight "Research phase" DSP/mastering work; NOT a verdict on the repo |
| `tsc --noEmit` (ui) | **exit 2, 16 errors** | 13 in `src/audio/engine.ts`, 1 each in `rack.ts`, `generator.ts`, `App.tsx` |
| `biome check .` | **exit 1** | 2 format-only findings (`biome.json`, `package.json` would be reformatted) — no code-lint violations surfaced |
| GitHub CI | **green** | **the CI runs ONLY `npm install` + `npm run build` inside `ui/` — no tests, no lint, no typecheck**. Green theater over a red repo: the 7 failing tests, 16 tsc errors, and broken root install are all invisible to it |

That last row is the family's oldest lesson, inverted: psysampler was
red-on-green (honest suite, lying threshold); psyreason is green-over-red
(lying CI, honest-ish suite). Same cure in both directions: the CI must run
what the repo claims.

## 4. Adoption plan (ready to execute the moment the owner authorizes writing)

1. **CLAIM** — open the worklog in psyreason; coordinate with the owner that
   the other agent's work landed (rebase/fetch fresh HEAD; NEVER adopt on a
   stale snapshot).
2. **BASE (honest gates first, before any wire work)** — fix the root
   workspace/install story (either add the missing package.jsons or descope
   `workspaces` to `ui` only); triage the 7 failing tests WITH the other
   agent's landed state (fix or xdocument-skip with reasons — no silent
   skips); tsc to 0; biome to 0; then REPLACE build-only CI with the family
   ladder: install → lint → tsc → bun test → coverage floor (the
   `scripts/coverage-floor.mjs` pattern, copy from psysampler/anthem) →
   family-sync-check `--only psyreason`.
3. **DO (the wire)** — vendor foundation's `packages/protocol/src/v2/{types,
   envelope}.ts` VERBATIM (one-codec law, md5-verified by family-sync-check);
   write `wire.ts`: composition/brain output → v2 note envelopes
   (seed carried, rev monotonic, ts in seconds), validated by the vendored
   codec; reuse the tier-0 bus only inside the rack.
4. **GATE/PROVE** — e2e pipeline like anthem's 53-claim run: compose → wire →
   POST foundation `/api/render-notes` → acceptance gates → HTTP determinism
   (identical md5 on double POST); document loudness/density findings against
   `docs/CONSUMER_SUPPORT.md` §5b.
5. **LOG/TAG** — worklog + FAMILY_MATRIX §6 + README journey row; tag.

## 5. Risks / open questions for the owner

- The other agent's WIP is reshaping DSP and mastering RIGHT NOW (Research
  phase 1–3 commits). Adoption must start AFTER their phase lands, on their
  final HEAD, or the gate triage will chase a moving target.
- The browser-only offline renderer means psyreason's OWN sound cannot be
  WAV-proved server-side without new work; the family proof standard (WAV
  through acceptance gates) will ride foundation's renderer first — psyreason
  rendering its own audio remains a browser/UI concern until someone builds a
  non-WebAudio offline path.
- `Math.random` appears in several `foundation/core/*.mjs` files
  (transport, dsp, render, director, midi) — a determinism audit is part of
  BASE so the wire's seed story stays honest end-to-end.
