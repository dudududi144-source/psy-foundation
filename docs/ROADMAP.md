# PSY Foundation — Roadmap

> 5 phases, 16-20 weeks total (solo developer).
> Each phase has explicit acceptance gates (see `docs/QUALITY_GATES.md`).

---

## Phase 0: Foundation Unpack + Triage (week 1)

**Goal:** Deploy real foundation, clean up dead code, write honest docs.

### Day 1 — Foundation Unpack + Restructure ✅
- [x] Branch `rebuild/phase-0` + tag `backup/pre-rebuild-20260819`
- [x] Extract `public/psy-foundation.zip` → `packages/`, `apps/*`, `benchmarks/`, `integration/`, `audit/`, `data/`
- [x] Move `src/` → `apps/web/src/`
- [x] Move `vst-plugin/` → `apps/vst/`
- [x] Delete `src/foundation/` (duplicates with `packages/`)
- [x] Patch 6 files: `@/foundation/music` → `@psy-foundation/music`
- [x] Root `package.json` as workspace
- [x] `bun install` (11.5s) + `bun test` (646 pass, 0 fail)
- [x] Render output verified (md5: a50d5601...)

### Day 2 — Cleanup ✅
- [x] Tag `backup/pre-cleanup-20260819`
- [x] Delete `skills/` (61MB, 1074 files)
- [x] Delete `public/samples/real/` (141 commercial samples)
- [x] Patch `forensic-bridge.ts` to use procedural samples
- [x] Delete 46 unused shadcn/ui components
- [x] Delete `prisma/` + `src/lib/db.ts`
- [x] Delete `tests/*.sh` + `scripts/keepalive.sh`
- [x] Delete `public/psy-foundation.zip` + demo WAVs
- [x] `apps/web/package.json`: 68 deps → 12 deps
- [x] Update `layout.tsx` metadata (PSY Foundation)
- [x] `bun install` (737ms) + `bun test` (646 pass, 0 fail)
- [x] Render verified (new md5: 0e1294f1...)

### Day 3 — Docs Rewrite (in progress)
- [ ] Archive old docs to `docs/archive/`
- [ ] Write `README.md` — honest, no false claims
- [ ] Write `docs/STATUS.md`
- [ ] Write `docs/ARCHITECTURE.md`
- [ ] Write `docs/ROADMAP.md` (this file)
- [ ] Write `docs/QUALITY_GATES.md`
- [ ] Write `docs/RISK_REGISTER.md`

### Day 4 — Lint + Type Check Strict
- [ ] Enable 5 biome rules: noUnusedVariables, noExplicitAny, useImportType, noUnreachableCode, noUnsafeFinally
- [ ] Fix all lint errors
- [ ] `tsc --noEmit` per package (foundation already passes)
- [ ] `tsc --noEmit` in `apps/web/`
- [ ] Remove `next.config: typescript.ignoreBuildErrors`

### Day 5 — Snapshot Tests + Final Commit
- [ ] Write `apps/web/tests/snapshot.test.ts` (render → md5 baseline)
- [ ] Write 5 DSP unit tests:
  - ZDFSVF frequency response (cutoff vs measured)
  - BLSaw aliasing check (harmonics above Nyquist)
  - LR4 crossover sum-to-unity (RBJ verified)
  - LUFS against sine wave reference (BS.1770-4 verification)
  - Limiter ceiling (sample peak ≤ ceiling)
- [ ] `bun test` should pass 646 + 6 = 652 tests
- [ ] Merge `rebuild/phase-0` → `main`
- [ ] Tag `v0.4.0-phase-0-complete`

---

## Phase 1: DSP Bug Fixes + Tests (weeks 2-4, 21 days)

**Goal:** Fix all documented DSP bugs, add tests, achieve stable snapshot.

### Week 2 — Critical DSP bugs (7 days)

**Day 1-2: StereoWidener + MasterChain**
- [ ] Fix `ms-processor.ts::StereoWidener.process` (lines 57-91) — math broken at width=1
  - Copy from `channel-fx.ts:447-450` (correct M/S implementation)
  - Test: `width=1` returns L,R unchanged
- [ ] Remove `MasterChain` hard-clip (`forensic/mixing.ts:113`)
  - Use only `TruePeakLimiter` at end of chain
- [ ] Test: master output doesn't hard-clip

