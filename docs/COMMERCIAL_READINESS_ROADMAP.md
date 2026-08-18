# PSY4 Commercial Readiness Roadmap

> After closing all 7 competitive gaps (Phase 1-4), this document identifies
> what's needed to transform PSY4 from a "technical platform" into a
> commercially viable product.

**Current state**: v8.5, score 0.6312, 0-1 marginal failures, all 7 gaps closed.
**Goal**: Commercial-ready product that producers will pay for.

---

## What We Have (Technical Platform)

✅ 13 voices with ZDF SVF filters
✅ Modulation matrix (6 LFOs × 8 destinations, 3 macros)
✅ Wavetable synthesis (7 built-in tables, morphable)
✅ Granular synthesis (real grain clouds)
✅ Physical modeling (Karplus-Strong waveguide)
✅ DDSP neural synthesis (60 harmonics, differentiable)
✅ Neural style transfer (RAVE-style spectral)
✅ AI arrangement (Markov-chain generator)
✅ Master chain (M/S, multiband, LUFS, limiter)
✅ Stems export (drum/bass/music)
✅ AudioCritic (38 metrics, pro thresholds)
✅ Harmony engine (8 scales, 7 progressions)
✅ Humanizer (mulberry32, velocity jitter, timing drift)
✅ Design system (chassis, OLED, voice colors)

---

## What's Missing (Commercial Product)

### TIER 1: Essential for any commercial release (1-2 weeks)

#### 1. Real-Time Playback (AudioWorklet)
**Status**: ❌ Missing — render is offline only
**Why it matters**: No producer will use a tool that can't play sound in real-time.
Every commercial synth (Serum, Vital, Pigments) plays instantly when you press a key.
**Implementation**:
- Port the ZDF SVF + voice engines to an AudioWorklet module
- Register as `AudioWorkletProcessor` in `/public/worklets/psy4-processor.js`
- Load via `audioContext.audioWorklet.addModule()`
- Create `AudioWorkletNode` with MIDI input handling
- UI: virtual keyboard + MIDI input selector
**Effort**: 3-5 days

#### 2. Preset System
**Status**: ❌ Missing — all params hardcoded in voice-specs.ts
**Why it matters**: Producers need to save/load/share patches. Serum has 1000+ factory presets.
**Implementation**:
- `PresetManager` class: save/load JSON presets
- Preset format: { voice params, modulation routes, master settings }
- Factory presets: "Full-On Lead", "Progressive Bass", "Darkpsy Kick", etc.
- UI: preset browser with search, categories, audition
- Import/export preset files (.psy4 format)
**Effort**: 2-3 days

#### 3. MIDI Input
**Status**: ❌ Missing — no MIDI device support
**Why it matters**: Producers use MIDI keyboards. No MIDI = no live performance.
**Implementation**:
- `navigator.requestMIDIAccess()` for device enumeration
- Listen to MIDI messages: note on/off, CC, pitch bend
- Route to voice engines: note → trigger, CC → macro/param
- UI: MIDI device selector, MIDI learn (right-click knob → move CC → assigned)
**Effort**: 2-3 days

#### 4. Undo/Redo History
**Status**: ❌ Missing
**Why it matters**: Every DAW has Ctrl-Z. Without it, users fear experimentation.
**Implementation**:
- Command pattern: every param change is a reversible command
- History stack (limit 100 steps)
- Keyboard: Ctrl-Z (undo), Ctrl-Y (redo)
- UI: undo/redo buttons in toolbar
**Effort**: 1-2 days

### TIER 2: Important for competitive feature parity (1-2 weeks)

#### 5. Visual Feedback
**Status**: ❌ Missing — no real-time spectrum, no filter display
**Why it matters**: Serum/Vital show real-time FFT, filter curve, LFO shape.
Users expect to "see" the sound.
**Implementation**:
- Real-time FFT spectrum analyzer (canvas, 60fps)
- Filter response curve display (cutoff/resonance visualization)
- LFO waveform display (animated)
- Modulation routing visualization (lines from source to destination)
**Effort**: 3-5 days

#### 6. Parameter Automation
**Status**: ❌ Missing
**Why it matters**: DAWs automate parameters over time. PSY4 params are static.
**Implementation**:
- Automation envelope editor (breakpoint curve per parameter)
- Export automation as VST parameter changes
- Timeline view with automation lanes
**Effort**: 3-4 days

#### 7. Multi-Export Formats
**Status**: ⚠️ Partial — WAV only
**Why it matters**: Producers need FLAC, MP3, AIFF for different workflows.
**Implementation**:
- FLAC encoder (lossless, smaller than WAV)
- MP3 encoder (for preview/sharing)
- AIFF (for Pro Tools compatibility)
- UI: format selector in export dialog
**Effort**: 1-2 days

