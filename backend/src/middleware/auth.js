const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { getCache, setCache } = require('../config/redis');

const ROLES = {
  ADMIN:   'admin',
  DOCTOR:  'doctor',
  PATIENT: 'patient',
  NURSE:   'nurse',
  VIEWER:  'viewer',
};

const PERMISSIONS = {
  admin:   ['*'],
  doctor:  ['stream:read', 'stream:write', 'analysis:read', 'blockchain:read', 'trust:read'],
  patient: ['stream:read', 'trust:read', 'session:read'],
  nurse:   ['stream:read', 'analysis:read', 'trust:read'],
  viewer:  ['stream:read', 'trust:read'],
};

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    // Check token blacklist in Redis
    const isBlacklisted = await getCache(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user from cache (basic fields) then always refresh enrollment fields from DB
    const cacheKey = `user:${decoded.userId}`;
    let user = await getCache(cacheKey);

    if (!user) {
      // Check unified users table first (RBAC platform). If the table is absent
      // in legacy deployments, fall back to doctors table.
      let result = { rows: [] };
      try {
        result = await query(
          'SELECT id, name, email, role, is_active, biometric_enrolled, enrollment_status FROM users WHERE id = $1',
          [decoded.userId]
        );
      } catch (err) {
        if (!String(err.message || '').includes('relation "users" does not exist')) {
          throw err;
        }
      }

      // Fall back to legacy doctors table
      if (result.rows.length === 0) {
        result = await query(
          'SELECT id, full_name AS name, email, role, is_active FROM doctors WHERE id = $1',
          [decoded.userId]
        );
      }

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'User not found' });
      }

      user = result.rows[0];
      await setCache(cacheKey, user, 300);
    }

    // Always fetch enrollment fields fresh from DB for doctors — never trust cache for these
    if (user.role === 'doctor') {
      const fresh = await query(
        'SELECT biometric_enrolled, enrollment_status FROM users WHERE id = $1',
        [decoded.userId]
      ).catch(() => ({ rows: [] }));
      if (fresh.rows.length > 0) {
        user = {
          ...user,
          biometric_enrolled: fresh.rows[0].biometric_enrolled,
          enrollment_status:  fresh.rows[0].enrollment_status,
        };
      }
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    req.user = { ...user, permissions: PERMISSIONS[user.role] || [] };
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    next(err);
  }
};

// ── requireEnrolled: blocks unenrolled doctors from protected routes ───────────
// Apply AFTER authenticate on any route that needs full doctor access.
// Enrollment endpoint itself must NOT use this middleware.
const requireEnrolled = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'doctor') return next(); // patients/admins pass through

  const { biometric_enrolled, enrollment_status } = req.user;

  if (!biometric_enrolled || enrollment_status === 'pending_enrollment') {
    return res.status(403).json({
      error: 'Biometric enrollment required before dashboard access.',
      code: 'ENROLLMENT_REQUIRED',
      enrollment_status: enrollment_status ?? 'pending_enrollment',
    });
  }
  if (enrollment_status === 'pending_admin_approval') {
    return res.status(403).json({
      error: 'Your biometric enrollment is complete. Awaiting admin approval.',
      code: 'PENDING_APPROVAL',
      enrollment_status,
    });
  }
  if (enrollment_status === 'suspended') {
    return res.status(403).json({
      error: 'Account suspended. Contact admin.',
      code: 'SUSPENDED',
      enrollment_status,
    });
  }
  next();
};

const authorize = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userPermissions = req.user.permissions || [];

    // Admin has wildcard access
    if (userPermissions.includes('*')) {
      return next();
    }

    const hasPermission = requiredPermissions.every((perm) =>
      userPermissions.includes(perm)
    );

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredPermissions,
        current: userPermissions,
      });
    }

    next();
  };
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient role',
        required: roles,
        current: req.user.role,
      });
    }

    next();
  };
};

module.exports = { authenticate, authorize, requireRole, requireEnrolled, ROLES, PERMISSIONS };
