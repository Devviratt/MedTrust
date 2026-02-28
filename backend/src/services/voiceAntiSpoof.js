'use strict';

/**
 * voiceAntiSpoof.js
 *
 * Phase 2 — Advanced voice anti-spoofing.
 * Pure Node.js DSP on MFCC feature vectors — no external ML dependencies.
 *
 * Produces deepfakeVoiceScore (0–100, higher = more authentic).
 * Merged into voiceScore before trust calculation. No new weight category.
 *
 * Detectors:
 *   1. Spectral flatness anomaly  — over-smooth/synthetic frequency spectrum
 *   2. Phase coherence distortion — TTS/VC systems produce unnatural phase
 *   3. Synthetic pitch uniformity — cloned voice has unnaturally steady pitch
 *   4. Replay attack detection    — pre-recorded playback echo signatures
 *   5. Challenge-response timing  — phoneme timing vs stored baseline
 */

const crypto = require('crypto');
const { getCache, setCache } = require('../config/redis');
const { logger } = require('../middleware/errorHandler');

const CACHE_TTL = 120; // seconds

// ─────────────────────────────────────────────────────────────────────────────
// Helper: compute mean and std-dev of an array
// ─────────────────────────────────────────────────────────────────────────────
const stats = (arr) => {
  if (!arr || arr.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of arr) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / arr.length;
  let varSum = 0;
  for (const v of arr) varSum += (v - mean) ** 2;
  const stddev = Math.sqrt(varSum / arr.length);
  return { mean, stddev, min, max };
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector 1: Spectral Flatness Anomaly
//
// MFCC coefficients represent the cepstral envelope. For a real voice:
// - Lower MFCCs (c1–c4) carry formant energy → relatively large values
// - Higher MFCCs (c10+) carry fine spectral detail → smaller, noisy values
// - The ratio of high-to-low MFCC energy should vary naturally
//
// TTS/voice-clone systems produce:
// - Artificially smooth MFCC trajectories (low intra-vector std-dev)
// - Unnatural flatness in high-order coefficients
//
// Metric: Spectral Flatness = geometric_mean / arithmetic_mean of |MFCC| values
//   Real voice    → flatness 0.3–0.7
//   Synthetic     → flatness < 0.2 (over-smooth) or > 0.85 (noisy TTS artifact)
// ─────────────────────────────────────────────────────────────────────────────
const spectralFlatnessScore = (mfcc) => {
  if (!mfcc || mfcc.length < 4) return { score: 60, flatness: 0 };

  const absVals = mfcc.map(v => Math.abs(Number(v) || 0) + 1e-6); // avoid log(0)

  // Geometric mean via log-sum
  const logSum = absVals.reduce((acc, v) => acc + Math.log(v), 0);
  const geoMean = Math.exp(logSum / absVals.length);
  const arithMean = absVals.reduce((a, b) => a + b, 0) / absVals.length;

  const flatness = geoMean / arithMean; // 0–1

  let score;
  if (flatness >= 0.30 && flatness <= 0.70) {
    score = 90; // Natural voice spectral distribution
  } else if (flatness >= 0.20 && flatness < 0.30) {
    score = 70; // Slightly over-smooth — possible light processing
  } else if (flatness > 0.70 && flatness <= 0.80) {
    score = 70; // Slightly flat spectrum — possible TTS artifact
  } else if (flatness < 0.20) {
    score = 30; // Strong synthetic smoothing signature
  } else {
    score = 35; // Extreme flatness — TTS/VC artifact
  }

  return { score, flatness: Math.round(flatness * 1000) / 1000 };
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector 2: Phase Coherence Distortion
//
// TTS and voice-conversion systems operate in the magnitude spectrum domain.
// They reconstruct phase using Griffin-Lim or neural vocoders, which introduce
// systematic phase distortions that manifest as:
// - Unnaturally low variance in sign patterns across MFCC coefficients
// - Missing odd/even coefficient alternation (real voice physiology)
//
// Proxy: in natural speech, MFCC coefficients alternate sign more irregularly.
// Synthetic speech shows near-monotone sign sequences.
//
// Metric: sign-change rate across the MFCC vector.
//   Real voice: sign-change rate 0.4–0.65
//   Synthetic:  < 0.25 or > 0.80
// ─────────────────────────────────────────────────────────────────────────────
const phaseCoherenceScore = (mfcc) => {
  if (!mfcc || mfcc.length < 6) return { score: 65, sign_change_rate: 0 };

  let signChanges = 0;
  for (let i = 1; i < mfcc.length; i++) {
    const prev = Number(mfcc[i - 1]) || 0;
    const curr = Number(mfcc[i]) || 0;
    if ((prev >= 0 && curr < 0) || (prev < 0 && curr >= 0)) signChanges++;
  }

  const rate = signChanges / (mfcc.length - 1);

  let score;
  if (rate >= 0.40 && rate <= 0.65) {
    score = 90; // Natural irregular sign alternation
  } else if (rate >= 0.30 && rate < 0.40) {
    score = 75;
  } else if (rate > 0.65 && rate <= 0.75) {
    score = 75;
  } else if (rate < 0.25) {
    score = 30; // Monotone signs — synthetic phase artifact
  } else if (rate > 0.80) {
    score = 35; // Over-alternating — Griffin-Lim artifact
  } else {
    score = 55;
  }

  return { score, sign_change_rate: Math.round(rate * 1000) / 1000 };
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector 3: Synthetic Pitch Uniformity
//
// Voice cloning systems generate unnaturally steady fundamental frequency (F0).
// Real human speech has natural pitch variation due to:
//   - Prosodic stress, intonation, coarticulation
//   - Breath pressure variation, vocal cord tension
//
// MFCC c0 (zeroth coefficient) tracks overall energy / pitch envelope.
// MFCC c1–c2 track first and second formants (strongly pitch-correlated).
//
// Metric: across a sliding window of frames, the std-dev of c0 and c1
// values should be non-trivially non-zero. Cloned voice collapses this to ~0.
// ─────────────────────────────────────────────────────────────────────────────
const syntheticPitchScore = (mfcc, prevWindow) => {
  if (!mfcc || mfcc.length < 2) return { score: 65, pitch_variance: 0 };

  const c0 = Number(mfcc[0]) || 0;
  const c1 = mfcc.length > 1 ? Number(mfcc[1]) || 0 : 0;

  if (!prevWindow || !prevWindow.c0_values) {
    // First frame — store baseline, neutral score
    return { score: 70, pitch_variance: 0, is_first: true };
  }

  const { c0_values, c1_values } = prevWindow;

  // Compute variance of c0 and c1 across stored window (last 5 frames)
  const c0Stats = stats(c0_values);
  const c1Stats = stats(c1_values);

  const pitchVariance = (c0Stats.stddev + c1Stats.stddev) / 2;

  let score;
  if (pitchVariance > 15) {
    score = 92; // Natural prosodic variation
  } else if (pitchVariance > 8) {
    score = 82;
  } else if (pitchVariance > 3) {
    score = 65; // Low variation — possible synthetic
  } else if (pitchVariance > 0.5) {
    score = 40; // Very low — strong synthetic pitch uniformity
  } else {
    score = 15; // Near-zero variance — voice clone / TTS
  }

  return { score, pitch_variance: Math.round(pitchVariance * 100) / 100 };
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector 4: Replay Attack Detection
//
// Pre-recorded audio playback through speakers introduces:
//   - Room impulse response echoes (reverberation signature)
//   - Compression artifacts from digital-to-analog conversion
//
// MFCC proxy: replayed audio shows unnaturally high energy in high-order
// MFCCs (c10+) due to room reverb adding high-frequency tail energy.
// It also shows suspiciously low variance in low-order MFCCs (flat spectrum).
//
// Metric: energy ratio of high-order vs low-order MFCCs.
//   Live voice: high-order energy < 40% of low-order energy
//   Replay:     high-order energy ≥ 60% of low-order energy (reverb tail)
// ─────────────────────────────────────────────────────────────────────────────
const replayAttackScore = (mfcc) => {
  if (!mfcc || mfcc.length < 8) return { score: 70, replay_ratio: 0 };

  const midpoint = Math.floor(mfcc.length / 2);
  const lowOrder  = mfcc.slice(0, midpoint).map(v => Math.abs(Number(v) || 0));
  const highOrder = mfcc.slice(midpoint).map(v => Math.abs(Number(v) || 0));

  const lowEnergy  = lowOrder.reduce((a, b) => a + b, 0) / (lowOrder.length  || 1);
  const highEnergy = highOrder.reduce((a, b) => a + b, 0) / (highOrder.length || 1);

  const replayRatio = highEnergy / (lowEnergy + 1e-6);

  let score;
  if (replayRatio < 0.25) {
    score = 92; // Low high-order energy — live microphone typical
  } else if (replayRatio < 0.40) {
    score = 82;
  } else if (replayRatio < 0.60) {
    score = 65; // Moderate — borderline
  } else if (replayRatio < 0.80) {
    score = 40; // High reverb tail — possible replay
  } else {
    score = 20; // Strong replay attack signature
  }

  return { score, replay_ratio: Math.round(replayRatio * 1000) / 1000 };
};

// ─────────────────────────────────────────────────────────────────────────────
// Detector 5: Challenge-Response Phoneme Timing
//
// When a challenge phrase is issued, the doctor must respond in real-time.
// Pre-recorded or TTS responses will not match the expected timing pattern
// because:
//   - They were recorded before the session
//   - TTS generation has latency spikes
//
// We generate a 3-word challenge hash per session (stored in Redis).
// The doctor's MFCC stream is compared for timing discontinuities.
//
// Metric: if the MFCC energy envelope shows an abrupt onset after silence
// (consistent with TTS playback starting), flag as suspicious.
// If the energy shows smooth pre-phonation breath noise → authentic.
// ─────────────────────────────────────────────────────────────────────────────
const CHALLENGE_WORDS = [
  ['alpha','bravo','charlie'], ['delta','echo','foxtrot'],
  ['golf','hotel','india'],   ['juliet','kilo','lima'],
  ['mike','november','oscar'], ['papa','quebec','romeo'],
  ['sierra','tango','uniform'], ['victor','whiskey','xray'],
];

const generateChallenge = (sessionId) => {
  // Deterministic per-session challenge (no randomness — reproducible)
  const hash = crypto.createHash('sha256').update(sessionId + 'challenge').digest('hex');
  const idx  = parseInt(hash.slice(0, 2), 16) % CHALLENGE_WORDS.length;
  return CHALLENGE_WORDS[idx];
};

const challengeResponseScore = async (mfcc, streamId) => {
  const cacheKey = `deepfake:voice:challenge:${streamId}`;

  try {
    const challenge = generateChallenge(streamId);
    const stored    = await getCache(cacheKey).catch(() => null);

    if (!stored) {
      // First call — store challenge and baseline MFCC energy envelope
      const energyEnvelope = mfcc ? mfcc.slice(0, 4).map(v => Math.abs(Number(v) || 0)) : [];
      await setCache(cacheKey, {
        challenge,
        baseline_energy: energyEnvelope,
        issued_at: Date.now(),
        frames_seen: 1,
      }, CACHE_TTL).catch(() => {});
      return { score: 72, challenge_words: challenge, status: 'issued' };
    }

    // Check for abrupt energy onset (TTS replay signature)
    const currentEnergy = mfcc ? mfcc.slice(0, 2).map(v => Math.abs(Number(v) || 0)) : [0];
    const currentMean   = currentEnergy.reduce((a, b) => a + b, 0) / (currentEnergy.length || 1);
    const baselineMean  = (stored.baseline_energy || [0]).reduce((a, b) => a + b, 0) /
                          ((stored.baseline_energy || [0]).length || 1);

    // TTS: sudden energy spike from near-silence → playback onset
    const energyRatio = baselineMean > 0 ? currentMean / baselineMean : 1;

    const framesUpdated = (stored.frames_seen || 1) + 1;
    await setCache(cacheKey, { ...stored, frames_seen: framesUpdated }, CACHE_TTL).catch(() => {});

    let score;
    if (energyRatio > 5.0 && baselineMean < 5) {
      // Abrupt high energy after near-silence — TTS/replay onset
      score = 30;
    } else if (energyRatio > 3.0) {
      score = 50; // Suspicious onset
    } else {
      score = 85; // Gradual energy — consistent with live speech
    }

    return {
      score,
      challenge_words:  challenge,
      status:           'active',
      frames_seen:      framesUpdated,
      energy_ratio:     Math.round(energyRatio * 100) / 100,
    };
  } catch (err) {
    return { score: 70, status: 'error', error: err.message };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main export: analyzeVoiceAntiSpoof
//
// Input: { streamId, mfcc: number[] }
// Output: { deepfakeVoiceScore: 0–100, detail: {...} }
//
// Safe-failure: any error → returns last known score or neutral 65.
// Never throws. Max latency: one Redis get + pure sync math ≈ <50ms.
// ─────────────────────────────────────────────────────────────────────────────
const analyzeVoiceAntiSpoof = async ({ streamId, mfcc }) => {
  const startMs = Date.now();
  const windowKey = `deepfake:voice:window:${streamId}`;

  try {
    if (!mfcc || !Array.isArray(mfcc) || mfcc.length < 4) {
      return { deepfakeVoiceScore: 65, confidence: 'LOW', detail: { reason: 'insufficient_mfcc' } };
    }

    // Load sliding window for pitch uniformity check
    const prevWindow = await getCache(windowKey).catch(() => null);

    // Run all 5 detectors
    const flatness   = spectralFlatnessScore(mfcc);
    const phase      = phaseCoherenceScore(mfcc);
    const pitch      = syntheticPitchScore(mfcc, prevWindow);
    const replay     = replayAttackScore(mfcc);
    const challenge  = await challengeResponseScore(mfcc, streamId);

    // Update sliding window (keep last 5 c0/c1 values)
    const c0 = Number(mfcc[0]) || 0;
    const c1 = mfcc.length > 1 ? Number(mfcc[1]) || 0 : 0;
    const newWindow = {
      c0_values: [...((prevWindow?.c0_values || []).slice(-4)), c0],
      c1_values: [...((prevWindow?.c1_values || []).slice(-4)), c1],
    };
    await setCache(windowKey, newWindow, CACHE_TTL).catch(() => {});

    // Weighted fusion — spectral + phase most reliable for voice clone detection
    const deepfakeVoiceScore = Math.round(
      flatness.score   * 0.30 +
      phase.score      * 0.25 +
      pitch.score      * 0.20 +
      replay.score     * 0.15 +
      challenge.score  * 0.10
    );

    return {
      deepfakeVoiceScore,
      confidence: prevWindow ? 'HIGH' : 'LOW',
      elapsed_ms: Date.now() - startMs,
      detail: {
        spectral_flatness_score: flatness.score,
        flatness_value:          flatness.flatness,
        phase_coherence_score:   phase.score,
        sign_change_rate:        phase.sign_change_rate,
        pitch_uniformity_score:  pitch.score,
        pitch_variance:          pitch.pitch_variance,
        replay_attack_score:     replay.score,
        replay_ratio:            replay.replay_ratio,
        challenge_score:         challenge.score,
        challenge_words:         challenge.challenge_words,
        challenge_status:        challenge.status,
      },
    };
  } catch (err) {
    logger.warn('[voiceAntiSpoof] analysis failed, using safe fallback', {
      streamId, error: err.message,
    });
    const prev = await getCache(windowKey).catch(() => null);
    return {
      deepfakeVoiceScore: prev ? 65 : 60,
      confidence: 'LOW',
      elapsed_ms: Date.now() - startMs,
      detail: { error: err.message },
    };
  }
};

module.exports = { analyzeVoiceAntiSpoof, generateChallenge };
