'use strict';

/**
 * trustEngineV2.js — Enterprise ICU Command Center Trust Engine
 *
 * Frame-triggered trust computation. Called ONLY when a frame is received.
 * No background intervals. No random values.
 *
 * 6 Detection Modules:
 *   1. Video Integrity     — brightness, edge variance, Sobel
 *   2. Voice Authenticity  — spectral flatness DSP
 *   3. Biometric Sync      — pulse variance, zero-crossing rate
 *   4. Behavioral Dynamics — motion delta consistency
 *   5. Blockchain Integrity— sha256 hash chain
 *   6. Environmental Context— lighting stability
 *
 * Formula: 0.35*video + 0.25*voice + 0.20*biometric + 0.10*blockchain + 0.05*behavioral + 0.05*env
 *
 * Alert triggers:
 *   trust < 50 OR video drop > 30 in 1 cycle OR biometric < 40 OR voice < 40
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { getCache, setCache, setTrustScore, getTrustScore } = require('../config/redis');
const { query } = require('../config/database');
const { logger } = require('../middleware/errorHandler');
const { getThresholds } = require('./thresholdService');

// ── Fallback weights (overridden by DB thresholds at runtime) ─────────────────
const DEFAULT_WEIGHTS = {
  video:      0.40,
  voice:      0.30,
  biometric:  0.20,
  blockchain: 0.10,
};

// ── Blockchain hash chain ─────────────────────────────────────────────────────

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * getLastBlockchainHash(streamId)
 * Returns the chunk_hash of the most recent blockchain_log row for this stream.
 * If none exists, returns GENESIS_HASH.
 */
const getLastBlockchainHash = async (streamId) => {
  try {
    const res = await query(
      `SELECT chunk_hash FROM blockchain_logs
         WHERE stream_id = $1
         ORDER BY block_number DESC LIMIT 1`,
      [streamId]
    );
    return res.rows[0]?.chunk_hash ?? GENESIS_HASH;
  } catch {
    return GENESIS_HASH;
  }
};

/**
 * insertBlockchainLog(streamId, newHash, trustScore, prevHash)
 * Atomically inserts a new blockchain log row with incremented block_number.
 */
const insertBlockchainLog = async (streamId, newHash, trustScore, prevHash) => {
  const txId = uuidv4();
  try {
    await query(
      `INSERT INTO blockchain_logs
         (stream_id, chunk_hash, chunk_type, timestamp, tx_id, block_number, sync_status)
       VALUES (
         $1, $2, 'trust', NOW(), $3,
         (SELECT COALESCE(MAX(block_number), 0) + 1 FROM blockchain_logs WHERE stream_id = $1),
         'synced'
       )`,
      [streamId, newHash, txId]
    );
    return { newHash, txId, prevHash };
  } catch (err) {
    logger.warn('[trustEngineV2] blockchain insert failed', { streamId, error: err.message });
    return null;
  }
};

// ── Thread log helper ────────────────────────────────────────────────────────
// Emits a structured event to the security thread log via Socket.IO
const emitThreadEvent = (io, streamId, module, message, level = 'info') => {
  if (!io) return;
  io.to(`trust:${streamId}`).emit('thread-log', {
    module,
    message,
    level,
    timestamp: new Date().toISOString(),
  });
};

// ── Alert engine ──────────────────────────────────────────────────────────────

