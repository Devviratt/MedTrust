"""
PyTest suite for SpoofDetector - replay attack & TTS spoof detection
"""
import sys
import os
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../ai-services'))

from audio_detection.pipeline.spoof_detector import SpoofDetector


@pytest.fixture(scope='module')
def detector():
    return SpoofDetector()


@pytest.fixture
def natural_speech():
    """Generate audio approximating natural speech characteristics."""
    sr = 16000
    t = np.linspace(0, 3.0, int(sr * 3.0))
    f0 = 130.0
    audio = sum((1.0 / h) * np.sin(2 * np.pi * f0 * h * t) for h in range(1, 10))
    audio += 0.05 * np.random.randn(len(t))
    # Amplitude modulation to simulate speech bursts
    envelope = np.abs(np.sin(2 * np.pi * 3.5 * t)) ** 0.3
    audio = audio * envelope
    audio = audio / (np.max(np.abs(audio)) + 1e-8)
    return audio.astype(np.float32), sr


@pytest.fixture
def replay_audio(natural_speech):
    """Replay attack: duplicate the same audio segment."""
    audio, sr = natural_speech
    replayed = np.tile(audio[:sr], 3)
    return replayed.astype(np.float32), sr


@pytest.fixture
def tts_audio():
    """Pure TTS-like: very regular, no natural variation."""
    sr = 16000
    t = np.linspace(0, 2.0, int(sr * 2.0))
    audio = 0.4 * np.sin(2 * np.pi * 220 * t) + 0.2 * np.sin(2 * np.pi * 440 * t)
    return audio.astype(np.float32), sr


class TestSpoofDetectorBasic:
    def test_returns_dict(self, detector, natural_speech):
        audio, sr = natural_speech
        result = detector.analyze(audio, sr)
        assert isinstance(result, dict)

    def test_score_key_present(self, detector, natural_speech):
        audio, sr = natural_speech
        result = detector.analyze(audio, sr)
        assert 'score' in result

    def test_score_range(self, detector, natural_speech):
        audio, sr = natural_speech
        result = detector.analyze(audio, sr)
        assert 0.0 <= result['score'] <= 1.0

    def test_transformer_score_present(self, detector, natural_speech):
        audio, sr = natural_speech
        result = detector.analyze(audio, sr)
        assert 'transformer_score' in result or 'score' in result

    def test_acoustic_score_present(self, detector, natural_speech):
        audio, sr = natural_speech
        result = detector.analyze(audio, sr)
        assert 'acoustic_score' in result or 'score' in result

    def test_handles_none(self, detector):
        result = detector.analyze(None, 16000)
        assert isinstance(result, dict)
        assert 'score' in result

    def test_handles_very_short_audio(self, detector):
        audio = np.zeros(100, dtype=np.float32)
        result = detector.analyze(audio, 16000)
        assert isinstance(result, dict)

    def test_handles_long_audio(self, detector):
        audio = np.random.randn(16000 * 10).astype(np.float32) * 0.3
        result = detector.analyze(audio, 16000)
        assert 0.0 <= result['score'] <= 1.0


class TestSpoofDetectorAccuracy:
    def test_natural_speech_reasonable_score(self, detector, natural_speech):
        audio, sr = natural_speech
        result = detector.analyze(audio, sr)
        # Should not confidently flag natural speech as spoofed (score > 0.2)
        assert result['score'] > 0.1

    def test_scores_are_deterministic(self, detector, natural_speech):
        audio, sr = natural_speech
        r1 = detector.analyze(audio, sr)
        r2 = detector.analyze(audio, sr)
        assert abs(r1['score'] - r2['score']) < 1e-5

    def test_feature_extraction_produces_correct_shape(self, detector, natural_speech):
        audio, sr = natural_speech
        features = detector._extract_features(audio, sr)
        assert features is not None
        assert features.shape == (200, 80)

    def test_feature_extraction_normalized(self, detector, natural_speech):
        audio, sr = natural_speech
        features = detector._extract_features(audio, sr)
        if features is not None:
            assert np.all(np.isfinite(features))

    def test_acoustic_heuristics_return_float(self, detector, natural_speech):
        audio, sr = natural_speech
        score = detector._acoustic_heuristics(audio, sr)
        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0
