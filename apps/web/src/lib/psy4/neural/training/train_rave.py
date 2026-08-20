#!/usr/bin/env python3
"""
PSY4 RAVE Training Script — Train VAE for neural style transfer.

Trains a Variational Autoencoder (VAE) on psytrance tracks for style transfer.
The encoder learns: audio → latent vector (32-dim)
The decoder learns: latent vector → audio

After training, style transfer works by:
1. Encode reference track → Z_ref
2. Encode render → Z_render
3. Blend: Z_result = lerp(Z_render, Z_ref, amount)
4. Decode Z_result → styled audio

Architecture:
    Encoder: Audio → CNN → 32-dim latent (μ, σ)
    Decoder: 32-dim latent → ConvTranspose → Audio

Usage:
    python train_rave.py --dataset /path/to/tracks --epochs 500

Output:
    models/rave_encoder.onnx
    models/rave_decoder.onnx
"""

import argparse
import os
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import soundfile as sf
from pathlib import Path

# ── Hyperparameters ──
SAMPLE_RATE = 44100
LATENT_DIM = 32
WINDOW_SIZE = 16384  # ~0.37s at 44.1kHz
BATCH_SIZE = 16
LEARNING_RATE = 1e-4
EPOCHS = 500
BETA = 0.01  # KL divergence weight (low for better reconstruction)

# ── Model Architecture ──

class RAVEEncoder(nn.Module):
    """Encodes audio to latent vector (μ, σ)."""
    
    def __init__(self, latent_dim: int = LATENT_DIM):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Conv1d(1, 64, kernel_size=7, stride=2, padding=3),
            nn.LeakyReLU(0.2),
            nn.Conv1d(64, 128, kernel_size=7, stride=2, padding=3),
            nn.LeakyReLU(0.2),
            nn.Conv1d(128, 256, kernel_size=7, stride=2, padding=3),
            nn.LeakyReLU(0.2),
            nn.Conv1d(256, 512, kernel_size=7, stride=2, padding=3),
            nn.LeakyReLU(0.2),
            nn.AdaptiveAvgPool1d(1),
        )
        self.fc_mu = nn.Linear(512, latent_dim)
        self.fc_logvar = nn.Linear(512, latent_dim)
    
    def forward(self, x):
        # x: (batch, 1, samples)
        x = self.encoder(x)
        x = x.squeeze(-1)
        mu = self.fc_mu(x)
        logvar = self.fc_logvar(x)
        return mu, logvar


class RAVEDecoder(nn.Module):
    """Decodes latent vector to audio."""
    
    def __init__(self, latent_dim: int = LATENT_DIM):
        super().__init__()
        self.fc = nn.Sequential(
            nn.Linear(latent_dim, 512),
            nn.LeakyReLU(0.2),
        )
        self.decoder = nn.Sequential(
            nn.ConvTranspose1d(512, 256, kernel_size=7, stride=2, padding=3),
            nn.LeakyReLU(0.2),
            nn.ConvTranspose1d(256, 128, kernel_size=7, stride=2, padding=3),
            nn.LeakyReLU(0.2),
            nn.ConvTranspose1d(128, 64, kernel_size=7, stride=2, padding=3),
            nn.LeakyReLU(0.2),
            nn.ConvTranspose1d(64, 1, kernel_size=7, stride=2, padding=3),
            nn.Tanh(),  # Output -1 to 1
        )
    
    def forward(self, z):
        # z: (batch, latent_dim)
        x = self.fc(z)
        x = x.unsqueeze(-1)  # (batch, 512, 1)
        # Need to repeat to match output size
        x = x.repeat(1, 1, WINDOW_SIZE // 16)  # Upsample to match decoder
        x = self.decoder(x)
        return x


class RAVEVAE(nn.Module):
    """Complete VAE: encoder + decoder + reparameterization."""
    
    def __init__(self, latent_dim: int = LATENT_DIM):
        super().__init__()
        self.encoder = RAVEEncoder(latent_dim)
        self.decoder = RAVEDecoder(latent_dim)
    
    def reparameterize(self, mu, logvar):
        std = torch.exp(0.5 * logvar)
        eps = torch.randn_like(std)
        return mu + eps * std
    
    def forward(self, x):
        mu, logvar = self.encoder(x)
        z = self.reparameterize(mu, logvar)
        recon = self.decoder(z)
        return recon, mu, logvar


def vae_loss(recon_x, x, mu, logvar, beta=BETA):
    """VAE loss: reconstruction + KL divergence."""
    # Reconstruction loss (MSE)
    recon_loss = nn.functional.mse_loss(recon_x, x, reduction='sum')
    
    # KL divergence
    kl_div = -0.5 * torch.sum(1 + logvar - mu.pow(2) - logvar.exp())
    
    return recon_loss + beta * kl_div


# ── Dataset ──

class TrackDataset(Dataset):
    """Loads full psytrance tracks for training."""
    
    def __init__(self, dataset_dir: str, max_tracks: int = 500):
        self.tracks = []
        
        for wav_file in Path(dataset_dir).glob("**/*.wav"):
            self.tracks.append(str(wav_file))
            if len(self.tracks) >= max_tracks:
                break
        
        print(f"Loaded {len(self.tracks)} tracks")
    
    def __len__(self):
        return len(self.tracks)
    
    def __getitem__(self, idx):
        audio, sr = sf.read(self.tracks[idx], dtype='float32')
        
        # Convert to mono if stereo
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)
        
        # Resample if needed
        if sr != SAMPLE_RATE:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
        
        # Take random window
        if len(audio) > WINDOW_SIZE:
            start = np.random.randint(0, len(audio) - WINDOW_SIZE)
            audio = audio[start:start + WINDOW_SIZE]
        elif len(audio) < WINDOW_SIZE:
            audio = np.pad(audio, (0, WINDOW_SIZE - len(audio)))
        
        # Normalize
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val
        
        return torch.from_numpy(audio).float().unsqueeze(0)  # (1, samples)


