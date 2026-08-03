import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /api/healthcheck
 *
 * week: optional ISO week (YYYY-Www). Defaults to the last completed ISO week.
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
}
