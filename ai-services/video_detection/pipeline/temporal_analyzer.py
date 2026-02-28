"""
Temporal Deepfake Detection using Bidirectional LSTM
Detects temporal inconsistencies across frame sequences.
Deepfakes often have unnatural temporal transitions.
"""

import torch
import torch.nn as nn
import numpy as np
import cv2
from typing import List, Dict
from loguru import logger


class TemporalFeatureExtractor(nn.Module):
    """Lightweight CNN to extract per-frame feature vectors."""
    def __init__(self, feature_dim: int = 256):
        super().__init__()
        self.cnn = nn.Sequential(
            nn.Conv2d(3, 32, 3, stride=2, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.Conv2d(32, 64, 3, stride=2, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.Conv2d(64, 128, 3, stride=2, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((4, 4)),
        )
        self.fc = nn.Linear(128 * 16, feature_dim)

    def forward(self, x):
        b = x.size(0)
        feat = self.cnn(x).view(b, -1)
        return self.fc(feat)


class TemporalLSTM(nn.Module):
    """Bidirectional LSTM for temporal sequence classification."""
    def __init__(self, input_dim: int = 256, hidden_dim: int = 256, num_layers: int = 2):
        super().__init__()
        self.feature_extractor = TemporalFeatureExtractor(input_dim)
        self.lstm = nn.LSTM(
            input_dim, hidden_dim, num_layers=num_layers,
            batch_first=True, bidirectional=True, dropout=0.3
        )
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim * 2, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, 2),
        )

    def forward(self, x_seq):
        # x_seq: (1, T, C, H, W)
        b, t, c, h, w = x_seq.shape
        x = x_seq.view(b * t, c, h, w)
        features = self.feature_extractor(x)
        features = features.view(b, t, -1)
        lstm_out, _ = self.lstm(features)
        pooled = lstm_out.mean(dim=1)
        return self.classifier(pooled)


class TemporalAnalyzer:
    """
    Detects temporal inconsistencies in video streams.
    Uses sliding window of frames processed by BiLSTM.
    """

    def __init__(self, window_size: int = 16, model_path: str = None, device: str = None):
        self.window_size = window_size
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = TemporalLSTM().to(self.device)

        if model_path and __import__('os').path.exists(model_path):
            checkpoint = torch.load(model_path, map_location=self.device)
            self.model.load_state_dict(checkpoint)
            logger.info(f"Loaded TemporalAnalyzer weights from {model_path}")

        self.model.eval()

        import torchvision.transforms as T
        self.transform = T.Compose([
            T.ToPILImage(),
            T.Resize((112, 112)),
            T.ToTensor(),
            T.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]),
        ])

    def analyze(self, frames: List[np.ndarray]) -> Dict:
        """
        Analyze sequence of frames for temporal consistency.
        Returns score where higher = more temporally consistent (real).
        """
        if len(frames) < 4:
            return {'score': 0.5, 'variance': 0.0}

        # Sample frames up to window_size
        indices = np.linspace(0, len(frames) - 1, min(self.window_size, len(frames)), dtype=int)
        sampled = [frames[i] for i in indices]

        frame_tensors = []
        for frame in sampled:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            t = self.transform(rgb)
            frame_tensors.append(t)

        # Stack: (1, T, C, H, W)
        x_seq = torch.stack(frame_tensors).unsqueeze(0).to(self.device)

        with torch.no_grad():
            logits = self.model(x_seq)
            probs = torch.softmax(logits, dim=1)
            authentic_prob = probs[0][1].item()

        # Also compute optical flow variance as supplementary signal
        variance = self._compute_flow_variance(sampled)

        # Adjust score: high optical flow variance can indicate manipulation
        flow_penalty = min(0.3, variance / 100.0)
        adjusted_score = max(0.0, authentic_prob - flow_penalty)

        return {
            'score': float(adjusted_score),
            'raw_score': float(authentic_prob),
            'variance': float(variance),
            'frame_count': len(sampled),
        }

    def _compute_flow_variance(self, frames: List[np.ndarray]) -> float:
        """Compute optical flow variance to detect unnatural motion."""
        if len(frames) < 2:
            return 0.0
        variances = []
        for i in range(1, min(len(frames), 8)):
            prev_gray = cv2.cvtColor(frames[i - 1], cv2.COLOR_BGR2GRAY)
            curr_gray = cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY)
            try:
                flow = cv2.calcOpticalFlowFarneback(
                    prev_gray, curr_gray, None,
                    pyr_scale=0.5, levels=3, winsize=15,
                    iterations=3, poly_n=5, poly_sigma=1.2, flags=0
                )
                mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
                variances.append(float(np.var(mag)))
            except Exception:
                variances.append(0.0)
        return float(np.mean(variances)) if variances else 0.0
