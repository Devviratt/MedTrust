"""
MedTrust AI - Biometric Sync Engine
gRPC server implementing:
  - rPPG vs ECG cross-correlation analysis
  - Physiological signal authenticity scoring
  - Real-time biometric sync scoring
"""

import os
import sys
import time
import concurrent.futures
from typing import Iterator

import grpc
import numpy as np
from loguru import logger
from dotenv import load_dotenv
from scipy import signal as scipy_signal
from scipy.stats import pearsonr

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from proto_gen import biometric_engine_pb2, biometric_engine_pb2_grpc

load_dotenv()


class BiometricServicer(biometric_engine_pb2_grpc.BiometricServiceServicer):
    """
    Biometric synchronization engine.
    Compares rPPG-derived pulse with ECG sensor data to validate
    that the video stream contains a real, live patient/doctor.
    """

    def __init__(self):
        logger.info("BiometricService initialized")
        self._stream_ecg_buffers = {}
        self._stream_rppg_buffers = {}

    def SyncBiometrics(
        self,
        request: biometric_engine_pb2.BiometricSyncRequest,
        context: grpc.ServicerContext,
    ) -> biometric_engine_pb2.BiometricSyncResponse:
        stream_id = request.stream_id
        rppg_signal = np.array(request.rppg_signal, dtype=np.float64)
        ecg_signal = np.array(request.ecg_signal, dtype=np.float64)
        sample_rate = request.sample_rate or 30

        if len(rppg_signal) < 5 or len(ecg_signal) < 5:
            return biometric_engine_pb2.BiometricSyncResponse(
                stream_id=stream_id,
                sync_score=0.5,
                correlation_coeff=0.0,
                phase_offset_ms=0.0,
                physiological_ok=False,
                analysis="Insufficient signal length",
            )

        try:
            result = self._analyze_sync(rppg_signal, ecg_signal, sample_rate)

            logger.info(
                f"Biometric sync [stream={stream_id}] "
                f"sync={result['sync_score']:.3f} "
                f"corr={result['correlation']:.3f} "
                f"hr_rppg={result['hr_rppg']:.1f} hr_ecg={result['hr_ecg']:.1f}"
            )

            return biometric_engine_pb2.BiometricSyncResponse(
                stream_id=stream_id,
                sync_score=float(result['sync_score']),
                correlation_coeff=float(result['correlation']),
                phase_offset_ms=float(result['phase_offset_ms']),
                physiological_ok=bool(result['physiological_ok']),
                analysis=result['analysis'],
            )

        except Exception as e:
            logger.error(f"Biometric sync error: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return biometric_engine_pb2.BiometricSyncResponse(
                stream_id=stream_id,
                sync_score=0.5,
                analysis=f"Error: {str(e)}",
            )

    def ExtractRPPG(
        self,
        request: biometric_engine_pb2.RPPGRequest,
        context: grpc.ServicerContext,
    ) -> biometric_engine_pb2.RPPGResponse:
        """Extract rPPG from a single frame (used as standalone endpoint)."""
        import cv2
        stream_id = request.stream_id
        try:
            nparr = np.frombuffer(request.frame_data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                return biometric_engine_pb2.RPPGResponse(stream_id=stream_id)

            # Extract RGB trace from forehead ROI
            h, w = frame.shape[:2]
            roi = frame[int(h * 0.15):int(h * 0.35), int(w * 0.35):int(w * 0.65)]
            if roi.size == 0:
                return biometric_engine_pb2.RPPGResponse(stream_id=stream_id)

            mean_bgr = cv2.mean(roi)[:3]
            r, g, b = mean_bgr[2], mean_bgr[1], mean_bgr[0]

            # Update buffer
            if stream_id not in self._stream_rppg_buffers:
                self._stream_rppg_buffers[stream_id] = []
            self._stream_rppg_buffers[stream_id].append((r, g, b))

            buffer = self._stream_rppg_buffers[stream_id][-60:]
            if len(buffer) < 10:
                return biometric_engine_pb2.RPPGResponse(stream_id=stream_id, confidence=0.0)

            g_channel = np.array([v[1] for v in buffer])
            waveform, hr, conf = self._estimate_hr_from_signal(g_channel, fps=30.0)

            return biometric_engine_pb2.RPPGResponse(
                stream_id=stream_id,
                waveform=[float(v) for v in waveform],
                heart_rate=float(hr),
                confidence=float(conf),
                method="green_channel_ica",
            )

        except Exception as e:
            logger.error(f"rPPG extraction error: {e}")
            return biometric_engine_pb2.RPPGResponse(stream_id=stream_id)

    def _analyze_sync(self, rppg: np.ndarray, ecg: np.ndarray, sample_rate: int) -> dict:
        """
        Core biometric sync analysis:
        1. Normalize both signals
        2. Compute cross-correlation and phase offset
        3. Compare heart rate estimates from both signals
        4. Compute Pearson correlation
        5. Combine into a sync score
        """
        # Normalize signals
        rppg_norm = self._normalize_signal(rppg)
        ecg_norm = self._normalize_signal(ecg)

        # Bandpass filter both to heart rate band
        rppg_filt = self._bandpass(rppg_norm, sample_rate, low=0.7, high=3.5)
        ecg_filt = self._bandpass(ecg_norm, sample_rate, low=0.7, high=3.5)

        # Resample to same length for comparison
        target_len = min(len(rppg_filt), len(ecg_filt), 300)
        if target_len < 5:
            return {'sync_score': 0.5, 'correlation': 0.0, 'phase_offset_ms': 0.0,
                    'physiological_ok': False, 'analysis': 'Too short', 'hr_rppg': 0.0, 'hr_ecg': 0.0}

        rppg_rs = self._resample(rppg_filt, target_len)
        ecg_rs = self._resample(ecg_filt, target_len)

        # Cross-correlation
        xcorr = np.correlate(rppg_rs, ecg_rs, mode='full')
        xcorr_norm = xcorr / (np.std(rppg_rs) * np.std(ecg_rs) * target_len + 1e-8)
        lag = np.argmax(np.abs(xcorr_norm)) - (target_len - 1)
        phase_offset_ms = float(lag / sample_rate * 1000)
        max_xcorr = float(np.max(np.abs(xcorr_norm)))

        # Pearson correlation at optimal lag
        try:
            if lag >= 0:
                corr, _ = pearsonr(rppg_rs[lag:], ecg_rs[:target_len - lag])
            else:
                corr, _ = pearsonr(rppg_rs[:target_len + lag], ecg_rs[-lag:])
        except Exception:
            corr = max_xcorr

        # Heart rate comparison
        hr_rppg = self._estimate_hr(rppg_filt, sample_rate)
        hr_ecg = self._estimate_hr(ecg_filt, sample_rate)
        hr_diff = abs(hr_rppg - hr_ecg)

        # HR match score: within 10 bpm = good, > 30 bpm = bad
        if hr_diff < 5:
            hr_score = 1.0
        elif hr_diff < 10:
            hr_score = 0.85
        elif hr_diff < 20:
            hr_score = 0.6
        elif hr_diff < 30:
            hr_score = 0.3
        else:
            hr_score = 0.1

        # Physiological plausibility
        physiological_ok = (
            40 <= hr_rppg <= 180 and
            40 <= hr_ecg <= 180 and
            hr_diff < 25 and
            abs(corr) > 0.3
        )

        # Composite sync score
        corr_score = (float(np.clip(corr, 0.0, 1.0)) + max_xcorr) / 2.0
        sync_score = corr_score * 0.5 + hr_score * 0.4 + (0.9 if physiological_ok else 0.3) * 0.1
        sync_score = float(np.clip(sync_score, 0.0, 1.0))

        analysis_parts = []
        if hr_diff > 20:
            analysis_parts.append(f"HR mismatch: rPPG={hr_rppg:.0f} ECG={hr_ecg:.0f}")
        if abs(corr) < 0.3:
            analysis_parts.append("Low signal correlation")
        if not physiological_ok:
            analysis_parts.append("Physiological check failed")
        analysis = "; ".join(analysis_parts) if analysis_parts else "Signals synchronized"

        return {
            'sync_score': sync_score,
            'correlation': float(corr),
            'phase_offset_ms': phase_offset_ms,
            'physiological_ok': physiological_ok,
            'analysis': analysis,
            'hr_rppg': hr_rppg,
            'hr_ecg': hr_ecg,
            'hr_diff': hr_diff,
        }

    def _normalize_signal(self, sig: np.ndarray) -> np.ndarray:
        std = sig.std()
        if std < 1e-8:
            return sig - sig.mean()
        return (sig - sig.mean()) / std

    def _bandpass(self, sig: np.ndarray, fs: int, low: float = 0.7, high: float = 3.5) -> np.ndarray:
        try:
            nyq = fs / 2.0
            b, a = scipy_signal.butter(3, [low / nyq, high / nyq], btype='band')
            return scipy_signal.filtfilt(b, a, sig)
        except Exception:
            return sig

    def _resample(self, sig: np.ndarray, target_len: int) -> np.ndarray:
        if len(sig) == target_len:
            return sig
        indices = np.linspace(0, len(sig) - 1, target_len)
        return np.interp(indices, np.arange(len(sig)), sig)

    def _estimate_hr(self, sig: np.ndarray, fs: int) -> float:
        try:
            f, psd = scipy_signal.welch(sig, fs=fs, nperseg=min(64, len(sig)))
            mask = (f >= 0.7) & (f <= 3.5)
            if not mask.any():
                return 0.0
            dominant = f[mask][np.argmax(psd[mask])]
            return float(dominant * 60)
        except Exception:
            return 0.0

    def _estimate_hr_from_signal(self, sig: np.ndarray, fps: float = 30.0):
        try:
            filt = self._bandpass(sig, int(fps), 0.7, 3.5)
            hr = self._estimate_hr(filt, int(fps))
            norm = filt / (np.abs(filt).max() + 1e-8)
            conf = min(1.0, len(sig) / 60.0)
            return norm.tolist(), hr, conf
        except Exception:
            return [], 0.0, 0.0


def serve():
    port = int(os.getenv("BIOMETRIC_SERVICE_PORT", "50053"))
    server = grpc.server(concurrent.futures.ThreadPoolExecutor(max_workers=8))
    biometric_engine_pb2_grpc.add_BiometricServiceServicer_to_server(
        BiometricServicer(), server
    )
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    logger.info(f"Biometric gRPC server started on port {port}")
    server.wait_for_termination()


if __name__ == '__main__':
    serve()