**Day 3-4: TruePeakLimiter**
- [ ] Fix `limiter.ts::TruePeakLimiter`:
  - Apply gain at 4× rate (currently detection 4×, application 1×)
  - Replace Catmull-Rom with FIR 48-tap ITU-R BS.1770-4 spec
  - O(N) sliding window max (monotonic-queue)
- [ ] Test: ffmpeg dBTP ≤ limiter ceiling
- [ ] Test: ceiling=-1.0 → ffmpeg measures ≤ -1.0

**Day 5: OversampledSaturation + BLTriangle**
- [ ] Fix `OversampledSaturation` (`forensic/dsp.ts:451-466`):
  - linear interp upsample → FIR 4-tap linear-phase
  - 2-tap boxcar downsample → matched FIR
  - Test: aliasing measurement drops 12dB+
- [ ] Fix `BLTriangle` (`forensic/dsp.ts:404-428`):
  - saw residual → integrated cubic polyBLEP (Välimäki-Heap)
  - Test: aliasing measurement drops 12dB+

**Day 6: MoogLadder**
- [ ] Fix `MoogLadder` (`forensic/dsp.ts:52-86`):
  - Option A: implement real Huovilainen 2004 with Newton iteration
  - Option B: update docstring to "Stilson-Smith derived with unit-delay feedback"
  - Decision: Option A if time allows, else Option B
- [ ] Test: frequency response matches reference Moog

**Day 7: SchroederReverb**
- [ ] Fix `forensic/mixing.ts::SchroederReverb`:
  - Replace with `CompactReverb` from `channel-fx.ts:158-281`
  - Or fix: separate comb banks per L/R, decorrelated
- [ ] Test: cross-correlation L/R < 0.5

