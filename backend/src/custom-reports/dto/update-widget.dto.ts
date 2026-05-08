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
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { WidgetKind, StatBand } from '../../database/entities/index.js';
import { ColumnDefinitionDto } from './column-definition.dto.js';

const WIDGET_KINDS: WidgetKind[] = ['line', 'bar', 'area', 'table', 'stat'];
const STAT_BANDS: StatBand[] = ['elite', 'high', 'medium', 'low', 'none'];

export class UpdateWidgetDto {
  @ApiPropertyOptional({ enum: WIDGET_KINDS })
  @IsOptional()
  @IsString()
  @IsIn(WIDGET_KINDS)
  kind?: WidgetKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional({ type: [ColumnDefinitionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ColumnDefinitionDto)
  columns?: ColumnDefinitionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  statUnit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  statSubtitle?: string;

  @ApiPropertyOptional({ enum: STAT_BANDS })
  @IsOptional()
  @IsString()
  @IsIn(STAT_BANDS)
  @ValidateIf((o: UpdateWidgetDto) => o.statBand !== undefined)
  statBand?: StatBand;
}
