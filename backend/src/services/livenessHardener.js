'use strict';

/**
 * livenessHardener.js
 *
 * Phase 3 — Real-time liveness hardening.
 * Phase 4 — Temporal consistency validation (sliding window).
 *
 * Pure Node.js. No external dependencies.
 * Operates on luma data from frameAnalyzer + timestamps.
 *
 * Produces livenessScore (0–100) and temporalConsistencyScore (0–100).
 * These feed into deepfakeFusion.js — NOT exposed separately in API.
 *
 * Detectors:
 *   1. Dynamic lighting shift detection  — real face reacts to lighting changes
 *   2. Motion latency analysis           — blink/movement response timing
 *   3. Temporal consistency (30s window) — detect mid-session deepfake injection
 */

const { getCache, setCache } = require('../config/redis');
const { logger } = require('../middleware/errorHandler');

const CACHE_TTL       = 120; // seconds
const WINDOW_SECONDS  = 30;  // temporal consistency window
const WINDOW_FRAMES   = 30;  // approx frames in 30s at ~1fps verification rate
const CHECK_INTERVAL  = 10;  // seconds between temporal checks

// ─────────────────────────────────────────────────────────────────────────────
// Helper: compute mean from array
// ─────────────────────────────────────────────────────────────────────────────
const mean = (arr) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

