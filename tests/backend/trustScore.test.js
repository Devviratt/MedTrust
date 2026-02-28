const { computeTrustScore } = require('../../backend/src/services/trustScoreService');

describe('Trust Score Engine', () => {
  const defaultWeights = {
    video_weight: { value: 0.40 },
    voice_weight: { value: 0.30 },
    biometric_weight: { value: 0.20 },
    blockchain_weight: { value: 0.10 },
    safe_threshold: { value: 75 },
    suspicious_threshold: { value: 50 },
  };

  test('computes safe status when all scores are high', () => {
    const result = computeTrustScore(
      { overall_score: 0.95 },
      { overall_score: 0.92 },
      { sync_score: 0.90 },
      { integrity_score: 1.0 },
      defaultWeights
    );
    expect(result.trust_score).toBeGreaterThanOrEqual(75);
    expect(result.status).toBe('safe');
  });

  test('computes alert status when video score is very low (deepfake detected)', () => {
    const result = computeTrustScore(
      { overall_score: 0.10 },
      { overall_score: 0.85 },
      { sync_score: 0.80 },
      { integrity_score: 1.0 },
      defaultWeights
    );
    expect(result.trust_score).toBeLessThan(75);
    expect(['suspicious', 'alert']).toContain(result.status);
  });

  test('computes alert status when all scores are zero', () => {
    const result = computeTrustScore(
      { overall_score: 0 },
      { overall_score: 0 },
      { sync_score: 0 },
      { integrity_score: 0 },
      defaultWeights
    );
    expect(result.trust_score).toBe(0);
    expect(result.status).toBe('alert');
  });

  test('computes suspicious status in borderline range', () => {
    const result = computeTrustScore(
      { overall_score: 0.60 },
      { overall_score: 0.65 },
      { sync_score: 0.55 },
      { integrity_score: 0.70 },
      defaultWeights
    );
    expect(result.trust_score).toBeGreaterThanOrEqual(50);
    expect(result.trust_score).toBeLessThan(75);
    expect(result.status).toBe('suspicious');
  });

  test('scores are clamped to 0-100 range', () => {
    const result = computeTrustScore(
      { overall_score: 2.0 },
      { overall_score: -0.5 },
      { sync_score: 1.5 },
      { integrity_score: 0.9 },
      defaultWeights
    );
    expect(result.trust_score).toBeGreaterThanOrEqual(0);
    expect(result.trust_score).toBeLessThanOrEqual(100);
  });

  test('weights sum correctly to produce expected score', () => {
    const result = computeTrustScore(
      { overall_score: 1.0 },
      { overall_score: 1.0 },
      { sync_score: 1.0 },
      { integrity_score: 1.0 },
      defaultWeights
    );
    expect(result.trust_score).toBe(100);
  });

  test('handles missing sub-scores gracefully', () => {
    const result = computeTrustScore(
      null,
      null,
      null,
      null,
      defaultWeights
    );
    expect(result).toHaveProperty('trust_score');
    expect(result).toHaveProperty('status');
    expect(['safe', 'suspicious', 'alert']).toContain(result.status);
  });
});
