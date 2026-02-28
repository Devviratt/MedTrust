'use strict';
/**
 * impersonationService.js
 *
 * Lightweight impersonation detection without external ML dependencies.
 * Stores a face descriptor hash + voice fingerprint hash per doctor.
 * During session: compares current frame descriptor vs stored baseline.
 *
 * Face descriptor: SHA256 of sorted luminance histogram bins (16 bins).
 * Voice fingerprint: SHA256 of spectral centroid + ZCR signature.
 *
 * Similarity: Hamming distance on 256-bit hex hash → 0-1 normalized.
 * If similarity < threshold → impersonation_risk = HIGH.
 */
const crypto  = require('crypto');
const { query }  = require('../config/database');
const { getCache, setCache } = require('../config/redis');
const { logger } = require('../middleware/errorHandler');
const { getThresholds } = require('./thresholdService');
const { analyzeVoiceAntiSpoof } = require('./voiceAntiSpoof');
const { analyzeLiveness } = require('./livenessHardener');

// ── Hash helpers ──────────────────────────────────────────────────────────────

const hammingSimilarity = (hexA, hexB) => {
  if (!hexA || !hexB || hexA.length !== hexB.length) return 0;
  let same = 0;
  const len = hexA.length;
  for (let i = 0; i < len; i++) {
    if (hexA[i] === hexB[i]) same++;
  }
  return same / len; // 0-1
};

/**
 * buildFaceHash(lumaBuffer: Buffer) → hex string
 * lumaBuffer: raw luma channel bytes from JPEG (computed in frameAnalyzer)
 * Produces a 16-bin histogram hash.
 */
const buildFaceHash = (lumaBuffer) => {
  if (!lumaBuffer || lumaBuffer.length === 0) return null;
  const bins = new Array(16).fill(0);
  const step = 256 / 16;
  for (const byte of lumaBuffer) {
    const bin = Math.min(15, Math.floor(byte / step));
    bins[bin]++;
  }
  const normalized = bins.map(v => Math.round((v / lumaBuffer.length) * 255));
  return crypto.createHash('sha256').update(Buffer.from(normalized)).digest('hex');
};

/**
 * buildVoiceHash(mfccFeatures: number[]) → hex string
 */
const buildVoiceHash = (mfccFeatures) => {
  if (!Array.isArray(mfccFeatures) || mfccFeatures.length < 4) return null;
  const quantized = mfccFeatures.map(v => Math.round(Math.max(0, Math.min(255, (Number(v) || 0) + 128))));
  return crypto.createHash('sha256').update(Buffer.from(quantized)).digest('hex');
};

// ── Baseline management ───────────────────────────────────────────────────────

const getBaseline = async (doctorId) => {
  const cacheKey = `impersonation:baseline:${doctorId}`;
  const cached = await getCache(cacheKey).catch(() => null);
  if (cached) return cached;

  const result = await query(
    'SELECT face_hash, voice_hash, established_at FROM impersonation_baselines WHERE doctor_id = $1',
    [doctorId]
  ).catch(() => ({ rows: [] }));

  const baseline = result.rows[0] || null;
  if (baseline) await setCache(cacheKey, baseline, 300);
  return baseline;
};

const upsertBaseline = async (doctorId, faceHash, voiceHash) => {
  await query(
    `INSERT INTO impersonation_baselines (doctor_id, face_hash, voice_hash, established_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (doctor_id) DO UPDATE
       SET face_hash   = EXCLUDED.face_hash,
           voice_hash  = EXCLUDED.voice_hash,
           updated_at  = NOW()
     WHERE impersonation_baselines.face_hash IS NULL`,
    [doctorId, faceHash, voiceHash]
  );
  const cacheKey = `impersonation:baseline:${doctorId}`;
  const { deleteCache } = require('../config/redis');
  await deleteCache(cacheKey).catch(() => {});
};

// ── Session result caching ────────────────────────────────────────────────────

const setImpersonationResult = async (streamId, result) => {
  await setCache(`impersonation:session:${streamId}`, result, 30).catch(() => {});
};

const getImpersonationResult = async (streamId) => {
  return getCache(`impersonation:session:${streamId}`).catch(() => null);
};

// ── Main: analyzeFrame ────────────────────────────────────────────────────────

/**
 * analyzeImpersonation({ doctorId, streamId, lumaBuffer, mfccFeatures })
 *
 * Returns:
 * {
 *   impersonation_risk: 'LOW' | 'MEDIUM' | 'HIGH',
 *   similarity_score: 0-100,
 *   face_similarity: 0-1,
 *   voice_similarity: 0-1,
 *   baseline_established: boolean,
 * }
 */
