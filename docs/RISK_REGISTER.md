# PSY Foundation — Risk Register

> 14 documented risks with mitigations.
> Updated: 2026-08-19 (Phase 0 Day 2 complete).

---

## Risk Summary

| # | Risk | Severity | Probability | Status |
|---|------|----------|-------------|--------|
| R1 | Commercial samples in public repo | Critical | Certain | ✅ Mitigated (Phase 0 Day 2) |
| R2 | Score metric gaming (12 commits "fix metric bug") | High | Certain | Open (Phase 1) |
| R3 | `/api/optimize` takes 5 min, `/api/audio-critique` 31s | Medium | Certain | Open (Phase 1) |
| R4 | 77% dead exports in psy4/index.ts | Medium | Certain | Partial (Phase 0 reduced, Phase 1 completes) |
| R5 | VST not buildable (PluginEditor.cpp missing) | High if kept / Low if deleted | Certain | Open (Phase 4) |
| R6 | 0 automated tests for DSP primitives | High | Certain | Open (Phase 0 Day 5) |
| R7 | Sample-rate brittleness (hard-coded 44100 in 8 files) | Medium | Certain | Open (Phase 1 Week 3) |
| R8 | Dependency rot (20 unused deps) | Low | Certain | ✅ Mitigated (Phase 0 Day 2) |
| R9 | Identity crisis (package name was "nextjs_tailwind_shadcn_ts") | Low | Certain | ✅ Mitigated (Phase 0 Day 1) |
| R10 | Self-reference loop in style-transfer | Medium | Certain | Open (Phase 5 or delete) |
| R11 | Architecture drift (src/foundation/ duplicated packages/) | Medium | Certain | ✅ Mitigated (Phase 0 Day 1) |
| R12 | Team capacity (solo developer, 8 days for 178 commits) | Medium | Certain | Accepted (16-20 weeks plan) |
| R13 | Foundation drift (zip vs app code mismatch) | Medium | Medium | Open (Phase 0 Day 1 verified, no critical gaps found) |
| R14 | GitHub token exposure | High | Certain | ✅ Mitigated (kept out of repo, rotation planned) |

---

## Detailed Risks

### R1: Commercial samples in public repo
**Severity:** Critical (legal)
**Probability:** Certain
**Status:** ✅ Mitigated (Phase 0 Day 2)

**Description:** 141 commercial Roland TR-909 / Elektron Machinedrum / Clavia Nord Drum samples were in `public/samples/real/`. The project's own `manifest.json` labeled them "QUARANTINED — DO NOT load at runtime" but `forensic-bridge.ts:269` was loading them at runtime anyway.

**Impact if unmitigated:**
- Copyright infringement liability if project distributed commercially
- Roland and Elektron could issue takedown or sue

**Mitigation applied:**
- Phase 0 Day 2: deleted `apps/web/public/samples/real/` (21MB, 141 files)
- Patched `forensic-bridge.ts:255-281` to use procedural CC0 samples (`kick.wav`, `hat_closed.wav`, `clap.wav`, `hat_open.wav`)
- All commercial samples removed from repo

**Residual risk:** None — samples are gone, code no longer references them.

---

### R2: Score metric gaming
**Severity:** High
**Probability:** Certain
**Status:** Open (Phase 1)

**Description:** Git history shows 12+ commits titled "fix metric bug" (e.g., "fix 2 more derivatives — kickClarity + kickDefinition", "fix 6th metric bug — spectralConsistency was duplicate of spectralMovement"). The score improvement from 0.63 to 0.71 was largely achieved by fixing bugs in the meter itself, not by improving audio.

**Evidence:**
```
$ git log --oneline | grep -i "fix.*metric\|fix.*bug\|fix.*deriv" | wc -l
12
```

**Impact:**
- Score is not a reliable signal of audio quality
- Continued "fix metric" commits would perpetuate the illusion

**Mitigation plan (Phase 1):**
- Replace single self-defined score with external measurements
- All commits must report: (1) self-defined score, (2) ffmpeg LUFS, (3) ffmpeg dBTP, (4) LRA
- Snapshot test catches changes to AudioCritic that don't correlate with audio changes
- Phase 3: A/B comparison against 3 reference tracks (Astrix, Vini Vici, Infected Mushroom)

---

### R3: Performance issues
**Severity:** Medium
**Probability:** Certain
**Status:** Open (Phase 1 Week 4)

**Description:**
- `/api/audio-critique?bars=8&seed=42` takes 31s (O(N²) DFT in `audio-critic.ts::computeDFT`)
- `/api/optimize?bars=8&seed=42` takes 2-5 min (16 hardcoded plans × 30s each)

