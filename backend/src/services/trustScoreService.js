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

const computeTrustScore = async ({
  streamId,
  videoScores,
  voiceScore,
  biometricScore,
  blockchainScore,
}) => {
  const config = await getAdminConfig();

  const weights = {
    video: config.video_weight || DEFAULT_WEIGHTS.video,
    voice: config.voice_weight || DEFAULT_WEIGHTS.voice,
    biometric: config.biometric_weight || DEFAULT_WEIGHTS.biometric,
    blockchain: config.blockchain_weight || DEFAULT_WEIGHTS.blockchain,
  };

  // Normalize weights to sum to 1.0
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  Object.keys(weights).forEach((k) => (weights[k] /= weightSum));

  // Video score: composite of spatial, temporal, GAN, rPPG
  const videoComposite = videoScores
    ? (videoScores.spatial_score * 0.35 +
        videoScores.temporal_score * 0.30 +
        videoScores.gan_score * 0.25 +
        videoScores.rppg_score * 0.10) * 100
    : 50;

  const voiceComposite = typeof voiceScore === 'number' ? voiceScore * 100 : 50;
  const biometricComposite = typeof biometricScore === 'number' ? biometricScore * 100 : 50;
  const blockchainComposite = typeof blockchainScore === 'number' ? blockchainScore * 100 : 100;

  const trustScore = Math.round(
    videoComposite * weights.video +
      voiceComposite * weights.voice +
      biometricComposite * weights.biometric +
      blockchainComposite * weights.blockchain
  );

  const safeThreshold = config.safe_threshold || DEFAULT_THRESHOLDS.safe;
  const suspiciousThreshold = config.suspicious_threshold || DEFAULT_THRESHOLDS.suspicious;

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

  // Cache trust score for real-time dashboard
  await setTrustScore(streamId, result);

  // Persist to database
  await logTrustScore(streamId, result);

  // Trigger alert if needed
  if (status === 'alert') {
    await triggerAlert(streamId, result);
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
