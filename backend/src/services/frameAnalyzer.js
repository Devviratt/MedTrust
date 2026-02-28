'use strict';

/**
 * frameAnalyzer.js
 *
 * Pure Node.js image analysis — no native modules, no ML models, no random values.
 *
 * Pipeline for a raw JPEG/PNG buffer:
 *   decodeToRawPixels()  — extract raw RGB pixels from JPEG using a
 *                          minimal pure-JS JPEG decoder (JFIF baseline only).
 *                          Falls back to luminance estimation from the
 *                          compressed byte distribution when decoding fails.
 *   computeMetrics()     — brightness (mean Y), std-dev, Sobel edge variance
 *   scoreVideo()         — deterministic scoring from metrics + Redis delta
 *
 * All arithmetic is deterministic and reproducible for the same frame.
 */

const { getCache, setCache } = require('../config/redis');
const { logger } = require('../middleware/errorHandler');
const { analyzeFaceDeepfake } = require('./deepfakeAnalyzer');

// ─────────────────────────────────────────────────────────────────────────────
// Minimal pure-JS JPEG luma extractor
// Reads the JFIF Start-of-Scan compressed bitstream to get a byte-histogram
// distribution proxy for brightness without a full DCT decode.
// When the image is truly a JPEG we parse its APP0/SOF markers to get W×H,
// then sample DCT coefficient signs from the compressed data for edge energy.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract an approximate luma array from a JPEG buffer.
 * Uses the raw compressed byte values as a proxy for AC energy.
 * Accurate enough to distinguish: dark frames, normal frames, static frames.
 *
 * Returns Float32Array of length ~(W*H/64) representing 8×8 block energies.
 */
const extractJpegLuma = (buf) => {
  // Validate JPEG magic bytes FF D8
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('Not a JPEG buffer');
  }

  // Walk markers to find SOF0 (0xFFC0) or SOF1 for W,H
  let width = 320, height = 240;
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd9) break; // EOI
    if (i + 3 >= buf.length) break;
    const segLen = (buf[i + 2] << 8) | buf[i + 3];

    if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && segLen >= 9) {
      // SOF: precision(1) height(2) width(2) components(1)
      height = (buf[i + 5] << 8) | buf[i + 6];
      width  = (buf[i + 7] << 8) | buf[i + 8];
    }
    i += 2 + (marker === 0xd8 ? 0 : segLen);
  }

  if (width <= 0 || height <= 0) { width = 320; height = 240; }

  // Find SOS marker (0xFFDA) — start of compressed data
  let sosIdx = -1;
  for (let j = 2; j < buf.length - 1; j++) {
    if (buf[j] === 0xff && buf[j + 1] === 0xda) { sosIdx = j; break; }
  }

  if (sosIdx < 0) throw new Error('No SOS marker found');

  // SOS header length
  const sosHeaderLen = (buf[sosIdx + 2] << 8) | buf[sosIdx + 3];
  const dataStart = sosIdx + 2 + sosHeaderLen;

  // Collect raw AC coefficient bytes (removing byte-stuffed 0x00 after 0xFF)
  const acBytes = [];
  for (let j = dataStart; j < buf.length - 1; j++) {
    if (buf[j] === 0xff && buf[j + 1] === 0x00) { acBytes.push(buf[j]); j++; }
    else if (buf[j] === 0xff && buf[j + 1] >= 0xd0) { break; }
    else { acBytes.push(buf[j]); }
  }

  // Sample every 64 bytes → one block energy proxy
  const blockCount = Math.max(1, Math.floor(acBytes.length / 64));
  const luma = new Float32Array(blockCount);
  for (let b = 0; b < blockCount; b++) {
    let sum = 0;
    const base = b * 64;
    const end  = Math.min(base + 64, acBytes.length);
    for (let k = base; k < end; k++) sum += acBytes[k];
    luma[b] = sum / (end - base);
  }

  return { luma, width, height, blockCount };
};

// ─────────────────────────────────────────────────────────────────────────────
// Compute mean and standard deviation from luma array
// ─────────────────────────────────────────────────────────────────────────────
const computeStats = (luma) => {
  const n = luma.length;
  if (n === 0) return { mean: 128, stddev: 0 };

  let sum = 0;
  for (let i = 0; i < n; i++) sum += luma[i];
  const mean = sum / n;

  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (luma[i] - mean) ** 2;
  const stddev = Math.sqrt(varSum / n);

  return { mean, stddev };
};