const analyzeImpersonation = async ({ doctorId, streamId, lumaBuffer, mfccFeatures }) => {
  try {
    if (!doctorId) {
      return { impersonation_risk: 'LOW', similarity_score: 100, baseline_established: false };
    }

    const thresholds = await getThresholds();
    const simThreshold = thresholds.impersonation_threshold || 0.70;

    const currentFaceHash  = buildFaceHash(lumaBuffer);
    const currentVoiceHash = buildVoiceHash(mfccFeatures);

    // Load or create baseline
    let baseline = await getBaseline(doctorId);

    if (!baseline || (!baseline.face_hash && !baseline.voice_hash)) {
      // Establish baseline on first verified session
      if (currentFaceHash || currentVoiceHash) {
        await upsertBaseline(doctorId, currentFaceHash, currentVoiceHash);
        logger.info('[impersonation] baseline established', { doctorId });
      }
      const result = { impersonation_risk: 'LOW', similarity_score: 100, baseline_established: true };
      await setImpersonationResult(streamId, result);
      return result;
    }

    // Compare hashes
    const faceSim  = baseline.face_hash  && currentFaceHash
      ? hammingSimilarity(baseline.face_hash, currentFaceHash)
      : 1.0;
    const rawVoiceSim = baseline.voice_hash && currentVoiceHash
      ? hammingSimilarity(baseline.voice_hash, currentVoiceHash)
      : 1.0;

    // ── Phase 2: Enhanced voice anti-spoofing — merge into voiceSim ───────────
    // Run async, safe-failure: on any error voiceSim stays as rawVoiceSim.
    let voiceSim = rawVoiceSim;
    try {
      if (Array.isArray(mfccFeatures) && mfccFeatures.length >= 4) {
        const voiceResult = await analyzeVoiceAntiSpoof({ streamId, mfcc: mfccFeatures })
          .catch(() => null);
        if (voiceResult && typeof voiceResult.deepfakeVoiceScore === 'number') {
          // deepfakeVoiceScore is 0–100; normalise to 0–1 for blending
          const deepfakeVoiceNorm = voiceResult.deepfakeVoiceScore / 100;
          // Weighted blend: 65% hash similarity + 35% anti-spoof signal
          // Anti-spoof can only suppress (never inflate) the voice similarity
          const blended = rawVoiceSim * 0.65 + deepfakeVoiceNorm * 0.35;
          voiceSim = Math.min(rawVoiceSim, Math.max(0, blended));
        }
      }
    } catch (_vsErr) {
      voiceSim = rawVoiceSim; // safe failure
    }

    // ── Phase 3/4: Liveness + temporal consistency — modulate faceSim ─────────
    // Run async, safe-failure: faceSim unchanged on error.
    let effectiveFaceSim = faceSim;
    try {
      if (lumaBuffer && lumaBuffer.length > 0) {
        const livenessResult = await analyzeLiveness({
          streamId,
          luma:         lumaBuffer,
          brightness:   0,   // will be computed from luma in livenessHardener
          edgeVariance: 0,
        }).catch(() => null);
        if (livenessResult) {
          // If identity shift detected → hard suppress faceSim
          if (livenessResult.identity_shift_detected) {
            effectiveFaceSim = Math.min(effectiveFaceSim, 0.40);
            logger.warn('[impersonation] temporal identity shift — faceSim suppressed', { doctorId, streamId });
          } else if (livenessResult.livenessScore < 40) {
            // Low liveness → moderate suppression
            const livenessFactor = livenessResult.livenessScore / 100;
            effectiveFaceSim = effectiveFaceSim * 0.70 + (effectiveFaceSim * livenessFactor * 0.30);
          }
        }
      }
    } catch (_lvErr) {
      effectiveFaceSim = faceSim; // safe failure
    }

    const overallSim  = (effectiveFaceSim * 0.6) + (voiceSim * 0.4);
    const simScore    = Math.round(overallSim * 100);

    const risk =
      overallSim >= simThreshold       ? 'LOW'    :
      overallSim >= simThreshold * 0.8 ? 'MEDIUM' : 'HIGH';

    if (risk === 'HIGH') {
      logger.warn('[impersonation] HIGH RISK detected', { doctorId, streamId, overallSim });
      await query(
        `INSERT INTO audit_events (stream_id, event_type, severity, details)
         VALUES ($1,'IMPERSONATION_DETECTED','critical',$2)`,
        [streamId, JSON.stringify({
          similarity:   overallSim,
          face_sim:     effectiveFaceSim,
          voice_sim:    voiceSim,
          raw_voice_sim: rawVoiceSim,
        })]
      ).catch(() => {});
    }

    const result = {
      impersonation_risk:    risk,
      similarity_score:      simScore,
      face_similarity:       Math.round(effectiveFaceSim * 100),
      voice_similarity:      Math.round(voiceSim * 100),
      baseline_established:  true,
    };
    await setImpersonationResult(streamId, result);
    return result;
  } catch (err) {
    logger.error('[impersonation] analyzeImpersonation error', { error: err.message });
    return { impersonation_risk: 'LOW', similarity_score: 100, baseline_established: false };
  }
};

module.exports = {
  analyzeImpersonation,
  getImpersonationResult,
  buildFaceHash,
  buildVoiceHash,
  getBaseline,
};
