/**
 * ISO 8601 week-key utilities.
 *
 * Single source of truth for converting a Date (interpreted in a specific
 * IANA timezone) to an ISO week key of the form `YYYY-Www`.
 *
 * Extracted to fix Bug A-1 (proposal 0055) — the previous inline
 * implementation in roadmap.service.ts and planning.service.ts walked
 * **forward** 4 days for Sundays instead of back 3, which mis-bucketed
 * Sundays at year boundaries (e.g. Sun 2023-12-31 was reported as
 * 2024-W01 instead of the correct 2023-W52).
 *
 * ADR 0050 documents the fix and the canonicalisation of date utilities.
 */

import { dateParts, startOfDayInTz } from '../metrics/tz-utils.js';

/**
 * Convert a Date to its ISO 8601 week key (`YYYY-Www`) interpreted in the
 * given IANA timezone.
 *
 * ISO 8601 rules:
 *   - Weeks start on Monday and end on Sunday.
 *   - Week 1 of an ISO year is the week containing the first Thursday of
 *     that year (equivalently, the week containing 4 January).
 *   - The ISO year of a date is the calendar year of the Thursday of its
 *     ISO week — so a Sunday on 31 Dec belongs to the prior ISO year if
 *     its Thursday falls in December.
 */
export function dateToIsoWeekKey(date: Date, tz: string = 'UTC'): string {
  const { year, month, day } = dateParts(date, tz);
  // Build a UTC-based proxy for the local calendar date in `tz`.
  const localDate = new Date(Date.UTC(year, month, day));

  // Find Thursday of the same ISO week. ISO 8601 numbers days Mon=1..Sun=7;
  // JS Date.getUTCDay returns Sun=0, Mon=1..Sat=6.
  // For Sunday (dow=0): walk back 3 days to Thursday of the same week.
  // For Mon-Sat: walk forward (4 - dow) days to Thursday.
  const dow = localDate.getUTCDay();
  const daysToThursday = dow === 0 ? -3 : 4 - dow;
  const thursday = new Date(localDate);
  thursday.setUTCDate(localDate.getUTCDate() + daysToThursday);

  const isoYear = thursday.getUTCFullYear();

  // Monday of ISO week 1 is the Monday of the week containing 4 January.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay();
  const jan4ToMonday = jan4Day === 0 ? -6 : 1 - jan4Day;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() + jan4ToMonday);

  // Monday of the week containing `localDate`.
  const thisMonday = new Date(localDate);
  const dateToMonday = dow === 0 ? -6 : 1 - dow;
  thisMonday.setUTCDate(localDate.getUTCDate() + dateToMonday);

  const diffMs = thisMonday.getTime() - week1Monday.getTime();
  const weekNumber = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;

  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Convert an ISO week key (`YYYY-Www`) to its [weekStart, weekEnd] boundaries
 * in the given IANA timezone.
 *
 * weekStart = Monday 00:00:00.000 local time
 * weekEnd   = Sunday  23:59:59.999 local time
 *
 * This is the single canonical implementation — all services must use this
 * rather than computing week boundaries inline. The previous planning service
 * implementation computed boundaries in raw UTC, causing a 14-hour offset for
 * Australia/Sydney (UTC+10) that excluded Monday-morning completions.
 */
export function isoWeekKeyToDates(
  week: string,
  tz: string = 'UTC',
): { weekStart: Date; weekEnd: Date } {
  const match = week.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid week format: "${week}". Expected YYYY-Www e.g. 2026-W20`);
  }

  const year = parseInt(match[1], 10);
  const weekNum = parseInt(match[2], 10);

  // Jan 4 is always in ISO week 1. Find its local calendar date in tz.
  const jan4LocalParts = dateParts(new Date(Date.UTC(year, 0, 4)), tz);
  const jan4Local = new Date(Date.UTC(jan4LocalParts.year, jan4LocalParts.month, jan4LocalParts.day));
  const jan4Dow = jan4Local.getUTCDay();
  const daysToMon = jan4Dow === 0 ? -6 : 1 - jan4Dow;

  // Monday of ISO week 1 in local calendar space
  const week1Monday = new Date(jan4Local);
  week1Monday.setUTCDate(jan4Local.getUTCDate() + daysToMon);

  // Monday of the requested week in local calendar space
  const weekMonday = new Date(week1Monday);
  weekMonday.setUTCDate(week1Monday.getUTCDate() + (weekNum - 1) * 7);

  // Sunday of the requested week in local calendar space
  const weekSunday = new Date(weekMonday);
  weekSunday.setUTCDate(weekMonday.getUTCDate() + 6);

  // Convert to actual UTC timestamps using midnight in the configured timezone
  const weekStart = startOfDayInTz(
    weekMonday.getUTCFullYear(),
    weekMonday.getUTCMonth(),
    weekMonday.getUTCDate(),
    tz,
  );
  const dayAfterWeekEnd = startOfDayInTz(
    weekSunday.getUTCFullYear(),
    weekSunday.getUTCMonth(),
    weekSunday.getUTCDate() + 1,
    tz,
  );
  const weekEnd = new Date(dayAfterWeekEnd.getTime() - 1);

  return { weekStart, weekEnd };
}
