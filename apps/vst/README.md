# PSY4 VST/AU Plugin

> **Status: Phase 4 — PluginEditor + DSP headers added, buildable (requires JUCE + CMake)**

JUCE-based VST3/AU/LV2 plugin wrapper for the PSY4 synthesis engine.

## What's Here (Phase 4)

### Source files
- `PluginProcessor.h` / `.cpp` — main processor with 3 voice types (Lead, Bass, Pad)
- `PluginEditor.h` / `.cpp` — UI with virtual keyboard + cutoff/resonance/gain sliders
- `DSP/ZDFSVF.h` — Zero-Delay Feedback State-Variable Filter (Simper/Zavalishin)
- `DSP/BLSaw.h` — Band-limited sawtooth with PolyBLEP
- `DSP/DecayEnv.h` — Exponential decay envelope

### Voice types (ported from TypeScript)
- **LeadVoice** (8-voice polyphonic) — ZDF SVF + BLSaw + DecayEnv
- **BassVoice** (2-voice) — sub sine + saw through filter
- **PadVoice** (2-voice) — detuned saws through filter

### Parameters (10)
- Cutoff, Resonance, Lead Gain, Bass Gain, Hat Gain
- Stereo Width, Target LUFS
- Macro 1 (SPACE), Macro 2 (ENERGY), Macro 3 (TENSION)

## Build (requires JUCE 7+ and CMake 3.22+)

```bash
cd apps/vst
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
```

JUCE is fetched automatically via `FetchContent` (requires internet).

### Output locations
- **macOS:** `~/Library/Audio/Plug-Ins/VST3/PSY4.vst3`
- **Windows:** `C:/Program Files/Common Files/VST3/PSY4.vst3`
- **Linux:** `~/.vst3/PSY4.vst3`

## What's NOT Here Yet

- **Full 13-voice engine** — currently 3 voice types (Lead, Bass, Pad)
- **Master chain** — no multiband/OTT/limiter in C++ (TS version has it)
- **Modulation matrix** — forward declared but not implemented
- **Stereo processing** — currently mono output (`channelL[i] = sample; channelR[i] = sample`)
- **Preset browser UI** — factory presets exist but no browser widget

These will be added in Phase 4 Day 2-3.

## License

MIT — same as the main project.
