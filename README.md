# PSY4 — Professional AI Psytrance Synthesis Platform

> 4 synthesis engines (connected) · 3 AI modules · 7 commercial features

## What This Is

PSY4 is a **synthesis platform** that combines:
- **4 synthesis engines connected to renderer** (BLSaw/ZDF SVF, Wavetable, Granular, Waveguide)
- **3 AI modules** (DDSP optional, RAVE-style style transfer, Markov arrangement)
- **7 commercial features** (real-time playback with 3 voices, presets, undo/redo, spectrum analyzer, multi-export, stems, automation)
- **VST/AU plugin** (C++/JUCE with real DSP — 3 voice types, 10 parameters)
- **Professional master chain** (M/S, multiband, dynamic EQ sidechain, LUFS, true-peak limiter)

## Quick Start

```bash
bun install
bun run dev
# Open http://localhost:3000
```

## What Actually Works

### Connected to offline renderer (verified):
1. **BLSaw + ZDF SVF** — core oscillator + filter
2. **Wavetable** — 6 morphable tables, connected to Lead voices
3. **Granular (GrainCloud)** — real grain clouds, connected to PsyTexture
4. **WaveguideString** — Karplus-Strong, connected to PsyBass
5. **Modulation Matrix** — 6 LFOs × 8 destinations, wired to Lead + Acid
6. **Master chain** — M/S, multiband, glue, saturation, LUFS, limiter

### Commercial features (verified working):
1. **Real-time playback** — AudioWorklet with 3 voice types (lead, bass, pad)
2. **Presets** — 11 factory presets, connected to render config via ?preset= API
3. **Undo/redo** — command pattern, 100 steps
4. **Spectrum analyzer** — real-time FFT, 60fps
5. **Multi-export** — WAV, AIFF, FLAC
6. **Stems export** — drum, bass, music per-bus WAVs
7. **Automation** — breakpoint curves, connected to render loop

### VST/AU Plugin (C++ with real DSP):
- 3 voice types: LeadVoice (8), BassVoice (2), PadVoice (2)
- ZDF SVF + BLSaw + DecayEnv (ported from TypeScript)
- 10 automatable parameters
- MIDI routing by pitch range
- Preset management (11 presets)

## What's NOT Working (Honest)

- **DDSP**: import added but NOT connected by default (lowers score when connected)
- **ONNX inference**: onnxruntime-node installed but no trained models exist
- **AI training**: Python scripts ready but never run (no dataset, no GPU, no models)
- **Style transfer**: uses spectral approximation (not neural RAVE)
- **Score**: 0.66 (honest, 9 metric bugs fixed — was 0.64 with bugs)

## API Routes

| Endpoint | Description |
|----------|-------------|
| `GET /api/render-forensic` | Render audio (?bars=8&format=wav\|aiff\|flac&stem=drum\|bass\|music&preset=Name) |
| `GET /api/audio-critique` | Score + 38 metrics + failures |
| `GET /api/optimize` | Auto-fixer (16 plans + 2 adaptive) |
| `GET /api/style-transfer` | Spectral style transfer (?blend=0.3) |
| `GET /api/arrangement` | AI arrangement (?seed=42&bars=88) |
| `POST /api/upload-reference` | Upload reference WAV |

## Architecture

```
CompositionEngine → 13 Voice Pools → ChannelFX → 3-Bus → Master Chain
     ↓                                           ↑
  Wavetable→Lead    Granular→Texture    Waveguide→Bass
     ↓                                           ↑
  ModulationMatrix (6 LFOs × 8 dest, 3 macros)
     ↓
  AudioCritic (38 metrics, 12 failure codes, pro thresholds)
```

## VST/AU Plugin

```bash
cd vst-plugin
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
```

## Tech Stack

- Next.js 16, TypeScript 5, Tailwind CSS 4
- Web Audio API, AudioWorklet, ZDF SVF
- ONNX Runtime (installed, no models yet)
- JUCE 7, CMake, C++17

## License

MIT
