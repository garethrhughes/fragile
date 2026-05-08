import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsValidLayout } from './is-valid-layout.decorator.js';
import type { ReportLayout } from '../layout-schema.js';

export class UpdateCustomReportDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

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
