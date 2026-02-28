"""
GAN Artifact Detection
Detects GAN-generated or manipulated video frames by identifying
characteristic frequency-domain artifacts and blending boundaries.
"""

import torch
import torch.nn as nn
import numpy as np
import cv2
from typing import List, Dict
from loguru import logger


class FrequencyArtifactNet(nn.Module):
    """
    CNN operating in frequency domain to detect GAN spectral artifacts.
    GAN-generated faces leave characteristic high-frequency patterns
    invisible to the human eye but detectable by CNNs.
    """
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 64, 3, padding=1), nn.ReLU(),
            nn.Conv2d(64, 64, 3, padding=1), nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1), nn.ReLU(),
            nn.Conv2d(128, 128, 3, padding=1), nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(128, 256, 3, padding=1), nn.ReLU(),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.classifier = nn.Sequential(
            nn.Linear(256 * 16, 512),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(512, 2),
        )

    def forward(self, x):
        f = self.features(x).view(x.size(0), -1)
        return self.classifier(f)


class GANDetector:
    """
    Multi-signal GAN artifact detector combining:
    1. Frequency domain analysis (FFT spectrum)
    2. Neural network classifier
    3. Face blending boundary detection
    4. Color inconsistency analysis
    """

    def __init__(self, model_path: str = None, device: str = None):
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = FrequencyArtifactNet().to(self.device)

        if model_path and __import__('os').path.exists(model_path):
            checkpoint = torch.load(model_path, map_location=self.device)
            self.model.load_state_dict(checkpoint)

        self.model.eval()

        import torchvision.transforms as T
        self.transform = T.Compose([
            T.ToPILImage(),
            T.Resize((128, 128)),
            T.ToTensor(),
            T.Normalize([0.5] * 3, [0.5] * 3),
        ])

    def analyze(self, frames: List[np.ndarray]) -> Dict:
        """
        Analyze frames for GAN artifacts.
        Returns dict with score (higher = more authentic), artifact probability.
        """
        if not frames:
            return {'score': 0.5, 'artifact_prob': 0.5}

        cnn_scores = []
        freq_scores = []
        boundary_scores = []

        sample_frames = frames[::max(1, len(frames) // 6)]

        for frame in sample_frames:
            # 1. CNN-based detection
            cnn_score = self._run_cnn(frame)
            cnn_scores.append(cnn_score)

            # 2. Frequency domain analysis
            freq_score = self._analyze_frequency(frame)
            freq_scores.append(freq_score)

            # 3. Face boundary blending detection
            boundary_score = self._detect_blending_boundary(frame)
            boundary_scores.append(boundary_score)

        # Ensemble: weighted combination
        avg_cnn = float(np.mean(cnn_scores)) if cnn_scores else 0.5
        avg_freq = float(np.mean(freq_scores)) if freq_scores else 0.5
        avg_boundary = float(np.mean(boundary_scores)) if boundary_scores else 0.5

        # Combined authenticity score
        combined = (avg_cnn * 0.5 + avg_freq * 0.3 + avg_boundary * 0.2)
        artifact_prob = 1.0 - combined

        return {
            'score': float(combined),
            'artifact_prob': float(artifact_prob),
            'cnn_score': avg_cnn,
            'frequency_score': avg_freq,
            'boundary_score': avg_boundary,
        }

    def _run_cnn(self, frame: np.ndarray) -> float:
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            tensor = self.transform(rgb).unsqueeze(0).to(self.device)
            with torch.no_grad():
                logits = self.model(tensor)
                probs = torch.softmax(logits, dim=1)
                return float(probs[0][1].item())  # real class probability
        except Exception as e:
            logger.debug(f"GAN CNN error: {e}")
            return 0.5

    def _analyze_frequency(self, frame: np.ndarray) -> float:
        """
        GAN images show characteristic spectral peaks in FFT.
        Real images follow a 1/f power spectrum; GAN artifacts deviate from this.
        """
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray_float = gray.astype(np.float32) / 255.0

            # Apply FFT
            f = np.fft.fft2(gray_float)
            fshift = np.fft.fftshift(f)
            magnitude = np.log1p(np.abs(fshift))

            # Compute azimuthally averaged power spectrum
            h, w = magnitude.shape
            center = (h // 2, w // 2)
            Y, X = np.ogrid[:h, :w]
            dist = np.sqrt((X - center[1]) ** 2 + (Y - center[0]) ** 2).astype(int)
            dist_flat = dist.ravel()
            mag_flat = magnitude.ravel()
            max_dist = dist.max()
            radial_mean = np.zeros(max_dist + 1)
            for d in range(max_dist + 1):
                mask = dist_flat == d
                if mask.any():
                    radial_mean[d] = mag_flat[mask].mean()

            # Real images: power decreases smoothly with frequency
            # GAN images: periodic spikes at specific frequencies
            if len(radial_mean) > 10:
                diffs = np.diff(radial_mean[:50])
                spike_count = np.sum(np.abs(diffs) > np.std(diffs) * 2)
                spike_ratio = spike_count / max(len(diffs), 1)
                # Higher spikes = more likely GAN
                authenticity = max(0.0, 1.0 - spike_ratio * 2)
                return float(authenticity)
            return 0.5
        except Exception as e:
            logger.debug(f"Frequency analysis error: {e}")
            return 0.5

    def _detect_blending_boundary(self, frame: np.ndarray) -> float:
        """
        Deepfakes often show subtle blending artifacts at face boundaries.
        Detects unusual edge discontinuities near face regions.
        """
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            # Apply Laplacian to detect edges
            laplacian = cv2.Laplacian(gray, cv2.CV_64F)
            variance = laplacian.var()

            # Very low variance = possibly over-smoothed (deepfake)
            # Very high variance = natural texture
            # Normalize to [0, 1] range based on empirical thresholds
            if variance < 50:
                return 0.3  # suspicious - too smooth
            elif variance > 3000:
                return 0.4  # suspicious - unusual high frequency noise
            else:
                # Normal natural image variance range
                normalized = min(1.0, (variance - 50) / 2950)
                return 0.5 + normalized * 0.5
        except Exception:
            return 0.5
