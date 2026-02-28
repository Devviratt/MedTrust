const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');

const { authenticate, authorize, requireRole, requireEnrolled } = require('../middleware/auth');
const { apiLimiter, authLimiter, analysisLimiter, adminLimiter, noLimiter } = require('../middleware/rateLimiter');
const { validate, validateBody, schemas } = require('../middleware/validate');

const { analyzeVideo, analyzeAudio, getLiveTrustScore, getTrustHistory } = require('../controllers/analysisController');
const { analyzeFrameEndpoint } = require('../controllers/frameController');
const { registerDoctor, loginDoctor, logoutDoctor, trainVoiceProfile, getDoctorProfile, listDoctors } = require('../controllers/doctorController');
const { logChunk, validateChunk, getAudit, getAllAuditEvents, computeHash } = require('../controllers/blockchainController');
const { getConfig, updateConfig, getDashboardStats, getComplianceReport, createStream, startStream, stopStream } = require('../controllers/adminController');
const { getStream, getActiveStream, startStream: startNewStream, endStream } = require('../controllers/streamsController');
const { login, logout, register, registerSelf, me } = require('../controllers/authController');
const { getMyProfile, getAssignedDoctor, getMySessions, getSessionTrust, getSessionReport, getMyAlerts } = require('../controllers/patientController');
const { enrollBiometric, verifyIdentity, getBiometricStatus } = require('../controllers/biometricController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/mp4'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  },
});

// ─── Health Check ─────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'MedTrust API Gateway', timestamp: new Date().toISOString() });
});

// ─── Unified Auth (RBAC) ──────────────────────────────────────────────────────
router.post('/auth/login',         authLimiter, login);
router.post('/auth/logout',        authenticate, logout);
router.post('/auth/register',      authenticate, requireRole('admin'), register);
router.post('/auth/register-self', authLimiter, registerSelf);  // public self-registration
router.get('/auth/me',             authenticate, me);

// ─── Legacy Authentication (preserved for backward compat) ───────────────────
router.post('/doctor/login',  authLimiter, validateBody(schemas.loginDoctor), loginDoctor);
router.post('/doctor/logout', authenticate, logoutDoctor);

// ─── Doctor Management ───────────────────────────────────────────────────────
router.post(
  '/doctor/register',
  authenticate,
  requireRole('admin'),
  adminLimiter,
  validateBody(schemas.registerDoctor),
  registerDoctor
);
router.post(
  '/doctor/train-voice',
  authenticate,
  authorize('stream:write'),
  upload.array('audio_samples', 10),
  validateBody(schemas.trainVoice),
  trainVoiceProfile
);
router.get('/doctor/profile/:id', authenticate, authorize('stream:read'), getDoctorProfile);
router.get('/doctor/list', authenticate, requireRole('admin'), listDoctors);

// ─── Biometric Enrollment & Verification ─────────────────────────────────────
router.post('/doctor/enroll/:doctorId',          authenticate, requireRole('admin'), adminLimiter, enrollBiometric);
router.post('/doctor/verify/:doctorId',          authenticate, requireRole('admin', 'doctor'), adminLimiter, verifyIdentity);
router.get('/doctor/biometric-status/:doctorId', authenticate, requireRole('admin', 'doctor'), getBiometricStatus);

// ─── Doctor: mandatory biometric enrollment (no requireEnrolled guard here) ────
router.post('/doctor/enroll-biometric', authenticate, requireRole('doctor'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const crypto = require('crypto');
    const {
      face_embedding,   // float[] — averaged face descriptor from 20 frames
      voice_embedding,  // float[] — MFCC features
      baseline_bpm,     // number
      bpm_range_low,    // number
      bpm_range_high,   // number
      enrollment_location, // { lat, lng, accuracy }
      liveness_passed,  // boolean — client-side liveness check result
      quality_score,    // 0-100
    } = req.body;

    if (!face_embedding || !Array.isArray(face_embedding)) {
      return res.status(400).json({ error: 'face_embedding (array) required' });
    }
    if (!liveness_passed) {
      return res.status(400).json({ error: 'Liveness check must be completed' });
    }

    // Hash embeddings for storage integrity
    const face_hash  = crypto.createHash('sha256').update(JSON.stringify(face_embedding)).digest('hex');
    const voice_hash = voice_embedding ? crypto.createHash('sha256').update(JSON.stringify(voice_embedding)).digest('hex') : null;

    await dbQuery(
      `INSERT INTO doctor_biometrics
         (doctor_id, face_embedding, face_hash, voice_embedding, voice_hash,
          baseline_bpm, bpm_range_low, bpm_range_high, enrollment_location, liveness_passed, quality_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (doctor_id) DO UPDATE SET
         face_embedding = EXCLUDED.face_embedding,
         face_hash = EXCLUDED.face_hash,
         voice_embedding = EXCLUDED.voice_embedding,
         voice_hash = EXCLUDED.voice_hash,
         baseline_bpm = EXCLUDED.baseline_bpm,
         bpm_range_low = EXCLUDED.bpm_range_low,
         bpm_range_high = EXCLUDED.bpm_range_high,
         enrollment_location = EXCLUDED.enrollment_location,
         liveness_passed = EXCLUDED.liveness_passed,
         quality_score = EXCLUDED.quality_score,
         updated_at = NOW()`,
      [
        req.user.id,
        JSON.stringify(face_embedding),
        face_hash,
        voice_embedding ? JSON.stringify(voice_embedding) : null,
        voice_hash,
        baseline_bpm   ?? null,
        bpm_range_low  ?? null,
        bpm_range_high ?? null,
        enrollment_location ? JSON.stringify(enrollment_location) : null,
        liveness_passed,
        quality_score  ?? null,
      ]
    );

    // Set biometric_enrolled=true, enrollment_status=pending_admin_approval
    await dbQuery(
      `UPDATE users SET biometric_enrolled = TRUE, enrollment_status = 'pending_admin_approval' WHERE id = $1`,
      [req.user.id]
    );
    // Also store in impersonation_baselines for re-verification use
    await dbQuery(
      `INSERT INTO impersonation_baselines (doctor_id, face_hash, voice_hash, face_embedding)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (doctor_id) DO UPDATE SET
         face_hash = EXCLUDED.face_hash,
         voice_hash = EXCLUDED.voice_hash,
         face_embedding = EXCLUDED.face_embedding,
         updated_at = NOW()`,
      [req.user.id, face_hash, voice_hash, JSON.stringify(face_embedding)]
    );
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['BIOMETRIC_ENROLLED', 'info', JSON.stringify({ doctor_id: req.user.id, quality_score, liveness_passed })]
    );
    // Invalidate user cache so next authenticate call sees new enrollment_status
    const { deleteCache } = require('../config/redis');
    await deleteCache(`user:${req.user.id}`);

    return res.json({
      message: 'Biometric enrollment complete. Awaiting admin approval.',
      enrollment_status: 'pending_admin_approval',
      biometric_enrolled: true,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Enrollment failed', detail: err.message });
  }
});

