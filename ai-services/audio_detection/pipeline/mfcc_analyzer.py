"""
MFCC-based Voice Authenticity Analyzer
Extracts Mel-frequency Cepstral Coefficients and analyzes for
statistical anomalies indicative of synthetic/cloned voice.
"""

import numpy as np
import librosa
from typing import Dict
from loguru import logger


class MFCCAnalyzer:
    """
    Analyzes MFCC features for voice authenticity.
    Synthetic voices (TTS/VC) show characteristic MFCC patterns.
    """

    def __init__(
        self,
        n_mfcc: int = 40,
        n_fft: int = 2048,
        hop_length: int = 512,
        n_mels: int = 128,
    ):
        self.n_mfcc = n_mfcc
        self.n_fft = n_fft
        self.hop_length = hop_length
        self.n_mels = n_mels
        logger.info(f"MFCCAnalyzer initialized (n_mfcc={n_mfcc})")

    def analyze(self, audio: np.ndarray, sample_rate: int = 16000) -> Dict:
        """
        Extract MFCC features and compute authenticity score.
        Real human voices have specific natural variance patterns in MFCCs.
        """
        if audio is None or len(audio) < sample_rate * 0.1:  # Min 100ms
            return {'score': 0.5, 'features': []}

        try:
            # Extract MFCCs
            mfccs = librosa.feature.mfcc(
                y=audio,
                sr=sample_rate,
                n_mfcc=self.n_mfcc,
                n_fft=self.n_fft,
                hop_length=self.hop_length,
                n_mels=self.n_mels,
            )

            # Delta and delta-delta for dynamic features
            mfcc_delta = librosa.feature.delta(mfccs)
            mfcc_delta2 = librosa.feature.delta(mfccs, order=2)

            # Statistical features per coefficient
            mfcc_mean = mfccs.mean(axis=1)
            mfcc_std = mfccs.std(axis=1)
            delta_mean = mfcc_delta.mean(axis=1)
            delta_std = mfcc_delta.std(axis=1)
            delta2_mean = mfcc_delta2.mean(axis=1)

            # Feature vector for scoring
            feature_vector = np.concatenate([
                mfcc_mean, mfcc_std, delta_mean, delta_std, delta2_mean
            ])

            # Authenticity heuristics
            score = self._compute_authenticity_score(mfccs, mfcc_delta, audio, sample_rate)

            return {
                'score': float(score),
                'features': [float(v) for v in feature_vector[:40]],
                'mfcc_mean': [float(v) for v in mfcc_mean],
                'mfcc_std': [float(v) for v in mfcc_std],
                'n_frames': mfccs.shape[1],
            }

        except Exception as e:
            logger.error(f"MFCC analysis error: {e}")
            return {'score': 0.5, 'features': []}

    def _compute_authenticity_score(
        self,
        mfccs: np.ndarray,
        mfcc_delta: np.ndarray,
        audio: np.ndarray,
        sample_rate: int
    ) -> float:
        """
        Multi-factor authenticity scoring:
        1. Spectral variance: Real voices have natural per-frame variance
        2. Delta variance: Natural speech has smooth but variable transitions
        3. Zero-crossing rate: TTS often shows artifacts in ZCR
        4. Spectral rolloff: Natural voice spectral envelope check
        5. RMS energy variance: Natural speech energy fluctuation
        """
        scores = []

        # 1. MFCC temporal variance check
        # Real voice: moderate variance across frames
        # TTS: often too regular (low variance) or too noisy (high variance)
        temporal_var = mfccs.var(axis=1).mean()
        if 0.5 < temporal_var < 500:
            scores.append(0.8)
        elif temporal_var <= 0.5:
            scores.append(0.2)  # Too regular - likely TTS
        else:
            scores.append(0.5)

        # 2. Delta smoothness (real speech has smooth transitions)
        delta_smoothness = mfcc_delta.std(axis=1).mean()
        smoothness_score = np.clip(1.0 - abs(delta_smoothness - 8.0) / 20.0, 0.2, 0.9)
        scores.append(float(smoothness_score))

        # 3. Zero-crossing rate naturalness
        try:
            zcr = librosa.feature.zero_crossing_rate(audio, hop_length=512)[0]
            zcr_mean = zcr.mean()
            zcr_std = zcr.std()
            # Natural speech: ZCR mean 0.05-0.15, some variance
            if 0.03 < zcr_mean < 0.20 and zcr_std > 0.02:
                scores.append(0.8)
            else:
                scores.append(0.4)
        except Exception:
            scores.append(0.5)

        # 4. Spectral rolloff (natural voice bandwidth check)
        try:
            rolloff = librosa.feature.spectral_rolloff(y=audio, sr=sample_rate, roll_percent=0.85)[0]
            rolloff_mean = rolloff.mean()
            # Natural voice: rolloff typically 2000-8000 Hz
            if 1500 < rolloff_mean < 8000:
                scores.append(0.8)
            else:
                scores.append(0.3)
        except Exception:
            scores.append(0.5)

        # 5. RMS energy naturalness
        try:
            rms = librosa.feature.rms(y=audio, hop_length=512)[0]
            rms_var = rms.var()
            if rms_var > 1e-6:
                scores.append(0.75)
            else:
                scores.append(0.3)
        except Exception:
            scores.append(0.5)

        return float(np.mean(scores))
