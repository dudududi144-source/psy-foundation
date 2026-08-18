#!/usr/bin/env python3
"""
PSY4 DDSP Training Script — Train harmonic decoder for neural synthesis.

Trains a neural network to predict 60 harmonic amplitudes from audio features.
The trained model replaces the hardcoded presets in DDSPHarmonic.setPreset().

Architecture:
    Input: Audio (waveform or spectrogram)
    → Encoder CNN (extract features)
    → Dense layers (predict harmonics)
    → Output: 60 harmonic amplitudes (0-1)

Loss: MSE between predicted harmonics and ground-truth (extracted via FFT)

Usage:
    python train_ddsp.py --dataset /path/to/samples --voice lead --epochs 100

Output:
    models/ddsp_{voice}.onnx
"""

import argparse
import os
import sys
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import librosa
import soundfile as sf
from pathlib import Path

# ── Hyperparameters ──
SAMPLE_RATE = 44100
FFT_SIZE = 2048
NUM_HARMONICS = 60
HOP_LENGTH = 512
BATCH_SIZE = 32
LEARNING_RATE = 1e-4
EPOCHS = 100

# ── Model Architecture ──

class DDSPDecoder(nn.Module):
    """Neural network that predicts harmonic amplitudes from audio."""
    
    def __init__(self, num_harmonics: int = NUM_HARMONICS):
        super().__init__()
        # Input: spectrogram (1, 1025, time_frames)
        self.encoder = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=(5, 5), stride=(2, 2), padding=2),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.Conv2d(32, 64, kernel_size=(5, 5), stride=(2, 2), padding=2),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.Conv2d(64, 128, kernel_size=(3, 3), stride=(2, 2), padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((1, 1)),  # Global average pooling
        )
        self.fc = nn.Sequential(
            nn.Linear(128, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Linear(128, num_harmonics),
            nn.Sigmoid()  # Output 0-1
        )
    
    def forward(self, x):
        # x: (batch, 1, freq_bins, time_frames)
        x = self.encoder(x)
        x = x.view(x.size(0), -1)
        x = self.fc(x)
        return x  # (batch, num_harmonics)


# ── Dataset ──

class AudioDataset(Dataset):
    """Loads audio samples and extracts harmonic ground truth."""
    
    def __init__(self, dataset_dir: str, voice_type: str, max_samples: int = 1000):
        self.samples = []
        self.voice_type = voice_type
        
        # Find all WAV files for this voice type
        voice_dir = Path(dataset_dir) / voice_type
        if not voice_dir.exists():
            print(f"Warning: {voice_dir} does not exist")
            return
        
        for wav_file in voice_dir.glob("**/*.wav"):
            self.samples.append(str(wav_file))
            if len(self.samples) >= max_samples:
                break
        
        print(f"Loaded {len(self.samples)} {voice_type} samples")
    
    def __len__(self):
        return len(self.samples)
    
    def __getitem__(self, idx):
        # Load audio
        audio, sr = sf.read(self.samples[idx], dtype='float32')
        if sr != SAMPLE_RATE:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
        
        # Take a 1-second window
        if len(audio) > SAMPLE_RATE:
            start = np.random.randint(0, len(audio) - SAMPLE_RATE)
            audio = audio[start:start + SAMPLE_RATE]
        elif len(audio) < SAMPLE_RATE:
            audio = np.pad(audio, (0, SAMPLE_RATE - len(audio)))
        
        # Compute spectrogram
        stft = librosa.stft(audio, n_fft=FFT_SIZE, hop_length=HOP_LENGTH)
        spectrogram = np.abs(stft)  # (1025, frames)
        
        # Extract ground-truth harmonics via peak detection
        harmonics = self._extract_harmonics(audio, sr)
        
        # Convert to tensor
        spec_tensor = torch.from_numpy(spectrogram).float()
        spec_tensor = spec_tensor.unsqueeze(0)  # Add channel dim
        spec_tensor = spec_tensor[:, :1024, :128]  # Crop to fixed size
        
        harm_tensor = torch.from_numpy(harmonics).float()
        
        return spec_tensor, harm_tensor
    
    def _extract_harmonics(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Extract 60 harmonic amplitudes from audio via FFT."""
        # Compute FFT
        fft = np.fft.rfft(audio)
        magnitude = np.abs(fft)
        
        # Find fundamental frequency (highest peak in 50-2000 Hz range)
        freqs = np.fft.rfftfreq(len(audio), 1.0 / sr)
        valid = (freqs > 50) & (freqs < 2000)
        if not np.any(valid):
            return np.zeros(NUM_HARMONICS, dtype=np.float32)
        
        fund_idx = np.argmax(magnitude[valid]) + np.where(valid)[0][0]
        fund_freq = freqs[fund_idx]
        
        # Extract 60 harmonics
        harmonics = np.zeros(NUM_HARMONICS, dtype=np.float32)
        for n in range(NUM_HARMONICS):
            freq = fund_freq * (n + 1)
            if freq > sr / 2:
                break
            # Find bin closest to this frequency
            bin_idx = np.argmin(np.abs(freqs - freq))
            # Average a small window for robustness
            window = magnitude[max(0, bin_idx - 1):bin_idx + 2]
            harmonics[n] = np.max(window) if len(window) > 0 else 0
        
        # Normalize to 0-1
        max_harm = np.max(harmonics)
        if max_harm > 0:
            harmonics = harmonics / max_harm
        
        return harmonics


# ── Training Loop ──

def train_model(dataset_dir: str, voice_type: str, epochs: int, output_path: str):
    """Train DDSP decoder for a specific voice type."""
    print(f"\n{'='*60}")
    print(f"Training DDSP decoder for voice: {voice_type}")
    print(f"Dataset: {dataset_dir}")
    print(f"Epochs: {epochs}")
    print(f"Output: {output_path}")
    print(f"{'='*60}\n")
    
    # Setup device
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Device: {device}")
    
    # Create dataset and dataloader
    dataset = AudioDataset(dataset_dir, voice_type)
    if len(dataset) == 0:
        print("Error: No samples found. Exiting.")
        return
    
    dataloader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=4)
    
    # Initialize model
    model = DDSPDecoder(NUM_HARMONICS).to(device)
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
    
    # Training loop
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        num_batches = 0
        
        for batch_idx, (specs, targets) in enumerate(dataloader):
            specs = specs.to(device)
            targets = targets.to(device)
            
            # Forward pass
            outputs = model(specs)
            loss = criterion(outputs, targets)
            
            # Backward pass
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            num_batches += 1
            
            if batch_idx % 10 == 0:
                print(f"  Epoch {epoch+1}/{epochs} Batch {batch_idx}/{len(dataloader)} Loss: {loss.item():.6f}")
        
        avg_loss = total_loss / max(1, num_batches)
        print(f"Epoch {epoch+1}/{epochs} Average Loss: {avg_loss:.6f}")
        
        # Save checkpoint every 10 epochs
        if (epoch + 1) % 10 == 0:
            checkpoint_path = output_path.replace('.onnx', f'_epoch{epoch+1}.pt')
            torch.save({
                'epoch': epoch + 1,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'loss': avg_loss,
            }, checkpoint_path)
            print(f"  Checkpoint saved: {checkpoint_path}")
    
    # Export to ONNX
    model.eval()
    dummy_input = torch.randn(1, 1, 1024, 128).to(device)
    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=['spectrogram'],
        output_names=['harmonics'],
        dynamic_axes={
            'spectrogram': {0: 'batch'},
            'harmonics': {0: 'batch'},
        }
    )
    print(f"\n✓ Model exported to ONNX: {output_path}")


# ── Main ──

def main():
    parser = argparse.ArgumentParser(description='Train PSY4 DDSP harmonic decoder')
    parser.add_argument('--dataset', required=True, help='Path to dataset directory')
    parser.add_argument('--voice', required=True, choices=['kick', 'bass', 'lead', 'pad', 'acid'],
                        help='Voice type to train')
    parser.add_argument('--epochs', type=int, default=EPOCHS, help='Number of training epochs')
    parser.add_argument('--output', default=None, help='Output ONNX model path')
    parser.add_argument('--batch-size', type=int, default=BATCH_SIZE, help='Batch size')
    
    args = parser.parse_args()
    
    output_path = args.output or f'models/ddsp_{args.voice}.onnx'
    
    # Create output directory
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    
    train_model(args.dataset, args.voice, args.epochs, output_path)


if __name__ == '__main__':
    main()
