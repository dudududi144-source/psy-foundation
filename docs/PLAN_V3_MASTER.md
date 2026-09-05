# PSY Foundation — Master Action Plan v3 (Z.ai)

> **Date:** 2026-09-04 · **Owner:** Z.ai (appointed Lead Foundation Engineer)
> **Input:** `docs/AUDIT_FORENSIC_2026-09-04.md` (independent forensic audit, 3.5/10)
> **Mandate:** take psy-foundation to the edge of its capability. Write access to **this repo only**; family repos are read-only until their owners opt in.
> **Doctrine:** *no claim without measurement · one DSP to rule them all · the foundation must have consumers · product beats marketing.*

---

## Guiding decisions (accepted, unless the owner vetoes)

1. **The offline render core is the product.** Real-time and VST are secondary until parity is real. We stop advertising parity we don't have.
2. **One DSP source of truth.** All master-chain + oscillator + filter + meter code moves to `@psy-foundation/dsp`; app, worklet and VST consume generated/shared artifacts. Copy-paste DSP is banned.
3. **Ship a release channel.** Versioned artifacts + CHANGELOG + version constant, so the zip era (and the family's 7 PolyBLEPs / 3 LUFS / 3 transports) can end.
4. **Honesty as a feature.** README numbers must be regenerable by a `bun run verify` script; anything unverifiable gets deleted or re-worded.

---

## Phase 0 — "Truth" (target: 1 session, immediate)

**Goal: everything advertised works; nothing advertised is false.**

| # | Task | Acceptance gate |
|---|------|-----------------|
| 0.1 | Fix `upload-reference` WAV parser (bitsPerSample at fmt+14; reject absurd dataLength ≤ content length; cap allocation) | POST of a valid 16-bit WAV → 200 + latent JSON; crafted header bomb → 4xx, no crash |
| 0.2 | Fix `style-transfer` header crash (ASCII header value; em-dash removed) | default GET → 200 WAV + honest `X-Style-Transfer` |
| 0.3 | Clamp query params: `bars ∈ [1,88]`, `seed ∈ [0, 2^31)`, `variations ≤ 24`; reject with 400 | `?bars=9999999` → 400 in <50ms |
| 0.4 | Remove failure-path double render; single render, honest error | forced-sample-failure test → 1 render (spy count) |
| 0.5 | Fix 23 tsc errors (`@types/bun` dev-dep; `seed` type on MusicalContext or test-side) | `tsc --noEmit` = 0 in apps/web |
| 0.6 | Delete: stale 2.3MB WAV, `app/api/route.ts` hello-world, unused toast/deps if orphaned | repo tree shrinks; lint stays 0 |
| 0.7 | Fix `/api/arrangement` bars contract (sections must sum to requested bars) | `?bars=N` → Σsections = N for N ∈ {1,8,16,32,88} |
| 0.8 | `scripts/verify.mjs`: boots server, smokes 6 endpoints, runs ffmpeg metrics, prints claims table | `bun run verify` = the README's source of truth |
| 0.9 | README regenerated from verify output (799/5 skip; endpoint matrix; remove parity/VST overclaims) | every README number traceable to verify.mjs output |

**Gate 0:** `bun test` 0 fail · `tsc` 0 · `lint` 0 · verify.mjs all-green · no unbounded query param left.

---

## Phase 1 — "One DSP" (the structural fix; ~2-3 sessions)

**Goal: the foundation contains the foundation. One copy of every primitive.**

| # | Task | Notes |
|---|------|-------|
| 1.1 | Move to `@psy-foundation/dsp`: `limiter.ts`, `multiband.ts`, `ott.ts`, `loudness.ts` (ITU meter), `ZDFSVF`, `BLSaw/BLSquare` (web's PolyBLEP variant), `ChannelFX` core | app imports from the package; old app files become re-exports during migration |
| 1.2 | **Rewrite TruePeakLimiter lookahead**: detect on a delay-line image (detector runs D samples ahead of gain application); ceiling = advertised ceiling (remove the 0.65 clip and its source-grep test); add ISP-aware release | property tests: 4-sample square through limiter ≤ ceiling; no clipped sample-peak overshoot >0.1dB; THD on 1kHz sine < threshold |
| 1.3 | Fix `packages/dsp` MoogLadder stability (clamp p or switch to the web's stable one-pole-per-stage variant) + add NaN guards | sweep 20Hz–20kHz × res 0–1: output bounded, finite |
| 1.4 | Replace `packages/dsp` LufsMeter with the real ITU meter (from 1.1) | 997Hz −23dBFS mono → −23±0.5 LU; gating tests |
| 1.5 | Worklet: `sampleRate` from `process()` options (kill the `const SR` lie); regenerate coefficient-dependent stages on init | 48kHz context → crossover at 0.2·sr measured |
| 1.6 | **Worklet build step**: `scripts/build-worklet.mjs` bundles the TS DSP into `public/worklets/psy4-processor.js` (or shared chunk); worklet no longer hand-maintained | worklet built in CI/verify; biome covers output or generated-flag set |
| 1.7 | Determinism: seed hats/click RNGs from the render seed in `packages/music` renderer | packages render → identical md5 across runs |
| 1.8 | De-duplicate critic: single AudioCritic (web's richer one moves to a package or the app stops importing music's) — one import path only | grep: one implementation referenced |

**Gate 1:** grep shows zero master-chain/DSP duplicates outside `packages/dsp` (+ its generated worklet artifact); limiter property tests pass; determinism tests pass on both renderers.

---

## Phase 2 — "Honest metrics & clean rooms" (~1-2 sessions)

| # | Task | Gate |
|---|------|------|
| 2.1 | De-game AudioCritic: implement real stereoContrast (or drop the metric for mono), real melodicClarity (pitch-class histogram entropy), motifIdentity (n-gram recurrence), remove floors/buckets | metronome-noise loop must NOT score >0.6 overall; documented synthetic A/B cases |
| 2.2 | Fix `learning/contextKey` (add bpm field; energy once) + regression test | two contexts differing only in bpm → different keys |
| 2.3 | Wire-or-delete `data/*.json` (prefer: music scales/presets load from them; else delete) | zero orphan files with false "Used by" headers |
| 2.4 | Dead-export purge per package (transport v0 → `@deprecated` internal or delete; target ≥80% alive exports) | export-alive ratio check in verify |
| 2.5 | Replace source-grep "E2E" tests with behavior tests; keep MD5 snapshot as *tripwire only* (clearly named) | phase-g grep tests deleted or replaced |
| 2.6 | Voice contract fixes: `active` reflects reality; lead `stereoWidth` either implemented or removed from API | unit tests on the Voice interface |

**Gate 2:** critic scores measured on the fixtures corpus with recorded baselines; no test greps source text; no known-false comment survives.

---

## Phase 3 — "Foundation for the family" (release channel; ~2 sessions)

| # | Task | Notes |
|---|------|-------|
| 3.1 | Versioning: root version constant, CHANGELOG.md, tags `foundation-v2.x`; worklet bundle carries the version string | verify prints version; mismatch fails |
| 3.2 | Publish artifacts: npm workspace publish config (or GitHub Packages) **and** a single-file ESM bundle (`psy-foundation.esm.js`) + built worklet — the two things zip-era consumers actually pin | install test in a scratch project |
| 3.3 | Backport family fixes upstream: DeviceHost per-device error isolation (from shims), O(1) voice-pool freeSet (from psy-sampler) | upstream tests + credit comments |
| 3.4 | Conformance suite: `packages/device-sdk/conformance` — a device repo runs it against itself (the CI-skipping shim-sync test dies) | psy-sampler-style device passes it in-repo |
| 3.5 | Transport decision honored: adopt psy4-proven semantics into foundation transport v1.x (epoch/holdover/seek/setTempo/predictBeats) closing the 10 documented gaps + un-skip the 5 GAP tests | all 5 GAP tests pass; parity matrix doc updated |
| 3.6 | PSYBUS: adopt psyboss's spec as `protocol/v2` envelope (single canonical bus; deprecate the other 3) | spec + round-trip tests |
| 3.7 | Offer (not perform) adoption path for psy-sampler / psysynth / psydrum: swap shim → npm dep | **requires owner approval per repo** — out of this repo's write scope |

**Gate 3:** a stranger repo can `bun add` (or pin a bundle) and pass the device conformance suite without touching this repo.

---

## Phase 4 — "Product" (make the demo a tool; ~3-4 sessions, parallelizable)

| # | Task |
|---|------|
| 4.1 | Renders off the event loop: worker thread pool (size = cores−1) + in-process LRU for hot seeds + request coalescing by params hash |
| 4.2 | Streaming: chunked WAV response (RIFF header + streamed data) so first-byte < 500ms on long renders |
| 4.3 | Rate limiting (token bucket per IP) + optional API key mode; upload-store bounded (TTL + max entries) |
| 4.4 | Realtime honesty: either reach ≥90% master-chain parity via the Phase-1 shared DSP (target), or demote the worklet UI to "sketchpad" labeling with the offline render as canonical |
| 4.5 | UI to tool-grade: transport for the realtime engine, mixer strip (mute/solo/gain per voice), preset **apply/load** wired, MIDI-in wired (the existing dead code), noteOff on key/pointer release, error boundary + toasts, dispose/leak fixes, ARIA on keyboard |
| 4.6 | Session persistence: save/load project (seed+bars+style+automation+preset refs) as JSON |

**Gate 4:** a user can open the app, play notes properly (with release), load/save a session, and the realtime path uses the same DSP build as the offline render; load test: 20 concurrent renders at bars=88 → no event-loop starvation.

---

## Phase 5 — "VST: fix or archive" (decision gate first)

**Decision point for the owner:** the VST is 2/10. Options:
- **A. Fix properly** (note-off in processBlock, wire all params, presets, editor layout, thread-safe messaging, MSVC guards): ~1-2 sessions. Worth it only if desktop plugin is a real goal.
- **B. Archive honestly** (move to `archive/vst-prototype`, README says "prototype, not shippable"): 1 commit, honesty restored. **Default recommendation: B**, revisit after Phase 4.

> **DECISION (2026-09-04, executed): B — archived honestly.** The prototype
> moved to `archive/vst-prototype/` with a post-mortem README (findings,
> revival conditions). See repo worklog Task 9 and the main README.

---

## Sequencing & parallelism

```
Phase 0  █████ (1 session)            ← START HERE — kills all false claims
Phase 1  ███████ (2-3)                ← structural; enables 2.1/4.4
Phase 2  ████ (1-2, after 1.1-1.2)
Phase 3  █████ (2, parallel with 2)
Phase 4  ████████ (3-4, after 1)
Phase 5  ██ (1-2 or 1 commit; owner decision)
```

Phases 2/3 can run in parallel (different subsystems). Every phase ends with: `bun test` + `tsc` + `lint` + `bun run verify` all green, worklog appended with measured numbers, tag `pre/post-phase-N`.

## Definition of Done (repo-level)

1. `bun run verify` = executable truth: endpoints, determinism, LUFS/TP/LRA vs ffmpeg, version.
2. Zero divergent DSP copies; worklet generated from the same source.
3. Zero unbounded inputs; all endpoints error honestly.
4. README claims 1:1 with verify output; no grep-tests; no dead flagship features.
5. A family member can adopt foundation v2 without copy-paste.
6. **Commercial readiness target: ≥ 7/10** (from 3.5) — measured by re-running this audit's scorecard.
