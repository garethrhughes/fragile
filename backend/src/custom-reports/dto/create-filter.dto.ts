import { IsString, IsIn, IsOptional, IsInt, Min, MaxLength, IsArray, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { FilterKind } from '../../database/entities/index.js';

const FILTER_KINDS: FilterKind[] = ['select', 'multiselect'];

export class CreateFilterDto {
  @ApiProperty({ description: 'Dimension key to filter on' })
  @IsString()
  @MaxLength(200)
  key!: string;

  @ApiProperty({ description: 'Display label for the filter' })
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: FILTER_KINDS })
  @IsString()
  @IsIn(FILTER_KINDS)
  kind!: FilterKind;

  @ApiPropertyOptional({
    description: 'Default value — string for select, string[] for multiselect',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  @IsOptional()
  @ValidateIf((o: CreateFilterDto) => Array.isArray(o.defaultValue))
  @IsArray()
  @IsString({ each: true })
  @ValidateIf((o: CreateFilterDto) => !Array.isArray(o.defaultValue))
  @IsString()
  defaultValue?: string | string[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
