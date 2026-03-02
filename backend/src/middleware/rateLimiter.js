const rateLimit = require('express-rate-limit');
const { getRedis } = require('../config/redis');
const noLimiter = (_req, _res, next) => next();

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isEnabled = (flag, defaultValue = true) => {
  if (flag === undefined) return defaultValue;
  return String(flag).toLowerCase() === 'true';
};

const limiterOrNoop = (enabled, options) => (enabled ? rateLimit(options) : noLimiter);

const globalRateLimitEnabled = isEnabled(process.env.RATE_LIMIT_ENABLED, true);
const authRateLimitEnabled = isEnabled(process.env.AUTH_RATE_LIMIT_ENABLED, globalRateLimitEnabled);
const analysisRateLimitEnabled = isEnabled(process.env.ANALYSIS_RATE_LIMIT_ENABLED, globalRateLimitEnabled);
const adminRateLimitEnabled = isEnabled(process.env.ADMIN_RATE_LIMIT_ENABLED, globalRateLimitEnabled);

// General API rate limiter
const apiLimiter = limiterOrNoop(globalRateLimitEnabled, {
  windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.RATE_LIMIT_MAX, 2000),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.user?.id || req.ip,
  skip: (req) => !!req.user?.id, // skip limiter entirely for authenticated users
});

// Auth endpoint limiter — generous to avoid blocking legitimate logins
const authLimiter = limiterOrNoop(authRateLimitEnabled, {
  windowMs: toInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.AUTH_RATE_LIMIT_MAX, 200),
  message: { error: 'Too many authentication attempts, please try again later.' },
  skipSuccessfulRequests: true,
  skip: (req) => process.env.NODE_ENV === 'development' || !!req.user?.id,
});

// Analysis endpoint limiter (higher throughput for real-time)
const analysisLimiter = limiterOrNoop(analysisRateLimitEnabled, {
  windowMs: toInt(process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS, 60 * 1000),
  max: toInt(process.env.ANALYSIS_RATE_LIMIT_MAX, 600),
  message: { error: 'Analysis rate limit exceeded.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

// Admin endpoint limiter
const adminLimiter = limiterOrNoop(adminRateLimitEnabled, {
  windowMs: toInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.ADMIN_RATE_LIMIT_MAX, 300),
  message: { error: 'Admin rate limit exceeded.' },
  skip: (req) => !!req.user?.id,
});

// No-op limiter for high-frequency polling routes (trustscore, streams status, sessions)

module.exports = { apiLimiter, authLimiter, analysisLimiter, adminLimiter, noLimiter };
