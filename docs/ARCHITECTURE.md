# PSY Foundation — Architecture

> Layered architecture for the PSY device family.
> Rule: Layer N may only import from Layer N-1 and below.

---

## Layer Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 5: PRESENTATION                                              │
│  apps/web (Next.js)  ·  apps/vst (JUCE C++ stub)  ·  CLI (Bun)     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 4: APPLICATION SERVICES                                       │
│  RenderService · CritiqueService · OptimizeService · ExportService │
│  (HTTP API + CLI consumers, NO business logic)                    │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 3: DOMAIN — PSY4 RENDER ENGINE                               │
│  forensic-bridge · psy-voices · channel-fx · master chain          │
│  · multiband · ms-processor · loudness · limiter · modulation-matrix│
│  · audio-critic · auto-fixer · arrangement · presets · automation │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 2: DOMAIN — COMPOSITION (in @psy-foundation/music)           │
│  composition-engine · motif-v2 · transformation · phrase-*        │
│  · harmonic-plan · bass-vocabulary · groove-plan · style-grammar  │
│  · sound-dna · enhanced-failure-detector · learning-kernel         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│ LAYER 1: FOUNDATION (10 packages, 646 tests)                       │
│  dsp · music · transport · protocol · analysis · learning         │
│  · material · scheduler · device-sdk · fixtures                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Foundation

10 packages in `packages/`. All have tests. All export TypeScript types.

| Package | Tests | Purpose | Key Exports |
|---------|-------|---------|-------------|
| `@psy-foundation/dsp` | 39 | Browser DSP toolbox | `PolyBlepOsc`, `MoogLadder`, `Adsr`, `Delay`, `SchroederReverb`, `LufsMeter`, `VoicePool` |
| `@psy-foundation/music` | 43 | Music theory + composition | `CompositionEngine`, `createIdentityA`, `serializeRawScore`, scales, chords, motif, bass, rhythm |
| `@psy-foundation/transport` | 12 | Beat/bar/phase/bpm | `MusicalTransport`, `BeatEstimator`, `PhaseCorrector`, `ConfidenceTracker` |
| `@psy-foundation/protocol` | 8 | Transport-agnostic events | `MusicalEvent`, `Channel`, `InMemoryChannel` |
| `@psy-foundation/analysis` | 26 | Audio features | `onset`, `beat`, `tempo`, `pitch`, `chroma`, spectral features |
| `@psy-foundation/learning` | 32 | Contextual bandit | `CONTEXT+ACTION+OUTCOME+REWARD`, `DO NOTHING` legal |
| `@psy-foundation/material` | 23 | Material library | 9 material kinds, `MaterialLibrary` |
| `@psy-foundation/scheduler` | 18 | Plan → events | `MusicalPlan → ScheduledEvent[]` (deterministic pure function) |
| `@psy-foundation/device-sdk` | 12 | Device interface | `PsyDevice`, `DeviceHost`, `ReferenceDevice` |
| `@psy-foundation/fixtures` | 10 | Synthetic radio fixtures | 14 deterministic, seeded fixtures |

**Dependency rule:** Layer 1 packages may only import from each other. They may NOT import from `apps/` or any layer above.

### Research apps (also Layer 1 consumers, separate from web app)
- `apps/benchmark-lab` — analyze audio → BPM, beat grid, phase, key, energy, features, sections
- `apps/consumer-contract` — contract tests that document gaps between foundation and consumer expectations
- `apps/differential-lab` — A/B comparison lab
- `apps/reference-lab` — audio reference analysis
- `apps/sync-lab` — multi-device sync simulation
- `apps/transport-runtime-lab` — runtime transport tests

---

## Layer 2: Composition (inside `@psy-foundation/music`)

The composition engine is the heart of the music-theory layer.

