import {
  IsOptional,
  IsString,
  IsArray,
  IsIn,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBoardConfigDto {
  @ApiPropertyOptional({ enum: ['scrum', 'kanban'] })
  @IsOptional()
  @IsString()
  @IsIn(['scrum', 'kanban'])
  boardType?: string;

  @ApiPropertyOptional({ type: [String], example: ['Done', 'Closed', 'Released'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  doneStatusNames?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Bug', 'Incident'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  failureIssueTypes?: string[];

  @ApiPropertyOptional({ type: [String], example: ['is caused by'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  failureLinkTypes?: string[];

  @ApiPropertyOptional({ type: [String], example: ['regression', 'incident'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  failureLabels?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Bug', 'Incident'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  incidentIssueTypes?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Done', 'Resolved'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recoveryStatusNames?: string[];

  @ApiPropertyOptional({ type: [String], example: [] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  incidentLabels?: string[];
}
