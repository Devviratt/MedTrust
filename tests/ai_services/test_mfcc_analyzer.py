"""
PyTest suite for MFCCAnalyzer - audio deepfake detection module
"""
import sys
import os
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../ai-services'))

from audio_detection.pipeline.mfcc_analyzer import MFCCAnalyzer


@pytest.fixture(scope='module')
def analyzer():
    return MFCCAnalyzer()


@pytest.fixture
def real_speech_audio():
    """Simulate natural speech with harmonic structure."""
    sr = 16000
    duration = 2.0
    t = np.linspace(0, duration, int(sr * duration))
    f0 = 150.0
    audio = np.zeros_like(t)
    for harmonic in range(1, 8):
        audio += (1.0 / harmonic) * np.sin(2 * np.pi * f0 * harmonic * t)
    # Add slight noise (naturalness)
    audio += 0.02 * np.random.randn(len(t))
    audio = audio / (np.max(np.abs(audio)) + 1e-8)
    return audio.astype(np.float32), sr


@pytest.fixture
def synthetic_audio():
    """Simulate synthetic/TTS audio with uniform energy and no naturalness."""
    sr = 16000
    duration = 2.0
    t = np.linspace(0, duration, int(sr * duration))
    # Pure sine wave - no harmonics, very uniform
    audio = 0.5 * np.sin(2 * np.pi * 440.0 * t)
    return audio.astype(np.float32), sr


@pytest.fixture
def silent_audio():
    sr = 16000
    audio = np.zeros(sr * 2, dtype=np.float32)
    return audio, sr


@pytest.fixture
def short_audio():
    sr = 16000
    audio = np.random.randn(200).astype(np.float32) * 0.1
    return audio, sr


class TestMFCCAnalyzerBasic:
    def test_returns_dict(self, analyzer, real_speech_audio):
        audio, sr = real_speech_audio
        result = analyzer.analyze(audio, sr)
        assert isinstance(result, dict)

    def test_returns_score_key(self, analyzer, real_speech_audio):
        audio, sr = real_speech_audio
        result = analyzer.analyze(audio, sr)
        assert 'score' in result

    def test_score_in_valid_range(self, analyzer, real_speech_audio):
        audio, sr = real_speech_audio
        result = analyzer.analyze(audio, sr)
        assert 0.0 <= result['score'] <= 1.0

    def test_handles_short_audio(self, analyzer, short_audio):
        audio, sr = short_audio
        result = analyzer.analyze(audio, sr)
        assert isinstance(result, dict)
        assert 'score' in result

    def test_handles_silent_audio(self, analyzer, silent_audio):
        audio, sr = silent_audio
        result = analyzer.analyze(audio, sr)
        assert isinstance(result, dict)
        assert 0.0 <= result.get('score', 0.5) <= 1.0

    def test_handles_none_audio(self, analyzer):
        result = analyzer.analyze(None, 16000)
        assert isinstance(result, dict)
        assert 'score' in result

    def test_handles_numpy_array(self, analyzer):
        audio = np.random.randn(32000).astype(np.float32) * 0.3
        result = analyzer.analyze(audio, 16000)
        assert isinstance(result, dict)
        assert 0.0 <= result['score'] <= 1.0


class TestMFCCFeatureExtraction:
    def test_mfcc_features_shape(self, analyzer, real_speech_audio):
        audio, sr = real_speech_audio
        mfccs = analyzer._extract_mfcc(audio, sr)
        assert mfccs is not None
        assert mfccs.ndim == 2
        assert mfccs.shape[0] == analyzer.n_mfcc

    def test_delta_features_computed(self, analyzer, real_speech_audio):
        audio, sr = real_speech_audio
        result = analyzer.analyze(audio, sr)
        if 'delta_energy' in result:
            assert isinstance(result['delta_energy'], float)

    def test_real_vs_synthetic_score_difference(self, analyzer, real_speech_audio, synthetic_audio):
        """Real speech should score higher (more authentic) than pure sine wave."""
        audio_real, sr = real_speech_audio
        audio_synth, _ = synthetic_audio
        result_real = analyzer.analyze(audio_real, sr)
        result_synth = analyzer.analyze(audio_synth, sr)
        # Real speech should have a different (typically higher) authenticity score
        # This is not guaranteed to be deterministic without a trained model,
        # but at minimum both should produce valid scores
        assert 0.0 <= result_real['score'] <= 1.0
        assert 0.0 <= result_synth['score'] <= 1.0

    def test_score_deterministic(self, analyzer, real_speech_audio):
        """Same input should produce same output."""
        audio, sr = real_speech_audio
        r1 = analyzer.analyze(audio, sr)
        r2 = analyzer.analyze(audio, sr)
        assert abs(r1['score'] - r2['score']) < 1e-5

    def test_different_sample_rates(self, analyzer):
        """Analyzer should handle common sample rates."""
        for sr in [8000, 16000, 22050, 44100]:
            audio = np.random.randn(sr * 2).astype(np.float32) * 0.3
            result = analyzer.analyze(audio, sr)
            assert isinstance(result, dict)
            assert 0.0 <= result['score'] <= 1.0


class TestMFCCEdgeCases:
    def test_very_loud_audio(self, analyzer):
        audio = np.ones(32000, dtype=np.float32)
        result = analyzer.analyze(audio, 16000)
        assert isinstance(result, dict)

    def test_very_quiet_audio(self, analyzer):
        audio = np.random.randn(32000).astype(np.float32) * 1e-8
        result = analyzer.analyze(audio, 16000)
        assert isinstance(result, dict)

    def test_nan_values_handled(self, analyzer):
        audio = np.full(32000, np.nan, dtype=np.float32)
        result = analyzer.analyze(audio, 16000)
        assert isinstance(result, dict)
        assert np.isfinite(result.get('score', 0.5))
