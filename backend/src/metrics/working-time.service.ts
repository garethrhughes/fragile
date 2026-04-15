import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WorkingTimeConfigEntity } from '../database/entities/index.js';
import { dateParts, midnightInTz } from './tz-utils.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Runtime working-time configuration — the entity enriched with the
 * tenant timezone from the environment.
 */
export interface WorkingTimeConfig {
  timezone: string;
  workDays: number[];
  hoursPerDay: number;
  holidays: string[];
}

// ---------------------------------------------------------------------------
// WorkingTimeService
// ---------------------------------------------------------------------------

@Injectable()
export class WorkingTimeService {
  private readonly logger = new Logger(WorkingTimeService.name);

  /**
   * In-memory default used when the `working_time_config` table row is absent
   * (e.g. a fresh DB that has not yet had migrations applied, or tests that
   * do not seed the table).
   */
  private static readonly DEFAULT_ENTITY: WorkingTimeConfigEntity = Object.assign(
    new WorkingTimeConfigEntity(),
    {
      id: 1,
      excludeWeekends: true,
      workDays: [1, 2, 3, 4, 5],
      hoursPerDay: 8,
      holidays: [] as string[],
    },
  );

  constructor(
    @InjectRepository(WorkingTimeConfigEntity)
    private readonly repo: Repository<WorkingTimeConfigEntity>,
    private readonly configService: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // DB access
  // ---------------------------------------------------------------------------

  /**
   * Loads the singleton row (id = 1) from the database.
   * Returns the in-memory default when no row is found so callers never
   * receive null/undefined.
   */
  async getConfig(): Promise<WorkingTimeConfigEntity> {
    const entity = await this.repo.findOne({ where: { id: 1 } });
    if (!entity) {
      this.logger.warn(
        'working_time_config row not found — using in-memory defaults',
      );
      return WorkingTimeService.DEFAULT_ENTITY;
    }
    return entity;
  }

  // ---------------------------------------------------------------------------
  // Config conversion
  // ---------------------------------------------------------------------------

  /**
   * Converts a WorkingTimeConfigEntity into a WorkingTimeConfig, enriched
   * with the tenant timezone from the TIMEZONE environment variable.
   */
  toConfig(entity: WorkingTimeConfigEntity): WorkingTimeConfig {
    return {
      timezone: this.configService.get<string>('TIMEZONE', 'UTC'),
      workDays: entity.workDays,
      hoursPerDay: entity.hoursPerDay,
      holidays: entity.holidays,
    };
  }

  // ---------------------------------------------------------------------------
  // Core working-time algorithm
  // ---------------------------------------------------------------------------

  /**
   * Returns the number of working hours between `start` and `end` in the
   * given working-time configuration.
   *
   * Algorithm:
   *   1. Walk calendar days in the given timezone from the day containing
   *      `start` through the day containing `end` (inclusive).
   *   2. For each calendar day, compute the millisecond overlap between
   *      [start, end] and [dayStart, dayEnd] in that timezone.
   *   3. Skip days that are non-working (weekday not in workDays) or are
   *      public holidays.
   *   4. Accumulate the overlapping milliseconds and convert to hours.
   *
   * DST safety: day boundaries are computed using `midnightInTz()` from
   * tz-utils.ts, which correctly handles DST gaps/overlaps.
   */
  workingHoursBetween(
    start: Date,
    end: Date,
    config: WorkingTimeConfig,
  ): number {
    if (start >= end) return 0;

    const { timezone, workDays, holidays } = config;
    const holidaySet = new Set(holidays);

    let totalMs = 0;

    // Find the calendar date for `start` in the given timezone.
    let { year, month, day } = dateParts(start, timezone);

    // Iterate day by day until the dayStart is past `end`.
    for (;;) {
      // Compute the UTC instant that represents midnight at the start of this
      // calendar day in the target timezone.
      const dayStart = midnightInTz(year, month, day, timezone);

      // If this day starts after `end`, we are done.
      if (dayStart >= end) break;

      // Compute the start of the NEXT calendar day.
      const nextDay = midnightInTz(year, month, day + 1, timezone);

      // Effective interval within [start, end] for this calendar day.
      const intervalStart = dayStart < start ? start : dayStart;
      const intervalEnd = nextDay > end ? end : nextDay;

      if (intervalStart < intervalEnd) {
        // Determine which weekday this calendar day falls on.
        // Use the midpoint of the day to avoid boundary edge cases.
        const midpoint = new Date((dayStart.getTime() + nextDay.getTime()) / 2);
        const weekday = getWeekday(midpoint, timezone);

        // Build YYYY-MM-DD string for the holiday check.
        const dateStr = toDateString(year, month, day);

        if (workDays.includes(weekday) && !holidaySet.has(dateStr)) {
          totalMs += intervalEnd.getTime() - intervalStart.getTime();
        }
      }

      // Advance to the next calendar day using dateParts on `nextDay`.
      // We use dateParts rather than incrementing `day` manually to avoid
      // month/year overflow issues when `midnightInTz` normalises overflows.
      ({ year, month, day } = dateParts(nextDay, timezone));

      // Safety guard: if nextDay equals dayStart (degenerate DST case) break.
      if (nextDay <= dayStart) break;
    }

    return totalMs / 3_600_000;
  }

  /**
   * Returns the number of working days between `start` and `end`.
   * = workingHoursBetween / hoursPerDay
   */
  workingDaysBetween(
    start: Date,
    end: Date,
    config: WorkingTimeConfig,
  ): number {
    if (config.hoursPerDay <= 0) return 0;
    return this.workingHoursBetween(start, end, config) / config.hoursPerDay;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns the ISO weekday (0 = Sunday, 1 = Monday, …, 6 = Saturday) for a
 * Date in the given IANA timezone.  Uses `Intl.DateTimeFormat` so it is
 * DST-safe and does not depend on UTC weekday.
 */
function getWeekday(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const dayStr = formatter.format(date); // e.g. "Mon", "Tue", ...
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[dayStr] ?? 0;
}

/**
 * Converts (year, month 0-indexed, day) to a "YYYY-MM-DD" string.
 * Used for holiday lookups.
 */
function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