// ─── Doctor: get own enrollment status ────────────────────────────────────────
router.get('/doctor/enrollment-status', authenticate, requireRole('doctor'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const result = await dbQuery(
      `SELECT u.biometric_enrolled, u.enrollment_status,
              db.liveness_passed, db.quality_score, db.enrolled_at,
              dp.verified_status
       FROM users u
       LEFT JOIN doctor_biometrics db ON db.doctor_id = u.id
       LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Doctor not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch enrollment status' });
  }
});

// ─── Analysis ─────────────────────────────────────────────────────────────────
router.post('/analyze/video', authenticate, authorize('analysis:read'), analysisLimiter, validateBody(schemas.analyzeVideo), analyzeVideo);
router.post('/analyze/audio', authenticate, authorize('analysis:read'), analysisLimiter, validateBody(schemas.analyzeAudio), analyzeAudio);
router.post('/analyze/frame/:streamId', authenticate, authorize('analysis:read'), analysisLimiter, analyzeFrameEndpoint);
router.get('/trustscore/live/:streamId', authenticate, noLimiter, authorize('trust:read'), getLiveTrustScore);
router.get('/trustscore/history/:streamId', authenticate, noLimiter, authorize('trust:read'), getTrustHistory);

// ─── Blockchain ───────────────────────────────────────────────────────────────
router.post('/blockchain/log', authenticate, authorize('blockchain:read'), logChunk);
router.post('/blockchain/validate', authenticate, authorize('blockchain:read'), validateChunk);
router.get('/blockchain/audit/:streamId', authenticate, authorize('blockchain:read'), getAudit);
router.get('/blockchain/audit', authenticate, requireRole('admin'), getAllAuditEvents);

// ─── Streams ──────────────────────────────────────────────────────────────────
router.get('/streams/active', authenticate, noLimiter, getActiveStream);
router.post('/streams/start', authenticate, startNewStream);
router.post('/streams/end/:streamId', authenticate, endStream);
router.get('/streams/history', authenticate, async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const limit = parseInt(req.query.limit) || 20;
    const result = await dbQuery(
      `SELECT s.id, s.status, s.started_at, s.ended_at, s.icu_room,
              pu.name AS patient_name,
              tl.trust_score AS last_trust
       FROM streams s
       LEFT JOIN users pu ON pu.id = s.patient_id
       LEFT JOIN LATERAL (
         SELECT trust_score FROM trust_logs
         WHERE stream_id = s.id ORDER BY created_at DESC LIMIT 1
       ) tl ON TRUE
       WHERE s.doctor_id = $1::uuid
       ORDER BY s.created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    return res.json({ streams: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch history', detail: err.message });
  }
});
router.get('/streams/:streamId', authenticate, getStream);
router.post('/streams/create', authenticate, createStream);  // legacy alias

// ─── Admin ────────────────────────────────────────────────────────────────────
router.get('/admin/config', authenticate, requireRole('admin'), adminLimiter, getConfig);
router.put('/admin/config', authenticate, requireRole('admin'), adminLimiter, validateBody(schemas.adminConfig), updateConfig);
router.get('/admin/dashboard', authenticate, requireRole('admin'), getDashboardStats);
router.get('/admin/compliance/report', authenticate, requireRole('admin'), getComplianceReport);
router.post('/admin/stream/start', authenticate, requireRole('admin', 'doctor'), startStream);
router.put('/admin/stream/:streamId/stop', authenticate, requireRole('admin', 'doctor'), stopStream);

// ─── Admin: AI Thresholds (RBAC — no hardcoded values) ───────────────────────
router.get('/admin/thresholds', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const result = await dbQuery('SELECT key, value, description, updated_at FROM ai_thresholds ORDER BY key');
    const thresholds = {};
    for (const row of result.rows) {
      thresholds[row.key] = { value: parseFloat(row.value), description: row.description, updated_at: row.updated_at };
    }
    return res.json(thresholds);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load thresholds' });
  }
});

