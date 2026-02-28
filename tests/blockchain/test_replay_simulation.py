"""
Blockchain Replay Attack Simulation Tests
Tests the core replay detection logic of the MedTrust chaincode
by simulating what the Go chaincode enforces.
"""
import hashlib
import time
import pytest
from typing import List, Dict


def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()


class MockChaincodeLedger:
    """
    Python simulation of the MedTrust Fabric chaincode logic
    for testing purposes without a live Fabric network.
    """

    def __init__(self):
        self._chunks: Dict[str, dict] = {}
        self._stream_states: Dict[str, dict] = {}
        self._audit_events: List[dict] = []

    def log_chunk(self, stream_id: str, chunk_hash: str, chunk_type: str,
                  timestamp_ms: int, doctor_id: str) -> dict:
        state = self._get_or_create_state(stream_id, doctor_id)

        # Replay detection
        is_replay = chunk_hash in state['seen_hashes']
        if is_replay:
            state['replay_alerts'] += 1
            self._audit_events.append({
                'stream_id': stream_id,
                'event_type': 'REPLAY_ATTACK_DETECTED',
                'severity': 'critical',
                'hash': chunk_hash,
                'timestamp': timestamp_ms,
            })

        # Timestamp monotonicity check
        timestamp_violation = timestamp_ms < state['last_timestamp']
        if timestamp_violation:
            self._audit_events.append({
                'stream_id': stream_id,
                'event_type': 'TIMESTAMP_VIOLATION',
                'severity': 'warning',
                'timestamp': timestamp_ms,
            })

        state['chunk_count'] += 1
        state['last_timestamp'] = max(state['last_timestamp'], timestamp_ms)
        if chunk_type == 'video':
            state['video_count'] += 1
        else:
            state['audio_count'] += 1

        # Maintain rolling window of 200 hashes
        state['seen_hashes'].append(chunk_hash)
        if len(state['seen_hashes']) > 200:
            state['seen_hashes'] = state['seen_hashes'][-200:]

        key = f"chunk:{stream_id}:{state['chunk_count']}"
        record = {
            'stream_id': stream_id,
            'chunk_hash': 'REPLAY:' + chunk_hash if is_replay else chunk_hash,
            'chunk_type': chunk_type,
            'timestamp': timestamp_ms,
            'sequence': state['chunk_count'],
            'is_replay': is_replay,
            'timestamp_violation': timestamp_violation,
        }
        self._chunks[key] = record
        return record

    def validate_chunk(self, stream_id: str, chunk_hash: str) -> bool:
        state = self._stream_states.get(stream_id)
        if not state:
            return False
        return chunk_hash in state['seen_hashes']

    def detect_replay(self, stream_id: str) -> dict:
        state = self._stream_states.get(stream_id)
        if not state:
            return {'replay_detected': False, 'details': 'Stream not found'}
        if state['replay_alerts'] > 0:
            return {
                'replay_detected': True,
                'replay_count': state['replay_alerts'],
                'details': f"{state['replay_alerts']} replay attempts detected",
            }
        return {'replay_detected': False, 'details': 'No replay detected'}

    def get_stream_state(self, stream_id: str) -> dict:
        return self._stream_states.get(stream_id, {})

    def get_audit_events(self, stream_id: str = None) -> List[dict]:
        if stream_id:
            return [e for e in self._audit_events if e['stream_id'] == stream_id]
        return self._audit_events

    def _get_or_create_state(self, stream_id: str, doctor_id: str) -> dict:
        if stream_id not in self._stream_states:
            self._stream_states[stream_id] = {
                'stream_id': stream_id,
                'doctor_id': doctor_id,
                'chunk_count': 0,
                'video_count': 0,
                'audio_count': 0,
                'last_timestamp': 0,
                'seen_hashes': [],
                'replay_alerts': 0,
            }
        return self._stream_states[stream_id]


@pytest.fixture
def ledger():
    return MockChaincodeLedger()


@pytest.fixture
def stream_id():
    return f"stream-test-{int(time.time())}"


