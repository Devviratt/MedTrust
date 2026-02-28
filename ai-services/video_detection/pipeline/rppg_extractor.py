"""
Remote Photoplethysmography (rPPG) Pulse Extractor
Extracts heart rate and pulse waveform from facial video using ICA/PCA.
Real humans show consistent physiological signals; deepfakes lack them.
"""

import numpy as np
import cv2
from typing import List, Dict, Tuple, Optional
from collections import deque
from loguru import logger


class RPPGExtractor:
    """
    rPPG signal extraction using:
    - ICA (Independent Component Analysis) - primary method
    - PCA (Principal Component Analysis) - fallback
    Extracts RGB traces from forehead/cheek ROI, decomposes to isolate pulse.
    """

    def __init__(self, method: str = 'ica', window_size: int = 30, fps: float = 30.0):
        self.method = method
        self.window_size = window_size
        self.fps = fps
        self._rgb_buffers: dict = {}  # stream_id -> deque of (R, G, B) tuples
        logger.info(f"RPPGExtractor initialized with method={method}")

    def extract(self, frames: List[np.ndarray], stream_id: str = 'default') -> Dict:
        """
        Extract rPPG signal and compute physiological authenticity score.
        Returns score where higher = more physiologically consistent (real).
        """
        if not frames:
            return {'score': 0.5, 'waveform': [], 'snr': 0.0, 'heart_rate': 0.0}

        # Initialize buffer for stream
        if stream_id not in self._rgb_buffers:
            self._rgb_buffers[stream_id] = deque(maxlen=self.window_size * 2)

        # Extract RGB traces from each frame
        new_traces = []
        for frame in frames:
            trace = self._extract_rgb_trace(frame)
            if trace is not None:
                new_traces.append(trace)
                self._rgb_buffers[stream_id].append(trace)

        buffer = list(self._rgb_buffers[stream_id])

        if len(buffer) < 10:
            return {'score': 0.5, 'waveform': [], 'snr': 0.0, 'heart_rate': 0.0, 'confidence': 0.0}

        rgb_matrix = np.array(buffer).T  # shape: (3, N)

        # Detrend and normalize
        rgb_detrended = self._detrend(rgb_matrix)

        # Extract pulse signal
        if self.method == 'ica':
            pulse_signal = self._ica_extraction(rgb_detrended)
        else:
            pulse_signal = self._pca_extraction(rgb_detrended)

        if pulse_signal is None or len(pulse_signal) < 8:
            return {'score': 0.5, 'waveform': [], 'snr': 0.0, 'heart_rate': 0.0}

        # Bandpass filter for heart rate (0.7–3.5 Hz = 42–210 bpm)
        filtered = self._bandpass_filter(pulse_signal, self.fps, low=0.7, high=3.5)

        # Compute SNR and heart rate
        snr = self._compute_snr(filtered, self.fps)
        heart_rate = self._estimate_heart_rate(filtered, self.fps)

        # Compute authenticity score
        score = self._compute_authenticity_score(snr, heart_rate, len(buffer))

        # Normalize waveform for display
        waveform = self._normalize_waveform(filtered[-min(60, len(filtered)):])

        return {
            'score': float(score),
            'waveform': [float(v) for v in waveform],
            'snr': float(snr),
            'heart_rate': float(heart_rate),
            'confidence': float(min(1.0, len(buffer) / self.window_size)),
            'method': self.method,
            'buffer_size': len(buffer),
        }

    def _extract_rgb_trace(self, frame: np.ndarray) -> Optional[Tuple[float, float, float]]:
        """
        Extract mean RGB values from forehead ROI using face detection.
        Forehead is preferred as it's less affected by facial movements.
        """
        try:
            h, w = frame.shape[:2]

            # Simplified ROI: top-center of frame (forehead approximation)
            # In production: use MediaPipe landmarks for precise forehead ROI
            roi_y1 = int(h * 0.15)
            roi_y2 = int(h * 0.35)
            roi_x1 = int(w * 0.35)
            roi_x2 = int(w * 0.65)

            roi = frame[roi_y1:roi_y2, roi_x1:roi_x2]
            if roi.size == 0:
                return None

            mean_bgr = cv2.mean(roi)[:3]
            # Return as (R, G, B)
            return (mean_bgr[2], mean_bgr[1], mean_bgr[0])
        except Exception:
            return None

    def _detrend(self, signal: np.ndarray) -> np.ndarray:
        """Remove linear trend from each channel."""
        detrended = np.zeros_like(signal, dtype=np.float64)
        for i in range(signal.shape[0]):
            x = np.arange(signal.shape[1], dtype=np.float64)
            coeffs = np.polyfit(x, signal[i].astype(np.float64), 1)
            trend = np.polyval(coeffs, x)
            detrended[i] = signal[i] - trend
        return detrended

    def _ica_extraction(self, rgb_matrix: np.ndarray) -> Optional[np.ndarray]:
        """
        ICA-based rPPG using the CHROM method.
        Separates blood pulse signal from noise using independent components.
        """
        try:
            from sklearn.decomposition import FastICA
            # Normalize each channel
            norm = np.zeros_like(rgb_matrix)
            for i in range(3):
                std = rgb_matrix[i].std()
                if std > 1e-8:
                    norm[i] = rgb_matrix[i] / std

            ica = FastICA(n_components=3, max_iter=300, tol=0.01, random_state=42)
            components = ica.fit_transform(norm.T)  # shape: (N, 3)

            # Select component with highest power in heart rate band
            best_comp = self._select_pulse_component(components.T, self.fps)
            return best_comp
        except Exception as e:
            logger.debug(f"ICA extraction failed: {e}")
            return self._pca_extraction(rgb_matrix)

    def _pca_extraction(self, rgb_matrix: np.ndarray) -> Optional[np.ndarray]:
        """PCA-based rPPG fallback."""
        try:
            from sklearn.decomposition import PCA
            norm = np.zeros_like(rgb_matrix)
            for i in range(3):
                std = rgb_matrix[i].std()
                if std > 1e-8:
                    norm[i] = (rgb_matrix[i] - rgb_matrix[i].mean()) / std

            pca = PCA(n_components=3)
            components = pca.fit_transform(norm.T)
            best_comp = self._select_pulse_component(components.T, self.fps)
            return best_comp
        except Exception as e:
            logger.debug(f"PCA extraction failed: {e}")
            return None

    def _select_pulse_component(self, components: np.ndarray, fps: float) -> np.ndarray:
        """Select the ICA/PCA component with most energy in the heart rate frequency band."""
        from scipy.signal import welch
        best_idx = 0
        best_power = -1.0
        for i in range(components.shape[0]):
            comp = components[i]
            if comp.std() < 1e-8:
                continue
            f, psd = welch(comp, fs=fps, nperseg=min(64, len(comp)))
            mask = (f >= 0.7) & (f <= 3.5)
            band_power = psd[mask].sum() if mask.any() else 0.0
            if band_power > best_power:
                best_power = band_power
                best_idx = i
        return components[best_idx]

    def _bandpass_filter(self, signal: np.ndarray, fps: float, low: float = 0.7, high: float = 3.5) -> np.ndarray:
        """Apply Butterworth bandpass filter."""
        try:
            from scipy.signal import butter, filtfilt
            nyq = fps / 2.0
            low_norm = low / nyq
            high_norm = high / nyq
            if low_norm >= 1.0 or high_norm >= 1.0 or low_norm <= 0:
                return signal
            b, a = butter(3, [low_norm, high_norm], btype='band')
            return filtfilt(b, a, signal)
        except Exception:
            return signal

    def _compute_snr(self, signal: np.ndarray, fps: float) -> float:
        """Compute signal-to-noise ratio in the heart rate band."""
        try:
            from scipy.signal import welch
            f, psd = welch(signal, fs=fps, nperseg=min(64, len(signal)))
            hr_mask = (f >= 0.7) & (f <= 3.5)
            noise_mask = ~hr_mask
            signal_power = psd[hr_mask].sum() if hr_mask.any() else 0.0
            noise_power = psd[noise_mask].sum() if noise_mask.any() else 1.0
            if noise_power < 1e-10:
                return 30.0
            snr_db = 10 * np.log10(signal_power / noise_power + 1e-10)
            return float(np.clip(snr_db, -20, 30))
        except Exception:
            return 0.0

    def _estimate_heart_rate(self, signal: np.ndarray, fps: float) -> float:
        """Estimate heart rate from the dominant frequency in the pulse signal."""
        try:
            from scipy.signal import welch
            f, psd = welch(signal, fs=fps, nperseg=min(64, len(signal)))
            hr_mask = (f >= 0.7) & (f <= 3.5)
            if not hr_mask.any():
                return 0.0
            dominant_freq = f[hr_mask][np.argmax(psd[hr_mask])]
            return float(dominant_freq * 60)
        except Exception:
            return 0.0

    def _compute_authenticity_score(self, snr: float, heart_rate: float, buffer_size: int) -> float:
        """
        Score based on:
        - SNR: real faces have measurable pulse SNR
        - Heart rate plausibility: 42-180 bpm is physiologically normal
        - Buffer size: need enough frames for reliable extraction
        """
        if buffer_size < 15:
            return 0.5  # insufficient data

        # Heart rate plausibility check
        hr_ok = 42 <= heart_rate <= 180
        hr_score = 0.8 if hr_ok else 0.2

        # SNR score: higher SNR = more likely real face
        snr_normalized = np.clip((snr + 20) / 50.0, 0.0, 1.0)

        # Combine
        score = hr_score * 0.6 + snr_normalized * 0.4
        return float(np.clip(score, 0.0, 1.0))

    def _normalize_waveform(self, signal: np.ndarray) -> np.ndarray:
        """Normalize waveform to [-1, 1] range for display."""
        if signal.std() < 1e-8:
            return np.zeros_like(signal)
        normalized = (signal - signal.mean()) / (signal.std() * 3)
        return np.clip(normalized, -1.0, 1.0)
