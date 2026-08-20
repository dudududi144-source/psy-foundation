# PSY Foundation — Engineering Roadmap v2 (Comprehensive)

> **Created: 2026-08-20**
> **Goal: Transform from 3/10 portfolio to verified, proven, end-to-end product**
> **Method: Fix every lie → Unify engines → Wire composition → Audio quality → Real VST → Commercial features → E2E verification**

---

## Current State (Honest)

| Metric | Value |
|--------|-------|
| Tests | 712 pass (but ~30% trivial, ~10% lock bugs) |
| LUFS | -6.5 (target -9, off by 2.5) |
| dBTP | -0.3 ✅ |
| VST | Does NOT compile |
| Worklet | 13 voices but BLSquare broken, no master chain |
| Progressions | 1 of 8 used |
| Stereo | Fake (Haas only) |
| Lint errors | 178 |
| Type errors | 12 (1 real bug) |
| Commercial features | 0 of 15 |

---

## Phase A: Fix Every Lie (Week 1, 7 days)

### A1: VST — Fix or Delete
**Decision: FIX (the C++ DSP is real, just structurally broken)**

| Task | File | Fix |
|------|------|-----|
| Fix nested-class vs namespace-class mismatch | PluginProcessor.h:22-30, 91-93 | Move voice classes to namespace scope, remove nested forward declarations |
| Fix private member access from editor | PluginProcessor.h:103 | Make `parameters` public or add getter |
| Include DSP/ headers in PluginProcessor.cpp | PluginProcessor.cpp:10 | Add `#include "DSP/ZDFSVF.h"` etc., remove local class definitions |
| Remove stale forward declarations | PluginProcessor.h:23-30 | Delete KickVoice, Wavetable, MasterChain, ModulationMatrix forward decls |
| **Acceptance** | | `cmake --build .` succeeds (test with syntax check if cmake unavailable) |

### A2: BLSquare — Fix PolyBLEP
| Task | File | Fix |
|------|------|-----|
| Add PolyBLEP at phase=0.5 transition | psy4-processor.js:194-216 | Add second blep correction for the square wave's mid-cycle discontinuity |
| Remove dead code (blep2, saw, empty if) | psy4-processor.js:201-212 | Clean up |
| **Acceptance** | | BLSquare aliasing < -30dB (measured via DFT) |

### A3: OTT — Fix 4 Bugs
| Task | File | Fix |
|------|------|-----|
| Fix stereo envelope (shared state) | ott.ts:155-189 | Use 6 BandExpander instances (2 per band × 3 bands) |
| Fix upward expansion slope | ott.ts:95 | Remove `* 0.5` — full strength |
| Fix unconditional makeup | ott.ts:162 | Apply makeup only to wet signal |
| Remove noise gate | ott.ts:92 | Process all signals above 0 |
| **Acceptance** | | OTT produces symmetric up/down expansion, L=R for mono input |

### A4: Tests — Remove Bug-Locking
| Task | File | Fix |
|------|------|-----|
| Fix ZDFSVF 100Hz REGRESSION GUARD | dsp-primitives.test.ts:68-90 | Change to expect ratioDb > -3 (after fixing ZDFSVF smoothing) |
| Fix BLSaw aliasing REGRESSION GUARD | dsp-primitives.test.ts:109-132 | Change to expect aliasDb < -30 (after fixing PolyBLEP) |
| Fix ZDFSVF smoothing bug | forensic/dsp.ts:119-124 | Fix one-pole coefficient (was τ≈0.67s, should be ~10ms) |
| **Acceptance** | | All REGRESSION GUARDs converted to real assertions |

### A5: Code Quality
| Task | File | Fix |
|------|------|-----|
| Fix 178 lint errors | page.tsx, route.ts files | Add `type="button"`, fix a11y, organize imports |
| Fix bass-vocabulary.ts:555 type error | bass-vocabulary.ts:555 | Add 'ROLL' to BassFunction type |
| Fix version numbers | package.json files | Set all to "0.8.0" |
| **Acceptance** | | `bun run lint` = 0 errors, `tsc --noEmit` = 0 real errors |

### A6: Delete False Claims from README
| Task | File | Fix |
|------|------|-----|
| Remove "VST buildable" until verified | README.md | Change to "VST in development" |
| Remove "13-voice" until BLSquare fixed | README.md | Change to "13 voices (AcidVoice BLSquare being fixed)" |
| Remove "8 progressions" until wired | README.md | Change to "8 progressions defined, 1 wired" |
| Fix "stereo output" claim | README.md | Change to "Haas delay (to be replaced with true stereo)" |
| **Acceptance** | | README contains 0 false claims |

