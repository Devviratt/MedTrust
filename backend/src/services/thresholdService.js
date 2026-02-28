'use strict';
/**
 * thresholdService.js
 * Reads AI thresholds from DB (cached in Redis for 60s).
 * Trust engine reads these — no hardcoded values.
 */
const { query }  = require('../config/database');
const { getCache, setCache } = require('../config/redis');
const { logger } = require('../middleware/errorHandler');

const CACHE_KEY = 'ai_thresholds:v1';
const CACHE_TTL = 60; // seconds

const DEFAULTS = {
  min_safe_score:           75,
  suspicious_score:         50,
  alert_score:              50,
  video_drop_threshold:     30,
  biometric_variance_limit: 40,
  voice_flatness_limit:     40,
  video_weight:             0.40,
  voice_weight:             0.30,
  biometric_weight:         0.20,
  blockchain_weight:        0.10,
  impersonation_threshold:  0.70,
};

const getThresholds = async () => {
  try {
    const cached = await getCache(CACHE_KEY);
    if (cached) return cached;

    const result = await query('SELECT key, value FROM ai_thresholds');
    const thresholds = { ...DEFAULTS };
    for (const row of result.rows) {
      thresholds[row.key] = parseFloat(row.value);
    }

    await setCache(CACHE_KEY, thresholds, CACHE_TTL);
    return thresholds;
  } catch (err) {
    logger.warn('[thresholdService] DB read failed, using defaults', { error: err.message });
    return { ...DEFAULTS };
  }
};

const invalidateCache = async () => {
  try {
    const { deleteCache } = require('../config/redis');
    await deleteCache(CACHE_KEY);
  } catch { /* non-fatal */ }
};

module.exports = { getThresholds, invalidateCache };
