import {
  IsOptional,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DataPointDto } from './append-data-points.dto.js';

/**
 * DTO for PUT .../data-points — replaces all existing data points for a graph.
 * Unlike AppendDataPointsDto, an empty array is valid: it clears all points
 * (callers can also use DELETE .../data-points for the same effect).
 */
export class ReplaceDataPointsDto {
  @ApiPropertyOptional({ type: [DataPointDto], maxItems: 1000 })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DataPointDto)
  @ArrayMaxSize(1000)
  points: DataPointDto[] = [];
}
