import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyDeploymentFrequency,
  classifyLeadTime,
  classifyChangeFailureRate,
  classifyMTTR,
  type DoraBand,
} from './dora-bands.js';

// Cross-suite boundary fixture (proposal 0052). Loaded at runtime via fs so
// no tsconfig changes are required (rootDir is `src` and the fixture lives
// in `docs/`). The frontend test (`frontend/src/lib/dora-bands.test.ts`)
// loads the same file — both suites must agree.
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

const fixturePath = join(__dirname, '..', '..', '..', 'docs', 'dora-bands-fixture.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('DORA Band Classification — boundary fixture (proposal 0052)', () => {
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
// Mid-band sanity tests retained from the original spec — these do not
// touch boundary values and provide quick regression coverage independent
// of the fixture.
// ---------------------------------------------------------------------------

describe('DORA Band Classification — mid-band sanity', () => {
  describe('classifyDeploymentFrequency', () => {
    it('classifies clearly elite values', () => {
      expect(classifyDeploymentFrequency(3)).toBe('elite');
    });

    it('classifies clearly low values', () => {
      expect(classifyDeploymentFrequency(0)).toBe('low');
    });
  });

  describe('classifyLeadTime', () => {
    it('classifies sub-day as elite', () => {
      expect(classifyLeadTime(0.5)).toBe('elite');
    });

    it('classifies multi-month as low', () => {
      expect(classifyLeadTime(90)).toBe('low');
    });
  });

  describe('classifyChangeFailureRate', () => {
    it('classifies very high failure rates as low', () => {
      expect(classifyChangeFailureRate(50)).toBe('low');
    });
  });

  describe('classifyMTTR', () => {
    it('classifies week-long recovery as low', () => {
      expect(classifyMTTR(500)).toBe('low');
    });
  });
});
