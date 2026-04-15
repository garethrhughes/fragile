import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * Singleton entity (always id = 1) that stores working-time configuration
 * for the tenant.  Used by WorkingTimeService to exclude weekends and public
 * holidays when computing cycle-time and lead-time durations.
 *
 * Values are populated on application startup from the optional `workingTime:`
 * stanza in `config/boards.yaml`.  If the stanza is absent the defaults here
 * produce calendar-day behaviour (excludeWeekends = true with Mon–Fri work
 * days, 8 h/day, no holidays) which is the most common real-world expectation.
 */
@Entity('working_time_config')
export class WorkingTimeConfigEntity {
  /**
   * Always 1.  There is exactly one row in this table — the singleton pattern
   * avoids the complexity of a keyless table while making the "global config"
   * semantics explicit.
   */
  @PrimaryColumn()
  id!: number;

  /**
   * When true, weekend days (as defined by workDays) are excluded from
   * cycle-time and lead-time calculations.
   */
  @Column({ type: 'boolean', default: true })
  excludeWeekends!: boolean;

  /**
   * ISO weekday numbers that count as working days.
   * 0 = Sunday, 1 = Monday, …, 6 = Saturday.
   * Default: Monday–Friday [1, 2, 3, 4, 5].
   */
  @Column({ type: 'simple-json', default: '[1,2,3,4,5]' })
  workDays!: number[];

  /**
   * Number of working hours in a full working day.
   * Used as the divisor when converting working-hours to working-days.
   */
  @Column({ type: 'integer', default: 8 })
  hoursPerDay!: number;

  /**
   * List of public holiday dates in YYYY-MM-DD format (tenant's local timezone).
   * These days are excluded from working-time calculations regardless of workDays.
   */
  @Column({ type: 'simple-json', default: '[]' })
  holidays!: string[];
}
