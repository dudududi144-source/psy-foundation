#!/usr/bin/env python3
"""
PSY4 Dataset Preparation — processes raw psytrance tracks into training format.

Steps:
1. Find all WAV/MP3 files in input directory
2. Split into 30-second windows (for RAVE) or 1-second clips (for DDSP)
3. Normalize loudness to -23 LUFS (EBU R128)
4. If stem-separated, organize by voice type (kick/bass/lead/etc.)
5. Create train/val/test splits (80/10/10)
6. Output processed dataset with manifest.json

Usage:
    python prepare_dataset.py --input /path/to/raw --output /path/to/processed --mode rave
    python prepare_dataset.py --input /path/to/stems --output /path/to/processed --mode ddsp
"""

import argparse
import os
import json
import numpy as np
import soundfile as sf
import librosa
from pathlib import Path

SAMPLE_RATE = 44100
RAVE_WINDOW_SEC = 30  # 30-second windows for RAVE
DDSP_WINDOW_SEC = 1   # 1-second clips for DDSP
TARGET_LUFS = -23
TRAIN_SPLIT = 0.8
VAL_SPLIT = 0.1
TEST_SPLIT = 0.1


def normalize_loudness(audio: np.ndarray, sr: int, target_lufs: float = TARGET_LUFS) -> np.ndarray:
    """Normalize audio to target LUFS using simple RMS approximation."""
    # Simple loudness approximation (true LUFS requires ITU-R BS.1770 filter)
    rms = np.sqrt(np.mean(audio ** 2))
    if rms < 1e-8:
        return audio
    
    # Convert RMS to approximate LUFS
    current_lufs = 20 * np.log10(rms) - 0.691
    
    # Calculate gain
    gain_db = target_lufs - current_lufs
    gain = 10 ** (gain_db / 20)
    
    return audio * gain


def split_audio(audio: np.ndarray, sr: int, window_sec: float) -> list:
    """Split audio into fixed-length windows."""
    window_size = int(sr * window_sec)
    windows = []
    
    for i in range(0, len(audio) - window_size, window_size):
        window = audio[i:i + window_size]
        windows.append(window)
    
    return windows


def process_track(file_path: str, output_dir: str, mode: str, track_id: str) -> list:
    """Process a single track into windows."""
    try:
        audio, sr = sf.read(file_path, dtype='float32')
    except Exception as e:
        print(f"  Skipping {file_path}: {e}")
        return []
    
    # Convert to mono if stereo
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)
    
    # Resample if needed
    if sr != SAMPLE_RATE:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
    
    # Normalize loudness
    audio = normalize_loudness(audio, SAMPLE_RATE)
    
    # Split into windows
    window_sec = RAVE_WINDOW_SEC if mode == 'rave' else DDSP_WINDOW_SEC
    windows = split_audio(audio, SAMPLE_RATE, window_sec)
    
    # Save windows
    saved_files = []
    for i, window in enumerate(windows):
        out_name = f"{track_id}_{i:04d}.wav"
        out_path = os.path.join(output_dir, out_name)
        sf.write(out_path, window, SAMPLE_RATE)
        saved_files.append(out_name)
    
    return saved_files


def process_stems(stems_dir: str, output_dir: str) -> dict:
    """Process stem-separated tracks for DDSP training."""
    voice_types = ['kick', 'bass', 'lead', 'pad', 'acid', 'hat', 'snare', 'shaker']
    manifest = {voice: [] for voice in voice_types}
    
    for voice in voice_types:
        voice_dir = Path(stems_dir) / voice
        if not voice_dir.exists():
            print(f"  No {voice} stems found, skipping")
            continue
        
        voice_output = os.path.join(output_dir, voice)
        os.makedirs(voice_output, exist_ok=True)
        
        for stem_file in voice_dir.glob("**/*.wav"):
            track_id = stem_file.stem
            windows = process_track(str(stem_file), voice_output, 'ddsp', track_id)
            manifest[voice].extend(windows)
            print(f"  {voice}/{track_id}: {len(windows)} windows")
    
    return manifest


def create_splits(items: list) -> dict:
    """Create train/val/test splits."""
    np.random.shuffle(items)
    n = len(items)
    train_end = int(n * TRAIN_SPLIT)
    val_end = int(n * (TRAIN_SPLIT + VAL_SPLIT))
    
    return {
        'train': items[:train_end],
        'val': items[train_end:val_end],
        'test': items[val_end:],
    }


def main():
    parser = argparse.ArgumentParser(description='Prepare PSY4 training dataset')
    parser.add_argument('--input', required=True, help='Input directory with raw tracks/stems')
    parser.add_argument('--output', required=True, help='Output directory for processed dataset')
    parser.add_argument('--mode', choices=['rave', 'ddsp'], required=True,
                        help='rave: full tracks for VAE, ddsp: stem-separated per voice')
    
    args = parser.parse_args()
    
    os.makedirs(args.output, exist_ok=True)
    
    print(f"\n{'='*60}")
    print(f"PSY4 Dataset Preparation")
    print(f"Input: {args.input}")
    print(f"Output: {args.output}")
    print(f"Mode: {args.mode}")
    print(f"{'='*60}\n")
    
    if args.mode == 'ddsp':
        # Process stem-separated tracks
        manifest = process_stems(args.input, args.output)
        
        # Create splits per voice
        splits = {}
        for voice, files in manifest.items():
            if files:
                splits[voice] = create_splits(files)
                print(f"{voice}: train={len(splits[voice]['train'])}, "
                      f"val={len(splits[voice]['val'])}, test={len(splits[voice]['test'])}")
        
        # Save manifest
        manifest_path = os.path.join(args.output, 'manifest.json')
        with open(manifest_path, 'w') as f:
            json.dump({
                'mode': 'ddsp',
                'sample_rate': SAMPLE_RATE,
                'window_sec': DDSP_WINDOW_SEC,
                'splits': splits,
            }, f, indent=2)
        print(f"\n✓ Manifest saved: {manifest_path}")
    
    else:
        # Process full tracks for RAVE
        track_files = list(Path(args.input).glob("**/*.wav"))
        print(f"Found {len(track_files)} tracks")
        
        all_windows = []
        for i, track_file in enumerate(track_files):
            print(f"Processing {i+1}/{len(track_files)}: {track_file.name}")
            windows = process_track(str(track_file), args.output, 'rave', f"track{i:04d}")
            all_windows.extend(windows)
        
        # Create splits
        splits = create_splits(all_windows)
        print(f"\nTotal windows: {len(all_windows)}")
        print(f"Train: {len(splits['train'])}, Val: {len(splits['val'])}, Test: {len(splits['test'])}")
        
        # Save manifest
        manifest_path = os.path.join(args.output, 'manifest.json')
        with open(manifest_path, 'w') as f:
            json.dump({
                'mode': 'rave',
                'sample_rate': SAMPLE_RATE,
                'window_sec': RAVE_WINDOW_SEC,
                'splits': splits,
            }, f, indent=2)
        print(f"\n✓ Manifest saved: {manifest_path}")
    
    print(f"\n✓ Dataset prepared: {args.output}")


if __name__ == '__main__':
    main()
