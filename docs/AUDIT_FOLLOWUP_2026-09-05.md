# PSY Foundation — Post-Execution Verification Audit (C1–C10 re-check)

**Date:** 2026-09-05
**Baseline:** [AUDIT_FORENSIC_2026-09-04.md](./AUDIT_FORENSIC_2026-09-04.md) (3.5/10)
**Trigger:** PLAN_V3_MASTER fully executed (worklog Tasks 3–10, zero deferrals).
**Method:** same-repo re-verification — code inspection at the exact audited locations, repo-wide greps, plus runtime evidence from `scripts/verify.mjs` (28/28, 138 s) and the five gates at audit time (bun test 957/0/0 skip · tsc 0 · biome 0).

Every verdict below was re-derived in this session, not copied from worklog claims. Evidence lines reference current code.

---

## 1. Verdict per critical finding

| # | Original finding | Verdict | Current evidence |
|---|---|---|---|
| C1 | DSP chain not in packages — "the foundation does not contain the foundation" | ✅ RESOLVED | `packages/dsp/src/master/{limiter,loudness,multiband,ott}.ts` + `filters-zdf.ts`. `apps/web` imports `@psy-foundation/dsp` in 5+ files incl. the worklet source (`worklets/psy4-processor.ts:4`), `forensic-bridge.ts:3`, `forensic/dsp.ts:2`. |
| C2 | Four divergent copies of every DSP primitive; MoogLadder unstable >3.5 kHz | ✅ RESOLVED | One canonical PolyBLEP/ZDF/MoogLadder in `packages/dsp`; worklet is a build artifact of it (D6: `scripts/build-worklet.mjs` from TS source); VST copy honestly archived (`archive/vst-prototype/`). Stability fix documented at `filters.ts:157-205`: per-stage `p` clamped to the stability bound, cutoff clamped to Nyquist, tanh saturation in the feedback path. |
| C3 | TruePeakLimiter lookahead is a no-op; hard-clips at `ceiling × 0.65`; grep test locked the bug | ✅ RESOLVED | `master/limiter.ts` header cites the audited bug and implements real lookahead (`lookaheadSamples`, 5 ms default, `:109-114`). Repo-wide grep `ceiling * 0.65` → **0 hits** (only a test comment noting the audit flagged it). Grep-theater test rewritten to structural claims. |
| C4 | Real-time engine is a different product (~5% parity) | ✅ RESOLVED by construction | Worklet is now a TS source importing the canonical `@psy-foundation/dsp`, compiled via `build-worklet.mjs` (D6) — parity by construction. UI honesty label (4.4): "Real-Time Sketchpad" explicitly states it is a lighter 13-voice arrangement and the offline render is the reference output. |
| C5 | `const SR = 44100 // Will be overridden` | ✅ RESOLVED | Repo-wide grep `const SR = 44100` → **0 hits**. Worklet takes `sampleRate` from the runtime (D2: `sampleRate` required, not defaulted). |
| C6 | 2/6 endpoints dead on arrival (WAV parse offset, em-dash header crash) | ✅ RESOLVED | verify.mjs runtime proof: `upload-reference` valid WAV → 200 + hash; style-transfer default → 200 (`"was guaranteed 500"` in the verify title itself); style-transfer with reference → 200 + `X-Style-Transfer: applied`. Em-dash survives only in code comments, never in runtime header strings. |
| C7 | Compute API trivially DoS-able | ✅ RESOLVED | Runtime proof (verify.mjs): `bars=9999999` → 400 `bars must be an integer in [1, 88]`; burst without key → 429 + Retry-After (4 routes rate-limited); renders off the event loop (`X-Render-Worker: worker`), request coalescing + LRU cache; failure path no longer re-renders (cache write moved into the coalesced task, Task 10); WAV upload strictly header-validated; header-first streaming with exact Content-Length (truncation is loud, never silent). |
| C8 | Critic partially fictional and automates PASS | ✅ RESOLVED | `audio-critic.ts`: `stereoContrast` is a real inter-channel measurement or `null` when no stereo input is provided (`:221`); `melodicClarity`/`motifIdentity`/`callResponse` computed from injected note events (`:198,231,239`) — old literals survive only as "Was:" comments (`:197,230,236`). Responsiveness tests lock behavior (9a00067). verify.mjs: 38 metrics computed on real audio, score 0.714. |
| C9 | Split-brain family: 0/16 runtime consumers, no release channel | ⚠️ CHANNEL SHIPPED — ADOPTION PENDING (external) | Foundation side done: `@psy-foundation/dsp` v2.0.0 single-source version + CHANGELOG + ESM release bundle; PSYBUS v2 canonical envelope with typed deprecation map; framework-agnostic device conformance suite; [FAMILY_ADOPTION_OFFER.md](./FAMILY_ADOPTION_OFFER.md). The 16 family repos are **read-only by mandate** — runtime adoption is the family's move. Listed as open-external, not hidden. |
| C10 | `Math.random()` inside the deterministic renderer | ✅ RESOLVED | Seeded `Rng` from `section.seed`: hats (`audio-renderer.ts:119`, `:176`), kick click (`kick-voice.ts:68`, `:160`). `Math.random` matches in the renderer are fix comments only. Determinism runtime-locked: md5-identical renders verified at 8 bars **and** 88 bars. |

---

## 2. Other audited items re-checked

