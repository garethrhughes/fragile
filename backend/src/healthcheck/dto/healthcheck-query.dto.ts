import { IsString, IsOptional, IsBoolean, IsIn, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /api/healthcheck
 *
 * week: optional ISO week (YYYY-Www). Defaults to the last completed ISO week.
 * includeSupport: optional boolean (default true). When false, support tickets
 *   are excluded from the Stability & Roadmap scores.
 * view: optional 'stored' (default) or 'live'. See ADR 0092.
 */
export class HealthcheckQueryDto {
  @ApiPropertyOptional({
    description:
      'ISO week identifier, e.g. 2026-W30. Defaults to the last completed week when omitted.',
    example: '2026-W30',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, {
    message:
      'week must be in YYYY-Www format with a valid week number (01–53), e.g. 2026-W30',
  })
  week?: string;

  @ApiPropertyOptional({
    description:
      'When false, support tickets are excluded from the Stability and Roadmap ' +
      'denominator and numerators (the Support score is unaffected). Defaults to true.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  includeSupport?: boolean;

  @ApiPropertyOptional({
    description:
      "'stored' (default) serves the persisted canonical figure for a completed " +
      "week, so a closed week is reproducible. 'live' forces a recompute from the " +
      'Jira mirror and returns a `drift` object comparing it against the stored ' +
      'figure. The current week and any includeSupport=false request are always ' +
      'computed live.',
    enum: ['stored', 'live'],
    default: 'stored',
  })
  @IsOptional()
  @IsIn(['stored', 'live'])
  view?: 'stored' | 'live';
}
