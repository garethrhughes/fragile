import {
  classifyDeploymentFrequency,
  classifyLeadTime,
  classifyChangeFailureRate,
  classifyMTTR,
} from './dora-bands.js';

describe('DORA Band Classification', () => {
  describe('classifyDeploymentFrequency', () => {
    it('should classify elite (at least daily)', () => {
      expect(classifyDeploymentFrequency(3)).toBe('elite');
      expect(classifyDeploymentFrequency(2)).toBe('elite');
      expect(classifyDeploymentFrequency(1)).toBe('elite');
    });

    it('should classify high (less than daily but at least weekly)', () => {
      expect(classifyDeploymentFrequency(0.5)).toBe('high');
      expect(classifyDeploymentFrequency(1 / 7)).toBe('high');
    });

    it('should classify medium (weekly to monthly)', () => {
      expect(classifyDeploymentFrequency(0.1)).toBe('medium');
      expect(classifyDeploymentFrequency(1 / 30)).toBe('medium');
    });

    it('should classify low (less than monthly)', () => {
      expect(classifyDeploymentFrequency(0.01)).toBe('low');
      expect(classifyDeploymentFrequency(0)).toBe('low');
    });
  });

  describe('classifyLeadTime', () => {
    it('should classify elite (< 1 day)', () => {
      expect(classifyLeadTime(0.5)).toBe('elite');
      expect(classifyLeadTime(0)).toBe('elite');
    });

    it('should classify high (1 day - 1 week)', () => {
      expect(classifyLeadTime(1)).toBe('high');
      expect(classifyLeadTime(5)).toBe('high');
      expect(classifyLeadTime(7)).toBe('high');
    });

    it('should classify medium (1 week - 1 month)', () => {
      expect(classifyLeadTime(14)).toBe('medium');
      expect(classifyLeadTime(30)).toBe('medium');
    });

    it('should classify low (> 1 month)', () => {
      expect(classifyLeadTime(31)).toBe('low');
      expect(classifyLeadTime(90)).toBe('low');
    });
  });

  describe('classifyChangeFailureRate', () => {
    it('should classify elite (0-5%)', () => {
      expect(classifyChangeFailureRate(0)).toBe('elite');
      expect(classifyChangeFailureRate(3)).toBe('elite');
      expect(classifyChangeFailureRate(5)).toBe('elite');
    });

    it('should classify high (5-10%)', () => {
      expect(classifyChangeFailureRate(7)).toBe('high');
      expect(classifyChangeFailureRate(10)).toBe('high');
    });

    it('should classify medium (10-15%)', () => {
      expect(classifyChangeFailureRate(12)).toBe('medium');
      expect(classifyChangeFailureRate(15)).toBe('medium');
    });

    it('should classify low (> 15%)', () => {
      expect(classifyChangeFailureRate(16)).toBe('low');
      expect(classifyChangeFailureRate(50)).toBe('low');
    });
  });

  describe('classifyMTTR', () => {
    it('should classify elite (< 1 hour)', () => {
      expect(classifyMTTR(0)).toBe('elite');
      expect(classifyMTTR(0.5)).toBe('elite');
    });

    it('should classify high (< 1 day)', () => {
      expect(classifyMTTR(1)).toBe('high');
      expect(classifyMTTR(12)).toBe('high');
      expect(classifyMTTR(23)).toBe('high');
    });

    it('should classify medium (< 1 week)', () => {
      expect(classifyMTTR(24)).toBe('medium');
      expect(classifyMTTR(100)).toBe('medium');
      expect(classifyMTTR(167)).toBe('medium');
    });

    it('should classify low (> 1 week)', () => {
      expect(classifyMTTR(168)).toBe('low');
      expect(classifyMTTR(500)).toBe('low');
    });
  });
});
