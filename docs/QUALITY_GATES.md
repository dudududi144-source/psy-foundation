# PSY Foundation — Quality Gates

> What must be true before each phase is "done".
> No phase is complete until its gate passes.

---

## Gate 0 (Phase 0 final)

### Repository hygiene
- [ ] `git ls-files | wc -l` < 500 (currently 341 after Day 2)
- [ ] `du -sh .` (excl .git + node_modules) < 35MB (currently 88MB — Phase 1 will reduce)
- [ ] `bun install` < 30s (currently 737ms ✅)
- [ ] 0 commercial samples in `apps/web/public/samples/` (✅ after Day 2)

### Documentation
- [ ] README does NOT contain: "AI", "neural", "commercial-grade", "VST/AU" (until Phase 4-5)
- [ ] README contains: "in development", "not commercial-ready"
- [ ] All claims in README link to verified measurement or file:line

### Tests
- [ ] `bun test` — 652 tests pass (646 foundation + 6 new)
- [ ] `tsc --noEmit` — 0 errors in all packages
- [ ] `tsc --noEmit` in `apps/web/` passes WITHOUT `ignoreBuildErrors`
- [ ] `next.config: typescript.ignoreBuildErrors` removed

### Snapshot tests (Phase 0 Day 5)
- [ ] `apps/web/tests/snapshot.test.ts` exists
- [ ] Render `?bars=8&seed=42` → md5 baseline saved
- [ ] LUFS measurement on baseline saved
- [ ] 5 DSP unit tests:
  - [ ] ZDFSVF frequency response (cutoff at 1kHz → -3dB at 1kHz)
  - [ ] BLSaw aliasing check (harmonics above Nyquist < -60dB)
  - [ ] LR4 crossover sum-to-unity (RBJ verified)
  - [ ] LUFS against sine wave reference (BS.1770-4)
  - [ ] Limiter ceiling (sample peak ≤ ceiling)

---

## Gate 1 (Phase 1 final)

### DSP bugs fixed
- [ ] `StereoWidener.process` at width=1 returns L,R unchanged (unit test)
- [ ] `MasterChain` no longer hard-clips (use TruePeakLimiter only)
- [ ] `TruePeakLimiter` applies gain at 4× rate (not 1×)
- [ ] `TruePeakLimiter` uses FIR 48-tap (not Catmull-Rom)
- [ ] `TruePeakLimiter` lookahead is O(N) (monotonic-queue, not O(N·D))
- [ ] `OversampledSaturation` uses FIR 4-tap (not linear interp)
- [ ] `BLTriangle` uses integrated cubic polyBLEP (not saw residual)
- [ ] `MoogLadder` either real Huovilainen OR docstring corrected to "Stilson-Smith derived"
- [ ] `SchroederReverb` has separate L/R comb banks (or replaced with CompactReverb)

### Sample-rate parameterization
- [ ] 0 hard-coded `SR = 44100` outside `foundation/dsp/src/utils.ts::DEFAULT_SR`
- [ ] All modules accept `sr: number` parameter
- [ ] Tests pass at 48kHz
- [ ] Tests pass at 96kHz

### Learning kernel bugs fixed
- [ ] `learning-kernel.ts:622` precedence bug fixed (weights sum to 1 after observe)
- [ ] `learning-kernel.ts:172` interval→degree lookup table correct per scale
- [ ] `learning-kernel.ts:466-517` reward loop reinforces only contributing degrees

### Audio-critic fixes
- [ ] `computeDFT` replaced with FFT (O(N log N) instead of O(N²))
- [ ] `computeMotifIdentity` uses `motifIdentity` from `motif-v2.ts`
- [ ] `computeKickBassLock` uses spectral separation + onset alignment

### API fixes
- [ ] `/api/arrangement` respects `?bars=` parameter (targetBars ±2)
- [ ] `/api/audio-critique?bars=8&seed=42` < 3s (currently 31s)

### Performance verification
- [ ] ffmpeg dBTP ≤ limiter ceiling (currently +0.2 > 0 = bug)
- [ ] ffmpeg LUFS ±0.5 from `targetLufs` setting
- [ ] cross-correlation L/R of reverb < 0.5

