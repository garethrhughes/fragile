import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PlanningQueryDto {
  @ApiPropertyOptional({ description: 'Board identifier (e.g. ACC, BPT)' })
  @IsOptional()
  @IsString()
  boardId?: string;

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
