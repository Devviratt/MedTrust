'use strict';
/**
 * biometricController.js
 *
 * POST /api/v1/doctor/enroll/:doctorId
 *   Body: { face_frame: "<base64_jpeg>", audio_data?: "<base64_pcm>", mfcc?: number[] }
 *   Admin-only. Captures face hash + optional voice hash and stores as the
 *   canonical impersonation baseline. Sets doctor_profiles.verified_status
 *   to 'verified'.
 *
 * POST /api/v1/doctor/verify/:doctorId
 *   Body: { face_frame: "<base64_jpeg>", audio_data?: "<base64_pcm>", mfcc?: number[] }
 *   Admin or doctor. Compares submitted biometrics against stored baseline.
 *   Returns similarity scores and impersonation risk.
 *
 * GET /api/v1/doctor/biometric-status/:doctorId
 *   Returns enrollment status + metadata.
 */

const { query }      = require('../config/database');
const { logger }     = require('../middleware/errorHandler');
const { deleteCache } = require('../config/redis');
const {
  buildFaceHash,
  buildVoiceHash,
  getBaseline,
} = require('../services/impersonationService');

// ── helpers ───────────────────────────────────────────────────────────────────

/** Extract luma bytes from a base64 JPEG string (same proxy as frameAnalyzer) */
const lumaFromBase64 = (b64) => {
  const buf = Buffer.from(b64, 'base64');
  // Validate JPEG magic
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('Invalid JPEG data');
  }
  // Use byte values after SOI as luma proxy (same approach as frameAnalyzer)
  // Skip the 2-byte SOI and take the compressed payload as proxy luma
  return buf.slice(2);
};

const hammingSimilarity = (hexA, hexB) => {
  if (!hexA || !hexB || hexA.length !== hexB.length) return 0;
  let same = 0;
  for (let i = 0; i < hexA.length; i++) {
    if (hexA[i] === hexB[i]) same++;
  }
  return same / hexA.length;
};

// ── POST /api/v1/doctor/enroll/:doctorId ─────────────────────────────────────
const enrollBiometric = async (req, res) => {
  const { doctorId } = req.params;
  const { face_frame, mfcc } = req.body;

  if (!face_frame) {
    return res.status(400).json({ error: 'face_frame (base64 JPEG) is required' });
  }

  // Verify doctor exists in users table
  const userRes = await query(
    `SELECT u.id, u.name, u.role, dp.verified_status
     FROM users u
     LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
     WHERE u.id = $1 AND u.role IN ('doctor','admin')`,
    [doctorId]
  ).catch(() => ({ rows: [] }));

  if (!userRes.rows.length) {
    return res.status(404).json({ error: 'Doctor not found' });
  }

  let faceHash = null;
  let voiceHash = null;
  let lumaLength = 0;

  try {
    const lumaBuf = lumaFromBase64(face_frame);
    lumaLength = lumaBuf.length;
    faceHash = buildFaceHash(lumaBuf);
  } catch (err) {
    return res.status(400).json({ error: `Face frame invalid: ${err.message}` });
  }

  if (Array.isArray(mfcc) && mfcc.length >= 4) {
    voiceHash = buildVoiceHash(mfcc);
  }

  try {
    // Upsert baseline — always overwrite on explicit enrollment
    await query(
      `INSERT INTO impersonation_baselines
         (doctor_id, face_hash, voice_hash, face_embedding, established_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (doctor_id) DO UPDATE
         SET face_hash      = EXCLUDED.face_hash,
             voice_hash     = EXCLUDED.voice_hash,
             face_embedding = EXCLUDED.face_embedding,
             updated_at     = NOW()`,
      [
        doctorId,
        faceHash,
        voiceHash,
        JSON.stringify({ luma_length: lumaLength, has_voice: !!voiceHash }),
      ]
    );

    // Mark doctor as biometric-enrolled / verified
    await query(
      `UPDATE doctor_profiles
       SET verified_status = 'verified'
       WHERE user_id = $1`,
      [doctorId]
    );

    // Invalidate cached baseline
    await deleteCache(`impersonation:baseline:${doctorId}`).catch(() => {});

    await query(
      `INSERT INTO audit_events (event_type, severity, details)
       VALUES ($1, $2, $3)`,
      [
        'BIOMETRIC_ENROLLED',
        'info',
        JSON.stringify({
          doctor_id:   doctorId,
          doctor_name: userRes.rows[0].name,
          enrolled_by: req.user?.id,
          has_voice:   !!voiceHash,
        }),
      ]
    );

    logger.info('[biometric] enrolled', { doctorId, hasVoice: !!voiceHash });

    return res.json({
      message:   'Biometric baseline enrolled successfully',
      doctor_id: doctorId,
      face_hash: faceHash ? `${faceHash.slice(0, 8)}…` : null,
      has_voice: !!voiceHash,
      verified_status: 'verified',
    });
  } catch (err) {
    logger.error('[biometric] enroll error', { error: err.message });
    return res.status(500).json({ error: 'Enrollment failed', detail: err.message });
  }
};