### Tests
- [ ] `bun test` — 652+ tests pass (with new Phase 1 tests added)
- [ ] `tsc --noEmit` — 0 errors
- [ ] Snapshot hash stable (after fixes — update baseline)
- [ ] New unit tests added for each DSP fix (10+ new tests)

---

## Gate 2 (Phase 2 final)

### Composition loops closed
- [ ] SoundDNA `synthRecipes` from `ComposedBar` consumed by audio-renderer
- [ ] 3+ motif transformations called per phrase (invert, retrograde, augment)
- [ ] All 25 preset fields mapped to RenderConfig (or removed from Preset type)
- [ ] Automation values read per-sample in render loop
- [ ] Wavetable `process()` called per-sample for Lead voices
- [ ] Granular spawn loop active for Texture voices
- [ ] Waveguide `trigger()` active for Bass voices

### Psytrance-specific features
- [ ] Texture voice in audio-renderer (INTRO state not silent)
- [ ] Transition FX (riser/impact/sweep) at section boundaries
- [ ] `harmonic-plan.ts` imports PSYTRANCE_PROGRESSIONS from `psy4/harmony.ts`
- [ ] 16th rolling bass mode available (16 notes per bar)
- [ ] Real sidechain — 6dB duck, 5ms attack, full-mix routing
- [ ] OTT (upward+downward expander 3-band) — genre signature

### Integration tests
- [ ] 32-bar render → assert structure (intro/build/drop/break/drop2/outro)
- [ ] Motif recurrence (motifIdentity score > 0.5)
- [ ] Sidechain audible (-6dB on kick)
- [ ] 16th rolling bass mode produces 16 notes/bar
- [ ] A/B comparison framework: render vs reference

### Acceptance
- [ ] INTRO state not silent (texture voice audible)
- [ ] DROP state starts with riser/impact
- [ ] sidechain audible (-6dB on kick)
- [ ] 16th rolling bass mode available and working
- [ ] OTT audible
- [ ] 3+ motif transformations called per phrase
- [ ] `enhanced-failure-detector` — 0 FAIL critical

---

## Gate 3 (Phase 3 final)

### Loudness targets
- [ ] `targetLufs` = -9 LUFS (club) — picked one target
- [ ] `ceiling` = -0.3 dBTP (club)
- [ ] ffmpeg LUFS = -9 ±0.5
- [ ] ffmpeg dBTP ≤ -0.3
- [ ] LRA > 4 LU (currently 1.9 — too compressed)

### Voice quality
- [ ] Kick sub-sustain 0.4-0.8s (currently 0.25)
- [ ] Bass has sustain mode + pluck mode (switchable)
- [ ] Lead 5-layer: fund+octave+air+FM+8kHz harmonic — all 5 audible
- [ ] Pad: slow filter sweep + chorus + shimmer
- [ ] Acid: bidirectional filter LFO
- [ ] Texture: multiple detuned layers + slow morph

### Reference comparison
- [ ] 3 reference tracks in `apps/web/tests/fixtures/references/` (gitignored)
- [x] ~~`compare-to-reference` CLI: `bun run benchmarks/compare-to-reference.ts`~~ RETIRED (Phase 2, D8.4):
      the benchmark compared renders against FABRICATED "reference" constants
      attributed to named commercial tracks (RMS reported as LUFS, crest as
      LRA). Deleted — a comparison needs real licensed references, not invented numbers.
- [ ] Compare: LUFS, dBTP, LRA, spectral centroid, crest factor, dynamic range
- [ ] Deviation from reference < 1.5 LU in LUFS = "close"
- [ ] Render is ±1.5 LU from all 3 references

### Polish
- [ ] Analog-modeled reverb (ConvolutionWithWav IR, or Valhalla-style algorithmic)
- [ ] Tape delay (analog-modeled)
- [ ] 100 snapshot tests (10 seeds × 10 bar-counts)
- [ ] Regression suite: every commit runs snapshot + LUFS + dBTP check

