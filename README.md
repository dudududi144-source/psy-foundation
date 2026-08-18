# PSY4 — Professional AI Psytrance Synthesis Platform

> 7 synthesis engines · 4 AI modules · 9 commercial features · VST/AU ready

[![Version](https://img.shields.io/badge/version-9.0-cyan)]()
[![Score](https://img.shields.io/badge/score-0.63-emerald)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## What This Is

PSY4 is a **complete synthesis platform** that combines:
- **7 synthesis engines** (wavetable, granular, physical modeling, DDSP, RAVE, BLSaw, ZDF SVF)
- **4 AI modules** (neural style transfer, DDSP harmonic/noise, Markov arrangement, ONNX inference)
- **9 commercial features** (real-time playback, presets, undo/redo, spectrum analyzer, multi-export, stems, reference upload, automation, VST scaffold)
- **Professional master chain** (M/S, multiband, dynamic EQ sidechain, LUFS, true-peak limiter)

```
Composition Engine → 13 Voice Pools → ChannelFX → 3-Bus Glue → Master Chain
                              ↓
                    AudioCritic (38 metrics)
                              ↓
              Stereo PCM → WAV/AIFF/FLAC + Stems
```

## Quick Start

```bash
# Install dependencies
bun install

# Start the dev server
bun run dev

# Open http://localhost:3000 in your browser
```

### Using the UI
1. **Render** — Click "Render + Critique" to generate audio
2. **Download** — WAV, AIFF, FLAC, or individual stems (drum/bass/music)
3. **Real-Time** — Click "Start Audio" to play the virtual keyboard
4. **Presets** — Click "Browse" to see 11 factory presets
5. **AI Arrangement** — Click "Generate Arrangement" for unique structure
6. **Style Transfer** — Download styled render (30% or 60% blend)
7. **Reference Upload** — Upload a WAV to learn its spectral style
8. **Auto-Fixer** — Click "Run Auto-Optimize" for 16-iteration search

## API Routes

| Endpoint | Description |
|----------|-------------|
| `GET /api/render-forensic` | Render audio (?bars=8&seed=42&format=wav\|aiff\|flac&stem=drum\|bass\|music) |
| `GET /api/audio-critique` | Score + 38 metrics + failures + render profile |
| `GET /api/optimize` | Auto-fixer (16 plans + 2 adaptive, 18 iterations) |
| `GET /api/style-transfer` | Neural style transfer (?blend=0.3) |
| `GET /api/arrangement` | AI arrangement generator (?seed=42&bars=88) |
| `POST /api/upload-reference` | Upload reference WAV for style learning |

## Architecture

### Synthesis Engines (7)
| Engine | File | Description |
|--------|------|-------------|
| BLSaw/BLSquare/BLTriangle | `forensic/dsp.ts` | Band-limited oscillators (PolyBLEP) |
| ZDF SVF | `forensic/dsp.ts` | Zero-delay feedback filter (from PsySynthPro) |
| Wavetable | `wavetable.ts` | 7 built-in tables, 2048-sample morphing |
| GrainCloud | `granular.ts` | Real granular synthesis (50-200 grains/sec) |
| WaveguideString | `physical/waveguide-string.ts` | Karplus-Strong physical modeling |
| DDSPHarmonic | `neural/ddsp-harmonic.ts` | 60-harmonic differentiable synth (Google Magenta) |
| DDSPNoise | `neural/ddsp-noise.ts` | 65-band filtered noise synth |

### Neural / AI (4)
| Module | File | Description |
|--------|------|-------------|
| NeuralStyleTransfer | `neural/latent-decoder.ts` | RAVE-style spectral style transfer |
| ONNX Inference | `neural/onnx-inference.ts` | Load trained PyTorch models |
| ArrangementGenerator | `arrangement/ArrangementGenerator.ts` | Markov-chain section generator |
| Training Pipeline | `neural/training/` | 3 Python/PyTorch scripts |

### Commercial Features (9)
| Feature | File | Description |
|---------|------|-------------|
| Real-time playback | `audio-engine.ts` + `worklets/psy4-processor.js` | AudioWorklet + MIDI |
| Presets | `preset-manager.ts` | 11 factory presets, localStorage |
| Undo/redo | `history.ts` | Command pattern, 100 steps |
| Spectrum analyzer | `components/spectrum-analyzer.tsx` | Real-time FFT, 60fps |
| Multi-export | `multi-export.ts` | WAV, AIFF, FLAC |
| Stems export | `forensic-bridge.ts` | Drum/bass/music per-bus WAVs |
| Reference upload | `api/upload-reference/` | WAV parsing + spectral analysis |
| Automation | `automation.ts` | Breakpoint curves, 4 interpolation types |
| VST plugin | `vst-plugin/` | JUCE C++ scaffold (VST3/AU/LV2) |

### Master Chain
```
HP(25Hz) → M/S(mono<120Hz) → Multiband(LR4) → Glue(2:1) → Sat(15%) → LUFS(-11) → Limiter(-1dBTP)
```

## Documentation

| Document | Description |
|----------|-------------|
| [SELF_ROAST.md](docs/SELF_ROAST.md) | Audit of 10 lies + how each was fixed |
| [COMPETITIVE_GAP_ANALYSIS.md](docs/COMPETITIVE_GAP_ANALYSIS.md) | Comparison to Serum/Vital + 7 breakthrough opportunities |
| [COMMERCIAL_READINESS_ROADMAP.md](docs/COMMERCIAL_READINESS_ROADMAP.md) | 12 commercial gaps + revenue models |
| [PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md) | Complete architecture + feature inventory |

## VST/AU Plugin

```bash
cd vst-plugin
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
# Output: PSY4.vst3 (macOS/Windows/Linux)
```

See `vst-plugin/README.md` for full build instructions.

## AI Training

```bash
# Prepare dataset (splits tracks into windows)
python src/lib/psy4/neural/training/prepare_dataset.py --input /tracks --output /processed --mode rave

# Train DDSP harmonic decoder (per voice)
python src/lib/psy4/neural/training/train_ddsp.py --dataset /processed --voice lead --epochs 100

# Train RAVE VAE for style transfer
python src/lib/psy4/neural/training/train_rave.py --dataset /processed --epochs 500
```

See `src/lib/psy4/neural/training/README.md` for requirements and workflow.

## Tech Stack

- **Framework**: Next.js 16, TypeScript 5, Tailwind CSS 4
- **Audio**: Web Audio API, AudioWorklet, ZDF SVF
- **Neural**: ONNX Runtime, PyTorch (training)
- **Plugin**: JUCE 7, CMake, C++17
- **Database**: Prisma (SQLite local, Supabase cloud)

## License

MIT — see [LICENSE](LICENSE)
