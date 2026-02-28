"""
MedTrust AI - Audio/Voice Deepfake Detection Service
gRPC server implementing:
  - MFCC extraction
  - Spectrogram CNN classifier
  - Wav2Vec2 speaker embedding verification
  - Transformer spoof detection
"""

import os
import sys
import io
import time
import concurrent.futures
from typing import List

import grpc
import numpy as np
from loguru import logger
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from proto_gen import audio_detection_pb2, audio_detection_pb2_grpc

from .pipeline.mfcc_analyzer import MFCCAnalyzer
from .pipeline.spectrogram_cnn import SpectrogramCNN
from .pipeline.wav2vec_verifier import Wav2VecVerifier
from .pipeline.spoof_detector import SpoofDetector

load_dotenv()


class AudioDetectionServicer(audio_detection_pb2_grpc.AudioDetectionServiceServicer):
    """
    Full voice deepfake detection pipeline.
    Modular: each detector is independently pluggable.
    """

    def __init__(self):
        logger.info("Initializing Audio Detection Pipeline...")
        self.mfcc_analyzer = MFCCAnalyzer()
        self.spectrogram_cnn = SpectrogramCNN()
        self.wav2vec_verifier = Wav2VecVerifier()
        self.spoof_detector = SpoofDetector()
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        logger.info("Audio Detection Pipeline initialized")

    def AnalyzeAudioChunk(
        self,
        request: audio_detection_pb2.AudioChunkRequest,
        context: grpc.ServicerContext
    ) -> audio_detection_pb2.AudioAnalysisResponse:
        start_time = time.time()
        stream_id = request.stream_id

        try:
            # Decode audio bytes to numpy waveform
            audio_array, sample_rate = self._decode_audio(request.audio_data, request.sample_rate)

            if audio_array is None or len(audio_array) == 0:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("Could not decode audio chunk")
                return audio_detection_pb2.AudioAnalysisResponse()

            # Run all analyzers in parallel
            futures = {
                'mfcc':       self._executor.submit(self.mfcc_analyzer.analyze, audio_array, sample_rate),
                'spectrogram':self._executor.submit(self.spectrogram_cnn.analyze, audio_array, sample_rate),
                'spoof':      self._executor.submit(self.spoof_detector.analyze, audio_array, sample_rate),
            }

            # Wav2Vec requires doctor embedding for speaker verification
            wav2vec_future = self._executor.submit(
                self.wav2vec_verifier.verify,
                audio_array, sample_rate, request.doctor_id
            )

            mfcc_result      = futures['mfcc'].result(timeout=8.0)
            spectrogram_result = futures['spectrogram'].result(timeout=8.0)
            spoof_result     = futures['spoof'].result(timeout=8.0)
            wav2vec_result   = wav2vec_future.result(timeout=10.0)

            # Composite voice score (weighted ensemble)
            voice_score = (
                mfcc_result['score']        * 0.20 +
                spectrogram_result['score'] * 0.30 +
                wav2vec_result['score']     * 0.30 +
                spoof_result['score']       * 0.20
            )

            processing_ms = int((time.time() - start_time) * 1000)

            logger.info(
                f"Audio analysis [stream={stream_id}] "
                f"mfcc={mfcc_result['score']:.3f} "
                f"spec={spectrogram_result['score']:.3f} "
                f"w2v={wav2vec_result['score']:.3f} "
                f"spoof={spoof_result['score']:.3f} "
                f"composite={voice_score:.3f} time={processing_ms}ms"
            )

            return audio_detection_pb2.AudioAnalysisResponse(
                stream_id=stream_id,
                voice_score=float(voice_score),
                mfcc_score=float(mfcc_result['score']),
                spectrogram_score=float(spectrogram_result['score']),
                wav2vec_score=float(wav2vec_result['score']),
                spoof_score=float(spoof_result['score']),
                mfcc_features=[float(v) for v in mfcc_result.get('features', [])[:20]],
                processing_ms=processing_ms,
                model_version="1.0.0",
            )

        except Exception as e:
            logger.error(f"Audio analysis error: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return audio_detection_pb2.AudioAnalysisResponse(
                stream_id=stream_id,
                voice_score=0.5,
                processing_ms=int((time.time() - start_time) * 1000),
                model_version="1.0.0",
            )

    def TrainVoiceProfile(
        self,
        request: audio_detection_pb2.VoiceTrainingRequest,
        context: grpc.ServicerContext
    ) -> audio_detection_pb2.VoiceTrainingResponse:
        """Train a speaker embedding profile for a doctor."""
        try:
            doctor_id = request.doctor_id
            samples = request.audio_samples

            if not samples:
                return audio_detection_pb2.VoiceTrainingResponse(
                    success=False, message="No audio samples provided"
                )

            audio_arrays = []
            for sample_bytes in samples:
                arr, sr = self._decode_audio(sample_bytes, 16000)
                if arr is not None:
                    audio_arrays.append((arr, sr))

            if not audio_arrays:
                return audio_detection_pb2.VoiceTrainingResponse(
                    success=False, message="Failed to decode audio samples"
                )

            embedding = self.wav2vec_verifier.train_profile(doctor_id, audio_arrays)

            logger.info(f"Voice profile trained for doctor {doctor_id}")

            return audio_detection_pb2.VoiceTrainingResponse(
                doctor_id=doctor_id,
                embedding=[float(v) for v in embedding],
                model_version="wav2vec2-large-xlsr",
                success=True,
                message=f"Voice profile trained with {len(audio_arrays)} samples",
            )

        except Exception as e:
            logger.error(f"Voice training error: {e}", exc_info=True)
            return audio_detection_pb2.VoiceTrainingResponse(
                success=False, message=str(e)
            )

    def VerifySpeaker(
        self,
        request: audio_detection_pb2.SpeakerVerifyRequest,
        context: grpc.ServicerContext
    ) -> audio_detection_pb2.SpeakerVerifyResponse:
        """Verify if audio matches registered doctor's voice profile."""
        try:
            audio_array, sample_rate = self._decode_audio(request.audio_data, 16000)
            result = self.wav2vec_verifier.verify(audio_array, sample_rate, request.doctor_id)

            return audio_detection_pb2.SpeakerVerifyResponse(
                similarity=float(result['similarity']),
                verified=bool(result['verified']),
                doctor_id=request.doctor_id,
            )
        except Exception as e:
            logger.error(f"Speaker verification error: {e}")
            return audio_detection_pb2.SpeakerVerifyResponse(
                similarity=0.0, verified=False, doctor_id=request.doctor_id
            )

    def _decode_audio(self, audio_bytes: bytes, target_sr: int = 16000):
        """Decode audio bytes to numpy waveform."""
        if not audio_bytes:
            return None, target_sr
        try:
            import soundfile as sf
            import librosa
            buf = io.BytesIO(audio_bytes)
            audio, sr = sf.read(buf, dtype='float32')
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)  # Stereo to mono
            if sr != target_sr:
                audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
            return audio, target_sr
        except Exception as e:
            try:
                import librosa
                buf = io.BytesIO(audio_bytes)
                audio, sr = librosa.load(buf, sr=target_sr, mono=True)
                return audio, target_sr
            except Exception as e2:
                logger.error(f"Audio decode failed: {e2}")
                return None, target_sr


def serve():
    port = int(os.getenv("AUDIO_SERVICE_PORT", "50052"))
    server = grpc.server(
        concurrent.futures.ThreadPoolExecutor(max_workers=10),
        options=[
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),
            ('grpc.max_send_message_length', 50 * 1024 * 1024),
        ]
    )
    audio_detection_pb2_grpc.add_AudioDetectionServiceServicer_to_server(
        AudioDetectionServicer(), server
    )
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    logger.info(f"Audio Detection gRPC server started on port {port}")
    server.wait_for_termination()


if __name__ == '__main__':
    serve()