---

## Phase B: Unify Audio Engines (Weeks 2-3, 14 days)

### B1: Port Master Chain to Worklet
| Task | Detail |
|------|--------|
| Port MultibandCompressor to JS | 3-band LR4 crossover + downward compressor |
| Port OTT to JS | 3-band upward+downward expander |
| Port sidechain to worklet | duckEnv on bass+music buses |
| Port TruePeakLimiter to JS | 4× oversampled detection + ISP-safe clip |
| Port StereoWidener to JS | M/S with mono-below-120Hz |
| **Acceptance** | Worklet output matches offline render within ±1dB |

### B2: Replace Fake Stereo
| Task | Detail |
|------|--------|
| Delete Haas delay | Remove haasBuffer, haasIdx |
| Add per-voice pan | Each voice gets pan parameter, equal-power crossfade |
| Add M/S widener in worklet | StereoWidener.processBuffer at end of chain |
| **Acceptance** | L ≠ R for stereo input, L ≈ R for mono input, mono compat > 0.7 |

### B3: Add Per-Voice ChannelFX
| Task | Detail |
|------|--------|
| Port ChannelFX to JS | EQ + delay + reverb + pan + width per voice |
| Wire ChannelFX per voice type | Lead → ChannelFX(lead), Bass → ChannelFX(bass), etc. |
| **Acceptance** | Each voice has independent FX chain |

---

## Phase C: Wire Composition Engine (Week 4, 7 days)

### C1: Connect PSYTRANCE_PROGRESSIONS
| Task | Detail |
|------|--------|
| Add progressionName to composition-engine | Pass through from context to buildHarmonicPlan |
| Delete hardcoded 'psy-dominant' in API routes | Add `?progression=` parameter |
| Wire style-based progression selection | full-on → psy-dominant, darkpsy → dark, prog → uplifting |
| **Acceptance** | All 8 progressions selectable via API |

### C2: Wire rollingBass16th
| Task | Detail |
|------|--------|
| Add bassMode to render config | 'standard' | '16th' | 'alternating' |
| Wire to bass vocabulary selector | Switch based on style |
| **Acceptance** | `?bassMode=16th` produces 16 notes/bar |

### C3: Wire SoundDNA → Renderer
| Task | Detail |
|------|--------|
| Connect synthRecipes from ComposedBar to renderer | Pass per-bar recipes to voice config |
| **Acceptance** | SoundDNA affects voice parameters per bar |

---

## Phase D: Audio Quality (Weeks 5-6, 14 days)

### D1: Fix Voice Specs
| Voice | Param | Old | New | Reason |
|-------|-------|-----|-----|--------|
| Kick | fundamental | 38Hz | 50Hz | Below PA sub cutoff |
| Kick | subDecay | 0.45s | 0.7s | Full-on needs longer |
| Bass | pluckDecay | 0.08s | 0.12s | 16th note overlap |
| Lead | cutoff | 5200Hz | 9000Hz | Too dark |
| Pad | chorusDepth | 0.7 | 0.4 | Too smeared |
| Bus | music gain | 2.5 | 1.2 | +8dB clip risk |

### D2: Fix Master Chain Order
```
OLD: Multiband → OTT → Glue → Sat → M/S → LUFS → Limiter
NEW: HP → Glue → Sat → M/S → Multiband → OTT → Limiter → measure LUFS
```
LUFS is measurement, not processing stage. OTT belongs after multiband.

### D3: Fix LUFS Targeting
| Task | Detail |
|------|--------|
| Remove 50% LUFS correction hack | forensic-bridge.ts:1315 |
| Use 100% correction | targetLufs = -9, output = -9 ±0.5 |
| Fix internal LUFS meter | 2 LU off from ffmpeg — fix K-weighting or gating |
| **Acceptance** | ffmpeg measures -9 ±0.5 LUFS |

### D4: Producer Validation
| Task | Detail |
|------|--------|
| Render 3 reference-style tracks | Astrix-style (138 BPM), Vini Vici-style (134), IM-style (145) |
| Compare LUFS/dBTP/LRA/spectral centroid | Within ±1.5 LU of reference |
| **Acceptance** | All 3 within ±1.5 LU of targets |

---

## Phase E: Real VST or Delete (Weeks 7-10, 28 days)

