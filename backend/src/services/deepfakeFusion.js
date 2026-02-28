'use strict';

/**
 * deepfakeFusion.js
 *
 * Phase 5 — Deepfake confidence fusion engine.
 * Phase 6 — Safe failure mode.
 * Phase 7 — Performance safety (async, timeout-safe, non-blocking).
 *
 * Combines outputs from:
 *   - deepfakeAnalyzer.js  (deepfakeFaceScore)
 *   - voiceAntiSpoof.js    (deepfakeVoiceScore)
 *   - livenessHardener.js  (livenessScore, temporalConsistencyScore)
 *
 * Computes internal deepfakeRiskScore (NOT exposed to frontend).
 * Adjusts existing face/voice scores downward when deepfake risk is high.
 * Triggers admin alert via existing audit_events system.
 * Implements kill-switch only when multiple signals fail simultaneously.
 *
 * API contract: unchanged — returns { adjustedFaceScore, adjustedVoiceScore }
 * that slot directly into the existing verifyPreSession trust formula.
 */

const { query }  = require('../config/database');
const { logger } = require('../middleware/errorHandler');

// ── Fusion weights (internal only) ───────────────────────────────────────────
const FUSION_WEIGHTS = {
  face:     0.35,
  voice:    0.30,
  liveness: 0.20,
  temporal: 0.15,
};

// Risk thresholds
const DEEPFAKE_ALERT_THRESHOLD  = 50; // deepfakeRiskScore < 50 → alert
const KILL_SWITCH_THRESHOLD     = 30; // < 30 AND multiple signals → hard block
const SINGLE_SIGNAL_FLOOR       = 35; // any single detector < 35 → suspicious

// Maximum penalty applied to face/voice scores when deepfake detected
const MAX_FACE_PENALTY  = 40; // points
const MAX_VOICE_PENALTY = 35; // points

// Timeout for the entire enhanced detection pipeline
const DETECTION_TIMEOUT_MS = 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Safe wrapper: run a detection function with a hard timeout.
// On timeout or error: returns the provided safe fallback value.
// ─────────────────────────────────────────────────────────────────────────────
const withTimeout = (promise, ms, fallback) =>
  Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ]).catch(() => fallback);

// ─────────────────────────────────────────────────────────────────────────────
// Count how many detectors are in a "failed" / high-risk state
// ─────────────────────────────────────────────────────────────────────────────
const countFailedSignals = ({ deepfakeFaceScore, deepfakeVoiceScore, livenessScore, temporalScore }) => {
  let failed = 0;
  if (deepfakeFaceScore  < SINGLE_SIGNAL_FLOOR) failed++;
  if (deepfakeVoiceScore < SINGLE_SIGNAL_FLOOR) failed++;
  if (livenessScore      < SINGLE_SIGNAL_FLOOR) failed++;
  if (temporalScore      < SINGLE_SIGNAL_FLOOR) failed++;
  return failed;
};

