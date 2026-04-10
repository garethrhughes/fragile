import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoadmapConfigDto {
  @ApiProperty({ description: 'Jira Product Discovery project key (e.g. DISC)' })
  @IsString()
  @IsNotEmpty()
  jpdKey!: string;

  @ApiPropertyOptional({ description: 'Optional human-readable description' })
  @IsOptional()
  @IsString()
  description?: string;
}
