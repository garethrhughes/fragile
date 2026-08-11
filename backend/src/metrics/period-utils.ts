/**
 * Utilities for working with calendar quarters used by the trend endpoint.
 */

import { dateParts, midnightInTz, startOfDayInTz } from './tz-utils.js';

export interface QuarterDates {
  label: string;    // e.g. "2026-Q1"
  startDate: Date;
  endDate: Date;
}

/** Rolling time-period window lengths in days. */
export const TIME_PERIOD_WINDOWS = [7, 30, 90] as const;
export type TimePeriodWindow = (typeof TIME_PERIOD_WINDOWS)[number];

export interface PeriodBucket {
  label: string; // e.g. "2026-08-04" (daily) or "2026-05-13" (week start)
  startDate: Date;
  endDate: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Formats a Date as a YYYY-MM-DD label in the given timezone.
 */
function dayLabel(date: Date, tz: string): string {
  const { year, month, day } = dateParts(date, tz);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Returns the UTC instant for 00:00:00.000 today in `tz` (the start of the
 * current calendar day). Everything before this instant is a "full day".
 */
function startOfTodayInTz(tz: string): Date {
  const { year, month, day } = dateParts(new Date(), tz);
  return startOfDayInTz(year, month, day, tz);
}

/**
 * Converts a rolling time-period window (in days) to a start/end date range
 * that ends at the last FULL day in the given timezone.
 *
 * The window ends at 23:59:59.999 yesterday (in `tz`) and spans exactly `days`
 * full calendar days. E.g. windowToDates(7) evaluated on 2026-08-11 (UTC)
 * returns 2026-08-04T00:00:00.000Z → 2026-08-10T23:59:59.999Z.
 *
 * @param days - Window length in days (e.g. 7, 30, 90)
 * @param tz   - IANA timezone (default 'UTC')
 */
export function windowToDates(days: number, tz = 'UTC'): { startDate: Date; endDate: Date } {
  const startOfToday = startOfTodayInTz(tz);
  // endDate = 23:59:59.999 yesterday = start-of-today minus 1 ms.
  const endDate = new Date(startOfToday.getTime() - 1);
  // startDate = start of the day `days` days before today.
  // start-of-today minus `days` full days lands at 00:00 of the first day in window.
  const startDate = new Date(startOfToday.getTime() - days * MS_PER_DAY);
  return { startDate, endDate };
}

/**
 * Splits a rolling time-period window into buckets for a trend chart.
 * Bucket granularity depends on window length:
 *   - 7-day  window → 7 daily buckets
 *   - 30-day window → 30 daily buckets
 *   - 90-day window → weekly buckets (last bucket may be short)
 *
 * All buckets are contiguous (1ms gap), non-overlapping, ordered oldest → newest,
 * and collectively cover exactly the window returned by windowToDates(days, tz).
 *
 * @param days - Window length in days
 * @param tz   - IANA timezone (default 'UTC')
 */
export function listRollingBuckets(days: number, tz = 'UTC'): PeriodBucket[] {
  const { startDate, endDate } = windowToDates(days, tz);
  // Daily for short windows, weekly for the 90-day window.
  const bucketDays = days <= 30 ? 1 : 7;

  const buckets: PeriodBucket[] = [];
  let cursor = startDate.getTime();
  const windowEnd = endDate.getTime();

  while (cursor <= windowEnd) {
    const bucketStart = new Date(cursor);
    // Bucket end = start + bucketDays, minus 1 ms; clamp to the window end.
    const rawEnd = cursor + bucketDays * MS_PER_DAY - 1;
    const bucketEnd = new Date(Math.min(rawEnd, windowEnd));
    buckets.push({
      label: dayLabel(bucketStart, tz),
      startDate: bucketStart,
      endDate: bucketEnd,
    });
    cursor = bucketEnd.getTime() + 1;
  }

  return buckets;
}

/**
 * Converts a quarter label (e.g. "2026-Q1") to start/end Date objects.
 * Returns the last 90 days as a fallback for invalid input.
 *
 * @param quarter - Quarter label in YYYY-QN format
 * @param tz      - IANA timezone (default 'UTC')
 */
export function quarterToDates(quarter: string, tz = 'UTC'): QuarterDates {
  const match = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!match) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    return { label: quarter, startDate, endDate };
  }

  const year = parseInt(match[1], 10);
  const q = parseInt(match[2], 10);
  const startMonth = (q - 1) * 3; // 0-indexed

  const startDate = midnightInTz(year, startMonth, 1, tz);
  // Last day of quarter: first day of the next quarter minus one day.
  // We compute the next-quarter start in UTC first, then subtract one millisecond
  // so endDate lands at 23:59:59.999 on the last day of the quarter in tz.
  const nextQStartMonth = startMonth + 3; // may be 12 (Jan next year) — Date.UTC handles overflow
  const nextQYear = nextQStartMonth >= 12 ? year + 1 : year;
  const nextQMonth = nextQStartMonth >= 12 ? 0 : nextQStartMonth;
  const nextQStart = midnightInTz(nextQYear, nextQMonth, 1, tz);
  const endDate = new Date(nextQStart.getTime() - 1); // 23:59:59.999 last day of quarter

  return { label: quarter, startDate, endDate };
}

/**
 * Returns the N most recent quarters ending at or before today (inclusive of
 * the current in-progress quarter), newest first.
 *
 * E.g. called on 2026-04-11 (Q2 2026) with n=4 returns:
 *   ['2026-Q2', '2026-Q1', '2025-Q4', '2025-Q3']
 *
 * @param n  - Number of quarters to return
 * @param tz - IANA timezone (default 'UTC')
 */
export function listRecentQuarters(n: number, tz = 'UTC'): QuarterDates[] {
  const now = new Date();
  const { year: currentYear, month: currentMonth } = dateParts(now, tz);
  const currentQ = Math.floor(currentMonth / 3) + 1; // 1-4

  const result: QuarterDates[] = [];
  let year = currentYear;
  let q = currentQ;

  for (let i = 0; i < n; i++) {
    const label = `${year}-Q${q}`;
    result.push(quarterToDates(label, tz));
    q -= 1;
    if (q < 1) {
      q = 4;
      year -= 1;
    }
  }

  return result; // newest first
}
