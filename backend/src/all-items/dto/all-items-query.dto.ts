import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query parameters for GET /api/all-items
 *
 * week: ISO week format YYYY-Www (e.g. 2026-W20)
 * filter: pipe-delimited set of active filters
 *
 * NOTE: This DTO is part of the all-items module — a bespoke MyPass-only
 * report (feature 0012, proposal 0062). It is intentionally isolated and
 * will not be upstreamed.
 */
export class AllItemsQueryDto {
  @ApiProperty({
    description: 'ISO week identifier, e.g. 2026-W20',
    example: '2026-W20',
  })
  @IsString()
  @Matches(/^\d{4}-W\d{2}$/, {
    message: 'week must be in YYYY-Www format, e.g. 2026-W20',
  })
  week!: string;

  @ApiPropertyOptional({
    description:
      'Pipe-delimited filter flags: added-mid-sprint, not-on-roadmap, support, ttb-support',
    example: 'support|not-on-roadmap',
  })
  @IsOptional()
  @IsString()
  filter?: string;
}