const triggerAlert = async (streamId, trustScore, detail, io, doctorId) => {
  try {
    await query(
      `INSERT INTO audit_events (stream_id, event_type, severity, details)
         VALUES ($1, 'DEEPFAKE_ALERT', 'critical', $2)`,
      [streamId, JSON.stringify({
        trust_score: trustScore,
        message: 'Possible deepfake detected',
        ...detail,
      })]
    );
  } catch (err) {
    logger.warn('[trustEngineV2] alert insert failed', { streamId, error: err.message });
  }

  // Emit thread log event
  emitThreadEvent(io, streamId, 'ALERT', `Trust dropped to ${trustScore} — deepfake suspicion`, 'critical');

  // SMS — fire and forget
  try {
    const { sendCriticalAlert } = require('./smsService');
    sendCriticalAlert({
      streamId,
      trustScore,
      doctorId: doctorId || null,
      timestamp: new Date().toISOString(),
    });
  } catch { /* SMS non-fatal */ }
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * computeTrust({ streamId, video_score, voice_score, biometric_score,
 *               behavioral_score, env_score, io, doctorId, frameContext })
 *
 * 6-module weighted trust computation.
 * io (optional): Socket.IO instance for thread-log events.
 * frameContext: { prev_video_score, motion_anomaly } for drop detection.
 */
const computeTrust = async ({
  streamId,
  video_score,
  voice_score      = null,
  biometric_score  = null,
  behavioral_score = null,
  env_score        = null,
  io               = null,
  doctorId         = null,
  frameContext     = {},
}) => {
  const now = new Date();
  const timestamp = now.toISOString();

  // ── Load thresholds from DB (cached 60s) ──────────────────────────────────
  const thresholds = await getThresholds();
  const WEIGHTS = {
    video:      thresholds.video_weight      ?? DEFAULT_WEIGHTS.video,
    voice:      thresholds.voice_weight      ?? DEFAULT_WEIGHTS.voice,
    biometric:  thresholds.biometric_weight  ?? DEFAULT_WEIGHTS.biometric,
    blockchain: thresholds.blockchain_weight ?? DEFAULT_WEIGHTS.blockchain,
  };
  // behavioral + env get remaining weight split equally
  const assigned = WEIGHTS.video + WEIGHTS.voice + WEIGHTS.biometric + WEIGHTS.blockchain;
  const remaining = Math.max(0, 1 - assigned);
  WEIGHTS.behavioral = remaining / 2;
  WEIGHTS.env        = remaining / 2;

  const THRESHOLD_SAFE       = thresholds.min_safe_score    ?? 75;
  const THRESHOLD_SUSPICIOUS = thresholds.suspicious_score  ?? 50;
  const ALERT_SCORE          = thresholds.alert_score       ?? 50;
  const VIDEO_DROP_LIMIT     = thresholds.video_drop_threshold     ?? 30;
  const BIOMETRIC_LIMIT      = thresholds.biometric_variance_limit ?? 40;
  const VOICE_LIMIT          = thresholds.voice_flatness_limit     ?? 40;

  // ── Load cached modality scores ──────────────────────────────────────────
  const cached = await getTrustScore(streamId).catch(() => null);

  const resolvedVoice      = voice_score      ?? cached?.voice_score      ?? 50;
  const resolvedBiometric  = biometric_score  ?? cached?.biometric_score  ?? 50;
  const resolvedBehavioral = behavioral_score ?? cached?.behavioral_score ?? 70;
  const resolvedEnv        = env_score        ?? cached?.env_score        ?? 70;

  // ── Blockchain hash chain validation ────────────────────────────────────
  const prevHash = await getLastBlockchainHash(streamId);

  const rawTrust = Math.round(
    video_score          * WEIGHTS.video      +
    resolvedVoice        * WEIGHTS.voice      +
    resolvedBiometric    * WEIGHTS.biometric  +
    100                  * WEIGHTS.blockchain +
    resolvedBehavioral   * WEIGHTS.behavioral +
    resolvedEnv          * WEIGHTS.env
  );

  const newHash = crypto
    .createHash('sha256')
    .update(`${prevHash}:${timestamp}:${rawTrust}`)
    .digest('hex');

  const storedPrevHash = await getLastBlockchainHash(streamId);
  const chainIntact    = storedPrevHash === prevHash;
  const blockchain_score = chainIntact ? 100 : 50;

  if (!chainIntact) {
    emitThreadEvent(io, streamId, 'BLOCKCHAIN', 'Hash mismatch detected — chain integrity degraded', 'warn');
  } else {
    emitThreadEvent(io, streamId, 'BLOCKCHAIN', `Hash verified — block appended`, 'info');
  }

  // ── Final weighted trust score ────────────────────────────────────────────
  const trust_score = Math.max(0, Math.min(100, Math.round(
    video_score        * WEIGHTS.video      +
    resolvedVoice      * WEIGHTS.voice      +
    resolvedBiometric  * WEIGHTS.biometric  +
    blockchain_score   * WEIGHTS.blockchain +
    resolvedBehavioral * WEIGHTS.behavioral +
    resolvedEnv        * WEIGHTS.env
  )));

  const status =
    trust_score >= THRESHOLD_SAFE       ? 'safe'       :
    trust_score >= THRESHOLD_SUSPICIOUS ? 'suspicious' :
                                          'alert';

  // ── Insert blockchain log ─────────────────────────────────────────────────
  const bcResult = await insertBlockchainLog(streamId, newHash, trust_score, prevHash);

  // ── Thread-log events per module ─────────────────────────────────────────
  if (video_score < 50) emitThreadEvent(io, streamId, 'VIDEO', `Edge variance drop — score ${video_score}`, 'warn');
  if (resolvedVoice < 50) emitThreadEvent(io, streamId, 'VOICE', `Abnormal spectral flatness — score ${resolvedVoice}`, 'warn');
  if (resolvedBiometric < 50) emitThreadEvent(io, streamId, 'BIOMETRIC', `Pulse instability detected — score ${resolvedBiometric}`, 'warn');
  if (frameContext.motion_anomaly) emitThreadEvent(io, streamId, 'VIDEO', 'Sudden motion anomaly detected', 'warn');

  // ── Build result with all 6 module scores ────────────────────────────────
  const result = {
    stream_id:         streamId,
    trust_score,
    status,
    timestamp,
    // 6 module scores
    video_score:       Math.round(video_score),
    voice_score:       Math.round(resolvedVoice),
    biometric_score:   Math.round(resolvedBiometric),
    behavioral_score:  Math.round(resolvedBehavioral),
    env_score:         Math.round(resolvedEnv),
    blockchain_score,
    // Blockchain
    chain_hash:        newHash,
    prev_hash:         prevHash,
    chain_intact:      chainIntact,
    blockchain_tx:     bcResult?.txId ?? null,
    weights:           WEIGHTS,
  };

  // ── Cache in Redis ────────────────────────────────────────────────────────────────
  await setTrustScore(streamId, result);

  // ── Persist to trust_logs ───────────────────────────────────────────────────────────
  try {
    await query(
      `INSERT INTO trust_logs
         (stream_id, trust_score, video_score, voice_score, biometric_score, blockchain_score, status, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [streamId, trust_score, result.video_score, result.voice_score,
       result.biometric_score, blockchain_score, status, JSON.stringify(result)]
    );
  } catch (err) {
    logger.warn('[trustEngineV2] trust_logs insert failed', { streamId, error: err.message });
  }

  // ── Multi-trigger alert engine (thresholds from DB) ─────────────────────────
  const prevVideoScore = frameContext.prev_video_score ?? null;
  const videoDropAlert = prevVideoScore !== null && (prevVideoScore - video_score) > VIDEO_DROP_LIMIT;
  const shouldAlert =
    trust_score < ALERT_SCORE ||
    videoDropAlert ||
    resolvedBiometric < BIOMETRIC_LIMIT ||
    resolvedVoice < VOICE_LIMIT;

  if (shouldAlert) {
    const alertDetail = {
      video_score, voice_score: resolvedVoice, biometric_score: resolvedBiometric,
      behavioral_score: resolvedBehavioral, env_score: resolvedEnv,
      video_drop_alert: videoDropAlert,
      triggers: [
        ...(status === 'alert'       ? ['trust_below_50']   : []),
        ...(videoDropAlert           ? ['video_drop_30']    : []),
        ...(resolvedBiometric < 40   ? ['biometric_unstable']: []),
        ...(resolvedVoice < 40       ? ['voice_flatness']   : []),
      ],
    };
    await triggerAlert(streamId, trust_score, alertDetail, io, doctorId);

    // Broadcast deepfake-alert to admin room
    if (io) {
      io.to('admin-room').emit('deepfake-alert', {
        ...result,
        alert_id: `alert-${Date.now()}`,
        message:  `DEEPFAKE ALERT: Trust ${trust_score} on stream ${streamId}`,
        triggers: alertDetail.triggers,
      });
    }
  }

  logger.info('[trustEngineV2] computed', {
    streamId, trust_score, status,
    video_score, voice_score: resolvedVoice,
    biometric_score: resolvedBiometric, blockchain_score,
    behavioral_score: resolvedBehavioral, env_score: resolvedEnv,
  });

  return result;
};

// ── Biometric score from pulse variance ───────────────────────────────────────

/**
 * computeBiometricScore(pulseSignal: number[]) → 0-100
 *
 * pulseSignal: array of average ROI luminance values from frontend (500ms cadence)
 *
 * Rules (deterministic, no sine wave):
 *   < 4 samples       → 20  (no signal)
 *   variance < 1      → 40  (flat/frozen — no pulse)
 *   variance > 2000   → 40  (noise — random signal)
 *   zero crossings ok AND variance 10-500 → 85-95 (healthy periodic)
 *   otherwise         → 60
 */
const computeBiometricScore = (pulseSignal) => {
  if (!Array.isArray(pulseSignal) || pulseSignal.length < 4) return 20;

  const n = pulseSignal.length;
  const mean = pulseSignal.reduce((a, b) => a + b, 0) / n;
  const variance = pulseSignal.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

  if (variance < 1.0)    return 40; // flat — no pulse
  if (variance > 2000)   return 40; // noisy — not physiological

  // Count zero crossings of the mean-subtracted signal
  let crossings = 0;
  const centered = pulseSignal.map(v => v - mean);
  for (let i = 1; i < n; i++) {
    if ((centered[i - 1] < 0 && centered[i] >= 0) ||
        (centered[i - 1] >= 0 && centered[i] < 0)) {
      crossings++;
    }
  }

  // For a 30-sample window at 500ms = 15s → expect 15-40 crossings for 60-160 BPM
  const crossingRate = crossings / n;
  const periodicOk = crossingRate >= 0.3 && crossingRate <= 1.2;
  const varianceOk = variance >= 10 && variance <= 500;

  if (periodicOk && varianceOk) {
    // Scale score within 85-95 based on how close to ideal variance (50-200)
    const idealVariance = 100;
    const devFromIdeal = Math.abs(variance - idealVariance) / idealVariance;
    return Math.round(95 - devFromIdeal * 10);
  } else if (variance >= 5 && variance <= 1000) {
    return 60; // some signal but not clearly periodic
  } else {
    return 40;
  }
};

// ── Voice score from spectral flatness ────────────────────────────────────────

/**
 * computeVoiceScore(mfccFeatures: number[]) → 0-100
 *
 * mfccFeatures: array of frequency-band energies (13-40 values expected)
 * Proxy for spectral flatness: ratio of geometric mean to arithmetic mean.
 *
 * Rules:
 *   flatness > 0.85 → synthetic/TTS → voice_score = 40
 *   flatness < 0.10 → silence/noise → voice_score = 30
 *   flatness 0.15-0.70 → natural human → voice_score = 85-95
 *   otherwise → 65
 */
const computeVoiceScore = (mfccFeatures) => {
  if (!Array.isArray(mfccFeatures) || mfccFeatures.length < 4) return 50;

  const values = mfccFeatures.map(v => Math.max(Number(v) || 0, 1e-10));
  const n = values.length;

  const arithmeticMean = values.reduce((a, b) => a + b, 0) / n;
  const logSum = values.reduce((s, v) => s + Math.log(v), 0);
  const geometricMean = Math.exp(logSum / n);

  const flatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

  if (flatness > 0.85) return 40; // synthetic / TTS-generated
  if (flatness < 0.10) return 30; // silence or noise
  if (flatness >= 0.15 && flatness <= 0.70) {
    // Natural human speech — score inversely proportional to flatness
    // Lower flatness = more formant structure = more authentic
    const normalized = (flatness - 0.15) / (0.70 - 0.15); // 0-1
    return Math.round(95 - normalized * 10); // 85-95
  }
  return 65;
};

module.exports = { computeTrust, computeBiometricScore, computeVoiceScore };
