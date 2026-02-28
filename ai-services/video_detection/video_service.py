"""
MedTrust AI - Video Deepfake Detection Service
gRPC server implementing:
  - MediaPipe face landmark extraction
  - EfficientNet spatial analysis
  - Temporal LSTM inconsistency detection
  - GAN artifact classifier
  - rPPG pulse extraction (ICA/PCA)
"""

import os
import sys
import time
import logging
import concurrent.futures
from typing import List, Iterator

import grpc
import numpy as np
import cv2
from loguru import logger
from dotenv import load_dotenv

# Add parent dir to path for proto imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from proto_gen import video_detection_pb2, video_detection_pb2_grpc

from .pipeline.spatial_analyzer import SpatialAnalyzer
from .pipeline.temporal_analyzer import TemporalAnalyzer
from .pipeline.gan_detector import GANDetector
from .pipeline.rppg_extractor import RPPGExtractor
from .pipeline.landmark_extractor import LandmarkExtractor

load_dotenv()

logging.basicConfig(level=logging.INFO)


class VideoDetectionServicer(video_detection_pb2_grpc.VideoDetectionServiceServicer):
    """
    Full video deepfake detection pipeline.
    Modular design: each detector is a separate pluggable component.
    """

    def __init__(self):
        logger.info("Initializing Video Detection Pipeline...")
        self.spatial_analyzer = SpatialAnalyzer()
        self.temporal_analyzer = TemporalAnalyzer(window_size=16)
        self.gan_detector = GANDetector()
        self.rppg_extractor = RPPGExtractor(method='ica')
        self.landmark_extractor = LandmarkExtractor()

        # Per-stream state for temporal analysis
        self._stream_buffers = {}
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        logger.info("Video Detection Pipeline initialized")

    def AnalyzeVideoChunk(
        self,
        request: video_detection_pb2.VideoChunkRequest,
        context: grpc.ServicerContext
    ) -> video_detection_pb2.VideoAnalysisResponse:
        start_time = time.time()
        stream_id = request.stream_id

        try:
            # Decode video chunk bytes to numpy frames
            frames = self._decode_chunk(request.chunk_data)
            if not frames:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details("Could not decode video chunk")
                return video_detection_pb2.VideoAnalysisResponse()

            # Extract face landmarks from the middle frame
            mid_frame = frames[len(frames) // 2]
            landmarks, landmark_proto = self.landmark_extractor.extract(mid_frame)

            # Run all detectors in parallel using thread pool
            futures = {
                'spatial': self._executor.submit(self.spatial_analyzer.analyze, frames),
                'gan':     self._executor.submit(self.gan_detector.analyze, frames),
                'rppg':    self._executor.submit(self.rppg_extractor.extract, frames, stream_id),
            }

            spatial_result = futures['spatial'].result(timeout=5.0)
            gan_result     = futures['gan'].result(timeout=5.0)
            rppg_result    = futures['rppg'].result(timeout=5.0)

            # Temporal analysis requires buffered frames
            self._update_stream_buffer(stream_id, frames)
            temporal_result = self.temporal_analyzer.analyze(
                self._stream_buffers.get(stream_id, frames)
            )

            processing_ms = int((time.time() - start_time) * 1000)

            logger.info(
                f"Video analysis [stream={stream_id}] "
                f"spatial={spatial_result['score']:.3f} "
                f"temporal={temporal_result['score']:.3f} "
                f"gan={gan_result['score']:.3f} "
                f"rppg={rppg_result['score']:.3f} "
                f"time={processing_ms}ms"
            )

            return video_detection_pb2.VideoAnalysisResponse(
                stream_id=stream_id,
                spatial_score=float(spatial_result['score']),
                temporal_score=float(temporal_result['score']),
                gan_score=float(gan_result['score']),
                rppg_score=float(rppg_result['score']),
                rppg_waveform=[float(v) for v in rppg_result.get('waveform', [])],
                landmarks=landmark_proto,
                processing_ms=processing_ms,
                model_version="1.0.0",
                debug_scores={
                    'efficientnet_confidence': spatial_result.get('confidence', 0.0),
                    'lstm_variance': temporal_result.get('variance', 0.0),
                    'gan_artifact_prob': gan_result.get('artifact_prob', 0.0),
                    'rppg_snr': rppg_result.get('snr', 0.0),
                }
            )

        except Exception as e:
            logger.error(f"Video analysis error: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return video_detection_pb2.VideoAnalysisResponse(
                stream_id=stream_id,
                spatial_score=0.5,
                temporal_score=0.5,
                gan_score=0.5,
                rppg_score=0.5,
                processing_ms=int((time.time() - start_time) * 1000),
                model_version="1.0.0",
            )

    def AnalyzeVideoStream(
        self,
        request_iterator: Iterator[video_detection_pb2.VideoChunkRequest],
        context: grpc.ServicerContext
    ) -> Iterator[video_detection_pb2.VideoAnalysisResponse]:
        """Bidirectional streaming RPC for continuous real-time analysis."""
        for request in request_iterator:
            if context.is_active():
                yield self.AnalyzeVideoChunk(request, context)
            else:
                break

    def GetModelInfo(
        self,
        request: video_detection_pb2.ModelInfoRequest,
        context: grpc.ServicerContext
    ) -> video_detection_pb2.ModelInfoResponse:
        import torch
        return video_detection_pb2.ModelInfoResponse(
            version="1.0.0",
            efficientnet_version="EfficientNet-B4",
            lstm_version="BiLSTM-256",
            gpu_enabled=torch.cuda.is_available(),
        )

    def _decode_chunk(self, chunk_data: bytes) -> List[np.ndarray]:
        """Decode raw video bytes to list of BGR numpy frames."""
        if not chunk_data:
            return []
        try:
            nparr = np.frombuffer(chunk_data, np.uint8)
            # Try decoding as a single image first
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is not None:
                return [frame]
            # Otherwise decode as video buffer
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as f:
                f.write(chunk_data)
                tmp_path = f.name
            frames = []
            cap = cv2.VideoCapture(tmp_path)
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break
                frames.append(frame)
            cap.release()
            os.unlink(tmp_path)
            return frames if frames else []
        except Exception as e:
            logger.error(f"Frame decode error: {e}")
            return []

    def _update_stream_buffer(self, stream_id: str, frames: List[np.ndarray], max_size: int = 32):
        """Maintain a rolling window of frames per stream for temporal analysis."""
        if stream_id not in self._stream_buffers:
            self._stream_buffers[stream_id] = []
        self._stream_buffers[stream_id].extend(frames)
        if len(self._stream_buffers[stream_id]) > max_size:
            self._stream_buffers[stream_id] = self._stream_buffers[stream_id][-max_size:]


def serve():
    port = int(os.getenv("VIDEO_SERVICE_PORT", "50051"))
    server = grpc.server(
        concurrent.futures.ThreadPoolExecutor(max_workers=10),
        options=[
            ('grpc.max_receive_message_length', 100 * 1024 * 1024),
            ('grpc.max_send_message_length', 100 * 1024 * 1024),
            ('grpc.keepalive_time_ms', 30000),
            ('grpc.keepalive_timeout_ms', 5000),
        ]
    )
    video_detection_pb2_grpc.add_VideoDetectionServiceServicer_to_server(
        VideoDetectionServicer(), server
    )
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    logger.info(f"Video Detection gRPC server started on port {port}")
    server.wait_for_termination()


if __name__ == '__main__':
    serve()
