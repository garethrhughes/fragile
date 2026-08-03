/**
 * ISO week-key arithmetic for the Healthcheck page.
 *
 * Pure helpers for navigating between ISO week keys (YYYY-Www) on the client.
 * Mirrors the backend `iso-week.ts` week-year rules (Jan-4 anchor) so the two
 * sides agree on week boundaries.
 */

/** Convert a Date to an ISO week key (YYYY-Www). */
export function dateToIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + (4 - dow))
  const isoYear = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(isoYear, 0, 4))
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay()
  const week1Mon = new Date(jan4)
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1))
  const weekNum = Math.round((thursday.getTime() - week1Mon.getTime()) / (7 * 86_400_000)) + 1
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`
}

/** Current ISO week key. */
export function currentIsoWeek(): string {
  return dateToIsoWeekKey(new Date())
}

/** Parse a YYYY-Www key to the UTC Date of that week's Monday, or null. */
export function isoWeekToMonday(week: string): Date | null {
  const m = week.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return null
  const isoYear = parseInt(m[1], 10)
  const weekNum = parseInt(m[2], 10)
  const jan4 = new Date(Date.UTC(isoYear, 0, 4))
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay()
  const week1Mon = new Date(jan4)
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1))
  const monday = new Date(week1Mon)
  monday.setUTCDate(week1Mon.getUTCDate() + (weekNum - 1) * 7)
  return monday
}

/** Format YYYY-Www as "W20 '26". */
export function formatWeekLabel(week: string): string {
  const m = week.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return week
  return `W${m[2]} '${m[1].slice(2)}`
}

/** Previous ISO week key (handles week 53 / year boundaries). */
export function prevWeek(week: string): string {
  const monday = isoWeekToMonday(week)
  if (!monday) return week
  monday.setUTCDate(monday.getUTCDate() - 7)
  return dateToIsoWeekKey(monday)
}

/** Next ISO week key (handles week 53 / year boundaries). */
export function nextWeek(week: string): string {
  const monday = isoWeekToMonday(week)
  if (!monday) return week
  monday.setUTCDate(monday.getUTCDate() + 7)
  return dateToIsoWeekKey(monday)
}

/** The last completed ISO week (the week before the current one). */
export function lastCompletedWeek(): string {
  return prevWeek(currentIsoWeek())
}