router.put('/admin/thresholds', authenticate, requireRole('admin'), adminLimiter, async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const { invalidateCache } = require('../services/thresholdService');
    const allowed = [
      'min_safe_score','suspicious_score','alert_score',
      'video_drop_threshold','biometric_variance_limit','voice_flatness_limit',
      'video_weight','voice_weight','biometric_weight','blockchain_weight',
      'impersonation_threshold',
    ];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (updates.length === 0) return res.status(400).json({ error: 'No valid threshold keys provided' });

    for (const [key, value] of updates) {
      const num = parseFloat(value);
      if (isNaN(num)) continue;
      await dbQuery(
        `INSERT INTO ai_thresholds (key, value, updated_by, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=NOW()`,
        [key, num, req.user.id]
      );
    }
    await invalidateCache();
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['THRESHOLDS_UPDATED', 'info', JSON.stringify({ updated_by: req.user.id, keys: updates.map(([k]) => k) })]
    );
    return res.json({ message: 'Thresholds updated', updated: updates.map(([k]) => k) });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update thresholds' });
  }
});

// ─── Admin: User activate / deactivate / suspend ───────────────────────────
router.patch('/admin/users/:userId/status', authenticate, requireRole('admin'), adminLimiter, async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const { status } = req.body; // 'active' | 'inactive' | 'suspended'
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'status must be active, inactive, or suspended' });
    }
    const is_active = status === 'active';
    const verified  = status === 'suspended' ? 'suspended' : undefined;

    await dbQuery('UPDATE users SET is_active=$1 WHERE id=$2', [is_active, req.params.userId]);
    if (verified) {
      await dbQuery(
        `UPDATE doctor_profiles SET verified_status=$1 WHERE user_id=$2`,
        [verified, req.params.userId]
      ).catch(() => {});
    }
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['USER_STATUS_CHANGED', 'info', JSON.stringify({ target: req.params.userId, status, by: req.user.id })]
    );
    return res.json({ message: `User ${status}`, userId: req.params.userId, status });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update user status' });
  }
});

// ─── Admin: Force re-verification ────────────────────────────────────────────
router.post('/admin/users/:userId/force-reverify', authenticate, requireRole('admin'), adminLimiter, async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    await dbQuery(
      `UPDATE doctor_profiles SET verified_status='pending' WHERE user_id=$1`,
      [req.params.userId]
    );
    await dbQuery(
      `DELETE FROM impersonation_baselines WHERE doctor_id=$1`,
      [req.params.userId]
    );
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['FORCE_REVERIFY', 'warning', JSON.stringify({ target: req.params.userId, by: req.user.id })]
    );
    return res.json({ message: 'Re-verification triggered', userId: req.params.userId });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to trigger re-verification' });
  }
});

