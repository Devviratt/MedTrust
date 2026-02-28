'use strict';

/**
 * streamIntervalManager.js
 *
 * Manages one background interval per active stream.
 * Every 5 seconds: calls trustEngine.processFrame() → computes real AI
 * trust scores → writes to Redis + trust_logs → inserts blockchain log.
 *
 * Lifecycle:
 *   start(streamId)  — called by POST /streams/start
 *   stop(streamId)   — called by POST /streams/end/:streamId
 *   stopAll()        — called on process shutdown
 */

const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { processFrame }       = require('./trustEngine');
const { query }              = require('../config/database');
const { logger }             = require('../middleware/errorHandler');

// Lazy getter — avoids circular dependency at module load time.
// signalingServer is fully initialized by the time the first tick fires.
const getIo = () => {
  try { return require('../websocket/signalingServer').getIo(); }
  catch { return null; }
};

const INTERVAL_MS = 5000; // 5 seconds

// Map<streamId, NodeJS.Timeout>
const activeIntervals = new Map();

// ── Blockchain insert ─────────────────────────────────────────────────────────
const insertBlockchainLog = async (streamId, trustScore, timestamp) => {
  try {
    const raw       = `${streamId}:${timestamp}:${trustScore}`;
    const chunkHash = crypto.createHash('sha256').update(raw).digest('hex');
    const txId      = uuidv4();

    // Use a single INSERT with inline subquery so block_number is computed
    // atomically at insert time — no race between SELECT and INSERT.
    await query(
      `INSERT INTO blockchain_logs
         (stream_id, chunk_hash, chunk_type, timestamp, tx_id, block_number, sync_status)
       VALUES (
         $1, $2, 'video', NOW(), $3,
         (SELECT COALESCE(MAX(block_number), 0) + 1 FROM blockchain_logs WHERE stream_id = $1),
         'synced'
       )`,
      [streamId, chunkHash, txId]
    );

    // Read back what was inserted for the return value
    const blockRes = await query(
      `SELECT block_number FROM blockchain_logs WHERE stream_id = $1 AND tx_id = $2`,
      [streamId, txId]
    ).catch(() => ({ rows: [] }));
    const blockNumber = blockRes.rows[0]?.block_number ?? '?';

    return { chunkHash, txId, blockNumber };
  } catch (err) {
    logger.warn('[intervalManager] blockchain insert failed', {
      streamId, error: err.message,
    });
    return null;
  }
};

// ── One tick ──────────────────────────────────────────────────────────────────
const runTick = async (streamId) => {
  try {
    const result    = await processFrame(streamId);
    const timestamp = result.timestamp ?? new Date().toISOString();

    await insertBlockchainLog(streamId, result.trust_score, timestamp);

    // Broadcast to WebSocket subscribers so dashboard updates instantly
    // without waiting for the next HTTP poll cycle
    const io = getIo();
    if (io) {
      io.to(`trust:${streamId}`).emit('trust-score-update', result);
      if (result.status === 'alert') {
        io.to('admin-room').emit('deepfake-alert', {
          ...result,
          alert_id: `alert-${Date.now()}`,
          message: `DEEPFAKE ALERT: Trust score ${result.trust_score} on stream ${streamId}`,
        });
      }
    }

    // Insert audit event if alert status
    if (result.status === 'alert') {
      await query(
        `INSERT INTO audit_events (stream_id, event_type, severity, details)
         VALUES ($1, 'DEEPFAKE_ALERT', 'critical', $2)`,
        [streamId, JSON.stringify({
          trust_score: result.trust_score,
          video_score: result.video_score,
          voice_score: result.voice_score,
          triggered_by: 'trust_engine',
        })]
      ).catch(() => {});
    }
  } catch (err) {
    // Never let a tick crash the interval
    logger.error('[intervalManager] tick error', { streamId, error: err.message });
  }
};

// ── Public API ────────────────────────────────────────────────────────────────

const start = (streamId) => {
  if (activeIntervals.has(streamId)) {
    logger.warn('[intervalManager] interval already running', { streamId });
    return;
  }

  logger.info('[intervalManager] starting background loop', { streamId, interval_ms: INTERVAL_MS });

  // Fire first tick immediately (non-blocking), then every INTERVAL_MS
  runTick(streamId);
  const timer = setInterval(() => runTick(streamId), INTERVAL_MS);
  activeIntervals.set(streamId, timer);
};

const stop = (streamId) => {
  const timer = activeIntervals.get(streamId);
  if (!timer) return;
  clearInterval(timer);
  activeIntervals.delete(streamId);
  logger.info('[intervalManager] stopped background loop', { streamId });
};

const stopAll = () => {
  for (const [streamId, timer] of activeIntervals.entries()) {
    clearInterval(timer);
    logger.info('[intervalManager] stopped on shutdown', { streamId });
  }
  activeIntervals.clear();
};

const activeCount = () => activeIntervals.size;

module.exports = { start, stop, stopAll, activeCount };
