# PSY4 AI Training Pipeline

This directory contains Python scripts for training the DDSP and RAVE models
used by PSY4's neural synthesis and style transfer features.

## Overview

Currently, PSY4's neural modules use **spectral approximation** (functional
approximations of RAVE/DDSP). To achieve **real neural quality**, you need
to train models on a psytrance dataset and export them to ONNX for inference
in the TypeScript runtime.

## Training Scripts

### 1. `train_ddsp.py` — Train DDSP Harmonic Decoder

Trains a neural network to predict harmonic amplitudes + noise coefficients
from audio features. The trained model replaces the hardcoded presets in
`DDSPHarmonic.setPreset()`.

```bash
python train_ddsp.py --dataset /path/to/psytrance/samples --epochs 100 --output models/ddsp_lead.onnx
```

**Input**: Audio samples (WAV)
**Output**: ONNX model that maps audio features → 60 harmonic amplitudes

### 2. `train_rave.py` — Train RAVE VAE

Trains a Variational Autoencoder on psytrance tracks for style transfer.
The encoder learns to compress audio → latent vector, the decoder learns
to reconstruct audio from latent.

```bash
python train_rave.py --dataset /path/to/psytrance/tracks --epochs 500 --output models/rave_psytrance.onnx
```

**Input**: Full psytrance tracks (WAV, 30-second windows)
**Output**: ONNX encoder + decoder models

### 3. `prepare_dataset.py` — Dataset Preparation

Processes a raw psytrance dataset into training-ready format:
- Splits tracks into 30-second windows
- Extracts per-voice stems (if available)
- Normalizes loudness to -23 LUFS
- Outputs train/val/test splits

```bash
python prepare_dataset.py --input /path/to/raw/tracks --output /path/to/processed
```

## Requirements

```
torch>=2.0.0
torchaudio>=2.0.0
numpy>=1.24.0
librosa>=0.10.0
soundfile>=0.12.0
onnx>=1.14.0
onnxruntime>=1.15.0
progressbar2>=4.2.0
```

Install: `pip install torch torchaudio librosa soundfile onnx onnxruntime`

## Dataset Requirements

### For DDSP (per-voice training)
- **1000+ samples** per voice type (kick, bass, lead, pad, acid)
- **Source**: Beatport top 100 psytrance × 10 years, stem-separated
- **Format**: WAV, 44.1kHz, mono
- **Duration**: 1-5 seconds per sample
- **License**: Ensure commercial usage rights

### For RAVE (full-track style transfer)
- **500+ full psytrance tracks** (minimum for VAE convergence)
- **Format**: WAV, 44.1kHz, stereo
- **Duration**: 3-7 minutes each
- **Variety**: Full-on, progressive, darkpsy, forest, suomi

## Training Hardware

- **GPU**: NVIDIA RTX 3090/4090 or A100 (24GB+ VRAM)
- **RAM**: 64GB+ (for dataset loading)
- **Storage**: 500GB+ (for raw + processed + checkpoints)
- **Time**: 
  - DDSP: ~12 hours (1000 samples, 100 epochs)
  - RAVE: ~7 days (500 tracks, 500 epochs)

## Workflow

1. **Collect dataset** — Obtain psytrance tracks with commercial license
2. **Prepare dataset** — Run `prepare_dataset.py` to split/normalize
3. **Train DDSP** — Run `train_ddsp.py` per voice type
4. **Train RAVE** — Run `train_rave.py` on full tracks
5. **Export to ONNX** — Models are auto-exported after training
6. **Copy models** — Place `.onnx` files in `/public/models/`
7. **Update PSY4** — The ONNX inference module loads them automatically

## Inference in PSY4

After training, the ONNX models are loaded by `src/lib/psy4/neural/onnx-inference.ts`:

```typescript
import { ONNXDDSPDecoder } from './neural/onnx-inference'
const decoder = new ONNXDDSPDecoder('/models/ddsp_lead.onnx')
const params = decoder.decode(features)  // audio features → harmonic params
synth.setHarmonics(params.harmonics)
```

## Current Status

⚠️ **Not yet trained** — The Python scripts are provided but no models exist.
PSY4 currently uses spectral approximation as a functional placeholder.

To train real models:
1. Obtain a psytrance dataset (commercial license)
2. Run the training scripts on a GPU machine
3. Copy the `.onnx` files to `/public/models/`

## License

The training scripts are MIT licensed. The trained models are proprietary
to the dataset owner. Ensure you have commercial rights to any dataset used.
