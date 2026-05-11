import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
      'Filter tickets by match reason. When set to "link", only tickets classified via issue link are returned. ' +
      'totalIssues (denominator) is unaffected. Supported values: "link", "label", "epic".',
    enum: ['link', 'label', 'epic'],
  })
  @IsOptional()
  @IsIn(['link', 'label', 'epic'])
  matchReason?: 'link' | 'label' | 'epic';
}
