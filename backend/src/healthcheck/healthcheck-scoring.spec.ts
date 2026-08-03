import { describe, it, expect } from '@jest/globals';
import { computeScore, poolDimension, type HealthcheckScore } from './healthcheck-scoring.js';

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

describe('poolDimension', () => {
  it('sums numerators and denominators across applicable boards', () => {
    // board A: 3/4, board B: 1/6 → pooled 4/10 = 40
    const r = poolDimension([
      { numerator: 3, denominator: 4, applicable: true },
      { numerator: 1, denominator: 6, applicable: true },
    ]);
    expect(r.numerator).toBe(4);
    expect(r.denominator).toBe(10);
    expect(r.score).toBe(40);
  });

  it('excludes non-applicable boards from both sums', () => {
    // Only board A applies (scrum); board B (kanban) excluded from Stability.
    const r = poolDimension([
      { numerator: 2, denominator: 5, applicable: true },
      { numerator: 0, denominator: 8, applicable: false },
    ]);
    expect(r.denominator).toBe(5);
    expect(r.numerator).toBe(2);
    expect(r.score).toBe(40);
  });

  it('is N/A when no applicable board has any started tickets', () => {
    const r = poolDimension([
      { numerator: 0, denominator: 0, applicable: true },
      { numerator: 0, denominator: 9, applicable: false },
    ]);
    expect(r.score).toBeNull();
    expect(r.denominator).toBe(0);
  });

  it('is N/A for an empty contribution list', () => {
    expect(poolDimension([]).score).toBeNull();
  });
});
