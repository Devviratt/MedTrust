"""
MediaPipe Face Landmark Extractor
Extracts 468 3D face landmarks used for:
- Face region detection for rPPG ROI
- Landmark consistency analysis
- Identity verification support
"""

import numpy as np
import cv2
from typing import List, Optional, Tuple
from loguru import logger

try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    MEDIAPIPE_AVAILABLE = False
    logger.warning("MediaPipe not available, landmark extraction will use fallback")


class LandmarkExtractor:
    """
    Extracts facial landmarks using MediaPipe FaceMesh.
    Returns 468 3D landmarks + proto message for gRPC response.
    """

    def __init__(self, max_faces: int = 1, refine_landmarks: bool = True):
        self.max_faces = max_faces
        if MEDIAPIPE_AVAILABLE:
            self.mp_face_mesh = mp.solutions.face_mesh
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=max_faces,
                refine_landmarks=refine_landmarks,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            logger.info("MediaPipe FaceMesh initialized")
        else:
            self.face_mesh = None
            # Fallback: Haar cascade
            self.face_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            )

    def extract(self, frame: np.ndarray) -> Tuple[List, List]:
        """
        Extract landmarks from frame.
        Returns (landmarks_list, proto_list) where each landmark has x, y, z, index.
        """
        if frame is None or frame.size == 0:
            return [], []

        if MEDIAPIPE_AVAILABLE and self.face_mesh:
            return self._extract_mediapipe(frame)
        else:
            return self._extract_fallback(frame)

    def _extract_mediapipe(self, frame: np.ndarray) -> Tuple[List, List]:
        """Full MediaPipe landmark extraction."""
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.face_mesh.process(rgb)

            if not results.multi_face_landmarks:
                return [], []

            landmarks_list = []
            proto_list = []

            for face_landmarks in results.multi_face_landmarks[:self.max_faces]:
                for idx, lm in enumerate(face_landmarks.landmark):
                    landmarks_list.append({
                        'x': lm.x, 'y': lm.y, 'z': lm.z, 'index': idx
                    })
                    # For proto we import inline to avoid circular dependency issues
                    proto_list.append({'x': lm.x, 'y': lm.y, 'z': lm.z, 'index': idx})

            return landmarks_list, proto_list
        except Exception as e:
            logger.debug(f"MediaPipe extraction error: {e}")
            return [], []

    def _extract_fallback(self, frame: np.ndarray) -> Tuple[List, List]:
        """Haar cascade fallback returning 4 bounding box corner landmarks."""
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(30, 30))
            if len(faces) == 0:
                return [], []

            x, y, w, h = faces[0]
            H, W = frame.shape[:2]
            landmarks = [
                {'x': x / W, 'y': y / H, 'z': 0.0, 'index': 0},
                {'x': (x + w) / W, 'y': y / H, 'z': 0.0, 'index': 1},
                {'x': (x + w) / W, 'y': (y + h) / H, 'z': 0.0, 'index': 2},
                {'x': x / W, 'y': (y + h) / H, 'z': 0.0, 'index': 3},
            ]
            return landmarks, landmarks
        except Exception:
            return [], []

    def get_forehead_roi(self, frame: np.ndarray, landmarks: List[dict]) -> Optional[np.ndarray]:
        """Extract forehead region from landmarks for rPPG analysis."""
        if not landmarks:
            return None
        try:
            h, w = frame.shape[:2]
            # MediaPipe forehead landmark indices (approximate)
            forehead_indices = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
            points = []
            for lm in landmarks:
                if lm['index'] in forehead_indices:
                    points.append((int(lm['x'] * w), int(lm['y'] * h)))

            if len(points) < 3:
                return None

            pts = np.array(points, dtype=np.int32)
            x, y, rw, rh = cv2.boundingRect(pts)
            roi = frame[max(0, y):min(h, y + rh), max(0, x):min(w, x + rw)]
            return roi if roi.size > 0 else None
        except Exception:
            return None
