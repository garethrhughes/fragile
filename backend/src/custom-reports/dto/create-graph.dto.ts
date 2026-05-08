import { IsString, IsIn, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { GraphKind } from '../../database/entities/index.js';

const GRAPH_KINDS: GraphKind[] = ['line', 'bar', 'area'];

export class CreateGraphDto {
  @ApiProperty({ enum: GRAPH_KINDS })
  @IsString()
  @IsIn(GRAPH_KINDS)
  kind!: GraphKind;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'Field in dimensions used to split series' })
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
}
