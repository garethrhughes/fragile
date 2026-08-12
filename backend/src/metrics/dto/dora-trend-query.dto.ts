import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TIME_PERIOD_WINDOWS, type TimePeriodWindow } from '../period-utils.js';

/**
 * Query DTO for GET /api/metrics/dora/trend
 * `boardId` is comma-separated (same semantics as MetricsQueryDto.boardId).
 */
export class DoraTrendQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated board IDs. Defaults to all boards.',
  })
  @IsOptional()
  @IsString()
  boardId?: string;

  @ApiPropertyOptional({
    description: 'Number of periods to return (default 8, max 20)',
    default: 8,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Period mode: "quarter" (default), "sprint", or "timeperiod".',
    enum: ['quarter', 'sprint', 'timeperiod'],
    default: 'quarter',
  })
  @IsOptional()
  @IsString()
  @IsIn(['quarter', 'sprint', 'timeperiod'])
  mode?: 'quarter' | 'sprint' | 'timeperiod';

  @ApiPropertyOptional({
    description:
      'Sprint ID — only used when mode=sprint and a single boardId is given.',
  })
  @IsOptional()
  @IsString()
  sprintId?: string;

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
