import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DoraAggregateQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated board IDs (e.g. ACC,BPT,PLAT). Defaults to all boards.',
  })
  @IsOptional()
  @IsString()
  boardId?: string;
}
