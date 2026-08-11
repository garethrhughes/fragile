import { IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TIME_PERIOD_WINDOWS, type TimePeriodWindow } from '../../metrics/period-utils.js';

export class SupportQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated board IDs. Defaults to all boards.' })
  @IsOptional()
  @IsString()
  boardId?: string;

  @ApiPropertyOptional({ description: 'Quarter in YYYY-QN format, e.g. 2026-Q1' })
  @IsOptional()
  @IsString()
  quarter?: string;

  @ApiPropertyOptional({ description: 'Single sprint ID to resolve date range from' })
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional({ description: 'Explicit date range in YYYY-MM-DD:YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({
    description:
      'Rolling time-period window in days (7, 30, or 90). When provided ' +
      '(and no quarter/sprintId), metrics cover the last N full days ending ' +
      'at 23:59:59 yesterday in the configured timezone.',
    enum: TIME_PERIOD_WINDOWS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(TIME_PERIOD_WINDOWS)
  window?: TimePeriodWindow;
}
