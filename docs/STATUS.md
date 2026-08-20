# PSY Foundation — Status

> Last updated: 2026-08-19 (Phase 0 Day 2 complete)
> Verified by: runtime tests, ffmpeg loudnorm, bun test

---

## Current State

**Phase 0 of rebuild plan — Day 2 complete.**

- 13 foundation packages deployed from `psy-foundation.zip` to `packages/`
- Repository restructured to monorepo (`packages/`, `apps/web/`, `apps/vst/`)
- 646 tests pass, 0 fail
- 6 HTTP API endpoints operational
- Cleanup done: skills/, commercial samples, dead deps, dead UI, prisma tutorial removed

---

## Verification Metrics (from runtime, not code reading)

### Tests
```
$ bun test
646 pass, 14 skip (CONTRACT GAP documented), 0 fail
391,380 expect() calls across 34 files / 660 tests
Ran in 36.31s
```

### Install
```
$ bun install
154 packages installed in 737ms
```

### Render output (`?bars=8&seed=42`)
```
$ curl http://localhost:3000/api/render-forensic?bars=8\&seed=42 -o out.wav
HTTP 200 · 5.2s · 1752236 bytes

$ ffprobe out.wav
duration=9.933061, sample_rate=44100, channels=2, 16-bit PCM

$ ffmpeg -af loudnorm -f null -i out.wav
Input Integrated: -10.6 LUFS
Input True Peak:  +0.2 dBTP  ⚠️ exceeds 0 dBFS (Phase 1 fix)
Input LRA:         1.9 LU

$ md5sum out.wav
0e1294f1e9f8b5280893ad01f9ca6326  out.wav  (deterministic baseline)
```

### Page load
```
$ curl http://localhost:3000/
HTTP 200 · 29KB · 0.05s
```

---

## What's Done (Phase 0 Day 1 + Day 2)

### Day 1 — Foundation Unpack + Restructure
- [x] Branch `rebuild/phase-0` created from `main`
- [x] Tag `backup/pre-rebuild-20260819` pushed (permanent)
- [x] `public/psy-foundation.zip` extracted → `packages/` + `apps/*` + `benchmarks/` + `integration/` + `audit/`
- [x] `src/` → `apps/web/src/`
- [x] `public/` → `apps/web/public/`
- [x] `next.config.ts` → `apps/web/next.config.mjs` (ESM fix)
- [x] `tailwind.config.ts` → `apps/web/tailwind.config.cjs` (CJS fix)
- [x] `vst-plugin/` → `apps/vst/`
- [x] Deleted `src/foundation/music/` and `src/foundation/transport/` (duplicates)
- [x] Patched 6 files: `@/foundation/music` → `@psy-foundation/music`
- [x] Root `package.json` rewritten as workspace
- [x] ESM/CJS conflicts resolved (`.mjs` + `.cjs` extensions)
- [x] Turbopack alias issue resolved (workspace symlinks instead)
- [x] `@types/node` added
- [x] `bun test` = 646 pass (no regression)
- [x] Render output bit-identical to pre-restructure (md5: a50d5601...)

### Day 2 — Cleanup
- [x] Tag `backup/pre-cleanup-20260819` pushed (permanent)
- [x] `skills/` deleted (61MB, 1074 files — Z.ai marketplace dump)
- [x] `apps/web/public/samples/real/` deleted (141 commercial samples — license violation)
- [x] `forensic-bridge.ts` patched to use procedural samples (`kick.wav`, `hat_closed.wav`, `clap.wav`, `hat_open.wav`)
- [x] 46 unused shadcn/ui components deleted (kept toast + toaster only)
- [x] `prisma/` + `src/lib/db.ts` deleted (dead tutorial)
- [x] `tests/*.sh` + `scripts/keepalive.sh` deleted
- [x] `public/psy-foundation.zip` + `demo-16bars.wav` + `diagnostic.wav` deleted
- [x] `apps/web/package.json` reduced from 68 deps to 12 deps
- [x] `layout.tsx` metadata updated (title, description, OG, Twitter)
- [x] `package.json: name` = `psy-foundation` (was `nextjs_tailwind_shadcn_ts`)
- [x] `bun install` = 737ms (was 89s — 120× faster)
- [x] `bun test` = 646 pass (no regression)
- [x] Render output verified (new baseline md5: `0e1294f1e9f8b5280893ad01f9ca6326` — different because procedural samples instead of 909)

---

## What's Next (Phase 0 Day 3-5)

### Day 3 — Docs rewrite (in progress)
- [ ] Archive old docs to `docs/archive/` (SELF_ROAST, HONEST_TRUTH, PROJECT_SUMMARY, COMMERCIAL_READINESS_ROADMAP, COMPETITIVE_GAP_ANALYSIS, knowledge-hub/)
- [ ] Write `README.md` — honest, no false claims
- [ ] Write `docs/STATUS.md` (this file)
- [ ] Write `docs/ARCHITECTURE.md`
- [ ] Write `docs/ROADMAP.md`
- [ ] Write `docs/QUALITY_GATES.md`
- [ ] Write `docs/RISK_REGISTER.md`