# ── Training Loop ──

def train_rave(dataset_dir: str, epochs: int, output_dir: str):
    """Train RAVE VAE for style transfer."""
    print(f"\n{'='*60}")
    print(f"Training RAVE VAE")
    print(f"Dataset: {dataset_dir}")
    print(f"Epochs: {epochs}")
    print(f"Output: {output_dir}")
    print(f"{'='*60}\n")
    
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Device: {device}")
    
    dataset = TrackDataset(dataset_dir)
    if len(dataset) == 0:
        print("Error: No tracks found. Exiting.")
        return
    
    dataloader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=4)
    
    model = RAVEVAE(LATENT_DIM).to(device)
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
    
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        total_recon = 0
        total_kl = 0
        num_batches = 0
        
        for batch_idx, (audio,) in enumerate(dataloader):
            audio = audio.to(device)
            
            recon, mu, logvar = model(audio)
            
            # Ensure same size for loss
            min_len = min(recon.size(-1), audio.size(-1))
            recon = recon[..., :min_len]
            audio = audio[..., :min_len]
            
            loss = vae_loss(recon, audio, mu, logvar)
            
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            num_batches += 1
            
            if batch_idx % 10 == 0:
                print(f"  Epoch {epoch+1}/{epochs} Batch {batch_idx}/{len(dataloader)} Loss: {loss.item():.2f}")
        
        avg_loss = total_loss / max(1, num_batches)
        print(f"Epoch {epoch+1}/{epochs} Average Loss: {avg_loss:.2f}")
        
        # Save checkpoint every 50 epochs
        if (epoch + 1) % 50 == 0:
            checkpoint_path = os.path.join(output_dir, f'rave_checkpoint_epoch{epoch+1}.pt')
            torch.save({
                'epoch': epoch + 1,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'loss': avg_loss,
            }, checkpoint_path)
            print(f"  Checkpoint saved: {checkpoint_path}")
    
    # Export encoder and decoder separately to ONNX
    os.makedirs(output_dir, exist_ok=True)
    
    # Export encoder
    model.eval()
    dummy_audio = torch.randn(1, 1, WINDOW_SIZE).to(device)
    encoder_path = os.path.join(output_dir, 'rave_encoder.onnx')
    torch.onnx.export(
        model.encoder, dummy_audio, encoder_path,
        export_params=True, opset_version=14,
        input_names=['audio'], output_names=['mu', 'logvar'],
        dynamic_axes={'audio': {0: 'batch'}, 'mu': {0: 'batch'}, 'logvar': {0: 'batch'}}
    )
    print(f"✓ Encoder exported: {encoder_path}")
    
    # Export decoder
    dummy_latent = torch.randn(1, LATENT_DIM).to(device)
    decoder_path = os.path.join(output_dir, 'rave_decoder.onnx')
    torch.onnx.export(
        model.decoder, dummy_latent, decoder_path,
        export_params=True, opset_version=14,
        input_names=['latent'], output_names=['audio'],
        dynamic_axes={'latent': {0: 'batch'}, 'audio': {0: 'batch'}}
    )
    print(f"✓ Decoder exported: {decoder_path}")


def main():
    parser = argparse.ArgumentParser(description='Train PSY4 RAVE VAE for style transfer')
    parser.add_argument('--dataset', required=True, help='Path to tracks directory')
    parser.add_argument('--epochs', type=int, default=EPOCHS, help='Number of epochs')
    parser.add_argument('--output', default='models', help='Output directory for ONNX models')
    
    args = parser.parse_args()
    train_rave(args.dataset, args.epochs, args.output)


if __name__ == '__main__':
    main()
