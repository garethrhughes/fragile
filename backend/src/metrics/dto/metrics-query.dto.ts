import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MetricsQueryDto {
  @ApiPropertyOptional({ description: 'Board identifier (e.g. ACC, PLAT)' })
  @IsOptional()
  @IsString()
  boardId?: string;

  @ApiPropertyOptional({
    description: 'Time period in format YYYY-MM-DD:YYYY-MM-DD',
    example: '2025-01-01:2025-03-31',
  })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({ description: 'Sprint ID to scope metrics to' })
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
