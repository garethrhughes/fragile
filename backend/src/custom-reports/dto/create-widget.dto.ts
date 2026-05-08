import {
  IsString,
  IsIn,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { WidgetKind, StatBand } from '../../database/entities/index.js';
import { ColumnDefinitionDto } from './column-definition.dto.js';

const WIDGET_KINDS: WidgetKind[] = ['line', 'bar', 'area', 'table', 'stat'];
const STAT_BANDS: StatBand[] = ['elite', 'high', 'medium', 'low', 'none'];

export class CreateWidgetDto {
  @ApiProperty({ enum: WIDGET_KINDS })
  @IsString()
  @IsIn(WIDGET_KINDS)
  kind!: WidgetKind;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'Field in dimensions used to split series (chart kinds only)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  seriesKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  xAxisLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  yAxisLabel?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional({
    description: 'Column definitions for table widgets. Must not be set when kind is "stat".',
    type: [ColumnDefinitionDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ColumnDefinitionDto)
  columns?: ColumnDefinitionDto[];

  @ApiPropertyOptional({ description: 'Unit suffix for stat widgets (e.g. "days", "ms")' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  statUnit?: string;

  @ApiPropertyOptional({ description: 'Secondary text below value for stat widgets' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  statSubtitle?: string;

  @ApiPropertyOptional({ enum: STAT_BANDS, description: 'Left-border band colour for stat widgets' })
  @IsOptional()
  @IsString()
  @IsIn(STAT_BANDS)
  @ValidateIf((o: CreateWidgetDto) => o.statBand !== undefined)
  statBand?: StatBand;
}
