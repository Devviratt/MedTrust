const { getCache, setCache, setTrustScore } = require('../config/redis');
const { query } = require('../config/database');
const { logger } = require('../middleware/errorHandler');

// Default weights (can be overridden by admin config)
const DEFAULT_WEIGHTS = {
  video: 0.40,
  voice: 0.30,
  biometric: 0.20,
  blockchain: 0.10,
};

// Default thresholds
const DEFAULT_THRESHOLDS = {
  safe: 75,
  suspicious: 50,
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp01 = (value, fallback = 0.5) => {
  const n = toNumber(value, fallback);
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

const clamp100 = (value, fallback = 50) => {
  const n = toNumber(value, fallback);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
};

const getLegacyValue = (source, key, fallback) => {
  const raw = source?.[key];
  if (raw && typeof raw === 'object' && raw.value !== undefined) {
    return toNumber(raw.value, fallback);
  }
  return toNumber(raw, fallback);
};

const getAdminConfig = async () => {
  const cached = await getCache('admin:config');
  if (cached) return cached;

  const result = await query('SELECT config_key, config_value FROM admin_configurations');
  const config = {};
  result.rows.forEach((row) => {
    config[row.config_key] = parseFloat(row.config_value);
  });

  await setCache('admin:config', config, 60);
  return config;
};

const computeTrustScore = async (...args) => {
  let streamId;
  let videoScores;
  let voiceScore;
  let biometricScore;
  let blockchainScore;
  let config = {};

  const isObjectMode =
    args.length === 1 &&
    args[0] &&
    typeof args[0] === 'object' &&
    (Object.prototype.hasOwnProperty.call(args[0], 'streamId') ||
      Object.prototype.hasOwnProperty.call(args[0], 'videoScores'));

  if (isObjectMode) {
    ({ streamId, videoScores, voiceScore, biometricScore, blockchainScore } = args[0]);
    config = await getAdminConfig();
  } else {
    // Backward-compatible signature used in unit tests:
    // computeTrustScore(video, voice, biometric, blockchain, weights)
    const [legacyVideo, legacyVoice, legacyBiometric, legacyBlockchain, legacyWeights] = args;

    streamId = null;
    videoScores = legacyVideo;
    voiceScore = typeof legacyVoice === 'number' ? legacyVoice : legacyVoice?.overall_score;
    biometricScore = typeof legacyBiometric === 'number' ? legacyBiometric : legacyBiometric?.sync_score;
    blockchainScore =
      typeof legacyBlockchain === 'number' ? legacyBlockchain : legacyBlockchain?.integrity_score;

    config = {
      video_weight: getLegacyValue(legacyWeights, 'video_weight', DEFAULT_WEIGHTS.video),
      voice_weight: getLegacyValue(legacyWeights, 'voice_weight', DEFAULT_WEIGHTS.voice),
      biometric_weight: getLegacyValue(legacyWeights, 'biometric_weight', DEFAULT_WEIGHTS.biometric),
      blockchain_weight: getLegacyValue(legacyWeights, 'blockchain_weight', DEFAULT_WEIGHTS.blockchain),
      safe_threshold: getLegacyValue(legacyWeights, 'safe_threshold', DEFAULT_THRESHOLDS.safe),
      suspicious_threshold: getLegacyValue(
        legacyWeights,
        'suspicious_threshold',
        DEFAULT_THRESHOLDS.suspicious
      ),
    };

    if (videoScores && typeof videoScores.overall_score === 'number') {
      const v = clamp01(videoScores.overall_score);
      videoScores = { spatial_score: v, temporal_score: v, gan_score: v, rppg_score: v };
    }
  }

  const weights = {
    video: toNumber(config.video_weight, DEFAULT_WEIGHTS.video),
    voice: toNumber(config.voice_weight, DEFAULT_WEIGHTS.voice),
    biometric: toNumber(config.biometric_weight, DEFAULT_WEIGHTS.biometric),
    blockchain: toNumber(config.blockchain_weight, DEFAULT_WEIGHTS.blockchain),
  };

  // Normalize weights to sum to 1.0
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  Object.keys(weights).forEach((k) => (weights[k] /= weightSum));

  // Video score: composite of spatial, temporal, GAN, rPPG
  const videoComposite = videoScores
    ? clamp100(
        (clamp01(videoScores.spatial_score) * 0.35 +
          clamp01(videoScores.temporal_score) * 0.30 +
          clamp01(videoScores.gan_score) * 0.25 +
          clamp01(videoScores.rppg_score) * 0.10) * 100
      )
    : 50;

  const voiceComposite = typeof voiceScore === 'number' ? clamp100(voiceScore * 100) : 50;
  const biometricComposite = typeof biometricScore === 'number' ? clamp100(biometricScore * 100) : 50;
  const blockchainComposite =
    typeof blockchainScore === 'number' ? clamp100(blockchainScore * 100, 100) : 100;

  const trustScore = Math.round(
    videoComposite * weights.video +
      voiceComposite * weights.voice +
      biometricComposite * weights.biometric +
      blockchainComposite * weights.blockchain
  );

  const safeThreshold = toNumber(config.safe_threshold, DEFAULT_THRESHOLDS.safe);
  const suspiciousThreshold = toNumber(config.suspicious_threshold, DEFAULT_THRESHOLDS.suspicious);

  let status;
  if (trustScore >= safeThreshold) {
    status = 'safe';
  } else if (trustScore >= suspiciousThreshold) {
    status = 'suspicious';
  } else {
    status = 'alert';
  }

  const result = {
    trust_score: trustScore,
    video_score: Math.round(videoComposite),
    voice_score: Math.round(voiceComposite),
    biometric_score: Math.round(biometricComposite),
    blockchain_score: Math.round(blockchainComposite),
    status,
    weights,
    thresholds: { safe: safeThreshold, suspicious: suspiciousThreshold },
    timestamp: new Date().toISOString(),
    stream_id: streamId,
    detail: {
      spatial_score: videoScores?.spatial_score,
      temporal_score: videoScores?.temporal_score,
      gan_score: videoScores?.gan_score,
      rppg_waveform: videoScores?.rppg_waveform || [],
    },
  };

  // Only persist/cache for real stream evaluations.
  if (streamId) {
    await setTrustScore(streamId, result);
    await logTrustScore(streamId, result);
    if (status === 'alert') {
      await triggerAlert(streamId, result);
    }
  }

  return result;
};

const logTrustScore = async (streamId, scoreData) => {
  try {
    await query(
      `INSERT INTO trust_logs 
       (stream_id, trust_score, video_score, voice_score, biometric_score, blockchain_score, status, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        streamId,
        scoreData.trust_score,
        scoreData.video_score,
        scoreData.voice_score,
        scoreData.biometric_score,
        scoreData.blockchain_score,
        scoreData.status,
        JSON.stringify(scoreData),
      ]
    );
  } catch (err) {
    logger.error('Failed to log trust score:', err.message);
  }
};

const triggerAlert = async (streamId, scoreData) => {
  try {
    await query(
      `INSERT INTO audit_events (stream_id, event_type, severity, details)
       VALUES ($1, $2, $3, $4)`,
      [streamId, 'DEEPFAKE_ALERT', 'critical', JSON.stringify(scoreData)]
    );
    logger.warn(`DEEPFAKE ALERT triggered for stream: ${streamId}`, { trust_score: scoreData.trust_score });
  } catch (err) {
    logger.error('Failed to trigger alert:', err.message);
  }
};

const getTrustHistory = async (streamId, limit = 60) => {
  const result = await query(
    `SELECT trust_score, video_score, voice_score, biometric_score, blockchain_score, status, created_at
     FROM trust_logs
     WHERE stream_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [streamId, limit]
  );
  return result.rows.reverse();
};

module.exports = { computeTrustScore, getTrustHistory, getAdminConfig };
