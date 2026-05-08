import {
  IsString,
  IsNumber,
  IsOptional,
  IsObject,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DataPointDto {
  @ApiProperty({ description: 'X-axis value (ISO date string or bucket label)' })
  @IsString()
  @MaxLength(200)
  x!: string;

  @ApiProperty()
  @IsNumber()
  y!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  series?: string;

  @ApiPropertyOptional({ description: 'Key-value pairs used for client-side filtering' })
  @IsOptional()
  @IsObject()
  dimensions?: Record<string, string>;
}

export class AppendDataPointsDto {
  @ApiProperty({ type: [DataPointDto], maxItems: 1000 })
  @ValidateNested({ each: true })
  @Type(() => DataPointDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  points!: DataPointDto[];
}
