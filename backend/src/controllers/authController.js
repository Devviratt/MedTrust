'use strict';
/**
 * authController.js — Unified RBAC authentication
 * POST /api/v1/auth/login  → { token, role, userId, user }
 * POST /api/v1/auth/logout
 * POST /api/v1/auth/register (admin only for doctor/patient creation)
 */
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query }      = require('../config/database');
const { setCache, deleteCache, getCache } = require('../config/redis');
const { logger }     = require('../middleware/errorHandler');

// ── POST /api/v1/auth/login ───────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    // Lookup in unified users table first, fall back to legacy doctors table
    let user = null;
    let source = 'users';

    const usersResult = await query(
      'SELECT id, name, email, password_hash, role, is_active, biometric_enrolled, enrollment_status FROM users WHERE email = $1 LIMIT 1',
      [email]
    );
    if (usersResult.rows.length > 0) {
      user = usersResult.rows[0];
    } else {
      // Legacy doctors table fallback
      const docResult = await query(
        'SELECT id, full_name AS name, email, password_hash, role, is_active FROM doctors WHERE email = $1 LIMIT 1',
        [email]
      );
      if (docResult.rows.length > 0) {
        user = docResult.rows[0];
        source = 'doctors';
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    // ── Always verify password first ─────────────────────────────────────────
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await query(
        `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
        ['LOGIN_FAILED', 'warning', JSON.stringify({ email, ip: req.ip })]
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // ── After password OK: check doctor enrollment state ─────────────────────
    if (user.role === 'doctor') {
      const enrollStatus = user.enrollment_status ?? 'pending_enrollment';
      const bioEnrolled  = user.biometric_enrolled ?? false;

      if (enrollStatus === 'suspended') {
        return res.status(403).json({ error: 'Account suspended. Contact admin.' });
      }

      const ePayload = { userId: user.id, role: user.role, email: user.email };
      const eToken   = jwt.sign(ePayload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });
      await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]).catch(() => {});

      if (!bioEnrolled || enrollStatus === 'pending_enrollment') {
        return res.json({
          token: eToken, role: user.role, userId: user.id,
          enrollment_required: true,
          enrollment_status: enrollStatus,
          user: { id: user.id, name: user.name, email: user.email, role: user.role, enrollment_status: enrollStatus, biometric_enrolled: bioEnrolled },
        });
      }
      if (enrollStatus === 'pending_admin_approval') {
        return res.json({
          token: eToken, role: user.role, userId: user.id,
          enrollment_required: false,
          pending_approval: true,
          enrollment_status: enrollStatus,
          user: { id: user.id, name: user.name, email: user.email, role: user.role, enrollment_status: enrollStatus, biometric_enrolled: bioEnrolled },
        });
      }
      // enrollment_status === 'approved' — fall through to normal token below
    }

    const payload = { userId: user.id, role: user.role, email: user.email };
    const token   = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    });

    await setCache(`refresh:${user.id}`, token, 7 * 24 * 3600);

    // Update last_login
    if (source === 'users') {
      await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    } else {
      await query('UPDATE doctors SET last_login = NOW() WHERE id = $1', [user.id]);
    }

    await query(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['LOGIN_SUCCESS', 'info', JSON.stringify({ user_id: user.id, role: user.role })]
    );

    // Load profile extras
    let profile = {};
    if (user.role === 'doctor' || user.role === 'admin') {
      const dp = await query(
        'SELECT specialization, license_number, hospital_name, verified_status, risk_score, photo_url, years_experience FROM doctor_profiles WHERE user_id = $1',
        [user.id]
      ).catch(() => ({ rows: [] }));
      profile = dp.rows[0] || {};
    }
    if (user.role === 'patient') {
      const pp = await query(
        `SELECT pp.health_id, pp.condition_notes, pp.assigned_doctor_id,
                u.name AS doctor_name
         FROM patient_profiles pp
         LEFT JOIN users u ON pp.assigned_doctor_id = u.id
         WHERE pp.user_id = $1`,
        [user.id]
      ).catch(() => ({ rows: [] }));
      profile = pp.rows[0] || {};
    }

    logger.info('[auth] login success', { userId: user.id, role: user.role });

    return res.json({
      token,
      role:   user.role,
      userId: user.id,
      user: {
        id:    user.id,
        name:  user.name,
        email: user.email,
        role:  user.role,
        ...profile,
      },
    });
  } catch (err) {
    logger.error('[auth] login error', { error: err.message });
    return res.status(500).json({ error: 'Login failed' });
  }
};

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────
const logout = async (req, res) => {
  try {
    const token   = req.token;
    const decoded = jwt.decode(token);
    const ttl     = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;
    if (ttl > 0) await setCache(`blacklist:${token}`, true, ttl);
    await deleteCache(`refresh:${req.user.id}`);
    await deleteCache(`user:${req.user.id}`);
    await query(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['LOGOUT', 'info', JSON.stringify({ user_id: req.user.id })]
    );
    return res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error('[auth] logout error', { error: err.message });
    return res.status(500).json({ error: 'Logout failed' });
  }
};

// ── POST /api/v1/auth/register (admin only) ───────────────────────────────────
const register = async (req, res) => {
  try {
    const {
      name, email, password, role,
      specialization, license_number, hospital_name, years_experience,
      assigned_doctor_id, health_id, condition_notes,
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, role required' });
    }
    if (!['admin', 'doctor', 'patient'].includes(role)) {
      return res.status(400).json({ error: 'role must be admin, doctor, or patient' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const userId        = uuidv4();

    const initEnrollStatus = role === 'admin' ? 'approved' : role === 'doctor' ? 'pending_enrollment' : 'approved';
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, enrollment_status) VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, name, email, password_hash, role, initEnrollStatus]
    );

    if (role === 'doctor' || role === 'admin') {
      const licenseVal = license_number || `PENDING-${userId.slice(0, 8).toUpperCase()}`;
      await query(
        `INSERT INTO doctor_profiles (user_id, specialization, license_number, hospital_name, years_experience, verified_status)
         VALUES ($1,$2,$3,$4,$5,'pending')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, specialization || null, licenseVal, hospital_name || null, years_experience || 0]
      );
    }
    if (role === 'patient') {
      const healthIdVal = health_id || `PAT-${userId.slice(0, 8).toUpperCase()}`;
      await query(
        `INSERT INTO patient_profiles (user_id, assigned_doctor_id, health_id, condition_notes)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, assigned_doctor_id || null, healthIdVal, condition_notes || null]
      );
    }

    await query(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['USER_REGISTERED', 'info', JSON.stringify({ user_id: userId, role, created_by: req.user?.id })]
    );

    logger.info('[auth] user registered', { userId, role, email });

    return res.status(201).json({
      message: 'User registered',
      user: { id: userId, name, email, role },
    });
  } catch (err) {
    logger.error('[auth] register error', { error: err.message });
    return res.status(500).json({ error: 'Registration failed' });
  }
};

// ── POST /api/v1/auth/register-self (public — patient/doctor only, no admin) ──
const registerSelf = async (req, res) => {
  try {
    const {
      name, email, password, role,
      specialization, license_number, hospital_name, years_experience,
      health_id, condition_notes,
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, role required' });
    }
    // Admin accounts cannot be self-created
    if (!['doctor', 'patient'].includes(role)) {
      return res.status(400).json({ error: 'role must be doctor or patient' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const userId        = uuidv4();

    // Doctors start with biometric_enrolled=false, enrollment_status=pending_enrollment
    const enrollStatus = role === 'doctor' ? 'pending_enrollment' : 'approved';
    await query(
      `INSERT INTO users (id, name, email, password_hash, role, biometric_enrolled, enrollment_status)
       VALUES ($1,$2,$3,$4,$5,FALSE,$6)`,
      [userId, name, email, password_hash, role, enrollStatus]
    );

    if (role === 'doctor') {
      const licenseVal = license_number || `PENDING-${userId.slice(0, 8).toUpperCase()}`;
      await query(
        `INSERT INTO doctor_profiles (user_id, specialization, license_number, hospital_name, years_experience, verified_status)
         VALUES ($1,$2,$3,$4,$5,'pending')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, specialization || null, licenseVal, hospital_name || null, years_experience || 0]
      );
    }
    if (role === 'patient') {
      const healthIdVal = health_id || `PAT-${userId.slice(0, 8).toUpperCase()}`;
      await query(
        `INSERT INTO patient_profiles (user_id, health_id, condition_notes)
         VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, healthIdVal, condition_notes || null]
      );
    }

    await query(
      `INSERT INTO audit_events (event_type, severity, details) VALUES ($1,$2,$3)`,
      ['USER_SELF_REGISTERED', 'info', JSON.stringify({ user_id: userId, role, email })]
    );

    logger.info('[auth] self-register', { userId, role, email });

    // Issue token immediately so doctor can authenticate to the enrollment endpoint
    const payload = { userId, role, email };
    const token   = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });

    return res.status(201).json({
      message: 'Account created successfully',
      token,
      enrollment_required: role === 'doctor',
      enrollment_status: enrollStatus,
      user: { id: userId, name, email, role, enrollment_status: enrollStatus, biometric_enrolled: false },
    });
  } catch (err) {
    logger.error('[auth] registerSelf error', { error: err.message });
    return res.status(500).json({ error: 'Registration failed' });
  }
};

// ── GET /api/v1/auth/me ───────────────────────────────────────────────────────
const me = async (req, res) => {
  try {
    const userId = req.user.id;
    const role   = req.user.role;

    let profile = {};
    if (role === 'doctor' || role === 'admin') {
      const dp = await query(
        `SELECT dp.specialization, dp.license_number, dp.hospital_name,
                dp.verified_status, dp.risk_score, dp.photo_url, dp.years_experience,
                ib.face_hash IS NOT NULL AS has_face_baseline,
                ib.voice_hash IS NOT NULL AS has_voice_baseline
         FROM doctor_profiles dp
         LEFT JOIN impersonation_baselines ib ON ib.doctor_id = dp.user_id
         WHERE dp.user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [] }));
      profile = dp.rows[0] || {};
    }
    if (role === 'patient') {
      const pp = await query(
        `SELECT pp.health_id, pp.condition_notes, pp.assigned_doctor_id,
                u.name AS doctor_name, dp.hospital_name, dp.specialization, dp.license_number,
                dp.verified_status
         FROM patient_profiles pp
         LEFT JOIN users u ON pp.assigned_doctor_id = u.id
         LEFT JOIN doctor_profiles dp ON dp.user_id = pp.assigned_doctor_id
         WHERE pp.user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [] }));
      profile = pp.rows[0] || {};
    }

    return res.json({
      id:    userId,
      name:  req.user.name || req.user.full_name,
      email: req.user.email,
      role,
      ...profile,
    });
  } catch (err) {
    logger.error('[auth] me error', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

module.exports = { login, logout, register, registerSelf, me };
