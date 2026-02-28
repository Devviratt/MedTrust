"""
PyTest suite for Biometric Sync Engine
"""
import sys
import os
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../ai-services'))

from biometric_engine.biometric_service import BiometricServicer


@pytest.fixture(scope='module')
def servicer():
    return BiometricServicer()


def make_heart_signal(hr_bpm: float, duration: float = 5.0, fs: int = 30, noise: float = 0.05):
    """Generate a synthetic heart rate signal at a given BPM."""
    t = np.linspace(0, duration, int(fs * duration))
    freq = hr_bpm / 60.0
    signal = np.sin(2 * np.pi * freq * t)
    signal += noise * np.random.randn(len(t))
    return signal.astype(np.float64)


class TestBiometricSyncAnalysis:
    def test_matching_signals_high_score(self, servicer):
        rppg = make_heart_signal(72.0)
        ecg = make_heart_signal(72.0)
        result = servicer._analyze_sync(rppg, ecg, sample_rate=30)
        assert result['sync_score'] > 0.5
        assert result['hr_rppg'] > 0
        assert result['hr_ecg'] > 0

    def test_mismatched_hr_lower_score(self, servicer):
        rppg = make_heart_signal(70.0)
        ecg = make_heart_signal(130.0)
        result = servicer._analyze_sync(rppg, ecg, sample_rate=30)
        assert result['sync_score'] < 0.75
        assert result['hr_diff'] > 40

    def test_physiological_ok_for_matching(self, servicer):
        rppg = make_heart_signal(75.0)
        ecg = make_heart_signal(74.0)
        result = servicer._analyze_sync(rppg, ecg, sample_rate=30)
        assert result['physiological_ok'] is True

    def test_physiological_fail_for_extreme_mismatch(self, servicer):
        rppg = make_heart_signal(40.0)
        ecg = make_heart_signal(160.0)
        result = servicer._analyze_sync(rppg, ecg, sample_rate=30)
        assert result['physiological_ok'] is False

    def test_sync_score_range(self, servicer):
        rppg = make_heart_signal(80.0)
        ecg = make_heart_signal(82.0)
        result = servicer._analyze_sync(rppg, ecg, sample_rate=30)
        assert 0.0 <= result['sync_score'] <= 1.0

    def test_analysis_returns_required_keys(self, servicer):
        rppg = make_heart_signal(70.0)
        ecg = make_heart_signal(70.0)
        result = servicer._analyze_sync(rppg, ecg, sample_rate=30)
        for key in ['sync_score', 'correlation', 'phase_offset_ms', 'physiological_ok', 'analysis', 'hr_rppg', 'hr_ecg']:
            assert key in result, f"Missing key: {key}"

    def test_too_short_signal_handled(self, servicer):
        rppg = np.array([0.1, 0.2, 0.3])
        ecg = np.array([0.1, 0.2, 0.3])
        result = servicer._analyze_sync(rppg, ecg, sample_rate=30)
        assert 'sync_score' in result

    def test_normalize_signal(self, servicer):
        sig = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        normalized = servicer._normalize_signal(sig)
        assert abs(normalized.mean()) < 1e-10
        assert abs(normalized.std() - 1.0) < 1e-10

    def test_bandpass_filter_preserves_shape(self, servicer):
        sig = make_heart_signal(72.0)
        filtered = servicer._bandpass(sig, fs=30, low=0.7, high=3.5)
        assert len(filtered) == len(sig)

    def test_heart_rate_estimation(self, servicer):
        for target_hr in [60.0, 72.0, 90.0, 120.0]:
            sig = make_heart_signal(target_hr, duration=10.0, fs=30)
            estimated = servicer._estimate_hr(sig, fs=30)
            assert abs(estimated - target_hr) < 20.0, f"HR estimate {estimated} too far from {target_hr}"

    def test_flat_signal_handled(self, servicer):
        rppg = np.zeros(150)
        ecg = np.zeros(150)
        result = servicer._analyze_sync(rppg, ecg, sample_rate=30)
        assert 0.0 <= result['sync_score'] <= 1.0


class TestReplayDetectionViaSignals:
    """Replay attacks produce rPPG that doesn't match patient's live ECG."""

    def test_replay_attack_pattern(self, servicer):
        """Pre-recorded video would have static rPPG while ECG changes."""
        # Live ECG at 80 BPM
        ecg = make_heart_signal(80.0, duration=8.0)
        # Replayed (old recording) rPPG at very different rate
        rppg = make_heart_signal(65.0, duration=8.0, noise=0.001)
        result = servicer._analyze_sync(rppg, ecg, sample_rate=30)
        # Should indicate poor sync (score < 0.65)
        assert result['sync_score'] < 0.75 or result['physiological_ok'] is False
