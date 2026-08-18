# PSY4 VST/AU Plugin

JUCE-based VST3/AU/LV2 plugin wrapper for the PSY4 synthesis engine.

## Overview

This directory contains the C++ scaffold for building PSY4 as a native
plugin (VST3, AU, LV2) that runs inside DAWs (Ableton, FL Studio, Logic, etc.).

The DSP engine is shared between the web app (TypeScript) and the plugin (C++).
The TypeScript engine is the reference implementation; the C++ version is
a port optimized for real-time plugin performance.

## Directory Structure

```
vst-plugin/
├── Source/
│   ├── PluginProcessor.h     # Main processor (DSP host)
│   ├── PluginProcessor.cpp   # DSP implementation (port of psy-voices.ts)
│   ├── PluginEditor.h        # UI editor
│   ├── PluginEditor.cpp      # UI implementation
│   ├── DSP/
│   │   ├── ZDFSVF.h          # ZDF State-Variable Filter
│   │   ├── BLSaw.h           # Band-limited saw oscillator
│   │   ├── Wavetable.h       # Wavetable synthesis
│   │   ├── Voices.h          # 13 voice implementations
│   │   └── MasterChain.h     # Master chain (M/S, multiband, limiter)
│   └── Parameters.h          # Parameter definitions
├── Builds/
│   ├── Mac/                  # Xcode project (AU + VST3)
│   ├── Windows/              # Visual Studio project (VST3)
│   └── Linux/                # Makefile (VST3 + LV2)
├── Resources/
│   ├── psy4-processor.js     # Web Audio fallback
│   └── presets/              # Factory presets (.psy4.json)
├── CMakeLists.txt            # CMake build system
└── README.md                 # This file
```

## Build Requirements

- **JUCE 7+** (https://juce.com/)
- **CMake 3.22+**
- **Compiler**: GCC 11+, Clang 14+, or MSVC 2022
- **Platforms**: macOS 11+, Windows 10+, Ubuntu 22.04+

## Building

### macOS (AU + VST3)
```bash
mkdir build && cd build
cmake .. -G Xcode -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release
# Output: PSY4.vst3 and PSY4.component
```

### Windows (VST3)
```bash
mkdir build && cd build
cmake .. -G "Visual Studio 17 2022" -DCMAKE_BUILD_TYPE=Release
cmake --build . --config Release
# Output: PSY4.vst3
```

### Linux (VST3 + LV2)
```bash
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
# Output: PSY4.vst3 and PSY4.lv2
```

## Installation

### macOS
```bash
# VST3
cp build/PSY4.vst3 ~/Library/Audio/Plug-Ins/VST3/
# AU
cp build/PSY4.component ~/Library/Audio/Plug-Ins/Components/
```

### Windows
```bash
# Copy to VST3 directory
copy build\PSY4.vst3 %COMMONPROGRAMFILES%\VST3\
```

## Parameters

The plugin exposes the following parameters to the DAW:

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Cutoff | 200-8000 Hz | 3000 | Lead filter cutoff |
| Resonance | 0-1 | 0.3 | Lead filter resonance |
| LeadGain | 0-1 | 0.6 | Lead volume |
| BassGain | 0-1 | 0.8 | Bass volume |
| HatGain | 0-2 | 0.85 | Hat volume |
| StereoWidth | 0.5-2 | 1.4 | M/S stereo width |
| TargetLufs | -18 to -6 | -11 | Master LUFS target |
| Macro1 (SPACE) | 0-1 | 0.5 | Delay + reverb send |
| Macro2 (ENERGY) | 0-1 | 0.5 | Drive + volume |
| Macro3 (TENSION) | 0-1 | 0.5 | Resonance + filter |

All parameters support DAW automation.

## License

MIT — same as the web version.
