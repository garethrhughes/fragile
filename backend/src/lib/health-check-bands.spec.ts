/**
 * Unit tests for health-check-bands (feature 0014, proposal 0071;
 * target-relative roadmap banding + org scores, proposal 0073).
 */
import {
  classifyHealthBand,
  buildBandDistribution,
  classifyRoadmapBand,
  roadmapAttainment,
  buildDistributionFromBands,
  mean,
  supportLoad,
  ROADMAP_WATCH_MARGIN,
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

describe('classifyRoadmapBand (target-relative, proposal 0073)', () => {
  it('is healthy at or above the team target', () => {
    expect(classifyRoadmapBand(80, 80)).toBe('healthy');
    expect(classifyRoadmapBand(95, 80)).toBe('healthy');
    // PLAT: 50% target, 55% score -> healthy (beats its own target)
    expect(classifyRoadmapBand(55, 50)).toBe('healthy');
    expect(classifyRoadmapBand(50, 50)).toBe('healthy');
  });

  it('is watch within the margin below target', () => {
    expect(ROADMAP_WATCH_MARGIN).toBe(15);
    expect(classifyRoadmapBand(79, 80)).toBe('watch');
    expect(classifyRoadmapBand(65, 80)).toBe('watch'); // target-15
    // PLAT: 50 target -> watch band is 35..49
    expect(classifyRoadmapBand(40, 50)).toBe('watch');
    expect(classifyRoadmapBand(35, 50)).toBe('watch');
  });

  it('is at-risk more than the margin below target', () => {
    expect(classifyRoadmapBand(64, 80)).toBe('at-risk');
    expect(classifyRoadmapBand(0, 80)).toBe('at-risk');
    expect(classifyRoadmapBand(34, 50)).toBe('at-risk');
  });
});

describe('roadmapAttainment (proposal 0073)', () => {
  it('is score/target as a percentage, rounded', () => {
    expect(roadmapAttainment(40, 80)).toBe(50);
    expect(roadmapAttainment(60, 80)).toBe(75);
  });

  it('caps at 100 when the team beats its target', () => {
    // PLAT: 70% score against 50% target -> 100 (not 140)
    expect(roadmapAttainment(70, 50)).toBe(100);
    expect(roadmapAttainment(80, 80)).toBe(100);
  });

  it('returns 100 when target is zero or negative (avoids divide-by-zero)', () => {
    expect(roadmapAttainment(0, 0)).toBe(100);
    expect(roadmapAttainment(50, 0)).toBe(100);
  });
});

describe('buildDistributionFromBands (proposal 0073)', () => {
  it('counts pre-computed bands, treating null as na', () => {
    const dist = buildDistributionFromBands(['healthy', 'watch', 'at-risk', null, 'healthy']);
    expect(dist).toEqual({ healthy: 2, watch: 1, atRisk: 1, na: 1 });
  });
});

describe('mean (proposal 0073)', () => {
  it('returns the rounded mean of non-null values', () => {
    expect(mean([80, 90, 100])).toBe(90);
    expect(mean([50, 55])).toBe(53); // 52.5 -> 53
  });

  it('ignores null values', () => {
    expect(mean([100, null, 50])).toBe(75);
  });

  it('returns null when there are no non-null values', () => {
    expect(mean([null, null])).toBeNull();
    expect(mean([])).toBeNull();
  });
});

describe('supportLoad (proposal 0076)', () => {
  it('is support / totalItems as a rounded percentage', () => {
    expect(supportLoad(8, 30)).toBe(27); // 26.66 -> 27
    expect(supportLoad(5, 10)).toBe(50);
    expect(supportLoad(0, 12)).toBe(0);
  });

  it('returns 0 when there are no items (avoids divide-by-zero)', () => {
    expect(supportLoad(0, 0)).toBe(0);
    expect(supportLoad(3, 0)).toBe(0);
  });
});
