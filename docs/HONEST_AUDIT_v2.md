# PSY Foundation — Honest Audit & New Roadmap

> **Date: 2026-08-20 (post-Phase 4 audit)**
> **Method: 2 parallel audit agents verified every claim against actual code**
> **Result: Commercial readiness score 3.0/10**

---

## Executive Summary

After 5 phases (0-4) of development, the project claims v0.8.0 with 712 tests,
13-voice AudioWorklet, buildable VST, and club loudness. An independent audit
reveals that while the core DSP engine and offline renderer are legitimate,
several major claims are false or overstated.

**Honest score: 3.0/10 commercial readiness.**

---

## Claims Verification

### TRUE ✅ (7 claims)
1. 712 tests pass (14 honest skips)
2. ffmpeg -6.5 LUFS (verified bit-identical render)
3. ffmpeg -0.3 dBTP (safely below 0 dBFS)
4. INTRO not silent (pad from bar 0, mean -12dB)
5. 11 DSP bugs fixed (5/5 spot-checked verified)
6. Full-mix sidechain (duck bass+music, not just bass)
7. Snapshot test bit-identical (md5 matches)

### FALSE ❌ (3 claims)
1. **"VST buildable"** — does NOT compile (nested-class mismatch, private access, dead DSP headers)
2. **"v0.8.0"** — no file says 0.8.0 (root says "0.4.0-phase-0", CMake says "8.9.0")
3. **"OTT implemented"** — works but has 4 implementation bugs (broken stereo envelope, half-strength upward, unconditional makeup, noise gate)

### OVERSTATED ⚠️ (4 claims)
1. **"13-voice worklet"** — count is 13 but BLSquare is mathematically broken (PolyBLEP at 1 of 2 discontinuities)
2. **"8 progressions"** — defined but only 1 used (hardcoded 'psy-dominant')
3. **"Club loudness -9"** — target is -9 but output is -6.5 (2.5 LU off, 50% LUFS hack)
4. **"Stereo output"** — Haas delay 15ms = fake stereo (destroys mono compat)

---

## 5 Architectural Problems

### 1. Two Divergent Audio Engines
- Offline renderer: 1401 lines, full master chain (multiband → OTT → glue → sat → M/S → limiter)
- Real-time worklet: 340 lines, NO master chain (just `sample *= 0.3; tanh(sample)`)
- They will NEVER sound alike. The worklet is a demo toy.

### 2. VST is a Facade
- PluginProcessor.h forward-declares ModulationMatrix, MasterChain, Wavetable, KickVoice — NONE exist
- Mono output (`channelL = channelR = sample`)
- Dead parameters (macros, stereo-width never read)
- Does not compile (3 categories of errors)

### 3. Tests Lock In Bugs
- "REGRESSION GUARD" tests assert that broken behavior is STILL broken
- If anyone fixes ZDFSVF smoothing or BLSaw aliasing, tests will FAIL
- The test suite actively prevents improvement

### 4. Composition Engine Doesn't Use Its Knowledge
- PSYTRANCE_PROGRESSIONS: 8 defined, 1 used (hardcoded)
- rollingBass16th: defined, never called by renderer
- SoundDNA: computed, never consumed by audio-renderer
- The engine is genre-blind despite having genre knowledge

### 5. Performance Wrong for Interactivity
- /api/audio-critique: 13s (target was 3s — 4× off)
- /api/optimize: 5 min (nobody waits 5 min)
- No path to <1s without WASM/Rust rewrite

---

## Metrics Reality Check

| Metric | Claimed | Actual |
|--------|---------|--------|
| Tests | 712 pass | ✅ 712 (but ~30% "doesn't crash", ~10% lock bugs) |
| VST buildable | Yes | ❌ No (compile errors) |
| VST voices | 13 | ❌ 12 (no AcidVoice in C++) |
| VST stereo | Yes | ❌ Mono |
| OTT | Implemented | ⚠️ 4 bugs |
| Progressions | 8 | ❌ 1 used |
| LUFS on-target | -9 | ❌ -6.5 (2.5 off) |
| Lint errors | 0 | ❌ 178 |
| Type errors | 0 | ❌ 12 (1 real bug) |
| Internal LUFS | Accurate | ❌ 2 LU off from ffmpeg |

---

## Commercial Readiness Scorecard

| Aspect | Score | Comment |
|--------|-------|---------|
| Audio quality | 4/10 | 38Hz kick (below PA), 0.08s bass (too short) |
| Master chain | 3/10 | Wrong order, OTT on master, 50% LUFS hack |
| Composition | 3/10 | 1 of 8 progressions, engine genre-blind |
| Real-time | 4/10 | Worklet exists but no master chain, fake stereo |
| VST | 2/10 | Mono, dead params, doesn't compile |
| Tests | 4/10 | 712 pass but 30% trivial, 10% lock bugs |
| Performance | 3/10 | 13s critique, 5min optimize |
| Docs | 6/10 | More honest than average, still misleading |
| Features | 1/10 | 0 of 15 needed features |
| License | 3/10 | CC0 asserted, not provenanced |
| **TOTAL** | **3.0/10** | |

---

## New Roadmap (Phases A-F)

### Phase A: Fix the Lies (week 1)
- Delete "VST buildable" from README OR fix compile errors
- Delete dead DSP/ headers OR include them
- Fix BLSquare PolyBLEP (2 discontinuities)
- Fix OTT stereo envelope (per-channel followers)
- Delete REGRESSION GUARD tests OR convert to xfail
- Fix 178 lint errors
- Fix bass-vocabulary.ts:555 type error
- Update version to 0.8.0 everywhere

### Phase B: Unify Audio Engines (weeks 2-3)
- Port master chain to worklet (multiband + OTT + sidechain + limiter in JS)
- Delete Haas fake stereo, replace with per-voice pan + M/S widener
- Add per-voice ChannelFX in worklet
- Verify worklet and offline produce same output (md5 comparison)

### Phase C: Wire Composition Engine (week 4)
- Connect PSYTRANCE_PROGRESSIONS to composition-engine
- Delete hardcoded 'psy-dominant', add ?progression= API param
- Wire rollingBass16th to renderer (?bassMode=16th)
- Add style selector (?style=full-on|darkpsy|progressive)

### Phase D: Audio Quality (weeks 5-6)
- KICK fundamental: 38→50Hz
- BASS pluckDecay: 0.08→0.12s
- LEAD cutoff: 5200→9000Hz
- BUS_GAINS.music: 2.5→1.2
- Fix master chain order: HP → Glue → Sat → M/S → Multiband → Limiter
- Fix LUFS correction: 50%→100%
- Producer A/B blind test

### Phase E: Real VST or Delete (weeks 7-10)
- Fix compile errors (nested-class, private access)
- Add AcidVoice in C++ (13 voices)
- Add stereo output in C++
- Add modulation matrix
- Add master chain
- OR: delete apps/vst/ and remove "VST" from README

### Phase F: Commercial Features (weeks 11-20)
- MIDI learn
- Preset browser (save/load)
- Real-time spectrum in UI
- Per-voice pan
- Automation curves
- Filter visualization
- Stem export from UI

---

## What This Project Actually Is

A **portfolio project** with:
- Real DSP code (ZDF SVF, FFT, LUFS, limiter)
- Real test suite (712 tests, even if some are weak)
- Real determinism (bit-identical renders)
- Real honesty (more than typical AI projects)

But NOT:
- A commercial product (0 of 15 needed features)
- A VST plugin (doesn't compile)
- A real-time synth (worklet has no master chain)
- A genre-aware composer (1 of 8 progressions used)

**Honest assessment: this is a learning project with potential, not a product.**
