"""
Transformer-based Voice Spoof Detection
Detects replay attacks, TTS synthesis, and voice conversion attempts.
Uses a lightweight transformer architecture trained on anti-spoofing datasets.
"""

import torch
import torch.nn as nn
import numpy as np
import librosa
from typing import Dict
from loguru import logger


class TransformerSpoofModel(nn.Module):
    """
    Transformer encoder for voice anti-spoofing.
    Input: sequence of spectral feature frames.
    """

    def __init__(self, input_dim: int = 80, d_model: int = 256, nhead: int = 8,
                 num_layers: int = 4, dropout: float = 0.1):
        super().__init__()
        self.input_proj = nn.Linear(input_dim, d_model)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead, dim_feedforward=d_model * 4,
            dropout=dropout, batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.cls_token = nn.Parameter(torch.randn(1, 1, d_model))
        self.layer_norm = nn.LayerNorm(d_model)
        self.classifier = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(128, 2),
        )

    def forward(self, x):
        # x: (B, T, F)
        b = x.size(0)
        x = self.input_proj(x)
        cls = self.cls_token.expand(b, -1, -1)
        x = torch.cat([cls, x], dim=1)
        out = self.transformer(x)
        cls_out = self.layer_norm(out[:, 0])
        return self.classifier(cls_out)


class SpoofDetector:
    """
    Detects voice spoofing attacks:
    - Replay attacks (recorded and replayed audio)
    - Text-to-speech synthesis
    - Voice conversion
    Uses transformer model + acoustic heuristics.
    """

    def __init__(self, model_path: str = None, device: str = None):
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = TransformerSpoofModel(input_dim=80, d_model=128, nhead=4, num_layers=2).to(self.device)

        if model_path and __import__('os').path.exists(model_path):
            checkpoint = torch.load(model_path, map_location=self.device)
            self.model.load_state_dict(checkpoint)
            logger.info(f"Loaded SpoofDetector weights from {model_path}")

        self.model.eval()
        logger.info(f"SpoofDetector initialized on {self.device}")

    def analyze(self, audio: np.ndarray, sample_rate: int = 16000) -> Dict:
        """
        Analyze audio for spoofing artifacts.
        Returns score (higher = more likely genuine/real).
        """
        if audio is None or len(audio) < 1000:
            return {'score': 0.5}

        try:
            # Extract features for transformer
            features = self._extract_features(audio, sample_rate)
            if features is None:
                return {'score': 0.5}

            # Run transformer model
            tensor = torch.FloatTensor(features).unsqueeze(0).to(self.device)
            with torch.no_grad():
                logits = self.model(tensor)
                probs = torch.softmax(logits, dim=1)
                genuine_prob = float(probs[0][1].item())

            # Acoustic heuristics for replay/TTS detection
            acoustic_score = self._acoustic_heuristics(audio, sample_rate)

            # Ensemble
            final_score = genuine_prob * 0.55 + acoustic_score * 0.45

            return {
                'score': float(np.clip(final_score, 0.0, 1.0)),
                'transformer_score': genuine_prob,
                'acoustic_score': acoustic_score,
            }

        except Exception as e:
            logger.error(f"SpoofDetector error: {e}")
            return {'score': 0.5}

    def _extract_features(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Extract 80-dim log filterbank features, shape: (T, 80)."""
        try:
            mel = librosa.feature.melspectrogram(
                y=audio, sr=sample_rate, n_mels=80, n_fft=512, hop_length=160,
            )
            log_mel = librosa.power_to_db(mel, ref=np.max).T  # (T, 80)
            # Fixed length: 200 frames (~2s at 16kHz with hop=160)
            target_len = 200
            if log_mel.shape[0] < target_len:
                pad = target_len - log_mel.shape[0]
                log_mel = np.pad(log_mel, ((0, pad), (0, 0)), mode='edge')
            else:
                log_mel = log_mel[:target_len]
            # Normalize
            log_mel = (log_mel - log_mel.mean()) / (log_mel.std() + 1e-8)
            return log_mel.astype(np.float32)
        except Exception as e:
            logger.debug(f"Feature extraction error: {e}")
            return None

    def _acoustic_heuristics(self, audio: np.ndarray, sample_rate: int) -> float:
        """
        Heuristic checks for replay/TTS artifacts:
        1. Background noise consistency (replay has room IR)
        2. Silence ratio (TTS often lacks natural pauses)
        3. Pitch naturalness
        4. Codec artifacts detection
        """
        scores = []

        try:
            # 1. Background noise analysis (replay = distinctive noise floor)
            rms = librosa.feature.rms(y=audio, hop_length=160)[0]
            silence_threshold = rms.mean() * 0.1
            silence_frames = np.sum(rms < silence_threshold) / len(rms)
            # Natural speech: 20-60% silence
            if 0.15 < silence_frames < 0.65:
                scores.append(0.8)
            else:
                scores.append(0.4)
        except Exception:
            scores.append(0.5)

        try:
            # 2. Pitch naturalness using autocorrelation
            frame_length = int(0.025 * sample_rate)
            hop_length = int(0.010 * sample_rate)
            frames = librosa.util.frame(audio, frame_length=frame_length, hop_length=hop_length)
            pitch_present = []
            for frame in frames.T[:50]:
                autocorr = np.correlate(frame, frame, mode='full')
                autocorr = autocorr[len(autocorr) // 2:]
                # Find first peak in voice pitch range (80-500 Hz)
                min_lag = int(sample_rate / 500)
                max_lag = int(sample_rate / 80)
                if max_lag < len(autocorr):
                    peak_val = autocorr[min_lag:max_lag].max() / (autocorr[0] + 1e-8)
                    pitch_present.append(peak_val > 0.3)
            if pitch_present:
                voiced_ratio = np.mean(pitch_present)
                # Natural speech: ~40-70% voiced frames
                if 0.3 < voiced_ratio < 0.8:
                    scores.append(0.8)
                else:
                    scores.append(0.4)
        except Exception:
            scores.append(0.5)

        try:
            # 3. High-frequency energy check (codec artifacts at Nyquist boundary)
            fft = np.abs(np.fft.rfft(audio))
            freqs = np.fft.rfftfreq(len(audio), d=1.0 / sample_rate)
            # Near-Nyquist energy (>7kHz for 16kHz audio)
            hf_mask = freqs > 7000
            lf_mask = freqs < 7000
            if hf_mask.any() and lf_mask.any():
                hf_ratio = fft[hf_mask].mean() / (fft[lf_mask].mean() + 1e-8)
                # TTS/replay often has sharp cutoff or unusual HF energy
                if 0.01 < hf_ratio < 0.5:
                    scores.append(0.75)
                else:
                    scores.append(0.35)
        except Exception:
            scores.append(0.5)

        return float(np.mean(scores)) if scores else 0.5


class AudioPipeline__init__:
    pass
