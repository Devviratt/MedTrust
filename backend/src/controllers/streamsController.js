'use strict';

const { query }       = require('../config/database');
const { logger }      = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');
const { generateSessionReport } = require('../services/sessionReportService');

// ── Validation helper ─────────────────────────────────────────────────────────
const isValidStreamId = (id) => {
  if (!id || typeof id !== 'string') return false;
  if (id.length < 8) return false;
  if (id.includes('<') || id.includes('>') || id.includes('%3C')) return false;
  return true;
};

// ── GET /api/v1/streams/:streamId ───────────────────────────────────────────
const getStream = async (req, res) => {
  const { streamId } = req.params;
  if (!isValidStreamId(streamId)) {
    return res.status(400).json({ error: 'Invalid stream ID' });
  }
  try {
    const result = await query(
      `SELECT id, status, started_at, ended_at, created_at, doctor_id, patient_id, icu_room
         FROM streams WHERE id = $1`,
      [streamId]
    );
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    const row = result.rows[0];
    return res.json({
      stream_id:  row.id,
      status:     row.status,
      started_at: row.started_at ?? row.created_at,
      ended_at:   row.ended_at ?? null,
      created_at: row.created_at,
      doctor_id:  row.doctor_id,
      patient_id: row.patient_id,
      icu_room:   row.icu_room,
    });
  } catch (err) {
    logger.error('[STREAMS] getStream error', { streamId, error: err.message });
    return res.status(500).json({ error: 'Failed to fetch stream' });
  }
};

// ── GET /api/v1/streams/active ────────────────────────────────────────────────
const getActiveStream = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, status, started_at, created_at, doctor_id, patient_id, icu_room
       FROM streams WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
    );
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ stream: null, message: 'No active stream' });
    }
    const row = result.rows[0];
    return res.json({
      stream_id:  row.id,
      status:     row.status,
      started_at: row.started_at ?? row.created_at,
      created_at: row.created_at,
      doctor_id:  row.doctor_id,
      patient_id: row.patient_id,
      icu_room:   row.icu_room,
    });
  } catch (err) {
    logger.error('[STREAMS] getActiveStream error', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch active stream' });
  }
};

// ── POST /api/v1/streams/start ────────────────────────────────────────────────
const startStream = async (req, res) => {
  const { doctor_id, patient_id, icu_room } = req.body || {};
  const streamId = uuidv4();
  const requestingUserId = req.user?.id;

  try {
    // End any existing active streams for this user
    await query(
      `UPDATE streams SET status = 'ended', ended_at = NOW()
         WHERE status = 'active' AND doctor_id = $1`,
      [doctor_id || requestingUserId || null]
    ).catch(() => {});

    const result = await query(
      `INSERT INTO streams (id, doctor_id, patient_id, icu_room, status, metadata)
         VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING id, status, started_at, created_at`,
      [
        streamId,
        doctor_id || requestingUserId || null,
        patient_id || null,
        icu_room   || 'ICU-Room-01',
        JSON.stringify({ created_by: requestingUserId }),
      ]
    );

    await query(
      `INSERT INTO audit_events (stream_id, event_type, severity, details)
         VALUES ($1, 'STREAM_STARTED', 'info', $2)`,
      [streamId, JSON.stringify({ created_by: requestingUserId, icu_room: icu_room || 'ICU-Room-01' })]
    ).catch(() => {});

    logger.info('[STREAM START] Created', { stream_id: streamId, user: requestingUserId });

    return res.status(201).json({
      stream_id:  result.rows[0].id,
      status:     result.rows[0].status,
      created_at: result.rows[0].created_at,
    });
  } catch (err) {
    logger.error('[STREAM START ERROR]', { error: err.message, code: err.code });
    return res.status(500).json({ error: 'Failed to start stream' });
  }
};

// ── POST /api/v1/streams/end/:streamId ───────────────────────────────────────
const endStream = async (req, res) => {
  const { streamId } = req.params;

  if (!isValidStreamId(streamId)) {
    return res.status(400).json({ error: 'Invalid stream ID' });
  }

  try {
    await query(
      `UPDATE streams SET status = 'ended', ended_at = NOW() WHERE id = $1`,
      [streamId]
    );
    await query(
      `INSERT INTO audit_events (stream_id, event_type, severity, details)
         VALUES ($1, 'STREAM_ENDED', 'info', $2)`,
      [streamId, JSON.stringify({ ended_by: req.user?.id })]
    ).catch(() => {});

    // Generate session report asynchronously
    generateSessionReport(streamId).then((report) => {
      if (!report) return;
      try {
        const { getIo } = require('../websocket/signalingServer');
        const io = getIo();
        if (io) {
          io.to(`trust:${streamId}`).emit('session-ended', { stream_id: streamId, report });
          if (report.patient?.id) {
            io.to(`patient:${report.patient.id}`).emit('session-ended', { stream_id: streamId, report });
          }
        }
      } catch { /* non-fatal */ }
    }).catch(() => {});

    logger.info('[STREAM END] ended + report queued', { stream_id: streamId });
    return res.json({ message: 'Stream ended', stream_id: streamId });
  } catch (err) {
    logger.error('[STREAM END ERROR]', { error: err.message });
    return res.status(500).json({ error: 'Failed to end stream' });
  }
};

module.exports = { getStream, getActiveStream, startStream, endStream };
