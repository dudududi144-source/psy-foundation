# Engineering Decision Record — PLAN_V3, Sessions 5+ (Phase 1.1 / Phase 2)

Authority: lead engineer, per owner mandate (full autonomy, push approved).
Status: ACTIVE. Every decision here overrides older docs where they conflict.

## D1 — The master chain moves into `@psy-foundation/dsp` (no shims)

`TruePeakLimiter`, `MultibandCompressor` (+ `LR4Crossover`, `BandCompressor`),
`OTT`, `measureLUFS`/`lufsToGainOffset` move from `apps/web/src/lib/psy4/` to
`packages/dsp/src/master/`. The old files are **deleted**, consumers import
`@psy-foundation/dsp` directly. No re-export shim files: shims preserve the
illusion of a second source — exactly what the audit condemned.
Web adds `@psy-foundation/dsp: workspace:*` as a dependency.

## D2 — `sampleRate` becomes REQUIRED in master-chain options

The `const SR = 44100` lie (fixed for the worklet in Phase 1) must not be
reintroduced through defaults. `TruePeakLimiterOptions`, `OTTOptions`,
`MultibandCompressorOptions` require explicit `sampleRate`. All call sites
already pass it; making it required turns "forgot to pass" into a compile
error instead of a mistuned master chain.

## D3 — OTT per-channel expanders (bug fix during move)

Audit finding: OTT shares ONE `BandExpander` per band across L and R
(`ott.ts:186-192`) — the sidechain of R corrupts the gain of L.
Fix during the move: 3 bands × 2 channels of independent envelope followers.
Locked by a new behavior test: a stereo signal with divergent per-channel
dynamics MUST produce divergent L/R gains (fails on the old code).

## D4 — One ZDF SVF: `forensic/dsp.ts` → `packages/dsp/src/filters-zdf.ts`

The audit-verified correct Zavalishin/Simper TPT SVF becomes a dsp export.
`forensic/dsp.ts` re-exports it for source compatibility (that file contains
more than the SVF; full decomposition is out of scope). One implementation,
two import paths, zero copies.

## D5 — Fake `LufsMeter` dies; real ITU metering ships

`packages/dsp/src/metering.ts` `LufsMeter` is NOT BS.1770 (no +4 dB shelf,
no gating) while a correct ITU implementation exists in `loudness.ts`.
Decision: delete the fake, export the real one from dsp. Its tests are
replaced by ITU-conformance behavior tests (known-signal LUFS targets).

## D6 — The worklet becomes a BUILD ARTIFACT (One DSP reaches real time)

`public/worklets/psy4-processor.js` (hand-maintained 4th DSP copy, 720 LOC)
is replaced by:
- TS source: `apps/web/src/worklets/psy4-processor.ts` — same 13-voice
  architecture, same MessagePort protocol (`noteOn`/`noteOff`/`acid`/params),
  same Haas stereo — but DSP primitives imported from `@psy-foundation/dsp`
  (PolyBLEP replaces the nonstandard near-zero-residual BLEP; ZdfSvf from D4).
- Build step: `scripts/build-worklet.mjs` using `Bun.build` (target browser,
  IIFE; ES module fallback — `addModule` supports both) → generated file with
  `GENERATED — DO NOT EDIT` banner. Root script `build:worklet`.
- Reproducibility gate: two consecutive builds produce byte-identical output.

## D7 — Parity fixtures BEFORE the move (migration safety)

Before any code moves: render deterministic test signals through the CURRENT
web implementations, save float fixtures (`packages/dsp/tests/fixtures/`).
After the move, classes must reproduce them bit-exactly — EXCEPT paths
changed by D3 (OTT) and D5, which get re-baselined **with recorded reasons**.
Any md5-baseline test that changes PCM is re-baselined with justification in
the commit message (charter: deterministic, logged, never silent).

## D8 — Phase 2 honesty decisions

1. **Critic de-gaming**: gamed metrics (stereoContrast=0.5 constant,
   melodicClarity centroid buckets, motifIdentity=uniformity×1.5,
   callResponse +0.3 floor) are replaced by real measurements in BOTH critics
   (packages/music + apps/web). A metric with insufficient input returns a
   non-score honestly; no constants, no fudge floors. Behavior tests must
   prove responsiveness (mono vs wide, scale-locked vs random, echoed vs
   unstructured).
2. **contextKey**: `bpmBin(ctx.energy)` (bpm binned from ENERGY — audit
   finding) is REMOVED, not "fixed" — `MusicalContext` has no bpm field and
   inventing one is out of scope. Key format change is accepted; bandit state
   resets honestly.
3. **data/*.json**: orphaned files with false "used by" claims are DELETED
   (connecting fabricated data would be a new lie).
4. **benchmarks/compare-to-reference.ts**: fabricated track references
   (RMS-as-LUFS, crest-as-LRA) — DELETED. The two real benchmarks stay.
5. **leadNotes=0 at full-on**: composition bug (found Phase 1) is fixed;
   test asserts leadNotes>0 for full-on with fixed seed.
6. **Remaining source-grep / fake-physics tests** are rewritten as behavior
   tests or deleted with the false claim they lock.

## Non-goals this session (explicit)

- Transport v0 dead-layer deletion (API surface change — later phase).
- Full critic consolidation into one package (D8 fixes honesty first).
- Pipeline-as-library (`masterChain()` composition function) — Phase 4.
- Any family-repo change (read-only mandate stands).

## Gates (unchanged, Five Gates charter)

`bun test` 0 fail · `tsc --noEmit` 0 · `bun run lint` 0 ·
`bun run verify` (root scripts/verify.mjs) green · ffmpeg ebur128 spot check.
