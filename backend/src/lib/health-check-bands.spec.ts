/**
 * Unit tests for health-check-bands (feature 0014, proposal 0071).
 */
import {
  classifyHealthBand,
  buildBandDistribution,
} from './health-check-bands.js';

describe('classifyHealthBand', () => {
  it('classifies 85 and above as healthy', () => {
    expect(classifyHealthBand(85)).toBe('healthy');
    expect(classifyHealthBand(100)).toBe('healthy');
  });

  it('classifies 70 to just under 85 as watch', () => {
    expect(classifyHealthBand(70)).toBe('watch');
    expect(classifyHealthBand(84)).toBe('watch');
  });

  it('classifies below 70 as at-risk', () => {
    expect(classifyHealthBand(69)).toBe('at-risk');
    expect(classifyHealthBand(0)).toBe('at-risk');
  });

  it('applies strict boundaries at 70 and 85', () => {
    // 84 -> watch, 85 -> healthy (upper boundary is inclusive of healthy)
    expect(classifyHealthBand(84)).toBe('watch');
    expect(classifyHealthBand(85)).toBe('healthy');
    // 69 -> at-risk, 70 -> watch
    expect(classifyHealthBand(69)).toBe('at-risk');
    expect(classifyHealthBand(70)).toBe('watch');
  });
});

describe('buildBandDistribution', () => {
  it('counts scores into the correct bands', () => {
    const dist = buildBandDistribution([90, 85, 80, 70, 69, 10]);
    expect(dist).toEqual({ healthy: 2, watch: 2, atRisk: 2, na: 0 });
  });

  it('counts null scores only toward na', () => {
    const dist = buildBandDistribution([90, null, 50, null]);
    expect(dist).toEqual({ healthy: 1, watch: 0, atRisk: 1, na: 2 });
  });

  it('returns all-zero distribution for an empty list', () => {
    expect(buildBandDistribution([])).toEqual({
      healthy: 0,
      watch: 0,
      atRisk: 0,
      na: 0,
    });
  });
});
