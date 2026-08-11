import { IsOptional, IsString, Matches, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TIME_PERIOD_WINDOWS, type TimePeriodWindow } from '../period-utils.js';

export class DoraAggregateQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated board IDs (e.g. ACC,BPT,PLAT). Defaults to all boards.',
  })
  @IsOptional()
  @IsString()
  boardId?: string;

  @ApiPropertyOptional({
    description:
      'Calendar quarter in YYYY-QN format (e.g. 2026-Q2). ' +
      'Defaults to the current calendar quarter when omitted.',
    example: '2026-Q2',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-Q[1-4]$/, { message: 'quarter must be in YYYY-QN format, e.g. 2026-Q2' })
  quarter?: string;

  @ApiPropertyOptional({
    description:
      'Sprint ID — when provided, metrics are scoped to the sprint window ' +
      'instead of a calendar quarter.',
  })
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional({
    description:
      'Rolling time-period window in days (7, 30, or 90). When provided ' +
      '(and no quarter/sprintId), metrics are scoped to the last N full days ' +
      'ending at 23:59:59 yesterday in the configured timezone.',
    enum: TIME_PERIOD_WINDOWS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(TIME_PERIOD_WINDOWS)
  window?: TimePeriodWindow;
}
