import {
  quarterToDates,
  listRecentQuarters,
  windowToDates,
  listRollingBuckets,
} from './period-utils.js';

describe('quarterToDates', () => {
  it('returns Q1 dates for 2026-Q1 in UTC', () => {
    const { label, startDate, endDate } = quarterToDates('2026-Q1', 'UTC');
    expect(label).toBe('2026-Q1');
    expect(startDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    // End date should be 23:59:59.999 on March 31
    expect(endDate.toISOString()).toBe('2026-03-31T23:59:59.999Z');
  });

  it('returns Q2 dates for 2026-Q2 in UTC', () => {
    const { startDate, endDate } = quarterToDates('2026-Q2', 'UTC');
    expect(startDate.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2026-06-30T23:59:59.999Z');
  });

  it('returns Q3 dates for 2025-Q3 in UTC', () => {
    const { startDate, endDate } = quarterToDates('2025-Q3', 'UTC');
    expect(startDate.toISOString()).toBe('2025-07-01T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2025-09-30T23:59:59.999Z');
  });

  it('returns Q4 dates for 2025-Q4 in UTC (tests Dec 31 end)', () => {
    const { startDate, endDate } = quarterToDates('2025-Q4', 'UTC');
    expect(startDate.toISOString()).toBe('2025-10-01T00:00:00.000Z');
    expect(endDate.toISOString()).toBe('2025-12-31T23:59:59.999Z');
  });

  it('handles Q4 → Q1 year boundary: start of next quarter is Jan 1 next year', () => {
    const { endDate } = quarterToDates('2025-Q4', 'UTC');
    const nextStart = new Date(endDate.getTime() + 1);
    expect(nextStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns fallback (last 90 days) for invalid quarter label', () => {
    const before = new Date();
    const { label, startDate, endDate } = quarterToDates('invalid');
    const after = new Date();
    expect(label).toBe('invalid');
    // endDate should be approximately now
    expect(endDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
    expect(endDate.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
    // startDate should be approximately 90 days before endDate
    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(diffDays)).toBe(90);
  });

  it('handles positive UTC offset timezone correctly for Q1', () => {
    // Asia/Kolkata (UTC+5:30) — midnight IST Jan 1 = 18:30 UTC Dec 31 prior
    const { startDate } = quarterToDates('2026-Q1', 'Asia/Kolkata');
    expect(startDate.toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  it('handles negative UTC offset timezone correctly for Q1', () => {
    // America/New_York (UTC-5 in winter / EST): midnight on Jan 1 2026 in New York
    // is 05:00 UTC (UTC-5), not 2025-12-31T05:00:00Z.
    // The old broken midnightInTz algorithm returned 2025-12-31T05:00:00Z due to
    // a sign error.  Fix A-1 (Proposal 0030) corrects this.
    const { startDate } = quarterToDates('2026-Q1', 'America/New_York');
    expect(startDate.toISOString()).toBe('2026-01-01T05:00:00.000Z');
  });
});

describe('listRecentQuarters', () => {
  it('returns n quarters newest first', () => {
    const quarters = listRecentQuarters(4, 'UTC');
    expect(quarters).toHaveLength(4);
    // Each quarter's endDate should be >= the next quarter's endDate
    for (let i = 0; i < quarters.length - 1; i++) {
      expect(quarters[i].startDate.getTime()).toBeGreaterThan(
        quarters[i + 1].startDate.getTime(),
      );
    }
  });

  it('returns labels in YYYY-QN format', () => {
    const quarters = listRecentQuarters(4, 'UTC');
    for (const q of quarters) {
      expect(q.label).toMatch(/^\d{4}-Q[1-4]$/);
    }
  });

  it('first quarter includes today', () => {
    const now = new Date();
    const [first] = listRecentQuarters(1, 'UTC');
    expect(first.startDate.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(first.endDate.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it('returns 1 quarter when n=1', () => {
    const quarters = listRecentQuarters(1, 'UTC');
    expect(quarters).toHaveLength(1);
  });

  it('consecutive quarters are adjacent (no gaps)', () => {
    const quarters = listRecentQuarters(4, 'UTC');
    for (let i = 0; i < quarters.length - 1; i++) {
      // The end of quarters[i+1] + 1ms should equal the start of quarters[i]
      const gapMs = quarters[i].startDate.getTime() - quarters[i + 1].endDate.getTime();
      expect(gapMs).toBe(1); // exactly 1ms gap (23:59:59.999 → 00:00:00.000)
    }
  });
});

describe('windowToDates', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Fixed "now": 2026-08-11T03:00:00Z. In UTC this is 2026-08-11.
    jest.setSystemTime(new Date('2026-08-11T03:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ends at 23:59:59.999 yesterday and spans N full days (UTC, 7d)', () => {
    const { startDate, endDate } = windowToDates(7, 'UTC');
    // Window ends at the last full day (yesterday = Aug 10)
    expect(endDate.toISOString()).toBe('2026-08-10T23:59:59.999Z');
    // 7 full days ending Aug 10 → starts Aug 04 00:00
    expect(startDate.toISOString()).toBe('2026-08-04T00:00:00.000Z');
  });

  it('spans 30 full days ending yesterday (UTC)', () => {
    const { startDate, endDate } = windowToDates(30, 'UTC');
    expect(endDate.toISOString()).toBe('2026-08-10T23:59:59.999Z');
    // 30 full days ending Aug 10 → starts Jul 12 00:00
    expect(startDate.toISOString()).toBe('2026-07-12T00:00:00.000Z');
  });

  it('spans 90 full days ending yesterday (UTC)', () => {
    const { startDate, endDate } = windowToDates(90, 'UTC');
    expect(endDate.toISOString()).toBe('2026-08-10T23:59:59.999Z');
    // 90 full days ending Aug 10 → starts May 13 00:00
    expect(startDate.toISOString()).toBe('2026-05-13T00:00:00.000Z');
  });

  it('uses the configured timezone for day boundaries (Australia/Sydney, 7d)', () => {
    // now = 2026-08-11T03:00:00Z = 2026-08-11 13:00 in Sydney (UTC+10, no DST in Aug).
    // "Yesterday" in Sydney is Aug 10; end = 2026-08-10T23:59:59.999 Sydney = 2026-08-10T13:59:59.999Z
    const { startDate, endDate } = windowToDates(7, 'Australia/Sydney');
    expect(endDate.toISOString()).toBe('2026-08-10T13:59:59.999Z');
    // start = 2026-08-04T00:00:00 Sydney = 2026-08-03T14:00:00.000Z
    expect(startDate.toISOString()).toBe('2026-08-03T14:00:00.000Z');
  });

  it('window end + 1ms equals start-of-today in tz', () => {
    const { endDate } = windowToDates(30, 'UTC');
    const startOfToday = new Date(endDate.getTime() + 1);
    expect(startOfToday.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });
});

describe('listRollingBuckets', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-11T03:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 7 daily buckets for a 7-day window (oldest first)', () => {
    const buckets = listRollingBuckets(7, 'UTC');
    expect(buckets).toHaveLength(7);
    expect(buckets[0].startDate.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    expect(buckets[0].endDate.toISOString()).toBe('2026-08-04T23:59:59.999Z');
    expect(buckets[6].startDate.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(buckets[6].endDate.toISOString()).toBe('2026-08-10T23:59:59.999Z');
  });

  it('returns 30 daily buckets for a 30-day window', () => {
    const buckets = listRollingBuckets(30, 'UTC');
    expect(buckets).toHaveLength(30);
    expect(buckets[0].startDate.toISOString()).toBe('2026-07-12T00:00:00.000Z');
    expect(buckets[29].endDate.toISOString()).toBe('2026-08-10T23:59:59.999Z');
  });

  it('returns weekly buckets for a 90-day window', () => {
    const buckets = listRollingBuckets(90, 'UTC');
    // 90 days / 7 = 12.86 → 13 buckets (last one short)
    expect(buckets).toHaveLength(13);
    // First bucket starts at window start
    expect(buckets[0].startDate.toISOString()).toBe('2026-05-13T00:00:00.000Z');
    // Last bucket ends at window end (yesterday)
    expect(buckets[buckets.length - 1].endDate.toISOString()).toBe(
      '2026-08-10T23:59:59.999Z',
    );
  });

  it('buckets are contiguous with a 1ms gap and non-overlapping', () => {
    const buckets = listRollingBuckets(30, 'UTC');
    for (let i = 0; i < buckets.length - 1; i++) {
      const gapMs = buckets[i + 1].startDate.getTime() - buckets[i].endDate.getTime();
      expect(gapMs).toBe(1);
    }
  });

  it('each bucket has a label', () => {
    const buckets = listRollingBuckets(7, 'UTC');
    for (const b of buckets) {
      expect(typeof b.label).toBe('string');
      expect(b.label.length).toBeGreaterThan(0);
    }
  });
});
