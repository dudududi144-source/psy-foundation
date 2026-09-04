# Changelog

All notable changes to **psy-foundation** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: the foundation releases as ONE monorepo-wide version, tagged
`foundation-vX.Y.Z` — the single source of truth is
`packages/dsp/src/version.ts` (`FOUNDATION_VERSION`).

## [Unreleased]

### Planned (Phase 3 remainder + Phase 4, PLAN_V3_MASTER)
- Transport GAP closure: `scheduleLocal()` (D1), `protocolVersion` (P1),
  melody/rhythm/noise fixtures (F1–F3) + un-skip of the 5 remaining contract
  tests.
- Product hardening: worker-pool rendering, chunked WAV streaming, rate
  limiting, session save/load, tool-grade UI.

## [2.0.0] — 2026-09-04

The honest rebuild. Version 2.0.0 marks the point where every loudness number,
every DSP primitive and every documented claim in this repo is measured,
behavior-tested and reproducible. Derived from the forensic audit
(docs/AUDIT_FORENSIC_2026-09-04.md) and executed under docs/PLAN_V3_MASTER.md
Phases 0–3 with the Five Gates (bun test / tsc / biome / verify / ffmpeg
spot-check) green at every step.

### Added
- `scripts/verify.mjs` — executable truth: boots the app, smokes every API
  endpoint, enforces bounded inputs, exact-bars arrangement contract,
  deterministic renders (md5), and measures loudness against
  `ffmpeg -filter:e ebur128`. README claims regenerate from its output.
- `@psy-foundation/dsp` master chain — THE canonical master chain (moved from
  the 4 divergent copies in apps/web): `MultibandCompressor` + LR4 crossover,
  per-channel `OTT` expanders, `TruePeakLimiter`, real ITU-R BS.1770-4 LUFS
  (`measureLUFS`, K-weighting), `ZDFSVF` (Zavalishin/Simper TPT).
- Device conformance suite (`packages/device-sdk/conformance/`) —
  framework-agnostic `runDeviceConformance()` (C1–C8) so external device
  repos can prove conformance without touching this repo.
- `DeviceHost` per-device error isolation: structured `DeviceErrorEvent`
  ring + opt-in `onError`; a faulted device never starves the others
  (backport of the family-shim policy).
- O(1) `VoicePool` — free-set allocation + oldest-outstanding FIFO steal
  (design backported from the psy-sampler foundation-shim).
- PSYBUS v2 (`@psy-foundation/protocol/v2`) — canonical bus envelope
  transcribed from psyboss's PSYBUS.md with per-field provenance, 15-kind
  payload union, typed validation errors, byte-deterministic canonical JSON,
  bounds (64 KiB / 128-char ids / depth 64), and a machine-readable
  deprecation map for the legacy envelope styles.
- Release artifacts: single-file ESM bundle `release/psy-foundation.esm.js`
  (all 10 packages, deterministic build) and the generated worklet artifact
  with an embedded version string — the two things zip-era consumers pin.
- `CHANGELOG.md` (this file) and single-source release versioning.

### Changed
- Worklet is a BUILD ARTIFACT generated from TypeScript source
  (`scripts/build-worklet.mjs`, DECISIONS_V3 D6) — the hand-maintained 4th
  DSP copy is gone; offline render and realtime engine share one DSP build.
- Worklet sample rate comes from `process()` options instead of a hardcoded
  `44100`.
- Limiter lookahead rewritten (the previous lookahead was a no-op) and
  MoogLadder stabilized against invalid arguments.
- True peak is 4×-oversampled (was sample peak); OTT parameter/gain clamping
  fixed (was ~685 billion on extreme params).
- Critics de-gamed: every metric is a real measurement or an honest
  unknown — fabricated passing constants removed (Phase 2).
- Bounded public inputs: `bars ∈ [1,88]`, bounded seeds/variation counts →
  HTTP 400 beyond bounds; upload-reference parser fixed (was allocating
  from an unbounded offset) with bound-checked allocations.
- 9 previously-skipped transport contract tests un-skipped and passing
  (T1–T6, T9); all reachable TS type errors cleared.

### Removed
- The fake `LufsMeter`; vendored duplicate DSP copies; orphaned data files
  and the vanity benchmark; stale 2.3 MB WAV binary and dead routes.

[Unreleased]: https://github.com/dudududi144-source/psy-foundation/compare/foundation-v2.0.0...HEAD
[2.0.0]: https://github.com/dudududi144-source/psy-foundation/compare/v1.2.0...foundation-v2.0.0