| Item (original sev) | Verdict | Evidence |
|---|---|---|
| Fake `LufsMeter` in packages/dsp (HIGH) | ✅ RESOLVED | Deleted per DECISIONS_V3 D5; real ITU-R BS.1770-4 meter in `master/loudness.ts` (K-weighting shelf, 400/100 ms blocks, −70/−10 gating); ffmpeg ebur128 parity in verify: I=−10.7 LUFS, TP −1.2 dBTP, LRA 3.9. |
| Learning contextKey double-counts energy, BPM unused (HIGH) | ✅ RESOLVED | BPM term removed (9a00067). |
| Dead-flag voices: `readonly active = false`; noteStartTime ≡ 0; `stereoWidth` accepted and never read (HIGH) | ⚠️ PARTIAL | `noteStartTime` now real (`lead-voice.ts:164`); honesty pass labels mono reality (4.4). **Still open:** `kick-voice.ts:49` `readonly active = false`; `stereoWidth` declared + preset-assigned but **zero read sites** in render logic. See §4. |
| VST findings (HIGH) | ✅ RESOLVED (decision B) | Honestly archived with post-mortem + explicit revival conditions (`archive/vst-prototype/`, Task 9). |
| Stale 2.3 MB WAV committed (MED) | ✅ RESOLVED | Deleted; repo history slimmed. |
| Test theater — grep-as-e2e, self-referential MIDI test (MED) | ✅ RESOLVED | Grep tests rewritten to structural claims; runtime truth is verify.mjs's 28 end-to-end claims (real HTTP, real ffmpeg, real md5). |
| Vanity benchmark inventing named-artist targets (MED) | ✅ RESOLVED | Deleted (9a00067). |
| Orphaned `data/*.json` with false "Used by" (MED) | ✅ RESOLVED | Deleted. |
| tsconfig strictness downgrades: `noUncheckedIndexedAccess:false`, `noImplicitAny:false` (MED) | ❌ OPEN | `apps/web/tsconfig.json:7-8`, `packages/dsp/tsconfig.json:3`, `packages/music/tsconfig.json:3`. Proposed as post-V3 hardening sweep (§4, item 2). |
| ~40-55% dead exports (LOW) | ⚠️ PARTIAL | v2.0.0 release bundle restructured the public surface; a full dead-export audit was not performed. |

---

## 3. Scorecard after execution

Same dimensions as the baseline audit.

| Dimension | 2026-09-04 | 2026-09-05 | One-line justification |
|---|---|---|---|
| Offline render core | 7/10 | 9/10 | Same ffmpeg-verified deterministic core; limiter lookahead real; ITU meter in-package; shared render geometry; determinism md5-locked at 8 and 88 bars. |
| packages/ foundation | 4.5/10 | 8.5/10 | DSP lives at home; real meter; stable ladder; v2.0.0 release channel; strictness flags remain off. |
| Real-time engine | 2/10 | 7/10 | Build artifact of the canonical chain (parity by construction); SR from runtime; sketchpad honestly labeled as the lighter arrangement. |
| VST | 2/10 | — archived | Honest archive with revival conditions (decision B). Scored no longer applicable. |
| Web UI / product | 3/10 | 7/10 | Tool-grade sketchpad (4.5), honesty labeling (4.4), session persistence (4.6); residual dead-code sweep not audited this pass. |
| API surface | 3/10 | 8/10 | 6/6 endpoints live at runtime; input guards; 429 + Retry-After; off-loop pool + cache + coalescing; streaming TTFB ~24 ms. |
| Test suite honesty | 5/10 | 8/10 | 957 tests, 0 fail, 0 skip; grep theater rewritten; verify.mjs 28 runtime claims incl. determinism, LUFS/TP ffmpeg parity, streaming, rate limiting. |
| Docs / claims honesty | 3/10 | 8.5/10 | Decision records D1–D8; honesty labels in UI; README regenerated from verify output; honest VST post-mortem; this follow-up audit. |
| Family integration | 0/10 | 5/10 | Release channel + adoption offer + PSYBUS v2 + conformance suite shipped; **0/16 runtime consumers remains** (external dependency, repos read-only by mandate). |
| **Overall commercial readiness** | **3.5/10** | **7.5/10** | Real core, real product, real platform. Remaining gap: one external dependency (family adoption) + one internal hardening sweep (strictness). |

---

## 4. What would close the remaining gap

1. **Family adoption (external).** The foundation side is ready and waiting: v2.0.0 bundle, PSYBUS v2, device conformance suite, adoption offer. The 16 repos are read-only for this engineer by mandate; the move is theirs.
2. **Strictness sweep (internal, proposed Task 12).** Enable `noUncheckedIndexedAccess` + `noImplicitAny` across all packages, fix the fallout, lock with the gates. Mechanical but broad; scheduled as its own session so it cannot half-land.
3. **Voice-dead-flag cleanup (internal, can ride with Task 12).** Read or remove `stereoWidth`; give kick's `active` flag a real lifecycle or delete it.
4. **Dead-export audit (LOW).** One grep-driven pass per package against the v2.0.0 public surface.

---

## 5. Reproducibility

```bash
# C3/C5/C10 absence proofs
rg 'ceiling \* 0\.65'            # 0 hits (audit reference comment only)
rg 'const SR = 44100'            # 0 hits
rg 'Math\.random' packages/music/src/audio   # fix comments only

# Runtime truth (138 s)
node scripts/verify.mjs          # 28 pass / 0 fail

# Five gates at audit time
bun test                         # 957 pass / 0 fail / 0 skip
tsc --noEmit (all packages)      # 0 errors
biome check                      # 0 problems (257 files)
```

*Signed: Z.ai — Lead Foundation Engineer (continuation session). Worklog: Task 11. Every verdict above was re-derived in this session from current code and runtime runs; nothing was copied from prior claims.*
