const { v4: uuidv4 } = require('uuid');
const { grpcCall, getVideoClient, getAudioClient, getBiometricClient } = require('../config/grpc');
const { computeTrustScore } = require('../services/trustScoreService');
const { logVideoChunk, logAudioChunk, validateChunkIntegrity, getBlockchainIntegrityScore } = require('../services/blockchainService');
const { getTrustScore } = require('../config/redis');
const { query } = require('../config/database');
const { logger } = require('../middleware/errorHandler');

// POST /api/v1/analyze/video
const analyzeVideo = async (req, res) => {
  const { stream_id, chunk_data, timestamp, frame_rate } = req.body;
  const doctorId = req.user.id;

  let videoScores = null;
  let blockchainResult = null;
  let blockchainScore = 1.0;

  // Run video analysis and blockchain logging in parallel
  const [videoResult, bcResult] = await Promise.allSettled([
    (async () => {
      const videoClient = getVideoClient();
      if (!videoClient) throw new Error('Video AI service unavailable');
      return await grpcCall(videoClient, 'AnalyzeVideoChunk', {
        stream_id,
        chunk_data,
        timestamp,
        frame_rate: frame_rate || 30,
        doctor_id: doctorId,
      });
    })(),
    logVideoChunk(stream_id, chunk_data, timestamp, doctorId),
  ]);

  if (videoResult.status === 'fulfilled') {
    videoScores = videoResult.value;
  } else {
    logger.warn('Video AI analysis failed, using defaults:', videoResult.reason?.message);
    // Fallback: return a degraded score when AI service is unavailable
    videoScores = { spatial_score: 0.5, temporal_score: 0.5, gan_score: 0.5, rppg_score: 0.5, rppg_waveform: [] };
  }

  if (bcResult.status === 'fulfilled') {
    blockchainResult = bcResult.value;
    blockchainScore = blockchainResult.txId ? 1.0 : 0.8;
  } else {
    blockchainScore = 0.7;
  }

  // Get current cached voice/biometric scores for this stream
  const cachedScores = await getTrustScore(stream_id);
  const voiceScore = cachedScores?.voice_score ? cachedScores.voice_score / 100 : 0.8;
  const biometricScore = cachedScores?.biometric_score ? cachedScores.biometric_score / 100 : 0.8;

  const trustResult = await computeTrustScore({
    streamId: stream_id,
    videoScores,
    voiceScore,
    biometricScore,
    blockchainScore,
  });

  res.json({
    ...trustResult,
    analysis_type: 'video',
    blockchain: blockchainResult,
    video_detail: videoScores,
  });
};

// POST /api/v1/analyze/audio
const analyzeAudio = async (req, res) => {
  const { stream_id, audio_data, timestamp, sample_rate } = req.body;
  const doctorId = req.user.id;

  let voiceScore = 0.8;
  let blockchainResult = null;
  let blockchainScore = 1.0;

  const [audioResult, bcResult] = await Promise.allSettled([
    (async () => {
      const audioClient = getAudioClient();
      if (!audioClient) throw new Error('Audio AI service unavailable');
      return await grpcCall(audioClient, 'AnalyzeAudioChunk', {
        stream_id,
        audio_data,
        timestamp,
        sample_rate: sample_rate || 16000,
        doctor_id: doctorId,
      });
    })(),
    logAudioChunk(stream_id, audio_data, timestamp, doctorId),
  ]);

  if (audioResult.status === 'fulfilled') {
    voiceScore = audioResult.value.voice_score;
  } else {
    logger.warn('Audio AI analysis failed, using defaults:', audioResult.reason?.message);
    voiceScore = 0.5;
  }

  if (bcResult.status === 'fulfilled') {
    blockchainResult = bcResult.value;
    blockchainScore = blockchainResult.txId ? 1.0 : 0.8;
  } else {
    blockchainScore = 0.7;
  }

  const cachedScores = await getTrustScore(stream_id);
  const videoScores = cachedScores
    ? {
        spatial_score: (cachedScores.video_score || 50) / 100,
        temporal_score: (cachedScores.video_score || 50) / 100,
        gan_score: (cachedScores.video_score || 50) / 100,
        rppg_score: 0.8,
        rppg_waveform: cachedScores.detail?.rppg_waveform || [],
      }
    : { spatial_score: 0.8, temporal_score: 0.8, gan_score: 0.8, rppg_score: 0.8, rppg_waveform: [] };

  const biometricScore = cachedScores?.biometric_score ? cachedScores.biometric_score / 100 : 0.8;

  const trustResult = await computeTrustScore({
    streamId: stream_id,
    videoScores,
    voiceScore,
    biometricScore,
    blockchainScore,
  });

  res.json({
    ...trustResult,
    analysis_type: 'audio',
    blockchain: blockchainResult,
    voice_detail: { voice_score: voiceScore },
  });
};

