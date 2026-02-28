'use strict';
/**
 * patientController.js — Patient-facing endpoints
 */
const { query }  = require('../config/database');
const { getCache, setCache } = require('../config/redis');
const { logger } = require('../middleware/errorHandler');

// GET /api/v1/patient/profile
const getMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await query(
      `SELECT pp.user_id, u.name, u.email,
              pp.health_id, pp.condition_notes, pp.assigned_doctor_id,
              du.name             AS doctor_name,
              dp.hospital_name,
              dp.specialization,
              dp.license_number,
              dp.verified_status,
              dp.risk_score,
              dp.years_experience
       FROM patient_profiles pp
       JOIN users u  ON u.id  = pp.user_id
       LEFT JOIN users du ON du.id = pp.assigned_doctor_id
       LEFT JOIN doctor_profiles dp ON dp.user_id = pp.assigned_doctor_id
       WHERE pp.user_id = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patient profile not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('[patient] getMyProfile', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

// GET /api/v1/patient/doctor
const getAssignedDoctor = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await query(
      `SELECT du.id, du.name, du.email,
              dp.specialization, dp.license_number, dp.hospital_name,
              dp.verified_status, dp.risk_score, dp.years_experience, dp.photo_url,
              ib.face_hash IS NOT NULL AS has_baseline
       FROM patient_profiles pp
       JOIN users du ON du.id = pp.assigned_doctor_id
       LEFT JOIN doctor_profiles dp ON dp.user_id = du.id
       LEFT JOIN impersonation_baselines ib ON ib.doctor_id = du.id
       WHERE pp.user_id = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No doctor assigned' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('[patient] getAssignedDoctor', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch doctor' });
  }
};

// GET /api/v1/patient/sessions
const getMySessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT s.id, s.status, s.started_at, s.ended_at, s.icu_room,
              du.name AS doctor_name,
              sr.avg_trust_score, sr.alert_count, sr.blockchain_valid, sr.impersonation_risk
       FROM streams s
       JOIN users du ON du.id = s.doctor_id
       LEFT JOIN session_reports sr ON sr.stream_id = s.id
       WHERE s.patient_id = $1
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), offset]
    );
    const count = await query(
      'SELECT COUNT(*) FROM streams WHERE patient_id = $1',
      [userId]
    );
    return res.json({
      sessions: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(count.rows[0].count) },
    });
  } catch (err) {
    logger.error('[patient] getMySessions', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }
};

// GET /api/v1/patient/session/:streamId/trust
const getSessionTrust = async (req, res) => {
  try {
    const { streamId } = req.params;
    const userId = req.user.id;

    // Verify this patient is linked to this stream
    const check = await query(
      'SELECT id FROM streams WHERE id = $1 AND patient_id = $2',
      [streamId, userId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this session' });
    }

    const result = await query(
      `SELECT trust_score, video_score, voice_score, biometric_score,
              blockchain_score, status, created_at
       FROM trust_logs
       WHERE stream_id = $1
       ORDER BY created_at DESC
       LIMIT 60`,
      [streamId]
    );
    return res.json({ history: result.rows });
  } catch (err) {
    logger.error('[patient] getSessionTrust', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch trust data' });
  }
};

// GET /api/v1/patient/session/:streamId/report
const getSessionReport = async (req, res) => {
  try {
    const { streamId } = req.params;
    const userId = req.user.id;

    const check = await query(
      'SELECT id FROM streams WHERE id = $1 AND patient_id = $2',
      [streamId, userId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await query(
      `SELECT sr.*, s.started_at, s.ended_at, s.icu_room,
              du.name AS doctor_name, dp.license_number, dp.hospital_name, dp.verified_status
       FROM session_reports sr
       JOIN streams s ON s.id = sr.stream_id
       JOIN users du ON du.id = s.doctor_id
       LEFT JOIN doctor_profiles dp ON dp.user_id = du.id
       WHERE sr.stream_id = $1`,
      [streamId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report not yet generated' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('[patient] getSessionReport', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch report' });
  }
};

// GET /api/v1/patient/alerts
const getMyAlerts = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await query(
      `SELECT ae.event_type, ae.severity, ae.details, ae.created_at, ae.stream_id
       FROM audit_events ae
       JOIN streams s ON s.id = ae.stream_id
       WHERE s.patient_id = $1
         AND ae.severity IN ('critical','warning')
       ORDER BY ae.created_at DESC
       LIMIT 50`,
      [userId]
    );
    return res.json({ alerts: result.rows });
  } catch (err) {
    logger.error('[patient] getMyAlerts', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch alerts' });
  }
};

module.exports = { getMyProfile, getAssignedDoctor, getMySessions, getSessionTrust, getSessionReport, getMyAlerts };
