import { describe, it, expect } from 'vitest'
import {
  dateToIsoWeekKey,
  isoWeekToMonday,
  formatWeekLabel,
  prevWeek,
  nextWeek,
} from './iso-week'

describe('iso-week', () => {
  it('converts a date to its ISO week key', () => {
    // Wed 2026-07-22 → 2026-W30
    expect(dateToIsoWeekKey(new Date('2026-07-22T12:00:00Z'))).toBe('2026-W30')
  })

  it('handles the year-boundary Sunday correctly (2023-12-31 → 2023-W52)', () => {
    expect(dateToIsoWeekKey(new Date('2023-12-31T12:00:00Z'))).toBe('2023-W52')
  })

  it('returns Monday of the ISO week', () => {
    const monday = isoWeekToMonday('2026-W30')
    expect(monday?.getUTCFullYear()).toBe(2026)
    // Mon 2026-07-20
    expect(monday?.toISOString().slice(0, 10)).toBe('2026-07-20')
  })

  it('formats a week label', () => {
    expect(formatWeekLabel('2026-W30')).toBe("W30 '26")
  })

  it('steps to the previous and next week', () => {
    expect(prevWeek('2026-W30')).toBe('2026-W29')
    expect(nextWeek('2026-W30')).toBe('2026-W31')
  })

  it('crosses the year boundary going back from W01', () => {
    // 2026-W01 → previous is the last week of 2025
    expect(prevWeek('2026-W01')).toBe('2025-W52')
  })
})
