const rateLimit = require('express-rate-limit');
const { getRedis } = require('../config/redis');

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.user?.id || req.ip,
  skip: (req) => !!req.user?.id, // skip limiter entirely for authenticated users
});

// Auth endpoint limiter — generous to avoid blocking legitimate logins
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many authentication attempts, please try again later.' },
  skipSuccessfulRequests: true,
  skip: (req) => process.env.NODE_ENV === 'development' || !!req.user?.id,
});

// Analysis endpoint limiter (higher throughput for real-time)
const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: { error: 'Analysis rate limit exceeded.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

// Admin endpoint limiter
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Admin rate limit exceeded.' },
  skip: (req) => !!req.user?.id,
});

// No-op limiter for high-frequency polling routes (trustscore, streams status, sessions)
const noLimiter = (_req, _res, next) => next();

module.exports = { apiLimiter, authLimiter, analysisLimiter, adminLimiter, noLimiter };
