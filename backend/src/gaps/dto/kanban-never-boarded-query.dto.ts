import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class KanbanNeverBoardedQueryDto {
  @ApiPropertyOptional({
    description:
      'Kanban board identifier (e.g. PLAT). Omit or pass "all" to aggregate across all Kanban boards.',
  })
  @IsOptional()
  @IsString()
  boardId?: string;

  @ApiPropertyOptional({
    description: 'Quarter in format YYYY-QN (e.g. 2026-Q1)',
    example: '2026-Q1',
  })
  @IsOptional()
  @IsString()
  quarter?: string;

  @ApiPropertyOptional({
    description: 'If true, use the last 90 days as the date window instead of a specific quarter.',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  last90?: boolean;
}
