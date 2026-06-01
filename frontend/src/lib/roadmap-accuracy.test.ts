import { describe, it, expect } from 'vitest';
import {
  deriveOnRoadmapLate,
  deriveOffRoadmap,
  computeOnRoadmapPercent,
  computeAggregateOnRoadmapPercent,
} from './roadmap-accuracy';

describe('roadmap-accuracy helpers', () => {
  describe('deriveOnRoadmapLate', () => {
    it('returns linkedCount minus coveredIssues', () => {
      expect(deriveOnRoadmapLate({ linkedCount: 10, coveredIssues: 7 })).toBe(3);
    });

    it('returns 0 when linkedCount equals coveredIssues', () => {
      expect(deriveOnRoadmapLate({ linkedCount: 5, coveredIssues: 5 })).toBe(0);
    });

    it('returns 0 when both are zero', () => {
      expect(deriveOnRoadmapLate({ linkedCount: 0, coveredIssues: 0 })).toBe(0);
    });
  });

  describe('deriveOffRoadmap', () => {
    it('returns totalIssues minus linkedCount', () => {
      expect(deriveOffRoadmap({ totalIssues: 15, linkedCount: 10 })).toBe(5);
    });

    it('returns 0 when all issues are linked', () => {
      expect(deriveOffRoadmap({ totalIssues: 8, linkedCount: 8 })).toBe(0);
    });

    it('returns totalIssues when none are linked', () => {
      expect(deriveOffRoadmap({ totalIssues: 12, linkedCount: 0 })).toBe(12);
    });
  });

  describe('computeOnRoadmapPercent', () => {
    it('returns linkedCount / totalIssues * 100 rounded to 2 decimals', () => {
      // 10/15 = 66.666... → 66.67
      expect(computeOnRoadmapPercent({ linkedCount: 10, totalIssues: 15 })).toBe(66.67);
    });

    it('returns 100 when all issues are linked', () => {
      expect(computeOnRoadmapPercent({ linkedCount: 7, totalIssues: 7 })).toBe(100);
    });

    it('returns 0 when no issues are linked', () => {
      expect(computeOnRoadmapPercent({ linkedCount: 0, totalIssues: 10 })).toBe(0);
    });

    it('returns 0 when totalIssues is 0', () => {
      expect(computeOnRoadmapPercent({ linkedCount: 0, totalIssues: 0 })).toBe(0);
    });
  });

  describe('computeAggregateOnRoadmapPercent', () => {
    it('computes weighted mean across multiple rows', () => {
      const rows = [
        { totalIssues: 15, linkedCount: 10, coveredIssues: 7 },
        { totalIssues: 7, linkedCount: 3, coveredIssues: 3 },
      ];
      // total linked = 13, total issues = 22 → 13/22 = 59.09%
      expect(computeAggregateOnRoadmapPercent(rows)).toBe(59.09);
    });

    it('returns 0 for empty array', () => {
      expect(computeAggregateOnRoadmapPercent([])).toBe(0);
    });

    it('returns 0 when all rows have 0 totalIssues', () => {
      const rows = [
        { totalIssues: 0, linkedCount: 0, coveredIssues: 0 },
      ];
      expect(computeAggregateOnRoadmapPercent(rows)).toBe(0);
    });
  });
});
