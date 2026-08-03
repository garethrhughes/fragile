import { describe, it, expect } from '@jest/globals';
import {
  classifyStabilityBand,
  classifyRoadmapBand,
  classifySupportBand,
} from './healthcheck-bands.js';

describe('classifyStabilityBand (higher is better)', () => {
  it('returns null for a null (N/A) score', () => {
    expect(classifyStabilityBand(null)).toBeNull();
  });
  it('green at or above 80', () => {
    expect(classifyStabilityBand(80)).toBe('green');
    expect(classifyStabilityBand(95)).toBe('green');
  });
  it('amber between 60 and 80', () => {
    expect(classifyStabilityBand(60)).toBe('amber');
    expect(classifyStabilityBand(79.99)).toBe('amber');
  });
  it('red below 60', () => {
    expect(classifyStabilityBand(59.99)).toBe('red');
    expect(classifyStabilityBand(0)).toBe('red');
  });
});

describe('classifyRoadmapBand (target-relative, higher is better)', () => {
  it('returns null for a null (N/A) score', () => {
    expect(classifyRoadmapBand(null, 80)).toBeNull();
  });
  it('green at or above the target', () => {
    expect(classifyRoadmapBand(80, 80)).toBe('green');
    expect(classifyRoadmapBand(50, 50)).toBe('green'); // PLAT target
  });
  it('amber at or above 60% of target but below target', () => {
    expect(classifyRoadmapBand(48, 80)).toBe('amber'); // 60% of 80 = 48
    expect(classifyRoadmapBand(79, 80)).toBe('amber');
  });
  it('red below 60% of target', () => {
    expect(classifyRoadmapBand(47.99, 80)).toBe('red');
  });
});

describe('classifySupportBand (burden — lower is better)', () => {
  it('returns null for a null (N/A) score', () => {
    expect(classifySupportBand(null)).toBeNull();
  });
  it('green at or below 20', () => {
    expect(classifySupportBand(20)).toBe('green');
    expect(classifySupportBand(0)).toBe('green');
  });
  it('amber above 20 up to 40', () => {
    expect(classifySupportBand(20.01)).toBe('amber');
    expect(classifySupportBand(40)).toBe('amber');
  });
  it('red above 40', () => {
    expect(classifySupportBand(40.01)).toBe('red');
    expect(classifySupportBand(100)).toBe('red');
  });
});
