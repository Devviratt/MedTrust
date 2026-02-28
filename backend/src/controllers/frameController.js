'use strict';

/**
 * frameController.js
 *
 * POST /api/v1/analyze/frame/:streamId
 *
 * Body: { frame: "<base64_jpeg>" }
 *
 * Pipeline:
 *   1. Validate streamId + stream exists + status=active
 *   2. frameAnalyzer.analyzeFrame()  → video_score (brightness, stddev, Sobel edge variance)
 *   3. Load cached voice/biometric scores (set by WebSocket handlers)
 *   4. trustEngineV2.computeTrust()  → weighted score, blockchain hash, Redis, DB
 *   5. Broadcast to Socket.IO trust:streamId room
 *   6. Return full trust result
 *
 * Trust updates ONLY when this endpoint is called. No background intervals.
 */

const { analyzeFrame }  = require('../services/frameAnalyzer');
const { computeTrust }  = require('../services/trustEngineV2');
const { query }         = require('../config/database');
const { logger }        = require('../middleware/errorHandler');

// ── Validation ────────────────────────────────────────────────────────────────
const isValidStreamId = (id) => {
  if (!id || typeof id !== 'string') return false;
  if (id.length < 8) return false;
  if (id.includes('<') || id.includes('>') || id.includes('%3C')) return false;
  return true;
};

// ── Controller ────────────────────────────────────────────────────────────────
const analyzeFrameEndpoint = async (req, res) => {
  const { streamId } = req.params;

  // 1. Validate streamId
  if (!isValidStreamId(streamId)) {
    return res.status(400).json({ error: 'Invalid stream ID' });
  }

  // 2. Validate frame payload
  const { frame } = req.body || {};
  if (!frame || typeof frame !== 'string' || frame.length < 100) {
    return res.status(400).json({ error: 'Missing or invalid frame data' });
  }

  try {
    // 3. Verify stream exists and is active
    const streamRes = await query(
      `SELECT id, status FROM streams WHERE id = $1`,
      [streamId]
    );
    if (!streamRes.rows || streamRes.rows.length === 0) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    if (streamRes.rows[0].status !== 'active') {
      return res.status(409).json({ error: 'Stream is not active', status: streamRes.rows[0].status });
    }

    // 4. Frame analysis — brightness, std-dev, Sobel edge variance → video_score
    let frameResult;
    try {
      frameResult = await analyzeFrame(streamId, frame);
    } catch (frameErr) {
      logger.warn('[frameController] frame analysis failed', { streamId, error: frameErr.message });
      return res.status(400).json({ error: `Frame analysis failed: ${frameErr.message}` });
    }

    // 5. Load previous video score for drop-detection
    let prevVideoScore = null;
    try {
      const { getCache } = require('../config/redis');
      const prev = await getCache(`frame:last:${streamId}`);
      prevVideoScore = prev?.video_score ?? null;
    } catch { /* non-fatal */ }

    // 6. Compute full 6-module trust score
    let io = null;
    try { const sig = require('../websocket/signalingServer'); io = sig.getIo(); } catch { /* non-fatal */ }

    const doctorId = req.user?.id || null;

    const trustResult = await computeTrust({
      streamId,
      video_score:      frameResult.video_score,
      behavioral_score: frameResult.behavioral_score,
      env_score:        frameResult.env_score,
      voice_score:      null,   // loaded from Redis cache
      biometric_score:  null,   // loaded from Redis cache
      io,
      doctorId,
      frameContext: {
        prev_video_score: prevVideoScore,
        motion_anomaly:   frameResult.motion_anomaly,
      },
    });

    // Cache current video_score for next-frame drop detection
    try {
      const { setCache } = require('../config/redis');
      await setCache(`frame:last:${streamId}`, { video_score: frameResult.video_score }, 60);
    } catch { /* non-fatal */ }

    // 7. Broadcast trust-score-update to all dashboard subscribers
    try {
      if (io) io.to(`trust:${streamId}`).emit('trust-score-update', trustResult);
    } catch { /* non-fatal */ }

    return res.json({
      ...trustResult,
      frame_analysis: {
        brightness:        frameResult.brightness,
        stddev:            frameResult.stddev,
        edge_variance:     frameResult.edge_variance,
        prev_edge_variance: frameResult.prev_edge_variance,
        frame_size_bytes:  frameResult.frame_size_bytes,
        width:             frameResult.width,
        height:            frameResult.height,
      },
    });

  } catch (err) {
    logger.error('[frameController] unhandled error', { streamId, error: err.message });
    return res.status(500).json({ error: 'Frame analysis failed' });
  }
};

module.exports = { analyzeFrameEndpoint };