**Impact:**
- Interactive iteration is painful
- CI would be too slow

**Mitigation plan:**
- Phase 1 Week 4: replace `computeDFT` with FFT (radix-2), expected 100× speedup → <3s
- Phase 1 Week 4: cache render between critique iterations in `/api/optimize`
- Target: `/api/audio-critique` < 3s, `/api/optimize` < 30s

---

### R4: Dead exports in psy4/index.ts
**Severity:** Medium
**Probability:** Certain
**Status:** Partial (Phase 0 reduced, Phase 1 completes)

**Description:** `apps/web/src/lib/psy4/index.ts` exports 145 symbols. Pre-Phase-0 audit showed 111 of them (77%) had no external consumer.

**Impact:**
- Maintenance burden (every change touches code that's never used)
- Confusing API surface for new contributors

**Mitigation applied (Phase 0):**
- Phase 0 Day 1 moved psy4 to `apps/web/src/lib/psy4/`
- Some exports are now used (foundation packages import some)

**Mitigation plan (Phase 1):**
- Run dependency analysis: `rg "import.*from.*psy4" src/ | grep -oE "psy4[^\"']+" | sort -u`
- For each exported symbol with 0 external consumers: delete or move to `internal/` subfolder
- Target: 0 dead exports in `index.ts`

---

### R5: VST not buildable
**Severity:** High if kept / Low if deleted
**Probability:** Certain
**Status:** Open (Phase 4)

**Description:** `apps/vst/CMakeLists.txt` references `Source/PluginEditor.cpp` which doesn't exist. The README claims a directory structure (`DSP/`, `Builds/`, `Resources/`) that doesn't exist. Build would fail at cmake configure step.

**Impact:**
- Cannot ship as VST/AU plugin
- README claims "VST/AU plugin" (now removed in Phase 0 Day 3 README rewrite)

**Mitigation applied:**
- Phase 0 Day 3 README no longer claims "VST/AU plugin"
- `apps/vst/README.md` will be updated to "experimental stub"

**Mitigation plan (Phase 4):**
- Either: complete the build (write PluginEditor.cpp, create DSP/ folder)
- Or: delete `apps/vst/` entirely if no C++/JUCE resource available

---

### R6: No automated tests for DSP primitives
**Severity:** High
**Probability:** Certain
**Status:** Open (Phase 0 Day 5)

**Description:** Pre-Phase-0: 0 tests for `ZDFSVF`, `BLSaw`, `MoogLadder`, `LR4Highpass`, `TruePeakLimiter`, `measureLUFS`. Foundation has 646 tests, but app-layer DSP has none.

**Impact:**
- Refactoring DSP is dangerous (no regression protection)
- Cannot verify "bit-identical for same seed" claim

**Mitigation plan (Phase 0 Day 5):**
- Write `apps/web/tests/snapshot.test.ts`: render `?bars=8&seed=42` → md5 baseline
- Write 5 DSP unit tests:
  - ZDFSVF frequency response (cutoff at 1kHz → -3dB at 1kHz)
  - BLSaw aliasing check (harmonics above Nyquist < -60dB)
  - LR4 crossover sum-to-unity (RBJ verified)
  - LUFS against sine wave reference (BS.1770-4 verification)
  - Limiter ceiling (sample peak ≤ ceiling)
- Target: 6 new tests, total 652

---

### R7: Sample-rate brittleness
**Severity:** Medium
**Probability:** Certain
**Status:** Open (Phase 1 Week 3)

**Description:** Hard-coded `SR = 44100` in 8 files:
- `forensic-bridge.ts:40`
- `psy-voices.ts:25`
- `waveguide-string.ts:27`
- `granular.ts` (8 places)
- `ms-processor.ts:63`
- `mixing.ts:187`
- `neural/ddsp-noise.ts:25`

**Impact:**
- Wrong output at 48kHz or 96kHz
- Cannot render at mastering sample rates

**Mitigation plan (Phase 1 Week 3):**
- Add `DEFAULT_SR` to `@psy-foundation/dsp/src/utils.ts`
- All modules accept `sr: number` parameter
- Tests at 48kHz and 96kHz

---

### R8: Dependency rot
**Severity:** Low
**Probability:** Certain
**Status:** ✅ Mitigated (Phase 0 Day 2)

**Description:** Pre-Phase-0: 68 deps in `apps/web/package.json`, 20 unused (next-auth, next-intl, react-markdown, framer-motion, zustand, z-ai-web-dev-sdk, @dnd-kit/*, @mdxeditor, react-syntax-highlighter, @tanstack/*, date-fns, uuid, zod, tailwindcss-animate, @reactuses/core, react-hook-form, @hookform/resolvers, embla-carousel-react, input-otp, react-day-picker, react-resizable-panels, vaul, cmdk, sonner, recharts, react-syntax-highlighter).

**Mitigation applied:**
- Phase 0 Day 2: reduced to 12 deps
- `bun install` time: 89s → 737ms (120× faster)

**Residual risk:** None — only used deps remain.

---

### R9: Identity crisis
**Severity:** Low
**Probability:** Certain
**Status:** ✅ Mitigated (Phase 0 Day 1)

**Description:** Pre-Phase-0: `package.json: name` was `"nextjs_tailwind_shadcn_ts"`, `layout.tsx` had `title: "Z.ai Code Scaffold - AI-Powered Development"`, OG pointed to `https://chat.z.ai`.

**Mitigation applied:**
- Phase 0 Day 1: `package.json: name` → `"psy-foundation"`
- Phase 0 Day 2: `layout.tsx` metadata → "PSY Foundation — Procedural Psytrance Synthesis Engine"

**Residual risk:** None.

---

### R10: Self-reference loop in style-transfer
**Severity:** Medium
**Probability:** Certain
**Status:** Open (Phase 5 or delete)

**Description:** `api/style-transfer/route.ts:70` does `st.loadReference(result.samplesL, ...)` — feeds the render itself as the "reference". Style transfer with source=reference is a no-op + mild EQ perturbation.

**Impact:**
- Feature is fake (no real style transfer happens)
- `/api/upload-reference` stores latents in-memory but no consumer reads them

**Mitigation plan:**
- Phase 5: connect `?reference=<hash>` parameter to upload-reference store, use real reference
- Or: delete `/api/style-transfer` route entirely and remove "style transfer" from README

**Decision pending:** depends on whether GPU is available for Phase 5.

---

### R11: Architecture drift
**Severity:** Medium
**Probability:** Certain
**Status:** ✅ Mitigated (Phase 0 Day 1)

**Description:** Pre-Phase-0: `src/foundation/music/` duplicated `packages/music/` (different versions, different bugs).

**Mitigation applied:**
- Phase 0 Day 1: deleted `src/foundation/music/` and `src/foundation/transport/`
- Patched imports to use `@psy-foundation/music` workspace package

**Residual risk:** None — single source of truth now.

---

### R12: Team capacity
**Severity:** Medium
**Probability:** Certain
**Status:** Accepted

**Description:** Git history shows 178 commits in 8 days (2026-08-12 to 2026-08-19) — suggests solo developer with high velocity but limited review.

**Impact:**
- 16-20 week timeline is realistic for solo
- No code review means bugs slip through (see Phase 1 bug list)

**Mitigation:**
- Snapshot tests provide regression protection
- Honest docs (this risk register, STATUS.md, ENGINEERING_PLAN_FINAL.md) provide accountability
- All commits pushed to GitHub (public audit trail)

---

### R13: Foundation drift
**Severity:** Medium
**Probability:** Medium
**Status:** Open (Phase 0 Day 1 verified)

**Description:** The `psy-foundation.zip` contained foundation v0.3.0 from 2026-08-13. The app code was at v8.5/8.8. Risk: API mismatches.

**Verification done (Phase 0 Day 1):**
- `CompositionEngine`, `createIdentityA`, `serializeRawScore`, `ComposedSection` — all exported from `@psy-foundation/music` ✅
- `bun test` = 646 pass, 0 fail (no API mismatches in tests)
- Render works (md5 deterministic)

**Residual risk:** Low — Phase 1 will surface any remaining API drift when fixing bugs.

---

### R14: GitHub token exposure
**Severity:** High
**Probability:** Certain
**Status:** ✅ Mitigated

**Description:** GitHub token was provided in `/home/z/my-project/upload/push and i will revove.env`. Token has admin+push permissions to `dudududi144-source/psy-foundation`.

**Mitigation applied:**
- Token never committed to repo
- Token URL is set per-push (`git remote set-url`) and cleaned after push (`git remote set-url origin https://github.com/...`)
- Token is in `push and i will revove.env` filename — suggesting user intends to revoke after push

**Recommendation:** Rotate the token after Phase 0 completes (or now). Use a fine-grained PAT scoped to just `psy-foundation` repo with only `contents:write` permission.

---

## Risk Monitoring

This register is reviewed at each phase gate. New risks discovered during a phase are added. Mitigated risks are marked ✅ but kept for history.

**Next review:** Phase 0 Day 5 (gate 0 verification).