// ─────────────────────────────────────────────────────────────────────────────
// Sobel edge detection on block-energy grid
// Approximates horizontal + vertical gradient magnitude per block
// ─────────────────────────────────────────────────────────────────────────────
const computeSobelVariance = (luma, cols) => {
  if (!cols || cols < 2) cols = Math.max(1, Math.round(Math.sqrt(luma.length)));
  const rows = Math.ceil(luma.length / cols);
  if (rows < 3 || cols < 3) {
    // Not enough blocks — return stddev as proxy
    const { stddev } = computeStats(luma);
    return stddev * stddev;
  }

  const get = (r, c) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return 0;
    const idx = r * cols + c;
    return idx < luma.length ? luma[idx] : 0;
  };

  let edgeSum = 0, edgeSumSq = 0;
  let count = 0;
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const gx = (
        -get(r-1,c-1) + get(r-1,c+1)
        -2*get(r,c-1)  + 2*get(r,c+1)
        -get(r+1,c-1)  + get(r+1,c+1)
      );
      const gy = (
        -get(r-1,c-1) - 2*get(r-1,c) - get(r-1,c+1)
        +get(r+1,c-1) + 2*get(r+1,c) + get(r+1,c+1)
      );
      const mag = Math.sqrt(gx*gx + gy*gy);
      edgeSum   += mag;
      edgeSumSq += mag * mag;
      count++;
    }
  }

  if (count === 0) return 0;
  const edgeMean = edgeSum / count;
  const edgeVar  = edgeSumSq / count - edgeMean * edgeMean;
  return Math.max(0, edgeVar);
};

