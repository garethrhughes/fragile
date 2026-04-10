import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

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

  @ApiPropertyOptional({
    description: 'ISO week in format YYYY-Www (e.g. 2026-W15)',
    example: '2026-W15',
  })
  @IsOptional()
  @IsString()
  week?: string;

  @ApiPropertyOptional({
    description: 'When true, return all weekly buckets instead of quarterly (Kanban only)',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  weekMode?: boolean;
}
