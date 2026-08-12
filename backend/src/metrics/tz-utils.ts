/**
 * Timezone utility helpers for quarter/week boundary calculations.
 * Uses Intl.DateTimeFormat — no external dependencies.
 */

/**
 * Cache of Intl.DateTimeFormat instances keyed by timezone. Constructing an
 * Intl.DateTimeFormat is expensive; these helpers are called on hot paths
 * (per-day working-time loops across thousands of issues), so the formatter is
 * built once per timezone and reused.
 */
const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Cache of computed local-midnight instants keyed by "tz:anchorUtcMs".
 * The result is deterministic per (timezone, calendar date), so memoising is
 * safe and collapses the per-day working-time loop's repeated lookups.
 */
const startOfDayCache = new Map<string, number>();

function getPartsFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = partsFormatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(tz, fmt);
  }
  return fmt;
}

/**
 * Returns the wall-clock time of a UTC instant in `tz`, expressed as the UTC
 * milliseconds of those same wall-clock components. The difference
 * `wallClockAsUtc(instant, tz) - instant` is the timezone's UTC offset (in ms)
 * that applies at `instant`. O(1) — one cached Intl format call.
 */
function wallClockAsUtcMs(instantMs: number, tz: string): number {
  const parts = getPartsFormatter(tz).formatToParts(new Date(instantMs));
  const p: Record<string, number> = {};
  for (const { type, value } of parts) {
    if (type !== 'literal') p[type] = Number(value);
  }
  // Intl emits hour '24' at midnight for hour12:false in some engines; normalise.
  const hour = p.hour === 24 ? 0 : p.hour;
  return Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second);
}

/**
 * Returns { year, month (0-indexed), day } for a Date in the given IANA timezone.
 */
export function dateParts(
  date: Date,
  tz: string,
): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA produces "YYYY-MM-DD"
  const [year, month, day] = formatter.format(date).split('-').map(Number);
  return { year, month: month - 1, day }; // month is 0-indexed to match Date API
}

/**
 * Returns the UTC instant corresponding to 00:00:00.000 on the given
 * calendar date in the specified IANA timezone.
 *
 * O(1) offset-probe (Proposal 0086 perf fix — replaces the previous
 * per-call binary search + per-call formatter allocation, which dominated
 * cycle-time / support / lead-time CPU on the working-time day loop):
 *
 *   1. Anchor: treat the target wall-clock (00:00 on the date) as if UTC.
 *   2. Probe the tz offset AT that anchor and subtract it to get a candidate
 *      UTC instant for local midnight.
 *   3. Re-probe the offset AT the candidate and correct once. The second probe
 *      handles the case where the offset at the anchor differs from the offset
 *      at midnight (a DST transition landing between them). A single correction
 *      is sufficient: IANA offsets change by at most a few hours, well inside
 *      the one-day granularity, so the candidate after step 2 is always within
 *      the same offset regime as true local midnight except across a transition,
 *      which step 3 resolves.
 *
 * Correct for positive and negative offsets and DST transitions.
 *
 * @param year  — Full year, e.g. 2026
 * @param month — 0-indexed month (0 = January, 11 = December)
 * @param day   — 1-indexed day of month
 * @param tz    — IANA timezone name, e.g. 'America/New_York'
 */
export function startOfDayInTz(
  year: number,
  month: number, // 0-indexed
  day: number,
  tz: string,
): Date {
  const anchorUtcMs = Date.UTC(year, month, day, 0, 0, 0);

  // Memoise by (tz, calendar date): working-time loops call this for the same
  // handful of dates across thousands of issues, so the cache turns O(issues ×
  // days) formatter calls into O(distinct dates).
  const key = `${tz}:${anchorUtcMs}`;
  const cached = startOfDayCache.get(key);
  if (cached !== undefined) return new Date(cached);

  // Offset (ms) = wall-clock-as-UTC minus the actual instant.
  const offset1 = wallClockAsUtcMs(anchorUtcMs, tz) - anchorUtcMs;
  const candidate = anchorUtcMs - offset1;

  // Correct once using the offset that actually applies at the candidate.
  const offset2 = wallClockAsUtcMs(candidate, tz) - candidate;
  const result = anchorUtcMs - offset2;

  startOfDayCache.set(key, result);
  return new Date(result);
}


/**
 * Returns a Date representing midnight (00:00:00.000) in `tz` for the given
 * calendar date components. The returned Date is a UTC instant.
 *
 * This is an alias for `startOfDayInTz` with month/overflow normalisation
 * support. Callers that use the day=0 or month overflow convention (e.g.
 * quarter boundary arithmetic) should call this function.
 *
 * @deprecated Use `startOfDayInTz` directly for new call sites. This alias
 *   is retained for backward compatibility and will be removed in a future
 *   cleanup pass (see Proposal 0030 Fix A-1, Open Question §3).
 */
export function midnightInTz(
  year: number,
  month: number, // 0-indexed
  day: number,
  tz: string,
): Date {
  // Normalise month overflow (e.g. month=12 → Jan of next year)
  while (month > 11) { month -= 12; year += 1; }
  while (month < 0)  { month += 12; year -= 1; }

  // Normalise day=0 (JS "last day of prior month" convention) to a real calendar day
  if (day === 0) {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
    day = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }

  return startOfDayInTz(year, month, day, tz);
}