### E1: Fix VST Compile (if proceeding)
| Task | Detail |
|------|--------|
| Fix all compile errors from Phase A1 | Verify with cmake |
| Add AcidVoice in C++ | Port from JS worklet |
| Add stereo output | Per-voice pan + M/S |
| Add modulation matrix | Wire macros to voice params |
| Add master chain | Port multiband + OTT + limiter to C++ |
| **Acceptance** | VST opens in REAPER, 13 voices, stereo, master chain |

### E2: OR Delete VST
| Task | Detail |
|------|--------|
| Delete apps/vst/ | Remove entire directory |
| Remove all VST claims from README | "No VST plugin — web-only" |
| Update docs | Remove VST references |
| **Acceptance** | No false VST claims remain |

**Decision criteria: if E1 takes >2 weeks → E2 (delete)**

---

## Phase F: Commercial Features (Weeks 11-20, 10 weeks)

### F1: Essential (must-have for any release)
| Feature | Priority | Effort |
|---------|----------|--------|
| MIDI learn | High | 3 days |
| Preset browser (save/load JSON) | High | 2 days |
| Real-time spectrum analyzer | High | 2 days |
| Per-voice pan | High | 1 day |
| Automation curves (basic) | Medium | 3 days |
| Filter visualization | Medium | 2 days |

### F2: Important (competitive parity)
| Feature | Priority | Effort |
|---------|----------|--------|
| Stem export from UI | Medium | 1 day |
| Multi-format export (WAV/AIFF/FLAC) | Medium | 1 day |
| Undo/redo | Medium | 2 days |
| MIDI file export | Medium | 2 days |
| Per-voice effects (delay/reverb) | Medium | 3 days |

### F3: Advanced (differentiators)
| Feature | Priority | Effort |
|---------|----------|--------|
| MPE support | Low | 5 days |
| AAX/CLAP formats | Low | 5 days |
| Cloud preset sharing | Low | 3 days |
| Collaborative editing | Low | 10 days |

---

## Phase G: End-to-End Verification (Week 21, 7 days)

### G1: Automated E2E Tests
| Test | Method |
|------|--------|
| Render → Critique → Verify metrics | Automated pipeline |
| Render → ffmpeg → Verify LUFS/dBTP | CI check |
| Worklet → Record → Verify matches offline | Audio comparison |
| VST → Build → Load in DAW → Play | Manual + automated |
| 100 snapshot tests (10 seeds × 10 bar counts) | Regression suite |

### G2: Performance Benchmarks
| Metric | Target |
|--------|--------|
| /api/render-forensic (8 bars) | < 5s |
| /api/audio-critique (8 bars) | < 3s |
| /api/optimize (8 bars) | < 30s |
| Worklet latency | < 50ms |
| bun test (all) | < 60s |

### G3: Documentation Final
| Doc | Content |
|-----|---------|
| README.md | All claims verified true |
| docs/STATUS.md | Updated to final state |
| docs/ARCHITECTURE.md | Updated with unified engine |
| docs/ROADMAP.md | This file, marked complete |
| docs/VERIFICATION.md | E2E test results |

---

## Timeline Summary

| Phase | Weeks | Days | Focus |
|-------|-------|------|-------|
| A | 1 | 7 | Fix every lie |
| B | 2-3 | 14 | Unify audio engines |
| C | 4 | 7 | Wire composition |
| D | 5-6 | 14 | Audio quality |
| E | 7-10 | 28 | Real VST or delete |
| F | 11-20 | 70 | Commercial features |
| G | 21 | 7 | E2E verification |
| **Total** | **21** | **147** | **Complete product** |

---

## Acceptance Criteria for "Done"

### Must be true for product release:
- [ ] 0 false claims in README
- [ ] 0 lint errors
- [ ] 0 type errors
- [ ] VST compiles AND opens in DAW (or deleted entirely)
- [ ] Worklet has full master chain
- [ ] Worklet output matches offline within ±1dB
- [ ] All 8 progressions selectable
- [ ] rollingBass16th wired
- [ ] LUFS = -9 ±0.5 (ffmpeg verified)
- [ ] dBTP ≤ -0.5 (ffmpeg verified)
- [ ] LRA > 4 LU
- [ ] 100 snapshot tests pass
- [ ] /api/audio-critique < 3s
- [ ] MIDI learn works
- [ ] Preset browser works
- [ ] Real-time spectrum works
- [ ] Producer A/B blind test: 50%+ identify "psytrance"

### Commercial readiness target: 7.0/10
(Up from current 3.0/10)
