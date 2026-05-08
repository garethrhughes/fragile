import { IsString, IsIn, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { GraphKind } from '../../database/entities/index.js';

const GRAPH_KINDS: GraphKind[] = ['line', 'bar', 'area'];

export class UpdateGraphDto {
  @ApiPropertyOptional({ enum: GRAPH_KINDS })
  @IsOptional()
  @IsString()
  @IsIn(GRAPH_KINDS)
  kind?: GraphKind;

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
}
