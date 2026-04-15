/**
 * Unit tests for WorkingTimeService — pure calculation methods.
 *
 * The service is instantiated directly (no NestJS module) with mocked
 * dependencies.  All assertions target workingHoursBetween() and
 * workingDaysBetween() directly.
 *
 * Algorithm summary:
 *   - workingHoursBetween accumulates the wall-clock hours that fall on
 *     working calendar days (workDays, minus holidays) in the configured tz.
 *   - workingDaysBetween = workingHoursBetween / hoursPerDay.
 *   - A full calendar day contributes 24h; a partial day contributes the
 *     portion that overlaps with [start, end].
 */

import { WorkingTimeService, type WorkingTimeConfig } from './working-time.service.js';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WorkingTimeConfigEntity } from '../database/entities/index.js';

function buildService(): WorkingTimeService {
  const repo = {
    findOne: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<Repository<WorkingTimeConfigEntity>>;

  const configService = {
    get: jest.fn().mockImplementation((key: string, def?: unknown) => {
      if (key === 'TIMEZONE') return 'UTC';
      return def ?? '';
    }),
  } as unknown as jest.Mocked<ConfigService>;

  return new WorkingTimeService(repo, configService);
}

// Convenience: Mon–Fri work week, 8 h/day, no holidays, UTC
const MON_FRI_UTC: WorkingTimeConfig = {
  timezone: 'UTC',
  workDays: [1, 2, 3, 4, 5], // Mon=1 … Fri=5
  hoursPerDay: 8,
  holidays: [],
};

describe('WorkingTimeService — workingHoursBetween', () => {
  let service: WorkingTimeService;

  beforeEach(() => {
    service = buildService();
  });

  it('returns 0 when start === end', () => {
    const t = new Date('2026-04-13T10:00:00Z'); // Monday
    expect(service.workingHoursBetween(t, t, MON_FRI_UTC)).toBe(0);
  });

  it('returns 0 when start is after end', () => {
    const a = new Date('2026-04-14T00:00:00Z');
    const b = new Date('2026-04-13T00:00:00Z');
    expect(service.workingHoursBetween(a, b, MON_FRI_UTC)).toBe(0);
  });

  it('returns 24 for a full Monday (Mon 00:00 → Tue 00:00 UTC)', () => {
    // 2026-04-13 is a Monday
    const start = new Date('2026-04-13T00:00:00Z');
    const end = new Date('2026-04-14T00:00:00Z');
    expect(service.workingHoursBetween(start, end, MON_FRI_UTC)).toBe(24);
  });

  it('returns 24 for Fri 00:00 → Mon 00:00 UTC (only Friday is a work day)', () => {
    // 2026-04-17 is a Friday, 2026-04-20 is a Monday
    const start = new Date('2026-04-17T00:00:00Z');
    const end = new Date('2026-04-20T00:00:00Z');
    // Fri=24h, Sat=0h, Sun=0h
    expect(service.workingHoursBetween(start, end, MON_FRI_UTC)).toBe(24);
  });

  it('returns 0 for a full Saturday', () => {
    // 2026-04-18 is a Saturday
    const start = new Date('2026-04-18T00:00:00Z');
    const end = new Date('2026-04-19T00:00:00Z');
    expect(service.workingHoursBetween(start, end, MON_FRI_UTC)).toBe(0);
  });

  it('returns 12 for Fri 18:00 → Mon 06:00 UTC (6h Fri + 6h Mon)', () => {
    // 2026-04-17 Fri, 2026-04-20 Mon
    const start = new Date('2026-04-17T18:00:00Z');
    const end = new Date('2026-04-20T06:00:00Z');
    // Fri: 18:00–24:00 = 6h; Sat: 0; Sun: 0; Mon: 00:00–06:00 = 6h
    expect(service.workingHoursBetween(start, end, MON_FRI_UTC)).toBe(12);
  });

  it('excludes a holiday on Monday — span Mon 00:00 → Tue 00:00 returns 0', () => {
    // 2026-04-13 Monday is a holiday
    const config: WorkingTimeConfig = {
      ...MON_FRI_UTC,
      holidays: ['2026-04-13'],
    };
    const start = new Date('2026-04-13T00:00:00Z');
    const end = new Date('2026-04-14T00:00:00Z');
    expect(service.workingHoursBetween(start, end, config)).toBe(0);
  });

  it('non-holiday Tuesday is unaffected by Monday holiday', () => {
    const config: WorkingTimeConfig = {
      ...MON_FRI_UTC,
      holidays: ['2026-04-13'],
    };
    const start = new Date('2026-04-14T00:00:00Z'); // Tuesday
    const end = new Date('2026-04-15T00:00:00Z');
    expect(service.workingHoursBetween(start, end, config)).toBe(24);
  });

  it('handles a Sun–Thu work week: Sunday counts', () => {
    const sunThuConfig: WorkingTimeConfig = {
      ...MON_FRI_UTC,
      workDays: [0, 1, 2, 3, 4], // Sun=0, Mon=1, …, Thu=4
    };
    // 2026-04-19 is a Sunday — should count
    const start = new Date('2026-04-19T00:00:00Z');
    const end = new Date('2026-04-20T00:00:00Z');
    expect(service.workingHoursBetween(start, end, sunThuConfig)).toBe(24);
  });

  it('handles a Sun–Thu work week: Saturday does not count', () => {
    const sunThuConfig: WorkingTimeConfig = {
      ...MON_FRI_UTC,
      workDays: [0, 1, 2, 3, 4],
    };
    // 2026-04-18 is a Saturday — should NOT count
    const start = new Date('2026-04-18T00:00:00Z');
    const end = new Date('2026-04-19T00:00:00Z');
    expect(service.workingHoursBetween(start, end, sunThuConfig)).toBe(0);
  });
});

describe('WorkingTimeService — workingDaysBetween', () => {
  let service: WorkingTimeService;

  beforeEach(() => {
    service = buildService();
  });

  it('returns 0 when start === end', () => {
    const t = new Date('2026-04-13T10:00:00Z');
    expect(service.workingDaysBetween(t, t, MON_FRI_UTC)).toBe(0);
  });

  it('returns 3.0 for full Monday (24h ÷ 8 h/day = 3.0)', () => {
    // 2026-04-13 is a Monday
    const start = new Date('2026-04-13T00:00:00Z');
    const end = new Date('2026-04-14T00:00:00Z');
    expect(service.workingDaysBetween(start, end, MON_FRI_UTC)).toBe(3);
  });

  it('returns 3.0 for Fri 00:00 → Mon 00:00 (only Friday: 24h ÷ 8 = 3.0)', () => {
    // 2026-04-17 Fri, 2026-04-20 Mon
    const start = new Date('2026-04-17T00:00:00Z');
    const end = new Date('2026-04-20T00:00:00Z');
    expect(service.workingDaysBetween(start, end, MON_FRI_UTC)).toBe(3);
  });

  it('returns 0 for full Saturday', () => {
    const start = new Date('2026-04-18T00:00:00Z');
    const end = new Date('2026-04-19T00:00:00Z');
    expect(service.workingDaysBetween(start, end, MON_FRI_UTC)).toBe(0);
  });

  it('returns 1.5 for Fri 18:00 → Mon 06:00 UTC (12h ÷ 8 = 1.5)', () => {
    const start = new Date('2026-04-17T18:00:00Z');
    const end = new Date('2026-04-20T06:00:00Z');
    expect(service.workingDaysBetween(start, end, MON_FRI_UTC)).toBe(1.5);
  });

  it('returns 0 when Monday is a holiday and span is Mon 00:00 → Tue 00:00', () => {
    const config: WorkingTimeConfig = {
      ...MON_FRI_UTC,
      holidays: ['2026-04-13'],
    };
    const start = new Date('2026-04-13T00:00:00Z');
    const end = new Date('2026-04-14T00:00:00Z');
    expect(service.workingDaysBetween(start, end, config)).toBe(0);
  });

  it('returns 0 when hoursPerDay is 0 (guard against divide-by-zero)', () => {
    const config: WorkingTimeConfig = { ...MON_FRI_UTC, hoursPerDay: 0 };
    const start = new Date('2026-04-13T00:00:00Z');
    const end = new Date('2026-04-14T00:00:00Z');
    expect(service.workingDaysBetween(start, end, config)).toBe(0);
  });
});

describe('WorkingTimeService — getConfig / toConfig', () => {
  it('returns in-memory default when no DB row found', async () => {
    const service = buildService();
    const entity = await service.getConfig();
    expect(entity.id).toBe(1);
    expect(entity.excludeWeekends).toBe(true);
    expect(entity.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(entity.hoursPerDay).toBe(8);
    expect(entity.holidays).toEqual([]);
  });

  it('toConfig enriches entity with timezone from ConfigService', () => {
    const service = buildService();
    const entity = Object.assign(new WorkingTimeConfigEntity(), {
      id: 1,
      excludeWeekends: true,
      workDays: [1, 2, 3, 4, 5],
      hoursPerDay: 8,
      holidays: ['2026-01-01'],
    });
    const config = service.toConfig(entity);
    expect(config.timezone).toBe('UTC');
    expect(config.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(config.hoursPerDay).toBe(8);
    expect(config.holidays).toEqual(['2026-01-01']);
  });
});