### Day 4 — Lint + type check strict
- [ ] Enable 5 biome rules: noUnusedVariables, noExplicitAny, useImportType, noUnreachableCode, noUnsafeFinally
- [ ] Fix all lint errors
- [ ] `tsc --noEmit` per package (foundation already passes)
- [ ] `tsc --noEmit` in `apps/web/`
- [ ] Remove `next.config: typescript.ignoreBuildErrors`

### Day 5 — Snapshot tests + commit
- [ ] Write `apps/web/tests/snapshot.test.ts` (render → md5 baseline)
- [ ] Write 5 DSP unit tests (ZDFSVF, BLSaw, LR4, LUFS, limiter)
- [ ] `bun test` should pass 646 + 6 = 652 tests
- [ ] Merge to `main` and tag `v0.4.0-phase-0-complete`

---

## Known Issues (carried forward to Phase 1)

### Critical bugs (Phase 1 Day 1-7 fixes)
1. **TruePeakLimiter doesn't catch ISPs** — render now exceeds 0 dBFS (+0.2 dBTP)
   - File: `apps/web/src/lib/psy4/limiter.ts`
   - Fix: replace Catmull-Rom with FIR 48-tap, apply gain at 4× rate
2. **`/api/audio-critique` takes 30s** — O(N²) DFT
   - File: `apps/web/src/lib/psy4/audio-critic.ts::computeDFT`
   - Fix: replace with FFT (radix-2), expected speedup 100×
3. **`/api/arrangement` ignores `?bars=`**
   - File: `apps/web/src/lib/psy4/arrangement/ArrangementGenerator.ts`
   - Fix: respect `targetBars` parameter
4. **`StereoWidener.process` broken at width=1**
   - File: `apps/web/src/lib/psy4/ms-processor.ts:57-91`
   - Fix: copy math from `channel-fx.ts:447-450` (correct implementation)
5. **`MoogLadder` mislabeled as Huovilainen**
   - File: `apps/web/src/lib/psy4/forensic/dsp.ts:52-86`
   - Fix: implement real Huovilainen 2004 OR correct docstring to "Stilson-Smith derived"
6. **`BLTriangle` wrong PolyBLEP residual**
   - File: `apps/web/src/lib/psy4/forensic/dsp.ts:404-428`
   - Fix: integrated cubic polyBLEP (Välimäki-Heap)
7. **`OversampledSaturation` not oversampling**
   - File: `apps/web/src/lib/psy4/forensic/dsp.ts:451-466`
   - Fix: FIR 4-tap linear-phase upsample, matched FIR downsample
8. **`SchroederReverb` fake stereo**
   - File: `apps/web/src/lib/psy4/forensic/mixing.ts:119-182`
   - Fix: separate comb banks per channel, decorrelated
9. **Hard-coded `SR = 44100`** in 8 files
   - Files: forensic-bridge.ts:40, psy-voices.ts:25, waveguide-string.ts:27, granular.ts (×8), ms-processor.ts:63, mixing.ts:187, neural/ddsp-noise.ts:25
   - Fix: parameterize via `foundation/dsp/src/utils.ts::DEFAULT_SR`
10. **`learning-kernel.ts:622` precedence bug** — `normalizeWeights` is a no-op
11. **`learning-kernel.ts:172` wrong interval→degree** — minor third maps to degree 3 (should be 2)

### Incomplete features (Phase 2 fixes)
- Real-time AudioWorklet: 1 voice only (lead), not 13 aspired
- SoundDNA computed but not consumed by audio-renderer
- Motif transformations written but not called by F20 composeLeadPlan
- No sidechain (only bass-only dynamic EQ duck)
- No OTT (genre signature missing)
- No 16th rolling bass mode
- INTRO state silent (no texture voice)

### Honest about what we don't have (Phase 4-5 or never)
- VST plugin not buildable (PluginEditor.cpp missing)
- No trained neural models (ONNX module broken: missing `await`)
- Style transfer uses self-reference (render compared to itself)
- AudioCritic score (0.66 on self-defined metric) is self-referential
- 0 producer blind tests done
- `targetLufs = -12` is neither club (-9) nor streaming (-14)

---

## Git State

```
Branch: rebuild/phase-0 (pushed)
Tags: backup/pre-rebuild-20260819, backup/pre-cleanup-20260819 (both pushed, permanent)

Latest commit:
c5b2539 feat(cleanup): Phase 0 Day 2 — delete skills/, commercial samples, unused deps, dead UI, prisma tutorial, fix metadata
```

GitHub: https://github.com/dudududi144-source/psy-foundation/tree/rebuild/phase-0
