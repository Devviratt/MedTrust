"""
Wav2Vec2 Speaker Embedding Verification
Uses HuggingFace wav2vec2 to generate speaker embeddings
and verify identity against registered doctor profiles.
"""

import os
import json
import numpy as np
from typing import Dict, List, Tuple, Optional
from loguru import logger

try:
    import torch
    from transformers import Wav2Vec2Model, Wav2Vec2Processor
    WAV2VEC_AVAILABLE = True
except ImportError:
    WAV2VEC_AVAILABLE = False
    logger.warning("Transformers not available, using fallback speaker verification")


class Wav2VecVerifier:
    """
    Speaker identity verification using Wav2Vec2 embeddings.
    Extracts high-dimensional speaker representations and computes
    cosine similarity against registered profiles.
    """

    MODEL_NAME = "facebook/wav2vec2-large-xlsr-53"
    VERIFICATION_THRESHOLD = 0.75  # Cosine similarity threshold

    def __init__(self, model_name: str = None, cache_dir: str = "./models"):
        self.model_name = model_name or self.MODEL_NAME
        self.cache_dir = cache_dir
        self._speaker_profiles: Dict[str, np.ndarray] = {}  # doctor_id -> embedding
        self.processor = None
        self.model = None
        self.device = 'cuda' if (WAV2VEC_AVAILABLE and torch.cuda.is_available()) else 'cpu'
        self._load_model()

    def _load_model(self):
        """Load Wav2Vec2 model (lazy loaded to avoid startup delay)."""
        if not WAV2VEC_AVAILABLE:
            logger.warning("Wav2Vec2 unavailable, using MFCC-based fallback for speaker verification")
            return
        try:
            logger.info(f"Loading Wav2Vec2 model: {self.model_name}")
            self.processor = Wav2Vec2Processor.from_pretrained(
                self.model_name, cache_dir=self.cache_dir
            )
            self.model = Wav2Vec2Model.from_pretrained(
                self.model_name, cache_dir=self.cache_dir
            ).to(self.device)
            self.model.eval()
            logger.info("Wav2Vec2 model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load Wav2Vec2 model: {e}. Using fallback.")
            self.model = None
            self.processor = None

    def _extract_embedding(self, audio: np.ndarray, sample_rate: int = 16000) -> Optional[np.ndarray]:
        """Extract speaker embedding from audio using Wav2Vec2."""
        if self.model is None or self.processor is None:
            return self._fallback_embedding(audio, sample_rate)

        try:
            import torch
            # Normalize audio
            audio = audio.astype(np.float32)
            if audio.std() > 0:
                audio = audio / (audio.std() + 1e-8)

            inputs = self.processor(
                audio, sampling_rate=16000, return_tensors="pt", padding=True
            )
            input_values = inputs.input_values.to(self.device)

            with torch.no_grad():
                outputs = self.model(input_values)
                # Mean pool over time dimension
                embedding = outputs.last_hidden_state.mean(dim=1).squeeze().cpu().numpy()

            return embedding.astype(np.float32)
        except Exception as e:
            logger.debug(f"Wav2Vec2 embedding error: {e}")
            return self._fallback_embedding(audio, sample_rate)

    def _fallback_embedding(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """MFCC-based fallback speaker embedding."""
        try:
            import librosa
            mfccs = librosa.feature.mfcc(y=audio, sr=sample_rate, n_mfcc=40)
            embedding = np.concatenate([mfccs.mean(axis=1), mfccs.std(axis=1)])
            return embedding.astype(np.float32)
        except Exception:
            return np.random.randn(80).astype(np.float32)

    def verify(self, audio: np.ndarray, sample_rate: int, doctor_id: str) -> Dict:
        """
        Verify if audio matches registered doctor's voice profile.
        Returns dict with similarity score and verification result.
        """
        if audio is None or len(audio) < 1000:
            return {'score': 0.5, 'similarity': 0.0, 'verified': False}

        current_embedding = self._extract_embedding(audio, sample_rate)
        if current_embedding is None:
            return {'score': 0.5, 'similarity': 0.0, 'verified': False}

        # Check if doctor has a registered profile
        if doctor_id not in self._speaker_profiles:
            logger.debug(f"No voice profile for doctor {doctor_id}, skipping speaker verification")
            # No profile = neutral score (can't penalize if not registered)
            return {'score': 0.75, 'similarity': 0.0, 'verified': False, 'reason': 'no_profile'}

        registered_embedding = self._speaker_profiles[doctor_id]
        similarity = self._cosine_similarity(current_embedding, registered_embedding)

        verified = similarity >= self.VERIFICATION_THRESHOLD
        # Score: verified = high score, not verified = low score
        score = similarity if verified else max(0.1, similarity * 0.5)

        return {
            'score': float(score),
            'similarity': float(similarity),
            'verified': bool(verified),
            'threshold': self.VERIFICATION_THRESHOLD,
            'doctor_id': doctor_id,
        }

    def train_profile(self, doctor_id: str, audio_samples: List[Tuple[np.ndarray, int]]) -> np.ndarray:
        """
        Train/register voice profile by averaging embeddings from multiple samples.
        """
        embeddings = []
        for audio, sr in audio_samples:
            emb = self._extract_embedding(audio, sr)
            if emb is not None:
                embeddings.append(emb)

        if not embeddings:
            raise ValueError("Could not extract embeddings from any audio sample")

        # Mean embedding as the registered profile
        profile_embedding = np.mean(embeddings, axis=0)
        # L2 normalize
        norm = np.linalg.norm(profile_embedding)
        if norm > 0:
            profile_embedding = profile_embedding / norm

        self._speaker_profiles[doctor_id] = profile_embedding
        logger.info(f"Voice profile registered for doctor {doctor_id} ({len(embeddings)} samples)")
        return profile_embedding

    def load_profile_from_json(self, doctor_id: str, embedding_json: str):
        """Load a stored embedding from JSON (from database)."""
        try:
            embedding = np.array(json.loads(embedding_json), dtype=np.float32)
            self._speaker_profiles[doctor_id] = embedding
        except Exception as e:
            logger.error(f"Failed to load profile for {doctor_id}: {e}")

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        """Compute cosine similarity between two vectors."""
        if a.shape != b.shape:
            min_len = min(len(a), len(b))
            a, b = a[:min_len], b[:min_len]
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a < 1e-8 or norm_b < 1e-8:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))
