"""
Shared PyTest fixtures and configuration for AI service tests.
"""
import sys
import os
import numpy as np
import pytest

# Ensure ai-services is on the path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../ai-services')))


def generate_speech(
    sr: int = 16000,
    duration: float = 2.0,
    fundamental: float = 150.0,
    harmonics: int = 8,
    noise: float = 0.02,
) -> np.ndarray:
    """Utility: generate synthetic harmonic speech signal."""
    t = np.linspace(0, duration, int(sr * duration))
    audio = sum(
        (1.0 / h) * np.sin(2 * np.pi * fundamental * h * t)
        for h in range(1, harmonics + 1)
    )
    audio += noise * np.random.randn(len(t))
    audio = audio / (np.max(np.abs(audio)) + 1e-8)
    return audio.astype(np.float32)


@pytest.fixture(scope='session')
def sample_rate():
    return 16000


@pytest.fixture(scope='session')
def speech_audio(sample_rate):
    return generate_speech(sr=sample_rate), sample_rate


@pytest.fixture(scope='session')
def long_speech_audio(sample_rate):
    return generate_speech(sr=sample_rate, duration=5.0), sample_rate


@pytest.fixture(scope='session')
def silent_audio(sample_rate):
    return np.zeros(sample_rate * 2, dtype=np.float32), sample_rate


@pytest.fixture(scope='session')
def noisy_audio(sample_rate):
    return (np.random.randn(sample_rate * 2) * 0.1).astype(np.float32), sample_rate
