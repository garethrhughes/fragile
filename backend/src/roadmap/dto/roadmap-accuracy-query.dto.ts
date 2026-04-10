import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RoadmapAccuracyQueryDto {
  @ApiProperty({ description: 'Board identifier (e.g. ACC, BPT)' })
  @IsNotEmpty()
  @IsString()
  boardId!: string;

  @ApiPropertyOptional({ description: 'Sprint ID to calculate accuracy for' })
  @IsOptional()
  @IsString()
  sprintId?: string;

  @ApiPropertyOptional({
    description: 'Quarter in format YYYY-QN (e.g. 2025-Q1)',
    example: '2025-Q1',
  })
  @IsOptional()
  @IsString()
  quarter?: string;
}