### Modules
- `composition-engine.ts` — main composer (LOCKED invariant: bass always places ROOT on step 0)
- `motif-v2.ts` — motif with `motifIdentity` (transposition-invariant fingerprint)
- `transformation.ts` — invert, retrograde, augment, contourMutation, intervalSubstitution, callResponse
- `phrase-planner.ts`, `phrase-arc.ts`, `phrase-development.ts`, `phrase-material.ts`
- `section-planner.ts`, `voice-plans.ts`
- `harmonic-plan.ts` — chord progressions (Phase 2: import PSYTRANCE_PROGRESSIONS)
- `bass-vocabulary.ts` — bass patterns (rolling, offbeat, kb3, acid)
- `groove-plan.ts` — kick/bass/hat patterns
- `style-grammar.ts` — full-on, progressive, dark, acid styles
- `sound-dna.ts` — 10-field feature vector → SynthRecipe (Phase 2: connect to renderer)
- `enhanced-failure-detector.ts` — 17 cross-part analysis rules
- `learning-kernel.ts` — contextual bandit (Phase 1: fix precedence bug + interval→degree mapping)

---

## Layer 3: PSY4 Render Engine

In `apps/web/src/lib/psy4/`. Renders audio offline via HTTP API.

### Modules
- `forensic-bridge.ts` — main render pipeline (RawScore → Stereo PCM)
- `psy-voices.ts` — 13 voice types (Kick, Bass, Lead, Pad, Acid, Hat, Snare, SubBass, Shaker, Riser, Impact, Texture, Sample)
- `channel-fx.ts` — per-voice FX chain (EQ, delay, reverb, pan, width)
- `forensic/mixing.ts` — bus processors + master chain
- `multiband.ts` — 3-band LR4 crossover compressor (textbook RBJ biquad)
- `ms-processor.ts` — M/S stereo widener (Phase 1: fix width=1 bug)
- `loudness.ts` — ITU-R BS.1770-4 LUFS (K-weighting, two-stage gating — verified correct)
- `limiter.ts` — true-peak limiter (Phase 1: fix application rate 1× → 4×)
- `modulation-matrix.ts` — 6 LFOs × 9 destinations (Phase 2: add per-voice phase)
- `audio-critic.ts` — 38 metrics, 12 failure codes (Phase 1: replace DFT with FFT)
- `auto-fixer.ts` — closed-loop render → critique → fix (16 plans + 2 adaptive)
- `arrangement/ArrangementGenerator.ts` — Markov chain (Phase 1: respect `?bars=`)
- `preset-manager.ts` — 11 factory presets (Phase 2: map all 25 fields to RenderConfig)
- `automation.ts` — breakpoint curves
- `wavetable.ts` — 7 tables, morphable (Phase 2: add mip levels)
- `granular.ts` — grain clouds (Phase 2: add interpolation, fix splice-during-iteration)
- `physical/waveguide-string.ts` — Karplus-Strong (Phase 1: fix decay = loop filter, not global envelope)
- `neural/` — DDSP/RAVE stubs (Phase 5, optional — NOT neural, just spectral approximation)

### Module Dependency (within Layer 3)
```
forensic-bridge.ts
  ├── psy-voices.ts
  │   ├── forensic/dsp.ts (ZDFSVF, BLSaw, MoogLadder, BLTriangle, OversampledSaturation)
  │   ├── forensic/prng.ts (deterministic RNG)
  │   ├── wavetable.ts
  │   ├── granular.ts
  │   ├── physical/waveguide-string.ts
  │   └── neural/ddsp-harmonic.ts (dead — Phase 5)
  ├── channel-fx.ts
  │   └── CompactReverb (Freeverb-style, stereo decorrelated — CORRECT)
  ├── multiband.ts (LR4 crossover, downward compressor — CORRECT)
  ├── ms-processor.ts (StereoWidener — BROKEN at width=1, Phase 1 fix)
  ├── loudness.ts (BS.1770-4 — CORRECT, K-weighting exact to 15 digits)
  ├── limiter.ts (TruePeakLimiter — application at 1× rate, Phase 1 fix)
  ├── forensic/mixing.ts (BusProcessor + MasterChain — hard clip in MasterChain, Phase 1 fix)
  ├── modulation-matrix.ts (6 LFOs × 9 destinations, wired to Lead + Acid)
  ├── audio-critic.ts (O(N²) DFT, Phase 1 FFT fix)
  ├── auto-fixer.ts (16 plans + 2 adaptive)
  └── @psy-foundation/music (Layer 2)
```

---

## Layer 4: Application Services

HTTP API routes in `apps/web/src/app/api/`. No business logic — just request/response handling.