### Week 3 — Sample-rate parameterization (7 days)
- [ ] Move `SR = 44100` from 8 files to `DEFAULT_SR` in `@psy-foundation/dsp/src/utils.ts`
- [ ] All modules accept `sr: number` parameter
- [ ] Files to fix:
  - `forensic-bridge.ts:40`
  - `psy-voices.ts:25`
  - `waveguide-string.ts:27`
  - `granular.ts` (8 places)
  - `ms-processor.ts:63`
  - `mixing.ts:187`
  - `neural/ddsp-noise.ts:25` (or delete if Phase 0 didn't)
- [ ] Tests: render at 48kHz and 96kHz → output correct

### Week 4 — audio-critic FFT + learning-kernel bugs (7 days)
- [ ] Replace `audio-critic.ts::computeDFT` (O(N²)) with FFT (radix-2)
  - Expected speedup: 100×
  - `/api/audio-critique?bars=8&seed=42` should drop from 31s to <3s
- [ ] Fix `learning-kernel.ts::normalizeWeights` precedence bug (line 622)
  - `weights[k] ?? 0 / total` → `(weights[k] ?? 0) / total`
- [ ] Fix `learning-kernel.ts::bass interval→degree` (line 172)
  - Lookup table semitones→degree per scale type
- [ ] Fix `learning-kernel.ts::observe reward loop` (lines 466-517)
  - Reinforce only degrees that contributed to reward, not uniform scaling
- [ ] Fix `audio-critic.ts::computeMotifIdentity` — use `motifIdentity` from `motif-v2.ts`
- [ ] Fix `audio-critic.ts::computeKickBassLock` — spectral separation + onset alignment
- [ ] Fix `/api/arrangement` — respect `?bars=` (`ArrangementGenerator.ts` overshoot)

### Phase 1 Acceptance Gate
- [ ] `bun test` — 652+ tests pass (646 + 6 new)
- [ ] `tsc --noEmit` — 0 errors
- [ ] Snapshot hash stable (after fixes — update baseline)
- [ ] ffmpeg dBTP ≤ limiter ceiling (currently +0.2 > 0 = bug)
- [ ] ffmpeg LUFS ±0.5 from target
- [ ] `/api/audio-critique?bars=8&seed=42` < 3s (currently 31s)
- [ ] `width=1` returns L,R unchanged (unit test)
- [ ] cross-correlation L/R of reverb < 0.5
- [ ] 0 hard-coded `SR = 44100` outside `foundation/dsp/src/utils.ts`

---

## Phase 2: Composition Engine Loop Closure (weeks 5-8, 28 days)

**Goal:** Connect dead modules, add psytrance-specific features.

### Week 5 — Connect dead modules (7 days)
- [ ] SoundDNA → audio-renderer: pass `synthRecipes` from `ComposedBar` to renderer config
- [ ] transformation.ts → composeLeadPlan: call `invert`/`retrograde`/`augment` at phrase boundaries
- [ ] Presets → RenderConfig: map remaining 17 fields (or delete from Preset type)
- [ ] Automation → render loop: verify per-sample read
- [ ] Wavetable → Lead: verify per-sample `process()` call
- [ ] Granular → Texture: spawn loop active
- [ ] Waveguide → Bass: trigger active

### Week 6 — Psytrance-specific features (7 days)
- [ ] Add texture voice in audio-renderer (INTRO state not silent)
- [ ] Add transition FX (riser/impact/sweep) at section boundaries
- [ ] Fix `harmonic-plan.ts` — import PSYTRANCE_PROGRESSIONS from `psy4/harmony.ts`
- [ ] Add 16th rolling bass mode (16 notes per bar in darkpsy/forest)
- [ ] Add real sidechain — 6dB duck, 5ms attack, full-mix routing
- [ ] Add OTT — upward+downward expander 3-band (genre signature)

### Weeks 7-8 — Composition engine integration tests (14 days)
- [ ] Integration tests: 32-bar render → assert structure (intro/build/drop/break/drop2/outro)
- [ ] Integration tests: motif recurrence (motifIdentity score > 0.5)
- [ ] Integration tests: sidechain audible (-6dB on kick)
- [ ] Integration tests: 16th rolling bass mode produces 16 notes/bar
- [ ] A/B comparison framework: render vs reference track

### Phase 2 Acceptance Gate
- [ ] INTRO state not silent (texture voice audible)
- [ ] DROP state starts with riser/impact
- [ ] sidechain audible (-6dB on kick)
- [ ] 16th rolling bass mode available and working
- [ ] OTT audible
- [ ] 3+ motif transformations called per phrase
- [ ] `enhanced-failure-detector` — 0 FAIL critical

---

## Phase 3: Audio Quality vs Reference (weeks 9-14, 42 days)

**Goal:** Sound like psytrance, objectively measured against reference tracks.

### Weeks 9-10 — Tuning to reference (14 days)
- [ ] Set `targetLufs` to -9 LUFS (club) — pick one target
- [ ] Set `ceiling` to -0.3 dBTP (club) — ffmpeg measures ≤ -0.3
- [ ] Improve kick — sub-sustain 0.4-0.8s (currently 0.25)
- [ ] Improve bass — sustain mode + pluck mode (switchable)
- [ ] Improve lead — 5-layer (fund+oct+air+FM+8kHz harmonic) — verify all 5 audible
- [ ] Improve pad — slow filter sweep + chorus + shimmer
- [ ] Improve acid — bidirectional filter LFO
- [ ] Improve texture — multiple detuned layers + slow morph

### Weeks 11-12 — Reference track comparison (14 days)
- [ ] Add 3 reference tracks to `apps/web/tests/fixtures/references/` (gitignored, not for distribution)
  - Astrix — "Deep Space Walk" (full-on, ~138 BPM, -8 LUFS)
  - Vini Vici — "The Tribe" (progressive, ~134 BPM, -9 LUFS)
  - Infected Mushroom — "Becoming Insane" (full-on, ~145 BPM, -7 LUFS)
- [x] ~~Build `compare-to-reference` CLI~~ RETIRED (Phase 2, D8.4): an early version
      (`benchmarks/compare-to-reference.ts`) fabricated reference constants for these
      named tracks and reported RMS as LUFS / crest as LRA — deleted. Rebuild ONLY
      against real reference audio files with real BS.1770 metering.
- [ ] Compare: LUFS, dBTP, LRA, spectral centroid, crest factor, dynamic range
- [ ] Deviation from reference < 1.5 LU in LUFS = "close"
- [ ] Tune iteratively until render is ±1.5 LU from reference

### Weeks 13-14 — Polish + final tests (14 days)
- [ ] Add analog-modeled reverb (ConvolutionWithWav IR, or Valhalla-style algorithmic)
- [ ] Add tape delay (analog-modeled)
- [ ] 100 snapshot tests (10 seeds × 10 bar-counts)
- [ ] Regression suite: every commit runs snapshot + LUFS + dBTP check

### Phase 3 Acceptance Gate
- [ ] ffmpeg LUFS = -9 ±0.5
- [ ] ffmpeg dBTP ≤ -0.3
- [ ] LRA > 4 LU (currently 1.9 — too compressed)
- [ ] reference comparison: 3 tracks, deviation < 1.5 LU in LUFS
- [ ] producer blind test setup (optional — not a blocker)

---

## Phase 4: VST + Real-time (weeks 15-20, 42 days)

**Goal:** Make the README's claims true — real VST plugin + 13-voice AudioWorklet.

### Weeks 15-16 — AudioWorklet full (14 days)
- [ ] Write `apps/web/public/worklets/psy4-engine.js` with full engine:
  - 13 voices (not 1)
  - ZDF SVF + BLSaw + DecayEnv ports
  - modulation matrix per-voice
  - MIDI routing by pitch range
  - parameter automation via MessagePort
- [ ] Test: all 13 voices audible in real-time
- [ ] Latency < 50ms

### Weeks 17-20 — VST plugin complete (28 days)
- [ ] Write `apps/vst/Source/PluginEditor.cpp` + `.h`
- [ ] Create `apps/vst/Source/DSP/` with:
  - `ZDFSVF.h`
  - `BLSaw.h`
  - `Wavetable.h`
  - `Voices.h`
  - `MasterChain.h`
  - `ModulationMatrix.h`
- [ ] Implement modulation matrix (forward declared, not implemented)
- [ ] Stereo output (currently mono — `channelL[i] = sample; channelR[i] = sample`)
- [ ] Limiter + master chain in C++
- [ ] PluginEditor UI: virtual keyboard, parameter knobs, preset browser
- [ ] cmake build on Mac/Windows/Linux
- [ ] Test: plugin opens in REAPER/Bitwig/Ableton Live

### Phase 4 Acceptance Gate
- [ ] VST plugin builds with cmake (`cmake --build .` succeeds)
- [ ] plugin opens in DAW (REAPER)
- [ ] 13 voices in real-time (AudioWorklet)
- [ ] modulation matrix works in DAW
- [ ] L ≠ R (stereo)
- [ ] LUFS meter in DAW shows -9 ±1

---

## Phase 5: AI Honestly (optional, parallel, requires GPU)

**Only if GPU access available (RTX 3090/4090/A100 24GB+):**

- [ ] Collect dataset: 100+ hours psytrance CC0 (Freesound) + self-produced
- [ ] Stem separation with Demucs → 1000 stems
- [ ] Fix `research/neural/training/train_rave.py`:
  - Add PQMF analysis/synthesis
  - multi-scale STFT loss
  - multi-period + multi-scale discriminator
  - feature matching loss
  - two-stage training
- [ ] Train 7 days on GPU
- [ ] Fix `research/neural/onnx-inference.ts` — missing `await`
- [ ] Connect `?ravestyle=true` real in API
- [ ] Compare to real reference track (not self-reference)

### Phase 5 Acceptance Gate (only if runs)
- [ ] ONNX model exists in `apps/web/public/models/`
- [ ] `?ravestyle=true` compares to real reference
- [ ] "neural" in README is true

**If no GPU:** `research/neural/` stays as "experimental, not integrated". README says "procedural synthesis with spectral analysis".

---

## Tags and Releases

Each phase completion gets a tag:

| Tag | Phase | When |
|-----|-------|------|
| `backup/pre-rebuild-20260819` | pre-Phase 0 | already pushed |
| `backup/pre-cleanup-20260819` | pre-Phase 0 Day 2 | already pushed |
| `v0.4.0-phase-0-complete` | Phase 0 done | end of week 1 |
| `v0.5.0-phase-1-complete` | Phase 1 done | end of week 4 |
| `v0.6.0-phase-2-complete` | Phase 2 done | end of week 8 |
| `v0.7.0-phase-3-complete` | Phase 3 done | end of week 14 |
| `v0.8.0-phase-4-complete` | Phase 4 done | end of week 20 |
| `v0.9.0-phase-5-complete` | Phase 5 done | only if GPU + trained model |

Backup tags before each phase:
- `backup/pre-phase-1-<date>`
- `backup/pre-phase-2-<date>`
- etc.

All tags are permanent — never deleted.