class TestNormalChunkLogging:
    def test_log_single_video_chunk(self, ledger, stream_id):
        h = sha256_hex("video_data_chunk_1")
        record = ledger.log_chunk(stream_id, h, 'video', 1000, 'doctor-1')
        assert record['is_replay'] is False
        assert record['chunk_hash'] == h

    def test_log_multiple_chunks_sequential(self, ledger, stream_id):
        for i in range(10):
            h = sha256_hex(f"chunk_data_{i}")
            ts = 1000 + i * 2000
            record = ledger.log_chunk(stream_id, h, 'video', ts, 'doctor-1')
            assert record['is_replay'] is False

        state = ledger.get_stream_state(stream_id)
        assert state['chunk_count'] == 10
        assert state['replay_alerts'] == 0

    def test_chunk_count_tracked(self, ledger, stream_id):
        for i in range(5):
            ledger.log_chunk(stream_id, sha256_hex(f"d_{i}"), 'video', i * 1000, 'doc')
        state = ledger.get_stream_state(stream_id)
        assert state['chunk_count'] == 5

    def test_video_audio_counts_separate(self, ledger, stream_id):
        ledger.log_chunk(stream_id, sha256_hex("v1"), 'video', 1000, 'doc')
        ledger.log_chunk(stream_id, sha256_hex("v2"), 'video', 2000, 'doc')
        ledger.log_chunk(stream_id, sha256_hex("a1"), 'audio', 3000, 'doc')
        state = ledger.get_stream_state(stream_id)
        assert state['video_count'] == 2
        assert state['audio_count'] == 1

    def test_validate_logged_chunk(self, ledger, stream_id):
        h = sha256_hex("unique_data_abc")
        ledger.log_chunk(stream_id, h, 'video', 1000, 'doc')
        assert ledger.validate_chunk(stream_id, h) is True

    def test_validate_unknown_chunk_fails(self, ledger, stream_id):
        assert ledger.validate_chunk(stream_id, sha256_hex("not_logged")) is False


class TestReplayAttackDetection:
    def test_replay_detected_on_duplicate_hash(self, ledger, stream_id):
        h = sha256_hex("video_frame_data")
        ledger.log_chunk(stream_id, h, 'video', 1000, 'doc')
        record = ledger.log_chunk(stream_id, h, 'video', 5000, 'doc')
        assert record['is_replay'] is True
        assert 'REPLAY:' in record['chunk_hash']

    def test_replay_alert_counter_increments(self, ledger, stream_id):
        h = sha256_hex("repeated_chunk")
        ledger.log_chunk(stream_id, h, 'video', 1000, 'doc')
        ledger.log_chunk(stream_id, h, 'video', 2000, 'doc')
        ledger.log_chunk(stream_id, h, 'video', 3000, 'doc')
        state = ledger.get_stream_state(stream_id)
        assert state['replay_alerts'] == 2

    def test_detect_replay_returns_true(self, ledger, stream_id):
        h = sha256_hex("replay_test_data")
        ledger.log_chunk(stream_id, h, 'video', 1000, 'doc')
        ledger.log_chunk(stream_id, h, 'video', 5000, 'doc')
        result = ledger.detect_replay(stream_id)
        assert result['replay_detected'] is True
        assert result['replay_count'] >= 1

    def test_no_replay_for_unique_chunks(self, ledger, stream_id):
        for i in range(20):
            ledger.log_chunk(stream_id, sha256_hex(f"unique_{i}_data"), 'video', i * 1000, 'doc')
        result = ledger.detect_replay(stream_id)
        assert result['replay_detected'] is False

    def test_replay_audit_event_generated(self, ledger, stream_id):
        h = sha256_hex("audit_test_data")
        ledger.log_chunk(stream_id, h, 'video', 1000, 'doc')
        ledger.log_chunk(stream_id, h, 'video', 5000, 'doc')
        events = ledger.get_audit_events(stream_id)
        replay_events = [e for e in events if e['event_type'] == 'REPLAY_ATTACK_DETECTED']
        assert len(replay_events) >= 1

    def test_sliding_window_evicts_old_hashes(self, ledger, stream_id):
        """After 200 unique chunks, oldest hashes should be evicted."""
        hashes = []
        for i in range(210):
            h = sha256_hex(f"window_chunk_{i}")
            hashes.append(h)
            ledger.log_chunk(stream_id, h, 'video', i * 1000, 'doc')

        state = ledger.get_stream_state(stream_id)
        assert len(state['seen_hashes']) <= 200
        # First hash should have been evicted
        assert hashes[0] not in state['seen_hashes']
        # Most recent hash should still be present
        assert hashes[-1] in state['seen_hashes']


class TestTimestampValidation:
    def test_non_monotonic_timestamp_flagged(self, ledger, stream_id):
        ledger.log_chunk(stream_id, sha256_hex("c1"), 'video', 5000, 'doc')
        record = ledger.log_chunk(stream_id, sha256_hex("c2"), 'video', 1000, 'doc')
        # Should be flagged as timestamp violation
        assert record['timestamp_violation'] is True

    def test_monotonic_timestamps_no_violation(self, ledger, stream_id):
        for i in range(5):
            record = ledger.log_chunk(
                stream_id, sha256_hex(f"mono_{i}"), 'video', (i + 1) * 2000, 'doc'
            )
            assert record['timestamp_violation'] is False

    def test_timestamp_violation_audit_event(self, ledger, stream_id):
        ledger.log_chunk(stream_id, sha256_hex("t1"), 'video', 10000, 'doc')
        ledger.log_chunk(stream_id, sha256_hex("t2"), 'video', 1000, 'doc')
        events = ledger.get_audit_events(stream_id)
        ts_events = [e for e in events if e['event_type'] == 'TIMESTAMP_VIOLATION']
        assert len(ts_events) >= 1
