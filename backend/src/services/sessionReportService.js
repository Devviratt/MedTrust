'use strict';
/**
 * sessionReportService.js
 * Generates a session report when a stream ends.
 * Aggregates trust logs, alerts, blockchain status, impersonation risk.
 */
const { v4: uuidv4 } = require('uuid');
const { query }  = require('../config/database');
const { logger } = require('../middleware/errorHandler');

const generateSessionReport = async (streamId) => {
  try {
    const [trustData, alertData, bcData, streamData, impersonationData] = await Promise.all([
      query(
        `SELECT AVG(trust_score) AS avg, MIN(trust_score) AS min,
                MAX(trust_score) AS max, COUNT(*) AS total
         FROM trust_logs WHERE stream_id = $1::uuid`,
        [streamId]
      ).catch(() => ({ rows: [{}] })),
      query(
        `SELECT COUNT(*) AS total FROM audit_events
         WHERE stream_id = $1::uuid AND severity = 'critical'`,
        [streamId]
      ).catch(() => ({ rows: [{ total: 0 }] })),
      query(
        `SELECT COUNT(*) AS total,
                COUNT(CASE WHEN sync_status = 'synced' THEN 1 END) AS synced
         FROM blockchain_logs WHERE stream_id = $1::uuid`,
        [streamId]
      ).catch(() => ({ rows: [{ total: 0, synced: 0 }] })),
      query(
        `SELECT s.started_at, s.ended_at, s.icu_room,
                du.name AS doctor_name, du.id AS doctor_id,
                pu.name AS patient_name
         FROM streams s
         LEFT JOIN users du ON du.id = s.doctor_id
         LEFT JOIN users pu ON pu.id = s.patient_id
         WHERE s.id = $1::uuid`,
        [streamId]
      ).catch(() => ({ rows: [{}] })),
      query(
        `SELECT details FROM audit_events
         WHERE stream_id = $1::uuid AND event_type = 'IMPERSONATION_DETECTED'
         ORDER BY created_at DESC LIMIT 1`,
        [streamId]
      ).catch(() => ({ rows: [] })),
    ]);

    const t = trustData.rows[0]    || {};
    const a = alertData.rows[0]    || {};
    const b = bcData.rows[0]       || {};
    const s = streamData.rows[0]   || {};
    const i = impersonationData.rows[0];

    const blockchainValid = parseInt(b.total) === 0 || parseInt(b.synced) === parseInt(b.total);
    const impersonationRisk = i ? 'HIGH' : 'LOW';

    const reportData = {
      stream_id: streamId,
      doctor: { name: s.doctor_name, id: s.doctor_id },
      patient: { name: s.patient_name },
      session: { started_at: s.started_at, ended_at: s.ended_at, icu_room: s.icu_room },
      trust: {
        avg: Math.round(parseFloat(t.avg) || 0),
        min: Math.round(parseFloat(t.min) || 0),
        max: Math.round(parseFloat(t.max) || 0),
        total_frames: parseInt(t.total) || 0,
      },
      security: {
        alert_count: parseInt(a.total) || 0,
        blockchain_valid: blockchainValid,
        blockchain_blocks: parseInt(b.total) || 0,
        impersonation_risk: impersonationRisk,
      },
    };

    await query(
      `INSERT INTO session_reports
         (id, stream_id, avg_trust_score, min_trust_score, max_trust_score,
          alert_count, blockchain_valid, impersonation_risk, total_frames, report_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (stream_id) DO UPDATE
         SET avg_trust_score   = EXCLUDED.avg_trust_score,
             min_trust_score   = EXCLUDED.min_trust_score,
             max_trust_score   = EXCLUDED.max_trust_score,
             alert_count       = EXCLUDED.alert_count,
             blockchain_valid  = EXCLUDED.blockchain_valid,
             impersonation_risk = EXCLUDED.impersonation_risk,
             total_frames      = EXCLUDED.total_frames,
             report_data       = EXCLUDED.report_data,
             generated_at      = NOW()`,
      [
        uuidv4(), streamId,
        Math.round(parseFloat(t.avg) || 0),
        Math.round(parseFloat(t.min) || 0),
        Math.round(parseFloat(t.max) || 0),
        parseInt(a.total) || 0,
        blockchainValid,
        impersonationRisk,
        parseInt(t.total) || 0,
        JSON.stringify(reportData),
      ]
    );

    logger.info('[sessionReport] generated', { streamId, avg: reportData.trust.avg });
    return reportData;
  } catch (err) {
    logger.error('[sessionReport] generation failed', { streamId, error: err.message });
    return null;
  }
};

module.exports = { generateSessionReport };