// ── POST /api/v1/doctor/verify/:doctorId ─────────────────────────────────────
const verifyIdentity = async (req, res) => {
  const { doctorId } = req.params;
  const { face_frame, mfcc } = req.body;

  if (!face_frame) {
    return res.status(400).json({ error: 'face_frame (base64 JPEG) is required' });
  }

  const baseline = await getBaseline(doctorId);
  if (!baseline || !baseline.face_hash) {
    return res.status(404).json({
      error: 'No biometric baseline enrolled for this doctor',
      baseline_established: false,
    });
  }

  let currentFaceHash = null;
  let currentVoiceHash = null;

  try {
    const lumaBuf = lumaFromBase64(face_frame);
    currentFaceHash = buildFaceHash(lumaBuf);
  } catch (err) {
    return res.status(400).json({ error: `Face frame invalid: ${err.message}` });
  }

  if (Array.isArray(mfcc) && mfcc.length >= 4) {
    currentVoiceHash = buildVoiceHash(mfcc);
  }

  // Load threshold
  let simThreshold = 0.70;
  try {
    const { getThresholds } = require('../services/thresholdService');
    const t = await getThresholds();
    simThreshold = t.impersonation_threshold || 0.70;
  } catch { /* use default */ }

  const faceSim  = hammingSimilarity(baseline.face_hash, currentFaceHash);
  const voiceSim = baseline.voice_hash && currentVoiceHash
    ? hammingSimilarity(baseline.voice_hash, currentVoiceHash)
    : null;

  const overallSim = voiceSim !== null
    ? (faceSim * 0.6) + (voiceSim * 0.4)
    : faceSim;

  const risk =
    overallSim >= simThreshold       ? 'LOW'    :
    overallSim >= simThreshold * 0.8 ? 'MEDIUM' : 'HIGH';

  if (risk === 'HIGH') {
    await query(
      `INSERT INTO audit_events (event_type, severity, details)
       VALUES ('IMPERSONATION_DETECTED', 'critical', $1)`,
      [JSON.stringify({ doctor_id: doctorId, overall_similarity: overallSim, verified_by: req.user?.id })]
    ).catch(() => {});
    logger.warn('[biometric] HIGH impersonation risk on verify', { doctorId, overallSim });
  }

  return res.json({
    impersonation_risk:   risk,
    similarity_score:     Math.round(overallSim * 100),
    face_similarity:      Math.round(faceSim * 100),
    voice_similarity:     voiceSim !== null ? Math.round(voiceSim * 100) : null,
    baseline_established: true,
    threshold_used:       Math.round(simThreshold * 100),
  });
};

// ── GET /api/v1/doctor/biometric-status/:doctorId ────────────────────────────
const getBiometricStatus = async (req, res) => {
  const { doctorId } = req.params;

  try {
    const [userRes, baselineRes] = await Promise.all([
      query(
        `SELECT u.id, u.name, u.email, dp.verified_status, dp.license_number
         FROM users u
         LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
         WHERE u.id = $1`,
        [doctorId]
      ),
      query(
        `SELECT face_hash, voice_hash, established_at, updated_at
         FROM impersonation_baselines WHERE doctor_id = $1`,
        [doctorId]
      ),
    ]);

    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    const doc      = userRes.rows[0];
    const baseline = baselineRes.rows[0] || null;

    return res.json({
      doctor_id:            doc.id,
      name:                 doc.name,
      email:                doc.email,
      verified_status:      doc.verified_status || 'pending',
      license_number:       doc.license_number,
      biometric_enrolled:   !!baseline?.face_hash,
      has_voice_baseline:   !!baseline?.voice_hash,
      enrolled_at:          baseline?.established_at || null,
      updated_at:           baseline?.updated_at || null,
      face_hash_preview:    baseline?.face_hash ? `${baseline.face_hash.slice(0, 8)}…` : null,
    });
  } catch (err) {
    logger.error('[biometric] status error', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch biometric status' });
  }
};

module.exports = { enrollBiometric, verifyIdentity, getBiometricStatus };