| Endpoint | Service | Module |
|----------|---------|--------|
| `/api/render-forensic` | RenderService | `forensic-bridge.ts::renderFoundationSection` |
| `/api/audio-critique` | CritiqueService | `audio-critic.ts::critiqueAudio` + `reference-analyzer.ts::analyzeReference` |
| `/api/optimize` | OptimizeService | `auto-fixer.ts::optimizeRender` |
| `/api/style-transfer` | StyleTransferService | `neural/latent-decoder.ts::NeuralStyleTransfer` (spectral, NOT neural) |
| `/api/arrangement` | ArrangementService | `arrangement/ArrangementGenerator.ts` |
| `/api/upload-reference` | UploadService | in-memory Map (no consumer) |

---

## Layer 5: Presentation

### `apps/web/` — Next.js 16 web app
- App Router (Turbopack)
- Single page UI (`src/app/page.tsx`)
- API routes (`src/app/api/*/route.ts`)
- AudioWorklet (`public/worklets/psy4-processor.js`) — 1 voice only (lead)
- Lazy-loaded `SpectrumAnalyzer` component

### `apps/vst/` — JUCE C++ stub (experimental)
- 527 LOC: `PluginProcessor.cpp` + `.h`
- 3 voice classes (LeadVoice, BassVoice, PadVoice)
- ZDF SVF + BLSaw + DecayEnv — real DSP
- **PluginEditor.cpp missing** — cannot build
- CMakeLists.txt references non-existent files
- Phase 4: complete the build

### CLI (planned)
- `bun run benchmarks/transport-accuracy.ts`
- `bun run benchmarks/analysis-accuracy.ts`

---

## Sample Rate Strategy

- **Default:** `SR = 44100` (audio standard)
- **Source of truth:** `@psy-foundation/dsp/src/utils.ts::DEFAULT_SR` (Phase 1: add this)
- All modules accept `sr: number` parameter (Phase 1: parameterize 8 hard-coded files)
- Offline render: can pass `sr = 48000` or `96000`
- Real-time worklet: reads `sampleRate` from `AudioContext`

---

## Determinism Strategy

- **All RNG via `Rng` class** (mulberry32) — never `Math.random()` in production paths
- **Known violation:** `physical/waveguide-string.ts:39` uses `Math.random()` (not called from production path, but Phase 1 fix)
- **Snapshot tests** planned (Phase 0 Day 5): render `?bars=8&seed=42` → md5 baseline
- Same seed → same WAV (verified: md5 `0e1294f1e9f8b5280893ad01f9ca6326`)

---

## Linting & Type Checking

- **Linter:** Biome 1.9.4 (foundation's choice, from zip)
- **TypeScript:** 5.6+
- **Phase 0 Day 4:** enable 5 strict rules
  - `noUnusedVariables` (with `_` prefix exception)
  - `noExplicitAny`
  - `useImportType`
  - `noUnreachableCode`
  - `noUnsafeFinally`
- **Phase 0 Day 4:** remove `next.config: typescript.ignoreBuildErrors`

---

## Build & Test Commands

```bash
# from repo root
bun install                              # ~1s, minimal deps
bun test                                 # 646 tests, 36s
bun run lint                             # biome check .
bun run typecheck                        # tsc --noEmit per package
bun run dev                              # apps/web on :3000
bun run build                            # all packages
bun run benchmarks                       # performance benchmarks
bun run clean                            # remove dist/ + .next/
```

```bash
# apps/web
cd apps/web && bun run dev               # Next.js dev server
cd apps/web && bun run build              # Next.js production build
cd apps/web && bun run lint               # biome check src
cd apps/web && bun run typecheck          # tsc --noEmit
```

---

## Cross-Cutting Concerns

### Configuration
- `tsconfig.base.json` — shared TypeScript config
- `biome.json` — linter + formatter config (foundation's, from zip)
- `apps/web/next.config.mjs` — Next.js config (ESM, no aliases — workspace symlinks handle resolution)

### Logging
- `apps/web/dev.log` — dev server output (gitignored)
- `worklog.md` — dev journal (committed, 2340+ lines, history of all changes)

### Backups
- Tags: `backup/pre-rebuild-20260819`, `backup/pre-cleanup-20260819` (permanent, pushed)
- Future: `backup/pre-phase-N-<date>` for each phase
