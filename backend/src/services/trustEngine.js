/**
 * trustEngine.js
 *
 * Real trust score computation pipeline.
 * Calls gRPC AI services (video / audio / biometric).
 * If a service is offline, falls back to the last known cached value for
 * that modality — never falls back to random numbers.
 * Uses the existing trustScoreService.computeTrustScore() for the weighted
 * formula (0.4*video + 0.3*voice + 0.2*biometric + 0.1*blockchain) and
 * for Redis caching + DB persistence.
 */

'use strict';

const { grpcCall, getVideoClient, getAudioClient, getBiometricClient } = require('../config/grpc');
const { getTrustScore }      = require('../config/redis');
const { computeTrustScore }  = require('./trustScoreService');
const { logger }             = require('../middleware/errorHandler');

// ── Fallback sentinel values ──────────────────────────────────────────────────
// Used only when a modality has NEVER produced a result for this stream.
// These represent "unknown / not yet measured" — not fake data.
const FALLBACK_VIDEO_SCORES = {
  spatial_score:  null,
  temporal_score: null,
  gan_score:      null,
  rppg_score:     null,
  rppg_waveform:  [],
};

const NULL_VOICE_SCORE      = null;   // will map to 50 in computeTrustScore
const NULL_BIOMETRIC_SCORE  = null;
const NULL_BLOCKCHAIN_SCORE = 1.0;   // blockchain is always valid unless we detect replay

// ── Helper: call gRPC video service ──────────────────────────────────────────
const fetchVideoScores = async (streamId) => {
  const client = getVideoClient();
  if (!client) {
    logger.debug('[trustEngine] video gRPC client unavailable', { streamId });
    return null;
  }
  try {
    const res = await grpcCall(client, 'AnalyzeVideoChunk', {
      stream_id:  streamId,
      chunk_data: Buffer.alloc(0),   // empty → service uses last buffered frame
      timestamp:  Date.now(),
      frame_rate: 30,
      doctor_id:  '',
    });
    return {
      spatial_score:  res.spatial_score  ?? null,
      temporal_score: res.temporal_score ?? null,
      gan_score:      res.gan_score      ?? null,
      rppg_score:     res.rppg_score     ?? null,
      rppg_waveform:  res.rppg_waveform  ?? [],
    };
  } catch (err) {
    logger.warn('[trustEngine] video gRPC call failed', { streamId, error: err.message });
    return null;
  }
};

// ── Helper: call gRPC audio service ──────────────────────────────────────────
const fetchVoiceScore = async (streamId) => {
  const client = getAudioClient();
  if (!client) {
    logger.debug('[trustEngine] audio gRPC client unavailable', { streamId });
    return null;
  }
  try {
    const res = await grpcCall(client, 'AnalyzeAudioChunk', {
      stream_id:   streamId,
      audio_data:  Buffer.alloc(0),
      timestamp:   Date.now(),
      sample_rate: 16000,
      doctor_id:   '',
    });
    return typeof res.voice_score === 'number' ? res.voice_score : null;
  } catch (err) {
    logger.warn('[trustEngine] audio gRPC call failed', { streamId, error: err.message });
    return null;
  }
};

// ── Helper: call gRPC biometric service ──────────────────────────────────────
const fetchBiometricScore = async (streamId, rppgWaveform) => {
  const client = getBiometricClient();
  if (!client) {
    logger.debug('[trustEngine] biometric gRPC client unavailable', { streamId });
    return null;
  }
  try {
    const res = await grpcCall(client, 'SyncBiometrics', {
      stream_id:   streamId,
      rppg_signal: rppgWaveform && rppgWaveform.length > 0 ? rppgWaveform : [],
      ecg_signal:  [],
      sample_rate: 30,
      timestamp:   Date.now(),
    });
    return typeof res.sync_score === 'number' ? res.sync_score : null;
  } catch (err) {
    logger.warn('[trustEngine] biometric gRPC call failed', { streamId, error: err.message });
    return null;
  }
};

// ── Main export: processFrame ─────────────────────────────────────────────────
/**
 * processFrame(streamId)
 *
 * 1. Fetch results from all three AI services in parallel (each has its own
 *    try/catch so one failure does not block the others).
 * 2. For any service that is offline, fall back to the last-known cached
 *    value for that modality (from Redis).  If there is no cached value yet,
 *    use the null sentinel which computeTrustScore maps to 50/100.
 * 3. Call computeTrustScore() — this applies admin-configurable weights,
 *    writes to Redis, and inserts a row into trust_logs.
 * 4. Return the full result object.
 */
const processFrame = async (streamId) => {
  // Fetch cached scores for fallback BEFORE the gRPC calls so we always
  // have something to fall back to even if Redis is slow.
  const cached = await getTrustScore(streamId).catch(() => null);

  // Fire all three AI services in parallel — failures are isolated
  const [videoResult, voiceResult, biometricResult] = await Promise.all([
    fetchVideoScores(streamId),
    fetchVoiceScore(streamId),
    fetchBiometricScore(streamId, cached?.detail?.rppg_waveform),
  ]);

  // ── Video scores ────────────────────────────────────────────────────────────
  let videoScores;
  if (videoResult !== null) {
    videoScores = videoResult;
  } else if (cached?.video_score != null) {
    // Reconstruct a synthetic videoScores object from the cached composite
    // so that computeTrustScore() can re-weight correctly.
    const v = cached.video_score / 100;
    videoScores = {
      spatial_score:  v,
      temporal_score: v,
      gan_score:      v,
      rppg_score:     cached.detail?.rppg_score ?? v,
      rppg_waveform:  cached.detail?.rppg_waveform ?? [],
    };
  } else {
    videoScores = FALLBACK_VIDEO_SCORES;
  }

  // ── Voice score ─────────────────────────────────────────────────────────────
  let voiceScore;
  if (voiceResult !== null) {
    voiceScore = voiceResult;
  } else if (cached?.voice_score != null) {
    voiceScore = cached.voice_score / 100;
  } else {
    voiceScore = NULL_VOICE_SCORE;
  }

  // ── Biometric score ─────────────────────────────────────────────────────────
  let biometricScore;
  if (biometricResult !== null) {
    biometricScore = biometricResult;
  } else if (cached?.biometric_score != null) {
    biometricScore = cached.biometric_score / 100;
  } else {
    biometricScore = NULL_BIOMETRIC_SCORE;
  }

  // ── Blockchain score ────────────────────────────────────────────────────────
  // Always 1.0 unless we detect a replay attack (handled upstream).
  const blockchainScore = NULL_BLOCKCHAIN_SCORE;

  const result = await computeTrustScore({
    streamId,
    videoScores,
    voiceScore,
    biometricScore,
    blockchainScore,
  });

  logger.info('[trustEngine] frame processed', {
    streamId,
    trust_score:    result.trust_score,
    status:         result.status,
    video_live:     videoResult !== null,
    voice_live:     voiceResult !== null,
    biometric_live: biometricResult !== null,
  });

  return result;
};

module.exports = { processFrame };