const stddev = (arr) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector 1: Dynamic Lighting Shift Detection
//
// A real human face responds to ambient light changes with gradual, continuous
// brightness shifts across the full frame. A displayed video (iPad/laptop
// replay attack) will NOT respond to external lighting changes —
// its brightness is fixed by the display backlight.
//
// We detect natural lighting variation by tracking the frame-level mean
// brightness over time. A real person in an ICU room will show:
//   - Gradual drift from ambient lighting (AC units, monitors, window light)
//   - Non-periodic brightness variation
//
// A replay / deepfake will show:
//   - Near-constant mean brightness (display backlight is constant)
//   - OR abrupt large jumps (video editing cuts)
//
// Metric: std-dev of brightness over the last N frames.
//   Real: moderate non-zero std-dev (2–20 units)
//   Replay: near-zero std-dev (<1) OR large periodic spikes
// ─────────────────────────────────────────────────────────────────────────────
const dynamicLightingScore = (brightnessWindow) => {
  if (!brightnessWindow || brightnessWindow.length < 3) {
    return { score: 70, reason: 'insufficient_frames' };
  }

  const sd = stddev(brightnessWindow);
  const mu = mean(brightnessWindow);

  // Check for periodic pattern — signs of video loop
  let periodicSignal = false;
  if (brightnessWindow.length >= 6) {
    // Compare first half vs second half mean — a loop would mirror them
    const half = Math.floor(brightnessWindow.length / 2);
    const firstHalf  = brightnessWindow.slice(0, half);
    const secondHalf = brightnessWindow.slice(half);
    const diff = Math.abs(mean(firstHalf) - mean(secondHalf));
    periodicSignal = diff < 0.5 && sd < 1.0; // Near-identical halves
  }

  let score;
  if (periodicSignal) {
    score = 15; // Video loop detected
  } else if (sd < 0.5 && mu > 10) {
    score = 20; // Constant brightness — display/replay artifact
  } else if (sd < 1.5) {
    score = 40; // Very low variation — suspicious
  } else if (sd >= 1.5 && sd <= 20) {
    score = 92; // Natural ambient lighting variation
  } else if (sd > 20 && sd <= 40) {
    score = 70; // High variation — could be natural or splice
  } else {
    score = 45; // Extreme variation — possible frame injection
  }

  return {
    score,
    brightness_stddev: Math.round(sd * 100) / 100,
    brightness_mean:   Math.round(mu * 100) / 100,
    periodic:          periodicSignal,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector 2: Motion Latency Analysis
//
// Real humans have natural micro-jitter: sub-pixel head movement from breathing,
// heartbeat (ballistocardiography), and involuntary muscle tremor.
//
// A displayed image or static deepfake has ZERO micro-jitter.
// A high-quality video replay has jitter ONLY from compression artifacts.
//
// Proxy: track frame-to-frame edge-variance delta. Real person:
//   - Small continuous non-zero deltas (2–15 units) from micro-motion
//   - Occasional larger deltas from intentional movement
// Replay / static deepfake:
//   - Near-zero consecutive deltas (frozen image)
//   - Abrupt large spikes (cut between video segments)
//
// We also detect "blink response latency": a natural blink creates a sudden
// drop in face brightness for 1–2 frames. No blinks over a 30-second window
// is a strong liveness failure signal.
// ─────────────────────────────────────────────────────────────────────────────
const motionLatencyScore = (edgeVarianceWindow, brightnessWindow) => {
  if (!edgeVarianceWindow || edgeVarianceWindow.length < 4) {
    return { score: 70, reason: 'insufficient_frames' };
  }

  // Compute frame-to-frame edge-variance deltas
  const deltas = [];
  for (let i = 1; i < edgeVarianceWindow.length; i++) {
    deltas.push(Math.abs(edgeVarianceWindow[i] - edgeVarianceWindow[i - 1]));
  }

  const deltaMean   = mean(deltas);
  const zeroDeltas  = deltas.filter(d => d < 0.5).length;
  const zeroFraction = zeroDeltas / deltas.length;

  // Blink detection: look for brief brightness dips (>10 unit drop for 1–2 frames)
  let blinkCount = 0;
  if (brightnessWindow && brightnessWindow.length >= 4) {
    for (let i = 1; i < brightnessWindow.length - 1; i++) {
      const drop = brightnessWindow[i - 1] - brightnessWindow[i];
      const recovery = brightnessWindow[i + 1] - brightnessWindow[i];
      if (drop > 8 && recovery > 5) blinkCount++;
    }
  }

  let score;

  // Zero-delta dominance — frozen / static frame
  if (zeroFraction > 0.80) {
    score = 15; // Static replay
  } else if (zeroFraction > 0.60) {
    score = 35; // Mostly frozen — suspicious
  } else if (deltaMean < 0.5) {
    score = 30; // Very low motion — probable display replay
  } else if (deltaMean >= 0.5 && deltaMean <= 30) {
    score = 85; // Natural micro-motion range

    // Bonus: blink detected (strong liveness signal)
    if (blinkCount > 0) score = Math.min(100, score + 8);
  } else if (deltaMean > 30 && deltaMean <= 80) {
    score = 65; // High motion — possible but borderline
  } else {
    score = 40; // Extreme motion — splice artifact
  }

  // Penalty: no blinks detected in a window ≥ 15 frames (approx 15s) → suspicious
  const windowLong = edgeVarianceWindow.length >= 15;
  if (windowLong && blinkCount === 0) {
    score = Math.max(20, score - 20); // Significant liveness penalty
  }

  return {
    score,
    delta_mean:      Math.round(deltaMean * 100) / 100,
    zero_fraction:   Math.round(zeroFraction * 100) / 100,
    blink_count:     blinkCount,
    frames_analyzed: edgeVarianceWindow.length,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector 3: Temporal Consistency Validation (Phase 4)
//
// Every ~10 seconds, compare the current biometric signature window
// to the previous 30-second window. A sudden drastic identity shift =
// mid-session deepfake injection.
//
// Metric: compute a "signature hash" from the mean luma histogram across the
// current window. Compare Hamming similarity to the previous window's hash.
//
// If similarity drops > 40% in 10 seconds → identity shift anomaly.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const buildSignatureHash = (histWindow) => {
  // Aggregate histogram across window frames
  const bins = new Array(16).fill(0);
  for (const hist of histWindow) {
    for (let b = 0; b < Math.min(hist.length, 16); b++) {
      bins[b] += hist[b];
    }
  }
  const n = histWindow.length || 1;
  const normalized = bins.map(v => Math.round((v / n) * 255));
  return crypto.createHash('sha256').update(Buffer.from(normalized)).digest('hex');
};

const hammingSimilarity = (hexA, hexB) => {
  if (!hexA || !hexB || hexA.length !== hexB.length) return 1.0;
  let same = 0;
  for (let i = 0; i < hexA.length; i++) {
    if (hexA[i] === hexB[i]) same++;
  }
  return same / hexA.length;
};

const temporalConsistencyScore = async (streamId, currentHist) => {
  const windowKey    = `deepfake:temporal:window:${streamId}`;
  const prevHashKey  = `deepfake:temporal:prevhash:${streamId}`;
  const checkKey     = `deepfake:temporal:lastcheck:${streamId}`;

  try {
    const now = Date.now();

    // Load sliding window of histograms
    const stored = await getCache(windowKey).catch(() => null);
    const histWindow = stored?.hists ?? [];

    // Add current histogram to window
    histWindow.push(currentHist);

    // Keep only the last WINDOW_FRAMES entries
    if (histWindow.length > WINDOW_FRAMES) histWindow.splice(0, histWindow.length - WINDOW_FRAMES);

    // Persist updated window
    await setCache(windowKey, { hists: histWindow, updated_at: now }, CACHE_TTL).catch(() => {});

    // Only run temporal comparison every CHECK_INTERVAL seconds
    const lastCheck = await getCache(checkKey).catch(() => null);
    const elapsed   = lastCheck ? (now - lastCheck.ts) / 1000 : Infinity;

    if (elapsed < CHECK_INTERVAL || histWindow.length < 5) {
      // Not time for a check yet — return last known score or neutral
      const prevResult = await getCache(prevHashKey).catch(() => null);
      return {
        score:              prevResult?.last_score ?? 80,
        identity_shift:     false,
        similarity:         prevResult?.last_similarity ?? 1.0,
        reason:             elapsed < CHECK_INTERVAL ? 'within_interval' : 'insufficient_frames',
      };
    }

    // Time for a check — build current window signature hash
    const currentHash = buildSignatureHash(histWindow);
    const prevData    = await getCache(prevHashKey).catch(() => null);

    let score, similarityVal, identityShift = false;

    if (!prevData || !prevData.hash) {
      // First check — store baseline
      await setCache(prevHashKey, { hash: currentHash, last_score: 85, last_similarity: 1.0 }, CACHE_TTL).catch(() => {});
      await setCache(checkKey, { ts: now }, CACHE_TTL).catch(() => {});
      return { score: 85, identity_shift: false, similarity: 1.0, reason: 'baseline_established' };
    }

    similarityVal = hammingSimilarity(prevData.hash, currentHash);
    const drop    = 1.0 - similarityVal;

    if (drop > 0.40) {
      // >40% identity shift in 10s window — mid-session injection
      identityShift = true;
      score = 10;
      logger.warn('[livenessHardener] TEMPORAL IDENTITY SHIFT DETECTED', { streamId, similarity: similarityVal, drop });
    } else if (drop > 0.25) {
      score = 35; // Significant shift — suspicious
    } else if (drop > 0.15) {
      score = 60; // Moderate shift — borderline
    } else if (drop > 0.05) {
      score = 82; // Small natural drift — normal
    } else {
      score = 95; // Near-identical — highly consistent identity
    }

    // Update stored hash and check timestamp
    await setCache(prevHashKey, { hash: currentHash, last_score: score, last_similarity: similarityVal }, CACHE_TTL).catch(() => {});
    await setCache(checkKey, { ts: now }, CACHE_TTL).catch(() => {});

    return {
      score,
      identity_shift:  identityShift,
      similarity:      Math.round(similarityVal * 1000) / 1000,
      drop:            Math.round(drop * 1000) / 1000,
      frames_in_window: histWindow.length,
    };
  } catch (err) {
    logger.warn('[livenessHardener] temporal check failed', { streamId, error: err.message });
    return { score: 75, identity_shift: false, similarity: 1.0, reason: 'error' };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a 16-bin histogram from a Float32Array luma
// (compatible format for temporal consistency)
// ─────────────────────────────────────────────────────────────────────────────
const buildHistFromLuma = (luma) => {
  const bins = new Array(16).fill(0);
  const step = 256 / 16;
  const total = luma.length || 1;
  for (let i = 0; i < luma.length; i++) {
    const bin = Math.min(15, Math.floor(luma[i] / step));
    bins[bin]++;
  }
  return bins.map(v => v / total);
};

// ─────────────────────────────────────────────────────────────────────────────
// Main export: analyzeLiveness
//
// Input: { streamId, luma, width, height, brightness, edgeVariance }
//   brightness   — current frame mean brightness (from frameAnalyzer)
//   edgeVariance — current Sobel edge variance (from frameAnalyzer)
//
// Output: { livenessScore, temporalConsistencyScore, detail }
//
// Safe-failure: never throws. Returns last known scores or neutral values.
// ─────────────────────────────────────────────────────────────────────────────
const analyzeLiveness = async ({ streamId, luma, brightness = 128, edgeVariance = 0 }) => {
  const startMs     = Date.now();
  const sensorKey   = `deepfake:liveness:sensor:${streamId}`;

  try {
    // Load sensor window (brightness + edge variance history)
    const sensorData = await getCache(sensorKey).catch(() => null);
    const brightnessWindow   = [...(sensorData?.brightness_window   ?? []), brightness];
    const edgeVarianceWindow = [...(sensorData?.edge_variance_window ?? []), edgeVariance];

    // Keep last 30 frames
    if (brightnessWindow.length   > WINDOW_FRAMES) brightnessWindow.splice(0, brightnessWindow.length - WINDOW_FRAMES);
    if (edgeVarianceWindow.length > WINDOW_FRAMES) edgeVarianceWindow.splice(0, edgeVarianceWindow.length - WINDOW_FRAMES);

    // Persist updated sensor windows
    await setCache(sensorKey, {
      brightness_window:   brightnessWindow,
      edge_variance_window: edgeVarianceWindow,
    }, CACHE_TTL).catch(() => {});

    // Run liveness detectors
    const lighting = dynamicLightingScore(brightnessWindow);
    const motion   = motionLatencyScore(edgeVarianceWindow, brightnessWindow);

    // Weighted liveness score
    const livenessScore = Math.round(
      lighting.score * 0.45 +
      motion.score   * 0.55
    );

    // Run temporal consistency check
    const currentHist = buildHistFromLuma(luma);
    const temporal    = await temporalConsistencyScore(streamId, currentHist);

    return {
      livenessScore,
      temporalConsistencyScore: temporal.score,
      identity_shift_detected:  temporal.identity_shift,
      elapsed_ms:               Date.now() - startMs,
      detail: {
        lighting_score:      lighting.score,
        brightness_stddev:   lighting.brightness_stddev,
        periodic_detected:   lighting.periodic,
        motion_score:        motion.score,
        delta_mean:          motion.delta_mean,
        zero_fraction:       motion.zero_fraction,
        blink_count:         motion.blink_count,
        temporal_score:      temporal.score,
        temporal_similarity: temporal.similarity,
        identity_shift:      temporal.identity_shift,
        frames_in_window:    brightnessWindow.length,
      },
    };
  } catch (err) {
    logger.warn('[livenessHardener] analysis failed, using safe fallback', {
      streamId, error: err.message,
    });
    return {
      livenessScore:            65,
      temporalConsistencyScore: 70,
      identity_shift_detected:  false,
      elapsed_ms:               Date.now() - startMs,
      detail:                   { error: err.message },
    };
  }
};

module.exports = { analyzeLiveness };