// ─────────────────────────────────────────────────────────────────────────────
// Emit admin alert via audit_events (existing alert system — no new API).
// Fire-and-forget: never blocks or throws.
// ─────────────────────────────────────────────────────────────────────────────
const emitDeepfakeAlert = async (streamId, doctorId, deepfakeRiskScore, detail) => {
  try {
    await query(
      `INSERT INTO audit_events (stream_id, event_type, severity, details)
       VALUES ($1, 'DEEPFAKE_DETECTED', 'critical', $2)`,
      [
        streamId,
        JSON.stringify({
          deepfake_risk_score: deepfakeRiskScore,
          doctor_id:           doctorId,
          message:             'Advanced deepfake detection triggered',
          signals:             detail,
          timestamp:           new Date().toISOString(),
        }),
      ]
    );
    logger.warn('[deepfakeFusion] DEEPFAKE ALERT emitted', { streamId, doctorId, deepfakeRiskScore });
  } catch (err) {
    logger.warn('[deepfakeFusion] alert emit failed (non-critical)', { error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main export: fuseDeepfakeSignals
//
// Input:
//   streamId            — session stream ID
//   doctorId            — doctor user ID (for alert logging)
//   deepfakeFaceScore   — 0–100 from deepfakeAnalyzer
//   deepfakeVoiceScore  — 0–100 from voiceAntiSpoof
//   livenessScore       — 0–100 from livenessHardener
//   temporalScore       — 0–100 from livenessHardener
//   currentFaceScore    — existing face_score from verify endpoint (0–100)
//   currentVoiceScore   — existing voice_score from verify endpoint (0–100)
//   identityShift       — boolean from livenessHardener
//
// Output: { adjustedFaceScore, adjustedVoiceScore, killSwitch, deepfakeRiskScore }
//   adjustedFaceScore  — drop-in replacement for face_score in trust formula
//   adjustedVoiceScore — drop-in replacement for voice_score in trust formula
//   killSwitch         — true only if multiple signals fail simultaneously
//   deepfakeRiskScore  — INTERNAL ONLY, not forwarded to frontend
//
// Phase 7 guarantee:
//   - Entire function wrapped in try/catch
//   - Called via withTimeout(3000ms) at integration point
//   - On any failure: returns original scores unchanged (last-known-good principle)
// ─────────────────────────────────────────────────────────────────────────────
const fuseDeepfakeSignals = async ({
  streamId,
  doctorId,
  deepfakeFaceScore,
  deepfakeVoiceScore,
  livenessScore,
  temporalScore,
  currentFaceScore,
  currentVoiceScore,
  identityShift = false,
}) => {
  try {
    // Clamp all inputs to 0–100
    const clamp = (v, def = 65) => (typeof v === 'number' && !isNaN(v)) ? Math.max(0, Math.min(100, v)) : def;

    const faceScore  = clamp(deepfakeFaceScore,  65);
    const voiceScore = clamp(deepfakeVoiceScore, 65);
    const liveness   = clamp(livenessScore,      70);
    const temporal   = clamp(temporalScore,      75);

    // ── Phase 5: Weighted fusion (internal only) ───────────────────────────
    const deepfakeRiskScore = Math.round(
      faceScore  * FUSION_WEIGHTS.face     +
      voiceScore * FUSION_WEIGHTS.voice    +
      liveness   * FUSION_WEIGHTS.liveness +
      temporal   * FUSION_WEIGHTS.temporal
    );

    // Count failed signals
    const failedSignals = countFailedSignals({
      deepfakeFaceScore:  faceScore,
      deepfakeVoiceScore: voiceScore,
      livenessScore:      liveness,
      temporalScore:      temporal,
    });

    // Identity shift always counts as an additional failed signal
    const effectiveFailed = identityShift ? failedSignals + 1 : failedSignals;

    // ── Phase 6: Safe failure mode ─────────────────────────────────────────

    let adjustedFaceScore  = clamp(currentFaceScore,  50);
    let adjustedVoiceScore = clamp(currentVoiceScore, 50);
    let killSwitch         = false;
    let alertTriggered     = false;

    if (deepfakeRiskScore < DEEPFAKE_ALERT_THRESHOLD) {
      // Deepfake risk high — apply graduated penalty to face and voice scores
      // Penalty proportional to how far below the threshold we are
      const deficitRatio = Math.min(1, (DEEPFAKE_ALERT_THRESHOLD - deepfakeRiskScore) / DEEPFAKE_ALERT_THRESHOLD);

      const facePenalty  = Math.round(MAX_FACE_PENALTY  * deficitRatio);
      const voicePenalty = Math.round(MAX_VOICE_PENALTY * deficitRatio);

      adjustedFaceScore  = Math.max(0, adjustedFaceScore  - facePenalty);
      adjustedVoiceScore = Math.max(0, adjustedVoiceScore - voicePenalty);

      // Emit alert via existing audit_events (Phase 6: notify admin)
      alertTriggered = true;
      setImmediate(() => emitDeepfakeAlert(streamId, doctorId, deepfakeRiskScore, {
        face_score:  faceScore,
        voice_score: voiceScore,
        liveness,
        temporal,
        failed_signals:  effectiveFailed,
        identity_shift:  identityShift,
      }));

      // Kill-switch: only if score is critically low AND ≥3 independent signals fail
      // Phase 6: "Activate kill-switch only if multiple signals fail"
      if (deepfakeRiskScore < KILL_SWITCH_THRESHOLD && effectiveFailed >= 3) {
        killSwitch = true;
        logger.error('[deepfakeFusion] KILL-SWITCH ACTIVATED', {
          streamId, doctorId, deepfakeRiskScore, effectiveFailed,
        });
      }
    } else if (deepfakeRiskScore >= DEEPFAKE_ALERT_THRESHOLD && deepfakeRiskScore < 65) {
      // Borderline — apply light penalty to maintain vigilance
      const lightPenalty = Math.round(10 * (1 - deepfakeRiskScore / 65));
      adjustedFaceScore  = Math.max(0, adjustedFaceScore  - lightPenalty);
      adjustedVoiceScore = Math.max(0, adjustedVoiceScore - lightPenalty);
    }
    // else: deepfakeRiskScore >= 65 → no penalty, pass-through unchanged

    return {
      adjustedFaceScore,
      adjustedVoiceScore,
      killSwitch,
      alertTriggered,
      deepfakeRiskScore,  // INTERNAL — fusion caller must NOT forward this to API response
      failedSignals: effectiveFailed,
      detail: {
        face_detector_score:  faceScore,
        voice_detector_score: voiceScore,
        liveness_score:       liveness,
        temporal_score:       temporal,
        identity_shift:       identityShift,
        risk_level:           deepfakeRiskScore < KILL_SWITCH_THRESHOLD ? 'CRITICAL'
                            : deepfakeRiskScore < DEEPFAKE_ALERT_THRESHOLD ? 'HIGH'
                            : deepfakeRiskScore < 65 ? 'MEDIUM' : 'LOW',
      },
    };
  } catch (err) {
    logger.warn('[deepfakeFusion] fusion failed, returning original scores unchanged', {
      streamId, error: err.message,
    });
    // Phase 7: safe failure — return originals unchanged, mark low confidence
    return {
      adjustedFaceScore:  currentFaceScore  ?? 50,
      adjustedVoiceScore: currentVoiceScore ?? 50,
      killSwitch:         false,
      alertTriggered:     false,
      deepfakeRiskScore:  65,
      failedSignals:      0,
      detail:             { error: err.message, fallback: true },
    };
  }
};

// ── Convenience export: run entire enhanced detection pipeline with timeout ───
const runEnhancedDetection = async ({
  streamId,
  doctorId,
  luma,
  width,
  height,
  brightness,
  edgeVariance,
  mfcc,
  currentFaceScore,
  currentVoiceScore,
}) => {
  const FALLBACK = {
    adjustedFaceScore:  currentFaceScore  ?? 50,
    adjustedVoiceScore: currentVoiceScore ?? 50,
    killSwitch:         false,
    alertTriggered:     false,
    deepfakeRiskScore:  65,
    failedSignals:      0,
    detail:             { fallback: true, reason: 'timeout_or_error' },
  };

  // Phase 7: entire pipeline runs inside a 3-second timeout
  return withTimeout(
    (async () => {
      // Run face + voice + liveness in parallel (they're all independent)
      const [faceResult, voiceResult, livenessResult] = await Promise.all([
        withTimeout(
          require('./deepfakeAnalyzer').analyzeFaceDeepfake({ streamId, luma, width, height }),
          2000,
          { deepfakeFaceScore: 65, confidence: 'LOW' }
        ),
        withTimeout(
          require('./voiceAntiSpoof').analyzeVoiceAntiSpoof({ streamId, mfcc }),
          2000,
          { deepfakeVoiceScore: 65, confidence: 'LOW' }
        ),
        withTimeout(
          require('./livenessHardener').analyzeLiveness({ streamId, luma, brightness, edgeVariance }),
          2000,
          { livenessScore: 70, temporalConsistencyScore: 75, identity_shift_detected: false }
        ),
      ]);

      // Fuse all signals
      return fuseDeepfakeSignals({
        streamId,
        doctorId,
        deepfakeFaceScore:  faceResult.deepfakeFaceScore,
        deepfakeVoiceScore: voiceResult.deepfakeVoiceScore,
        livenessScore:      livenessResult.livenessScore,
        temporalScore:      livenessResult.temporalConsistencyScore,
        identityShift:      livenessResult.identity_shift_detected,
        currentFaceScore,
        currentVoiceScore,
      });
    })(),
    DETECTION_TIMEOUT_MS,
    FALLBACK
  );
};

module.exports = { fuseDeepfakeSignals, runEnhancedDetection };
