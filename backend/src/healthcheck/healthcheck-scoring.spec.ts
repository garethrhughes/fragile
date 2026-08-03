import { describe, it, expect } from '@jest/globals';
import { computeScore, type HealthcheckScore } from './healthcheck-scoring.js';

describe('computeScore', () => {
  it('returns null score when denominator is zero (N/A)', () => {
    const result: HealthcheckScore = computeScore(0, 0);
    expect(result.score).toBeNull();
    expect(result.numerator).toBeNull();
    expect(result.denominator).toBe(0);
  });

  it('returns 100 when every started ticket matches', () => {
    expect(computeScore(4, 4).score).toBe(100);
  });

  it('returns 0 when no started ticket matches', () => {
    expect(computeScore(0, 3).score).toBe(0);
  });

  it('computes (100 / denominator) * numerator as a percentage', () => {
    // 3 of 8 → 37.5
    expect(computeScore(3, 8).score).toBe(37.5);
  });

  it('rounds to two decimal places', () => {
    // 1 of 3 → 33.333... → 33.33
    expect(computeScore(1, 3).score).toBe(33.33);
  });

  it('reports numerator and denominator alongside the score', () => {
    const r = computeScore(2, 5);
    expect(r.numerator).toBe(2);
    expect(r.denominator).toBe(5);
    expect(r.score).toBe(40);
  });

  it('returns a null (N/A) score when explicitly not applicable regardless of counts', () => {
    const r = computeScore(0, 4, { applicable: false });
    expect(r.score).toBeNull();
    expect(r.numerator).toBeNull();
    expect(r.denominator).toBe(4);
  });
});