### Acceptance
- [ ] ffmpeg LUFS = -9 ±0.5
- [ ] ffmpeg dBTP ≤ -0.3
- [ ] LRA > 4 LU
- [ ] reference comparison: 3 tracks, deviation < 1.5 LU
- [ ] 100 snapshot tests passing

---

## Gate 4 (Phase 4 final)

### AudioWorklet (real-time playback)
- [ ] `apps/web/public/worklets/psy4-engine.js` contains 13 voices (not 1)
- [ ] All 13 voices audible in real-time
- [ ] Latency < 50ms
- [ ] modulation matrix per-voice
- [ ] MIDI routing by pitch range
- [ ] parameter automation via MessagePort

### VST plugin
- [ ] `apps/vst/Source/PluginEditor.cpp` + `.h` written
- [ ] `apps/vst/Source/DSP/` folder with: ZDFSVF.h, BLSaw.h, Wavetable.h, Voices.h, MasterChain.h, ModulationMatrix.h
- [ ] modulation matrix implemented (currently forward declared, not implemented)
- [ ] Stereo output (L ≠ R, not mono `channelL[i] = channelR[i] = sample`)
- [ ] Limiter + master chain in C++
- [ ] PluginEditor UI: virtual keyboard, parameter knobs, preset browser
- [ ] cmake build succeeds on Linux
- [ ] cmake build succeeds on Mac
- [ ] cmake build succeeds on Windows
- [ ] Plugin opens in REAPER (verified)
- [ ] Plugin opens in Bitwig (verified)
- [ ] Plugin opens in Ableton Live (verified)

### Acceptance
- [ ] VST plugin builds with cmake
- [ ] plugin opens in DAW (REAPER minimum)
- [ ] 13 voices in real-time (AudioWorklet)
- [ ] modulation matrix works in DAW
- [ ] L ≠ R (stereo)
- [ ] LUFS meter in DAW shows -9 ±1

---

## Gate 5 (Phase 5, optional — only if GPU)

### Dataset
- [ ] 100+ hours psytrance CC0 (Freesound + self-produced)
- [ ] Stem separation with Demucs → 1000 stems
- [ ] All stems have license metadata

### Training
- [ ] `research/neural/training/train_rave.py` fixed:
  - PQMF analysis/synthesis added
  - multi-scale STFT loss added
  - multi-period + multi-scale discriminator added
  - feature matching loss added
  - two-stage training added
- [ ] Training completed (7 days on GPU)
- [ ] Loss converges (verified)
- [ ] Model exported to ONNX

### Inference
- [ ] `research/neural/onnx-inference.ts` — missing `await` fixed
- [ ] `?ravestyle=true` endpoint in API (real, not self-reference)
- [ ] Style transfer compares to real reference track (uploaded WAV)

### Acceptance
- [ ] ONNX model exists in `apps/web/public/models/`
- [ ] `?ravestyle=true` compares to real reference
- [ ] "neural" in README is true
- [ ] A/B test: render with vs without RAVE — audible difference

**If no GPU:** `research/neural/` stays as "experimental, not integrated". README says "procedural synthesis with spectral analysis". Gate 5 is skipped, project ends at Gate 4.

---

## Forbidden Claims (before each gate)

| Claim | Allowed only after |
|-------|---------------------|
| "Commercial-grade DSP" | Gate 3 |
| "AI synthesis platform" | Gate 5 (or never) |
| "Neural RAVE style transfer" | Gate 5 |
| "VST/AU plugin" | Gate 4 |
| "Real-time playback with N voices" | Gate 4 (with real N) |
| "11 factory presets" | Gate 2 + UI counter shows 11 |
| "0 failures" | never — always "N failures under honest thresholds" |
| "Score X" | never as single number — always "X on self-defined metric, Y on external LUFS" |
| "Huovilainen ZDF" | Gate 1 (after fix or docstring update) |
| "Karplus-Strong" | Gate 1 (after decay fix) |
| "ITU-R BS.1770-4" | Gate 1 (after snapshot test vs reference) |
| "True-peak limiter" | Gate 1 (after application rate fix) |
| "Psytrance" | Gate 3 (reference comparison passes) |