// ── PHASE 1: param validation helper ─────────────────────────────────────────
const isValidStreamId = (id) => {
  if (!id || typeof id !== 'string') return false;
  if (id.length < 8) return false;
  if (id.includes('<') || id.includes('>')) return false;
  if (id.includes('%3C') || id.includes('%3E')) return false;
  if (id === '<stream-id>' || id === ':streamId') return false;
  return true;
};

// GET /api/v1/trustscore/live/:streamId
const getLiveTrustScore = async (req, res) => {
  // PHASE 1: validate param before touching any service
  const { streamId } = req.params;

  if (!isValidStreamId(streamId)) {
    return res.status(400).json({
      error: 'Invalid stream ID',
      trust_score: 0,
    });
  }

  // PHASE 2: full try/catch — never let this 500
  try {
    logger.info(`[TRUST FETCH] stream=${streamId}`);

    // PHASE 4: Redis cache — isolated, never throws (redis.js now safe)
    let cached = null;
    try {
      cached = await getTrustScore(streamId);
    } catch (redisErr) {
      logger.warn('[TRUST FETCH] Redis unavailable, falling back to DB', { streamId, error: redisErr.message });
    }

    if (cached) {
      // PHASE 5: null-safe response from cache
      return res.json({
        trust_score:      cached.trust_score      ?? 0,
        video_score:      cached.video_score      ?? 0,
        voice_score:      cached.voice_score      ?? 0,
        biometric_score:  cached.biometric_score  ?? 0,
        blockchain_score: cached.blockchain_score ?? 0,
        status:           cached.status           ?? 'standby',
        stream_id:        streamId,
        source:           'cache',
        timestamp:        cached.timestamp        ?? new Date().toISOString(),
      });
    }

    // PHASE 3: DB fallback
    const result = await query(
      `SELECT trust_score, video_score, voice_score, biometric_score, blockchain_score, status, created_at
       FROM trust_logs WHERE stream_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [streamId]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'Session not active',
        trust_score: null,
        status: 'inactive',
        stream_id: streamId,
      });
    }

    const row = result.rows[0];

    // PHASE 5: null-safe response from DB
    return res.json({
      trust_score:      parseFloat(row.trust_score)      || 0,
      video_score:      parseFloat(row.video_score)      || 0,
      voice_score:      parseFloat(row.voice_score)      || 0,
      biometric_score:  parseFloat(row.biometric_score)  || 0,
      blockchain_score: parseFloat(row.blockchain_score) || 0,
      status:           row.status                       ?? 'standby',
      stream_id:        streamId,
      source:           'database',
      timestamp:        row.created_at                   ?? new Date().toISOString(),
    });

  } catch (err) {
    logger.error('[TRUST LIVE ERROR]', { streamId, error: err.message, code: err.code });
    return res.status(503).json({
      error:            'Service temporarily unavailable',
      trust_score:       null,
      status:            'error',
      stream_id:         streamId,
    });
  }
};

// GET /api/v1/trustscore/history/:streamId
const getTrustHistory = async (req, res) => {
  const { streamId } = req.params;

  if (!isValidStreamId(streamId)) {
    return res.status(400).json({
      error: 'Invalid stream ID',
      history: [],
      stream_id: streamId,
    });
  }

  try {
    const limit = Math.min(parseInt(req.query.limit) || 60, 500);

    const result = await query(
      `SELECT trust_score, video_score, voice_score, biometric_score, blockchain_score, status, created_at
       FROM trust_logs WHERE stream_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [streamId, limit]
    );

    const rows = (result.rows || []).map((row) => ({
      trust_score:      parseFloat(row.trust_score)      || 0,
      video_score:      parseFloat(row.video_score)      || 0,
      voice_score:      parseFloat(row.voice_score)      || 0,
      biometric_score:  parseFloat(row.biometric_score)  || 0,
      blockchain_score: parseFloat(row.blockchain_score) || 0,
      status:           row.status    ?? 'standby',
      created_at:       row.created_at ?? new Date().toISOString(),
    }));

    return res.json({
      history:   rows.reverse(),
      stream_id: streamId,
      count:     rows.length,
    });

  } catch (err) {
    logger.error('[TRUST HISTORY ERROR]', {
      streamId,
      error: err.message,
      code:  err.code,
    });
    return res.status(500).json({
      error:     'Failed to fetch trust history',
      history:   [],
      stream_id: streamId,
    });
  }
};

module.exports = { analyzeVideo, analyzeAudio, getLiveTrustScore, getTrustHistory };