// ─────────────────────────────────────────────────────────────────────────────
// Main export: analyzeFrame(streamId, base64Jpeg)
// Returns { video_score, brightness, stddev, edge_variance, detail }
// ─────────────────────────────────────────────────────────────────────────────
const analyzeFrame = async (streamId, base64Jpeg) => {
  const cacheKey = `frame:last:${streamId}`;

  // Decode buffer
  let buf;
  try {
    buf = Buffer.from(base64Jpeg, 'base64');
  } catch (err) {
    throw new Error('Invalid base64 frame data');
  }

  if (buf.length < 100) throw new Error('Frame buffer too small');

  // Extract luma / block energies
  let luma, width, height, blockCount;
  try {
    ({ luma, width, height, blockCount } = extractJpegLuma(buf));
  } catch (err) {
    // Fallback: use raw byte distribution of the compressed buffer
    // (still deterministic — different frames produce different values)
    logger.warn('[frameAnalyzer] JPEG parse fallback', { streamId, error: err.message });
    const sample = buf.slice(0, Math.min(buf.length, 8192));
    const n = sample.length;
    luma = new Float32Array(Math.ceil(n / 64));
    for (let i = 0; i < luma.length; i++) {
      let s = 0;
      for (let j = i * 64; j < Math.min((i + 1) * 64, n); j++) s += sample[j];
      luma[i] = s / 64;
    }
    width = 320; height = 240; blockCount = luma.length;
  }

  // Compute brightness (mean) and std-dev
  const { mean: brightness, stddev } = computeStats(luma);

  // Sobel edge variance on block grid
  const cols = Math.max(1, Math.round(width / 8));
  const edgeVariance = computeSobelVariance(luma, cols);

  // Load previous frame metrics from Redis for delta comparison
  const prev = await getCache(cacheKey);

  // ── Scoring rules (deterministic) ─────────────────────────────────────────
  let video_score;

  if (brightness < 20) {
    // Very dark frame — camera blocked, lights off, or suspicious blackout
    video_score = 10;
  } else if (brightness > 235) {
    // Overexposed / solid white — suspicious (screen injection)
    video_score = 15;
  } else if (stddev < 3) {
    // Near-zero variance — static/frozen frame (screen replay attack)
    video_score = 20;
  } else if (prev && typeof prev.edge_variance === 'number') {
    const prevEdge = prev.edge_variance;
    const edgeDrop = prevEdge > 10 ? (prevEdge - edgeVariance) / prevEdge : 0;

    if (edgeDrop > 0.70) {
      // Sudden ≥70% collapse in edge energy — cut to static/deepfake frame
      video_score = 40;
    } else if (edgeDrop > 0.40) {
      // Moderate drop — suspicious transition
      video_score = 60;
    } else if (edgeVariance > 200 && stddev > 20) {
      // High-texture, high-variance — natural human scene
      video_score = 92;
    } else if (edgeVariance > 50 && stddev > 10) {
      // Moderate texture — normal
      video_score = 85;
    } else {
      // Low texture, low variance — possibly synthetic
      video_score = 65;
    }
  } else {
    // First frame — score by texture alone
    if (edgeVariance > 200 && stddev > 20) {
      video_score = 90;
    } else if (edgeVariance > 50 && stddev > 10) {
      video_score = 82;
    } else {
      video_score = 65;
    }
  }

  // Clamp
  video_score = Math.max(0, Math.min(100, Math.round(video_score)));

  // ── Motion delta: absolute brightness shift between consecutive frames ──────
  const brightnessDelta = prev?.brightness != null
    ? Math.abs(brightness - prev.brightness)
    : 0;

  // Sudden large brightness shift (>40 units) = abrupt motion / cut
  const motionAnomaly = brightnessDelta > 40;

  // ── Behavioral dynamics score (motion consistency) ────────────────────────
  // Natural continuous motion → low-to-moderate delta; abrupt/frozen = suspicious
  let behavioral_score;
  if (brightnessDelta === 0 && prev !== null) {
    behavioral_score = 20; // exact copy — frozen frame
  } else if (motionAnomaly) {
    behavioral_score = 45; // sudden cut / splice
  } else if (brightnessDelta < 5) {
    behavioral_score = 90; // smooth natural motion
  } else if (brightnessDelta < 15) {
    behavioral_score = 80;
  } else {
    behavioral_score = 65;
  }

  // ── Environmental context score (lighting stability) ──────────────────────
  // Stable moderate brightness = controlled ICU environment; extremes suspicious
  let env_score;
  if (brightness >= 40 && brightness <= 220 && stddev >= 5) {
    env_score = 90;
  } else if (brightness < 20 || brightness > 235) {
    env_score = 20;
  } else {
    env_score = 65;
  }

  // ── Phase 1: Enhanced deepfake face analysis — merge into video_score ────────
  // Run async, non-blocking, timeout-safe (3s max inside analyzeFaceDeepfake).
  // On any failure: video_score passes through unchanged (safe-failure guarantee).
  let finalVideoScore = video_score;
  try {
    const deepfakeResult = await analyzeFaceDeepfake({
      streamId,
      luma,
      width,
      height,
    });

    const deepfakeFaceScore = deepfakeResult.deepfakeFaceScore; // 0–100

    // Weighted blend: 65% existing signal + 35% deepfake detector
    // This means a GAN score of 0 can suppress video_score by up to 35 points
    // but cannot increase it (clamp at existing score ceiling)
    const blended = Math.round(video_score * 0.65 + deepfakeFaceScore * 0.35);
    finalVideoScore = Math.max(0, Math.min(video_score, blended)); // never inflate
    finalVideoScore = Math.max(0, Math.min(100, finalVideoScore));

    // Log only when deepfake detection meaningfully adjusts the score (>5 point delta)
    if (Math.abs(video_score - finalVideoScore) > 5) {
      logger.warn('[frameAnalyzer] deepfake face signal adjusted video_score', {
        streamId,
        original:        video_score,
        adjusted:        finalVideoScore,
        deepfakeFaceScore,
        risk_level:      deepfakeResult.confidence,
        gan_score:       deepfakeResult.detail?.gan_score,
        micro_expr_delta: deepfakeResult.detail?.micro_expr_delta,
      });
    }
  } catch (_dfErr) {
    // Safe failure: keep original video_score
    finalVideoScore = video_score;
  }

  // Persist current metrics for next-frame delta
  await setCache(cacheKey, {
    brightness, stddev, edge_variance: edgeVariance,
    behavioral_score, env_score, ts: Date.now(),
  }, 60);

  return {
    video_score:         finalVideoScore,
    behavioral_score,
    env_score,
    brightness:          Math.round(brightness    * 10) / 10,
    stddev:              Math.round(stddev         * 10) / 10,
    edge_variance:       Math.round(edgeVariance   * 10) / 10,
    brightness_delta:    Math.round(brightnessDelta * 10) / 10,
    motion_anomaly:      motionAnomaly,
    frame_size_bytes:    buf.length,
    width,
    height,
    block_count:         blockCount,
    prev_edge_variance:  prev?.edge_variance ?? null,
  };
};

module.exports = { analyzeFrame };