// ─── Admin: Grouped users list (doctors / patients / admins) ──────────────────
router.get('/admin/users/grouped', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');

    const doctorsQ = await dbQuery(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.last_login,
              u.biometric_enrolled, u.enrollment_status, u.suspicious_session_count,
              dp.verified_status, dp.hospital_name, dp.license_number,
              dp.specialization, dp.years_experience,
              (SELECT COUNT(*) FROM streams s WHERE s.doctor_id = u.id) AS total_sessions
       FROM users u
       LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
       WHERE u.role = 'doctor'
       ORDER BY u.created_at DESC`
    );

    const patientsQ = await dbQuery(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.last_login,
              u.suspicious_session_count,
              pp.assigned_doctor_id, pp.health_id,
              du.name AS assigned_doctor_name,
              (SELECT COUNT(*) FROM streams s WHERE s.patient_id = u.id) AS total_sessions
       FROM users u
       LEFT JOIN patient_profiles pp ON pp.user_id = u.id
       LEFT JOIN users du ON du.id = pp.assigned_doctor_id
       WHERE u.role = 'patient'
       ORDER BY u.created_at DESC`
    );

    const adminsQ = await dbQuery(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.last_login
       FROM users u
       WHERE u.role = 'admin'
       ORDER BY u.created_at DESC`
    );

    return res.json({
      doctors:  doctorsQ.rows,
      patients: patientsQ.rows,
      admins:   adminsQ.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch grouped users' });
  }
});

// ─── Admin: Block / unblock any user ──────────────────────────────────────────
router.post('/admin/users/:userId/block', authenticate, requireRole('admin'), adminLimiter, async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const { block = true } = req.body;
    await dbQuery('UPDATE users SET is_active=$1 WHERE id=$2', [!block, req.params.userId]);
    if (block) {
      await dbQuery(`UPDATE doctor_profiles SET verified_status='suspended' WHERE user_id=$1`, [req.params.userId]).catch(() => {});
    }
    await dbQuery(
      `INSERT INTO admin_logs (admin_id, target_user_id, action, metadata)
       VALUES ($1,$2,$3,$4)`,
      [req.user.id, req.params.userId, block ? 'BLOCK_USER' : 'UNBLOCK_USER', JSON.stringify({})]
    ).catch(() => {});
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      [block ? 'USER_BLOCKED' : 'USER_UNBLOCKED', 'warning', JSON.stringify({ target: req.params.userId, by: req.user.id })]
    );
    const { deleteCache } = require('../config/redis');
    await deleteCache(`user:${req.params.userId}`);
    const { getIo } = require('../websocket/signalingServer');
    const io = getIo();
    if (io) io.emit('user_status_changed', { userId: req.params.userId, is_active: !block });
    return res.json({ message: block ? 'User blocked' : 'User unblocked', userId: req.params.userId });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update user status' });
  }
});

// ─── Admin: Delete user ────────────────────────────────────────────────────────
router.delete('/admin/users/:userId', authenticate, requireRole('admin'), adminLimiter, async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    // Prevent admin from deleting themselves
    if (req.params.userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    await dbQuery(
      `INSERT INTO admin_logs (admin_id, target_user_id, action, metadata)
       VALUES ($1,$2,'DELETE_USER',$3)`,
      [req.user.id, req.params.userId, JSON.stringify({})]
    ).catch(() => {});
    await dbQuery('DELETE FROM users WHERE id=$1', [req.params.userId]);
    const { deleteCache } = require('../config/redis');
    await deleteCache(`user:${req.params.userId}`);
    const { getIo } = require('../websocket/signalingServer');
    const io = getIo();
    if (io) io.emit('user_deleted', { userId: req.params.userId });
    return res.json({ message: 'User deleted', userId: req.params.userId });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ─── Admin: Users list ────────────────────────────────────────────────────────
router.get('/admin/users', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const { role, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let q = `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.last_login,
                    u.biometric_enrolled, u.enrollment_status,
                    dp.verified_status, dp.hospital_name, dp.license_number,
                    pp.assigned_doctor_id, pp.health_id
             FROM users u
             LEFT JOIN doctor_profiles dp ON dp.user_id = u.id AND u.role IN ('doctor','admin')
             LEFT JOIN patient_profiles pp ON pp.user_id = u.id AND u.role = 'patient'
             WHERE 1=1`;
    const params = [];
    if (role) { params.push(role); q += ` AND u.role = $${params.length}`; }
    params.push(parseInt(limit), offset);
    q += ` ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const result = await dbQuery(q, params);
    const count  = await dbQuery('SELECT COUNT(*) FROM users' + (role ? ' WHERE role=$1' : ''), role ? [role] : []);
    return res.json({ users: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── Admin: All active sessions ───────────────────────────────────────────────
router.get('/admin/sessions', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const result = await dbQuery(
      `SELECT s.id, s.status, s.started_at, s.ended_at, s.icu_room,
              s.doctor_id,
              du.name AS doctor_name, pu.name AS patient_name,
              tl.trust_score AS last_trust, tl.status AS trust_status
       FROM streams s
       LEFT JOIN users du ON du.id = s.doctor_id
       LEFT JOIN users pu ON pu.id = s.patient_id
       LEFT JOIN LATERAL (
         SELECT trust_score, status FROM trust_logs
         WHERE stream_id = s.id ORDER BY created_at DESC LIMIT 1
       ) tl ON TRUE
       ORDER BY s.created_at DESC LIMIT 100`
    );
    return res.json({ sessions: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ─── Patient routes ──────────────────────────────────────────────────────────
router.get('/patient/profile',                  authenticate, requireRole('patient'), getMyProfile);
router.get('/patient/doctor',                   authenticate, requireRole('patient'), getAssignedDoctor);
router.get('/patient/sessions',                 authenticate, requireRole('patient'), getMySessions);
router.get('/patient/session/:streamId/trust',  authenticate, requireRole('patient'), getSessionTrust);
router.get('/patient/session/:streamId/report', authenticate, requireRole('patient'), getSessionReport);
router.get('/patient/alerts',                   authenticate, requireRole('patient'), getMyAlerts);

// ─── Public: verified doctors list (patients browse before connecting) ────────
router.get('/doctors/verified', authenticate, async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const result = await dbQuery(
      `SELECT u.id, u.name, u.email,
              dp.specialization, dp.hospital_name, dp.license_number,
              dp.verified_status, dp.years_experience, dp.photo_url
       FROM users u
       JOIN doctor_profiles dp ON dp.user_id = u.id
       WHERE u.role = 'doctor'
         AND u.is_active = true
         AND dp.verified_status = 'verified'
       ORDER BY u.name ASC`
    );
    return res.json({ doctors: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// ─── Session requests (patient initiates connection to doctor) ────────────────
router.post('/sessions/request', authenticate, requireRole('patient'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const { doctor_id } = req.body;
    if (!doctor_id) return res.status(400).json({ error: 'doctor_id required' });

    // Verify doctor is verified
    const dr = await dbQuery(
      `SELECT u.id, u.name, dp.verified_status
       FROM users u JOIN doctor_profiles dp ON dp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'doctor' AND u.is_active = true`,
      [doctor_id]
    );
    if (dr.rows.length === 0) return res.status(404).json({ error: 'Doctor not found' });
    if (dr.rows[0].verified_status !== 'verified') {
      return res.status(403).json({ error: 'Doctor is not verified' });
    }

    // Assign doctor to patient profile and create a pending stream
    await dbQuery(
      `UPDATE patient_profiles SET assigned_doctor_id = $1 WHERE user_id = $2`,
      [doctor_id, req.user.id]
    );

    // Create stream in pending state
    const { v4: uuidv4 } = require('uuid');
    const streamId = uuidv4();
    await dbQuery(
      `INSERT INTO streams (id, doctor_id, patient_id, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())`,
      [streamId, doctor_id, req.user.id]
    );

    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['SESSION_REQUESTED', 'info', JSON.stringify({ patient_id: req.user.id, doctor_id, stream_id: streamId })]
    );

    return res.status(201).json({
      message: 'Connection request sent',
      stream_id: streamId,
      doctor: { id: dr.rows[0].id, name: dr.rows[0].name },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to request session', detail: err.message });
  }
});

// ─── Patient/Doctor: get my pending/active stream ─────────────────────────────
router.get('/sessions/my', authenticate, noLimiter, requireRole('patient', 'doctor'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const SESSION_Q = (byField) => `
      SELECT s.id, s.status, s.started_at, s.ended_at, s.icu_room,
             du.id AS doctor_id, du.name AS doctor_name,
             pu.id AS patient_id, pu.name AS patient_name,
             dp.specialization, dp.hospital_name, dp.license_number, dp.verified_status,
             tl.trust_score AS last_trust, tl.status AS trust_status
      FROM streams s
      LEFT JOIN users du ON du.id = s.doctor_id
      LEFT JOIN users pu ON pu.id = s.patient_id
      LEFT JOIN doctor_profiles dp ON dp.user_id = s.doctor_id
      LEFT JOIN LATERAL (
        SELECT trust_score, status FROM trust_logs
        WHERE stream_id = s.id ORDER BY created_at DESC LIMIT 1
      ) tl ON TRUE
      WHERE s.${byField} = $1 AND s.status IN ('pending','doctor_verifying','active')
      ORDER BY s.created_at DESC LIMIT 1`;

    const q = req.user.role === 'doctor'
      ? SESSION_Q('doctor_id')
      : SESSION_Q('patient_id');
    const result = await dbQuery(q, [req.user.id]);
    return res.json({ session: result.rows[0] || null });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// ─── Doctor: own profile + impersonation status ───────────────────────────────
router.get('/doctor/impersonation/:streamId', authenticate, requireRole('doctor','admin'), async (req, res) => {
  try {
    const { getImpersonationResult } = require('../services/impersonationService');
    const result = await getImpersonationResult(req.params.streamId);
    return res.json(result || { impersonation_risk: 'LOW', similarity_score: 100, baseline_established: false });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch impersonation data' });
  }
});

// ─── Session report (doctor/admin) ───────────────────────────────────────────
router.get('/streams/:streamId/report', authenticate, requireRole('admin','doctor'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const result = await dbQuery(
      `SELECT sr.*, s.started_at, s.ended_at, s.icu_room,
              du.name AS doctor_name, pu.name AS patient_name
       FROM session_reports sr
       JOIN streams s ON s.id = sr.stream_id
       LEFT JOIN users du ON du.id = s.doctor_id
       LEFT JOIN users pu ON pu.id = s.patient_id
       WHERE sr.stream_id = $1::uuid`,
      [req.params.streamId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// ─── Doctor: get pending session requests ─────────────────────────────────────
router.get('/sessions/pending', authenticate, noLimiter, requireEnrolled, requireRole('doctor'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const result = await dbQuery(
      `SELECT s.id, s.status, s.created_at, s.icu_room,
              pu.id AS patient_id, pu.name AS patient_name, pu.email AS patient_email,
              pp.health_id, pp.condition_notes
       FROM streams s
       JOIN users pu ON pu.id = s.patient_id
       LEFT JOIN patient_profiles pp ON pp.user_id = s.patient_id
       WHERE s.doctor_id = $1 AND s.status = 'pending'
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    return res.json({ requests: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch session requests' });
  }
});

// ─── Doctor: get active session ───────────────────────────────────────────────
router.get('/sessions/active', authenticate, noLimiter, requireEnrolled, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const result = await dbQuery(
      `SELECT s.id, s.status, s.started_at, s.trust_score,
              pu.id AS patient_id, pu.name AS patient_name,
              pp.health_id, pp.condition_notes,
              tl.trust_score AS live_trust, tl.status AS trust_status
       FROM streams s
       JOIN users pu ON pu.id = s.patient_id
       LEFT JOIN patient_profiles pp ON pp.user_id = s.patient_id
       LEFT JOIN LATERAL (
         SELECT trust_score, status FROM trust_logs
         WHERE stream_id = s.id ORDER BY created_at DESC LIMIT 1
       ) tl ON TRUE
       WHERE s.doctor_id = $1 AND s.status = 'active'
       ORDER BY s.started_at DESC LIMIT 1`,
      [req.user.id]
    );
    return res.json({ session: result.rows[0] || null });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch active session' });
  }
});

// ─── Doctor: respond to session request (accept / reject) ────────────────────
router.post('/sessions/:streamId/respond', authenticate, requireEnrolled, requireRole('doctor'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const { action } = req.body; // 'accept' | 'reject'
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be accept or reject' });
    }

    const stream = await dbQuery(
      `SELECT id, doctor_id, patient_id, status FROM streams WHERE id = $1`,
      [req.params.streamId]
    );
    if (stream.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    if (stream.rows[0].doctor_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    if (stream.rows[0].status !== 'pending') return res.status(409).json({ error: 'Session is not pending' });

    if (action === 'reject') {
      await dbQuery(`UPDATE streams SET status = 'ended', ended_at = NOW() WHERE id = $1`, [req.params.streamId]);
      await dbQuery(
        `INSERT INTO audit_events (event_type, severity, details, stream_id) VALUES ($1,$2,$3,$4)`,
        ['SESSION_REJECTED', 'info', JSON.stringify({ doctor_id: req.user.id }), req.params.streamId]
      );
      return res.json({ message: 'Session rejected' });
    }

    // Accept — set status to 'doctor_verifying' (active only after re-verification passes)
    await dbQuery(
      `UPDATE streams SET status = 'doctor_verifying' WHERE id = $1`,
      [req.params.streamId]
    );
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details, stream_id) VALUES ($1,$2,$3,$4)`,
      ['SESSION_ACCEPTED', 'info', JSON.stringify({ doctor_id: req.user.id }), req.params.streamId]
    );
    // Notify patient that doctor has accepted and verification is underway
    const { getIo: _acceptIo } = require('../websocket/signalingServer');
    const _acceptSocket = _acceptIo();
    if (_acceptSocket) {
      _acceptSocket.to(req.params.streamId).emit('doctor_verified', {
        session_id: req.params.streamId,
        sessionId:  req.params.streamId,
        status: 'doctor_verifying',
      });
    }
    return res.json({ message: 'Session accepted — verification required', stream_id: req.params.streamId, status: 'doctor_verifying' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to respond to session' });
  }
});

// ─── Doctor: pre-session re-verification gate ─────────────────────────────────
router.post('/sessions/:streamId/verify', authenticate, requireEnrolled, requireRole('doctor'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    // Accept scores from biometric service, or fallback to mock if not provided
    const {
      face_score      = 0,
      voice_score     = 0,
      biometric_score = 0,
      liveness_score  = 0,
      motion_score    = 0,
    } = req.body;

    // Trust formula: face 30% + voice 20% + biometric 20% + liveness 15% + motion 15%
    const final_trust = Math.round(
      face_score * 0.30 +
      voice_score * 0.20 +
      biometric_score * 0.20 +
      liveness_score * 0.15 +
      motion_score * 0.15
    );
    const passed = final_trust >= 70;

    // Log verification attempt
    await dbQuery(
      `INSERT INTO verification_logs
         (stream_id, user_id, face_score, voice_score, biometric_score, liveness_score, motion_score, final_trust, passed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.params.streamId, req.user.id, face_score, voice_score, biometric_score, liveness_score, motion_score, final_trust, passed]
    );

    if (!passed) {
      // Block the session and flag doctor
      await dbQuery(`UPDATE streams SET status = 'blocked', ended_at = NOW() WHERE id = $1`, [req.params.streamId]);
      // Insert security log
      await dbQuery(
        `INSERT INTO security_logs (session_id, user_id, role, violation_type, risk_score, metadata)
         VALUES ($1,$2,'doctor','VERIFICATION_FAILED',$3,$4)`,
        [req.params.streamId, req.user.id, final_trust,
          JSON.stringify({ face_score, voice_score, biometric_score, liveness_score, motion_score })]
      ).catch(() => {});
      // Notify patient + admin via socket
      const { getIo: _getIo } = require('../websocket/signalingServer');
      const _io = _getIo();
      if (_io) {
        _io.to(req.params.streamId).emit('session_blocked', { sessionId: req.params.streamId, reason: 'Verification failed — identity risk detected' });
        _io.emit('identity_flagged', {
          sessionId: req.params.streamId,
          userId: req.user.id,
          role: 'doctor',
          risk_score: final_trust,
          message: 'Doctor identity verification failed — session blocked',
        });
      }
      await dbQuery(
        `UPDATE users SET suspicious_session_count = suspicious_session_count + 1,
                          risk_score = LEAST(risk_score + 10, 100)
         WHERE id = $1`,
        [req.user.id]
      );
      // Auto-suspend if >= 3 suspicious sessions
      await dbQuery(
        `UPDATE doctor_profiles SET verified_status = 'suspended'
         WHERE user_id = (SELECT id FROM users WHERE id = $1 AND suspicious_session_count >= 3)`,
        [req.user.id]
      );
      await dbQuery(
        `INSERT INTO audit_events (event_type, severity, details, stream_id) VALUES ($1,$2,$3,$4)`,
        ['VERIFICATION_FAILED', 'critical',
          JSON.stringify({ doctor_id: req.user.id, final_trust, face_score, voice_score }),
          req.params.streamId]
      );
      return res.status(403).json({
        passed: false,
        final_trust,
        message: 'Verification failed — identity could not be confirmed. Session blocked.',
      });
    }

    // Set session active now that identity is confirmed
    await dbQuery(
      `UPDATE streams SET status = 'active', started_at = NOW(), trust_score = $1 WHERE id = $2`,
      [final_trust, req.params.streamId]
    );
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details, stream_id) VALUES ($1,$2,$3,$4)`,
      ['VERIFICATION_PASSED', 'info', JSON.stringify({ doctor_id: req.user.id, final_trust }), req.params.streamId]
    );
    // Emit socket events so patient dashboard auto-activates
    const { getIo } = require('../websocket/signalingServer');
    const io = getIo();
    if (io) {
      // emit both field names for compatibility
      const payload = { session_id: req.params.streamId, sessionId: req.params.streamId, final_trust };
      io.to(req.params.streamId).emit('doctor_verified',   payload);
      io.to(req.params.streamId).emit('session_activated', payload);
    }
    return res.json({ passed: true, final_trust, message: 'Verification passed', session_id: req.params.streamId });
  } catch (err) {
    return res.status(500).json({ error: 'Verification check failed' });
  }
});

// ─── Doctor/Patient: get session detail ──────────────────────────────────────
router.get('/sessions/:streamId', authenticate, noLimiter, requireRole('doctor', 'patient', 'admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const result = await dbQuery(
      `SELECT s.id, s.status, s.started_at, s.ended_at, s.icu_room, s.trust_score,
              du.id AS doctor_id, du.name AS doctor_name, du.email AS doctor_email,
              dp.specialization, dp.hospital_name, dp.license_number, dp.verified_status,
              pu.id AS patient_id, pu.name AS patient_name, pu.email AS patient_email,
              pp.health_id, pp.condition_notes,
              (SELECT COUNT(*) FROM streams ps
               WHERE ps.patient_id = s.patient_id AND ps.status IN ('ended','completed','blocked')) AS previous_sessions,
              (SELECT COUNT(*) FROM audit_events ae
               WHERE ae.stream_id = s.id AND ae.severity = 'critical') AS risk_events
       FROM streams s
       LEFT JOIN users du ON du.id = s.doctor_id
       LEFT JOIN doctor_profiles dp ON dp.user_id = s.doctor_id
       LEFT JOIN users pu ON pu.id = s.patient_id
       LEFT JOIN patient_profiles pp ON pp.user_id = s.patient_id
       WHERE s.id = $1`,
      [req.params.streamId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    const row = result.rows[0];
    // Access control: doctor must own it, patient must be the patient, admin always OK
    if (req.user.role === 'doctor'  && row.doctor_id  !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    if (req.user.role === 'patient' && row.patient_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    return res.json({ session: row });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch session detail', detail: err.message });
  }
});

// ─── Doctor: get patient-side trust score for active session ──────────────────
router.get('/sessions/:streamId/trust', authenticate, noLimiter, requireRole('doctor', 'admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const { getTrustScore } = require('../config/redis');

    // Try Redis live score first (fastest)
    const live = await getTrustScore(req.params.streamId);
    if (live) {
      return res.json({
        stream_id:   req.params.streamId,
        trust_score: live.trust_score ?? 0,
        status:      live.status      ?? 'safe',
        face_score:  live.face_score  ?? live.video_score ?? 0,
        voice_score: live.voice_score ?? 0,
        biometric_score: live.biometric_score ?? 0,
        source: 'live',
      });
    }
    // Fallback to DB latest trust log
    const result = await dbQuery(
      `SELECT tl.trust_score, tl.status, tl.created_at,
              vl.face_score, vl.voice_score, vl.biometric_score, vl.final_trust
       FROM streams s
       LEFT JOIN LATERAL (
         SELECT trust_score, status, created_at FROM trust_logs
         WHERE stream_id = s.id ORDER BY created_at DESC LIMIT 1
       ) tl ON TRUE
       LEFT JOIN LATERAL (
         SELECT face_score, voice_score, biometric_score, final_trust FROM verification_logs
         WHERE stream_id = s.id ORDER BY created_at DESC LIMIT 1
       ) vl ON TRUE
       WHERE s.id = $1`,
      [req.params.streamId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No trust data' });
    const row = result.rows[0];
    return res.json({
      stream_id:       req.params.streamId,
      trust_score:     row.trust_score     ?? row.final_trust ?? 0,
      status:          row.status          ?? 'safe',
      face_score:      row.face_score      ?? 0,
      voice_score:     row.voice_score     ?? 0,
      biometric_score: row.biometric_score ?? 0,
      recorded_at:     row.created_at,
      source: 'db',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch trust score', detail: err.message });
  }
});

// ─── Patient: cancel / disconnect session ────────────────────────────────────
router.post('/sessions/:streamId/cancel', authenticate, requireRole('patient'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const stream = await dbQuery(
      `SELECT id, patient_id, status FROM streams WHERE id = $1`, [req.params.streamId]
    );
    if (stream.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    if (stream.rows[0].patient_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    await dbQuery(`UPDATE streams SET status = 'ended', ended_at = NOW() WHERE id = $1`, [req.params.streamId]);
    return res.json({ message: 'Session cancelled' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel session' });
  }
});

// ─── Admin: enhanced user registry with biometric + verification data ─────────
router.get('/admin/registry', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const { role } = req.query;
    const whereRole = role ? `AND u.role = $1` : '';
    const params = role ? [role] : [];

    const result = await dbQuery(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.last_login, u.created_at,
              u.biometric_enrolled, u.risk_score, u.suspicious_session_count,
              dp.verified_status, dp.specialization, dp.hospital_name, dp.license_number, dp.years_experience,
              pp.health_id, pp.assigned_doctor_id,
              ib.face_hash IS NOT NULL AS has_face_baseline,
              (SELECT COUNT(*) FROM streams s WHERE s.doctor_id = u.id AND s.status = 'blocked') AS blocked_sessions,
              (SELECT MAX(vl.final_trust) FROM verification_logs vl WHERE vl.user_id = u.id) AS last_verify_score
       FROM users u
       LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
       LEFT JOIN patient_profiles pp ON pp.user_id = u.id
       LEFT JOIN impersonation_baselines ib ON ib.doctor_id = u.id
       WHERE 1=1 ${whereRole}
       ORDER BY u.created_at DESC`,
      params
    );
    return res.json({ users: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch user registry' });
  }
});

// ─── Admin: get all sessions with trust data ──────────────────────────────────
router.get('/admin/sessions/all', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    const result = await dbQuery(
      `SELECT s.id, s.status, s.started_at, s.ended_at, s.trust_score, s.icu_room,
              du.name AS doctor_name, du.email AS doctor_email,
              pu.name AS patient_name,
              dp.verified_status,
              (SELECT COUNT(*) FROM audit_events ae WHERE ae.stream_id = s.id AND ae.severity = 'critical') AS critical_events
       FROM streams s
       LEFT JOIN users du ON du.id = s.doctor_id
       LEFT JOIN users pu ON pu.id = s.patient_id
       LEFT JOIN doctor_profiles dp ON dp.user_id = s.doctor_id
       ORDER BY s.created_at DESC
       LIMIT 100`
    );
    return res.json({ sessions: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ─── Admin: approve doctor (set verified) ─────────────────────────────────────
router.post('/admin/doctors/:userId/approve', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    await dbQuery(
      `UPDATE doctor_profiles SET verified_status = 'verified' WHERE user_id = $1`,
      [req.params.userId]
    );
    await dbQuery(
      `UPDATE users SET enrollment_status = 'approved' WHERE id = $1`,
      [req.params.userId]
    );
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['DOCTOR_APPROVED', 'info', JSON.stringify({ user_id: req.params.userId, admin_id: req.user.id })]
    );
    const { deleteCache } = require('../config/redis');
    await deleteCache(`user:${req.params.userId}`);
    return res.json({ message: 'Doctor approved' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to approve doctor' });
  }
});

// ─── Admin: revoke / suspend doctor ──────────────────────────────────────────
router.post('/admin/doctors/:userId/revoke', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    await dbQuery(
      `UPDATE doctor_profiles SET verified_status = 'suspended' WHERE user_id = $1`,
      [req.params.userId]
    );
    await dbQuery(`UPDATE users SET is_active = FALSE WHERE id = $1`, [req.params.userId]);
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['DOCTOR_REVOKED', 'critical', JSON.stringify({ user_id: req.params.userId, admin_id: req.user.id })]
    );
    const { deleteCache } = require('../config/redis');
    await deleteCache(`user:${req.params.userId}`);
    return res.json({ message: 'Doctor revoked' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to revoke doctor' });
  }
});

// ─── Admin: force re-enroll biometric ─────────────────────────────────────────
router.post('/admin/doctors/:userId/re-enroll', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { query: dbQuery } = require('../config/database');
    await dbQuery(`DELETE FROM impersonation_baselines WHERE doctor_id = $1`, [req.params.userId]);
    await dbQuery(`DELETE FROM doctor_biometrics WHERE doctor_id = $1`, [req.params.userId]);
    await dbQuery(
      `UPDATE users SET biometric_enrolled = FALSE, enrollment_status = 'pending_enrollment' WHERE id = $1`,
      [req.params.userId]
    );
    await dbQuery(
      `UPDATE doctor_profiles SET verified_status = 'pending' WHERE user_id = $1`,
      [req.params.userId]
    );
    await dbQuery(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['BIOMETRIC_RESET', 'warning', JSON.stringify({ user_id: req.params.userId, admin_id: req.user.id })]
    );
    const { deleteCache } = require('../config/redis');
    await deleteCache(`user:${req.params.userId}`);
    return res.json({ message: 'Biometric reset — doctor must re-enroll' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset biometric' });
  }
});

module.exports = router;
