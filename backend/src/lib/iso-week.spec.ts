import { dateToIsoWeekKey, isoWeekKeyToDates } from './iso-week.js';

describe('dateToIsoWeekKey', () => {
  // ---------------------------------------------------------------------------
  // Regression: A-1 (proposal 0055) — Sunday year-boundary bug
  // ---------------------------------------------------------------------------

  it('Sunday 2023-12-31 maps to 2023-W52, not 2024-W01 (A-1 regression)', () => {
    const sun = new Date(Date.UTC(2023, 11, 31));
    expect(dateToIsoWeekKey(sun, 'UTC')).toBe('2023-W52');
  });

  it('Saturday 2023-12-30 also maps to 2023-W52', () => {
    const sat = new Date(Date.UTC(2023, 11, 30));
    expect(dateToIsoWeekKey(sat, 'UTC')).toBe('2023-W52');
  });

  it('Monday 2024-01-01 maps to 2024-W01', () => {
    const mon = new Date(Date.UTC(2024, 0, 1));
    expect(dateToIsoWeekKey(mon, 'UTC')).toBe('2024-W01');
  });

  // ---------------------------------------------------------------------------
  // ISO year boundary cases
  // ---------------------------------------------------------------------------

  it('Sunday 2018-12-30 maps to 2018-W52', () => {
    // 2018-12-31 is a Monday in week 1 of 2019; 30th Sunday is week 52 of 2018
    expect(dateToIsoWeekKey(new Date(Date.UTC(2018, 11, 30)), 'UTC')).toBe(
      '2018-W52',
    );
  });

  it('Monday 2018-12-31 maps to 2019-W01', () => {
    expect(dateToIsoWeekKey(new Date(Date.UTC(2018, 11, 31)), 'UTC')).toBe(
      '2019-W01',
    );
  });

  it('Friday 2021-01-01 maps to 2020-W53 (ISO long year)', () => {
    // 2020 is an ISO long year (53 weeks); Jan 1 2021 (Friday) is in 2020-W53
    expect(dateToIsoWeekKey(new Date(Date.UTC(2021, 0, 1)), 'UTC')).toBe(
      '2020-W53',
    );
  });

  it('Sunday 2021-01-03 maps to 2020-W53', () => {
    expect(dateToIsoWeekKey(new Date(Date.UTC(2021, 0, 3)), 'UTC')).toBe(
      '2020-W53',
    );
  });

  it('Monday 2021-01-04 maps to 2021-W01', () => {
    expect(dateToIsoWeekKey(new Date(Date.UTC(2021, 0, 4)), 'UTC')).toBe(
      '2021-W01',
    );
  });

  // ---------------------------------------------------------------------------
  // Mid-year sanity
  // ---------------------------------------------------------------------------

  it('mid-year date maps correctly', () => {
    // 2026-05-06 is a Wednesday in week 19 of 2026
    expect(dateToIsoWeekKey(new Date(Date.UTC(2026, 4, 6)), 'UTC')).toBe(
      '2026-W19',
    );
  });

  // ---------------------------------------------------------------------------
  // Timezone interpretation
  // ---------------------------------------------------------------------------

  it('respects the supplied timezone when bucketing', () => {
    // 2023-12-31 23:30 UTC is 2024-01-01 10:30 in Sydney → ISO week of 2024-W01
    const d = new Date(Date.UTC(2023, 11, 31, 23, 30));
    expect(dateToIsoWeekKey(d, 'Australia/Sydney')).toBe('2024-W01');
    // …same instant under UTC is still in 2023-W52
    expect(dateToIsoWeekKey(d, 'UTC')).toBe('2023-W52');
  });
});

describe('isoWeekKeyToDates', () => {
  it('W20 2026 in UTC starts Mon 11 May 00:00 UTC and ends Sun 17 May 23:59:59 UTC', () => {
    const { weekStart, weekEnd } = isoWeekKeyToDates('2026-W20', 'UTC');
    expect(weekStart.toISOString()).toBe('2026-05-11T00:00:00.000Z');
    expect(weekEnd.toISOString()).toBe('2026-05-17T23:59:59.999Z');
  });

  it('W20 2026 in Australia/Sydney starts Sun 10 May 14:00 UTC (Mon 11 May 00:00 AEST)', () => {
    // This is the critical test — Mon 11 May 00:00 AEST = Sun 10 May 14:00 UTC
    // Planning was computing Mon 11 May 00:00 UTC, missing completions that
    // happened between 14:00-24:00 UTC on Sunday.
    const { weekStart, weekEnd } = isoWeekKeyToDates('2026-W20', 'Australia/Sydney');
    expect(weekStart.toISOString()).toBe('2026-05-10T14:00:00.000Z');
    expect(weekEnd.toISOString()).toBe('2026-05-17T13:59:59.999Z');
  });

  it('throws on invalid week format', () => {
    expect(() => isoWeekKeyToDates('invalid')).toThrow();
  });
});
