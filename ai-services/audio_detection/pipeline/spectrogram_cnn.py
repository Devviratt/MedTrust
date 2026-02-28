"""
Spectrogram CNN Classifier for Voice Deepfake Detection
Uses mel-spectrogram images fed through a CNN to classify real vs synthetic speech.
"""

import torch
import torch.nn as nn
import numpy as np
import librosa
import librosa.display
from typing import Dict
from loguru import logger


class SpectrogramCNNModel(nn.Module):
    """ResNet-inspired CNN for mel-spectrogram classification."""
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            # Block 1
            nn.Conv2d(1, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
            nn.Conv2d(32, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
            nn.MaxPool2d(2, 2),
            # Block 2
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
            nn.Conv2d(64, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
            nn.MaxPool2d(2, 2),
            # Block 3
            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(),
            nn.Conv2d(128, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(),
            nn.MaxPool2d(2, 2),
            # Block 4
            nn.Conv2d(128, 256, 3, padding=1), nn.BatchNorm2d(256), nn.ReLU(),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(256 * 16, 512), nn.ReLU(), nn.Dropout(0.5),
            nn.Linear(512, 128), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(128, 2),
        )

    def forward(self, x):
        return self.classifier(self.features(x))


class SpectrogramCNN:
    """
    Converts audio to mel-spectrogram and runs CNN-based deepfake detection.
    Synthetic voice: distinctive spectral patterns (e.g., missing naturalness,
    vocoder artifacts visible in spectrogram).
    """

    def __init__(self, model_path: str = None, device: str = None):
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = SpectrogramCNNModel().to(self.device)
        if model_path and __import__('os').path.exists(model_path):
            checkpoint = torch.load(model_path, map_location=self.device)
            self.model.load_state_dict(checkpoint)
        self.model.eval()
        self.n_mels = 128
        self.n_fft = 2048
        self.hop_length = 512
        logger.info(f"SpectrogramCNN initialized on {self.device}")

    def analyze(self, audio: np.ndarray, sample_rate: int = 16000) -> Dict:
        if audio is None or len(audio) < 1000:
            return {'score': 0.5}
        try:
            mel_spec = self._compute_mel_spectrogram(audio, sample_rate)
            if mel_spec is None:
                return {'score': 0.5}

            # Normalize and convert to tensor
            mel_norm = (mel_spec - mel_spec.mean()) / (mel_spec.std() + 1e-8)
            tensor = torch.FloatTensor(mel_norm).unsqueeze(0).unsqueeze(0).to(self.device)

            with torch.no_grad():
                logits = self.model(tensor)
                probs = torch.softmax(logits, dim=1)
                authentic_prob = float(probs[0][1].item())

            # Supplement with spectral analysis heuristics
            heuristic_score = self._spectral_heuristics(mel_spec, audio, sample_rate)

            # Ensemble
            final_score = authentic_prob * 0.6 + heuristic_score * 0.4

            return {
                'score': float(np.clip(final_score, 0.0, 1.0)),
                'cnn_score': authentic_prob,
                'heuristic_score': heuristic_score,
                'mel_shape': mel_spec.shape,
            }
        except Exception as e:
            logger.error(f"SpectrogramCNN error: {e}")
            return {'score': 0.5}

    def _compute_mel_spectrogram(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Compute log mel-spectrogram, padded/truncated to fixed size."""
        try:
            mel = librosa.feature.melspectrogram(
                y=audio, sr=sample_rate,
                n_mels=self.n_mels, n_fft=self.n_fft, hop_length=self.hop_length,
            )
            log_mel = librosa.power_to_db(mel, ref=np.max)
            # Resize to fixed width (128 frames = ~2.7s at 16kHz)
            target_width = 128
            if log_mel.shape[1] < target_width:
                pad = target_width - log_mel.shape[1]
                log_mel = np.pad(log_mel, ((0, 0), (0, pad)), mode='edge')
            else:
                log_mel = log_mel[:, :target_width]
            return log_mel
        except Exception as e:
            logger.debug(f"Mel spectrogram error: {e}")
            return None

    def _spectral_heuristics(self, mel_spec: np.ndarray, audio: np.ndarray, sr: int) -> float:
        """Heuristic checks for TTS/vocoder artifacts in spectral domain."""
        scores = []
        try:
            # 1. Spectral flatness (synthetic speech often flatter)
            flatness = librosa.feature.spectral_flatness(y=audio, n_fft=self.n_fft)[0]
            flat_mean = flatness.mean()
            if 0.001 < flat_mean < 0.3:
                scores.append(0.8)
            else:
                scores.append(0.3)

            # 2. Harmonic-to-noise ratio (real voice has clear harmonics)
            harmonic, percussive = librosa.effects.hpss(audio)
            hnr = np.sum(harmonic ** 2) / (np.sum(percussive ** 2) + 1e-8)
            hnr_score = min(1.0, hnr / 10.0)
            scores.append(float(hnr_score))

            # 3. Mel spectrogram column variance (time dynamics)
            col_var = mel_spec.var(axis=0).mean()
            if col_var > 5.0:
                scores.append(0.8)
            else:
                scores.append(0.4)

        except Exception as e:
            logger.debug(f"Spectral heuristics error: {e}")
            scores.append(0.5)

        return float(np.mean(scores)) if scores else 0.5