#### 8. Reference Upload
**Status**: ❌ Missing — style transfer uses render as self-reference
**Why it matters**: The "clone reference" feature only works if users can upload
a real reference track.
**Implementation**:
- File upload endpoint: POST /api/upload-reference (multipart)
- Parse uploaded audio (WAV/MP3 → Float32Array)
- Feed to NeuralStyleTransfer.loadReference()
- UI: "Upload Reference" button + drag-drop zone
**Effort**: 1-2 days

### TIER 3: Nice-to-have for premium positioning (2-4 weeks)

#### 9. VST/AU Plugin Export
**Status**: ❌ Missing
**Why it matters**: Producers want to use PSY4 inside their DAW, not in a browser.
**Implementation**:
- Use JUCE framework (C++) to wrap the TS DSP engine
- Compile to VST3/AU/LV2 plugin formats
- Package as installer (.dmg for Mac, .exe for Windows)
**Effort**: 2-3 weeks (requires C++ expertise)

#### 10. Collaboration / Cloud Sync
**Status**: ❌ Missing
**Why it matters**: Modern production is collaborative (Splice, BandLab).
**Implementation**:
- Cloud preset sync (Supabase backend)
- Project sharing (encrypted project files)
- Real-time collaboration (WebSocket state sync)
**Effort**: 2-3 weeks

#### 11. Mobile App
**Status**: ❌ Missing
**Why it matters**: 40% of producers make music on mobile (GarageBand, FL Mobile).
**Implementation**:
- React Native wrapper for the DSP engine
- Touch-optimized UI
- iOS/Android Audio APIs
**Effort**: 3-4 weeks

#### 12. AI Training Pipeline
**Status**: ❌ Missing — DDSP/style transfer use spectral approximation
**Why it matters**: Real neural networks would learn from psytrance datasets
and produce superior results.
**Implementation**:
- Python training pipeline (PyTorch)
- Dataset: 1000 psytrance tracks ( Beatport top 100 × 10 years)
- Train RAVE VAE on dataset
- Train DDSP decoder on per-voice samples
- Export trained models to ONNX for TS inference
**Effort**: 4-6 weeks (requires ML expertise + GPU + dataset licensing)

---

## Priority Matrix

| Priority | Feature | Effort | Revenue Impact |
|----------|---------|--------|----------------|
| 1 | Real-time playback (AudioWorklet) | 3-5d | Critical — without it, nothing works |
| 2 | Preset system | 2-3d | High — users need factory presets |
| 3 | MIDI input | 2-3d | High — live performance market |
| 4 | Undo/redo | 1-2d | Medium — expected feature |
| 5 | Reference upload | 1-2d | High — enables "clone" feature |
| 6 | Visual feedback | 3-5d | Medium — UX improvement |
| 7 | Multi-export formats | 1-2d | Low — convenience |
| 8 | Parameter automation | 3-4d | Medium — DAW integration |
| 9 | VST/AU plugin | 2-3w | Very High — opens DAW market |
| 10 | AI training pipeline | 4-6w | Very High — real neural quality |
| 11 | Cloud sync | 2-3w | Medium — collaborative market |
| 12 | Mobile app | 3-4w | Medium — mobile market |

---

## Recommended Next Steps

### Immediate (this week):
1. **Real-time playback** — without this, nothing else matters
2. **Preset system** — users need saveable patches
3. **MIDI input** — live performance capability

### Short-term (2-4 weeks):
4. **Reference upload** — makes style transfer actually useful
5. **Visual feedback** — competitive UX parity
6. **VST/AU plugin** — opens the DAW market

### Long-term (1-3 months):
7. **AI training pipeline** — real neural network quality
8. **Cloud sync** — collaborative features
9. **Mobile app** — mobile market

---

## Revenue Model Options

### A. SaaS Subscription ($19/month)
- Web app with all features
- Cloud preset sync
- Reference upload (limited per month)
- Style transfer (limited renders per month)

### B. Desktop Plugin ($199 one-time)
- VST/AU/LV2 plugin
- Offline rendering (no cloud)
- Unlimited presets and renders
- 1 year of updates

### C. Freemium
- Free: 8-bar renders, 3 presets, no stems
- Pro ($19/mo): unlimited renders, all presets, stems, style transfer
- Enterprise ($99/mo): API access, batch processing, white-label

### D. API Licensing
- $0.01 per render for commercial use
- $500/month for unlimited API access
- Target: music production companies, streaming services

---

## Conclusion

PSY4 v8.5 is a **solid technical platform** with all 7 competitive gaps closed.
However, it's not yet a **commercial product** — it lacks real-time playback,
presets, MIDI input, and plugin format support.

The path to commercial viability:
1. **Real-time playback** (AudioWorklet) — critical, 3-5 days
2. **Preset system** — users need saveable patches, 2-3 days
3. **VST/AU plugin** — opens the DAW market, 2-3 weeks
4. **AI training** — real neural quality, 4-6 weeks

**Estimated time to commercial release**: 6-8 weeks of focused development.
**Estimated revenue potential**: $50K-200K/year (SaaS + plugin sales).
