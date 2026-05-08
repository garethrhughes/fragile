import { IsString, IsOptional, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsValidLayout } from './is-valid-layout.decorator.js';
import type { ReportLayout } from '../layout-schema.js';

export class CreateCustomReportDto {
  @ApiProperty({ example: 'my-report', description: 'URL-safe slug (lowercase, hyphens, digits)' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must contain only lowercase letters, digits, and hyphens' })
  @MaxLength(80)
  slug!: string;

  @ApiProperty({ example: 'My Custom Report' })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Grid layout configuration for widgets',
    example: { defaultColumns: 3, widgets: { 'uuid-abc': { colSpan: 3 } } },
  })
  @IsOptional()
  @IsValidLayout()
  layout?: ReportLayout;
}
