"""
Spatial Deepfake Detection using EfficientNet-B4
Analyzes individual frames for GAN/deepfake artifacts in spatial domain.
"""

import torch
import torch.nn as nn
import torchvision.transforms as transforms
import numpy as np
import cv2
from typing import List, Dict
from loguru import logger


class SpatialAnalyzer:
    """
    EfficientNet-B4 based spatial authenticity analyzer.
    Detects frame-level deepfake artifacts.
    Higher score = more authentic (real).
    """

    def __init__(self, model_path: str = None, device: str = None):
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        logger.info(f"SpatialAnalyzer using device: {self.device}")

        self.model = self._build_model()
        if model_path and __import__('os').path.exists(model_path):
            checkpoint = torch.load(model_path, map_location=self.device)
            self.model.load_state_dict(checkpoint['model_state_dict'])
            logger.info(f"Loaded SpatialAnalyzer weights from {model_path}")
        else:
            logger.warning("No pretrained weights found, using randomly initialized model (for dev only)")

        self.model.eval()

        self.transform = transforms.Compose([
            transforms.ToPILImage(),
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def _build_model(self) -> nn.Module:
        try:
            import timm
            model = timm.create_model('efficientnet_b4', pretrained=False, num_classes=2)
        except ImportError:
            from torchvision.models import efficientnet_b4
            model = efficientnet_b4(weights=None)
            model.classifier[1] = nn.Linear(model.classifier[1].in_features, 2)
        return model.to(self.device)

    def analyze(self, frames: List[np.ndarray]) -> Dict:
        """
        Analyze list of frames for spatial deepfake artifacts.
        Returns dict with 'score' (authenticity probability) and 'confidence'.
        """
        if not frames:
            return {'score': 0.5, 'confidence': 0.0}

        scores = []
        sample_frames = frames[::max(1, len(frames) // 8)]  # Sample up to 8 frames

        with torch.no_grad():
            for frame in sample_frames:
                try:
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    tensor = self.transform(rgb).unsqueeze(0).to(self.device)
                    logits = self.model(tensor)
                    probs = torch.softmax(logits, dim=1)
                    # Class 1 = real/authentic
                    authentic_prob = probs[0][1].item()
                    scores.append(authentic_prob)
                except Exception as e:
                    logger.debug(f"Frame analysis error: {e}")
                    scores.append(0.5)

        if not scores:
            return {'score': 0.5, 'confidence': 0.0}

        avg_score = float(np.mean(scores))
        confidence = float(1.0 - np.std(scores))  # Higher consistency = higher confidence

        return {
            'score': avg_score,
            'confidence': max(0.0, min(1.0, confidence)),
            'frame_count': len(scores),
            'min_score': float(np.min(scores)),
            'max_score': float(np.max(scores)),
        }
