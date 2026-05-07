import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  classifyDeploymentFrequency,
  classifyLeadTime,
  classifyChangeFailureRate,
  classifyMTTR,
  bandColor,
  type DoraBand,
} from './dora-bands';

// Cross-suite boundary fixture (proposal 0052) — same JSON consumed by the
// backend Jest spec at backend/src/metrics/dora-bands.spec.ts. Loaded via
// fs so the two suites cannot drift through diverging tsconfig settings.
interface FixtureCase {
  value: number;
  expected: DoraBand;
  note: string;
}

interface Fixture {
  deploymentFrequency: FixtureCase[];
  leadTime: FixtureCase[];
  changeFailureRate: FixtureCase[];
  mttr: FixtureCase[];
}

// __dirname is frontend/src/lib at runtime; fixture is at <repo>/docs/dora-bands-fixture.json.
const fixturePath = path.join(__dirname, '..', '..', '..', 'docs', 'dora-bands-fixture.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('DORA band classifiers — boundary fixture (proposal 0052)', () => {
  describe('classifyDeploymentFrequency', () => {
    it.each(fixture.deploymentFrequency)(
      'value=$value -> $expected ($note)',
      ({ value, expected }) => {
        expect(classifyDeploymentFrequency(value)).toBe(expected);
      },
    );
  });

  describe('classifyLeadTime', () => {
    it.each(fixture.leadTime)('value=$value -> $expected ($note)', ({ value, expected }) => {
      expect(classifyLeadTime(value)).toBe(expected);
    });
  });

  describe('classifyChangeFailureRate', () => {
    it.each(fixture.changeFailureRate)(
      'value=$value -> $expected ($note)',
      ({ value, expected }) => {
        expect(classifyChangeFailureRate(value)).toBe(expected);
      },
    );
  });

  describe('classifyMTTR', () => {
    it.each(fixture.mttr)('value=$value -> $expected ($note)', ({ value, expected }) => {
      expect(classifyMTTR(value)).toBe(expected);
    });
  });
});

// ---------------------------------------------------------------------------
// Mid-band sanity tests (no boundary values) and bandColor coverage —
// retained from the original spec.
// ---------------------------------------------------------------------------

describe('classifyDeploymentFrequency — mid-band sanity', () => {
  it('returns elite for clearly daily+', () => {
    expect(classifyDeploymentFrequency(5)).toBe('elite');
  });

  it('returns low for zero', () => {
    expect(classifyDeploymentFrequency(0)).toBe('low');
  });
});

describe('classifyLeadTime — mid-band sanity', () => {
  it('returns elite for sub-day', () => {
    expect(classifyLeadTime(0.5)).toBe('elite');
  });

  it('returns low for multi-month', () => {
    expect(classifyLeadTime(90)).toBe('low');
  });
});

describe('classifyChangeFailureRate — mid-band sanity', () => {
  it('returns low for very high failure rates', () => {
    expect(classifyChangeFailureRate(20)).toBe('low');
  });
});

describe('classifyMTTR — mid-band sanity', () => {
  it('returns low for week-long recovery', () => {
    expect(classifyMTTR(200)).toBe('low');
  });
});

describe('bandColor', () => {
  it('returns green classes for elite', () => {
    expect(bandColor('elite')).toContain('green');
  });

  it('returns blue classes for high', () => {
    expect(bandColor('high')).toContain('blue');
  });

  it('returns amber classes for medium', () => {
    expect(bandColor('medium')).toContain('amber');
  });

  it('returns red classes for low', () => {
    expect(bandColor('low')).toContain('red');
  });

  it('returns bg, text, and border classes for each band', () => {
    const bands: DoraBand[] = ['elite', 'high', 'medium', 'low'];
    for (const band of bands) {
      const classes = bandColor(band);
      expect(classes).toMatch(/text-/);
      expect(classes).toMatch(/bg-/);
      expect(classes).toMatch(/border-/);
    }
  });
});
