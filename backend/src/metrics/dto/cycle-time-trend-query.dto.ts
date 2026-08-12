import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TIME_PERIOD_WINDOWS, type TimePeriodWindow } from '../period-utils.js';

/**
 * Query DTO for GET /api/metrics/cycle-time/trend
 * Mirrors DoraTrendQueryDto structure exactly (Issue 4).
 */
export class CycleTimeTrendQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated board IDs. Defaults to all boards.',
  })
  @IsOptional()
  @IsString()
  boardId?: string;

  @ApiPropertyOptional({
    description: 'Period mode: quarters (default), sprints, or timeperiod',
    enum: ['quarters', 'sprints', 'timeperiod'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['quarters', 'sprints', 'timeperiod'])
  mode?: 'quarters' | 'sprints' | 'timeperiod';

  @ApiPropertyOptional({
    description: 'Number of periods to return (default 8, max 52)',
    default: 8,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Rolling time-period window in days (7, 30, or 90). Required when ' +
      'mode=timeperiod. 7/30-day windows produce daily buckets; 90-day ' +
      'windows produce weekly buckets.',
    enum: TIME_PERIOD_WINDOWS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(TIME_PERIOD_WINDOWS)
  window?: TimePeriodWindow;
}
