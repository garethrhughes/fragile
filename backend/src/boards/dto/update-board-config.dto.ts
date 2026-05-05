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

  @ApiPropertyOptional({
    type: [String],
    example: ['10303'],
    description: 'Status IDs that represent the Kanban backlog (never-on-board). When set, issues whose current statusId is in this list are excluded from flow metrics.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  backlogStatusIds?: string[];

  @ApiPropertyOptional({
    type: String,
    example: '2024-01-01',
    description: 'ISO date (YYYY-MM-DD) lower bound for Kanban flow metrics. Issues whose board-entry date is before this date are excluded. Null means no lower bound.',
  })
  @IsOptional()
  @IsString()
  dataStartDate?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['In Progress', 'In Development'],
    description: 'Status names that indicate active work has begun (cycle time start event)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  inProgressStatusNames?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Jira issue link type names (e.g. "is connected to") that signal a direct roadmap link from ' +
      'an issue to a JPD idea. Empty array (default) disables the feature. (ADR 0044)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roadmapLinkTypes?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['support', 'triage'],
    description:
      'Labels that classify an issue as a support ticket for this board. ' +
      'Empty array (default) disables label-based classification. (ADR 0045)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportLabels?: string[];

  @ApiPropertyOptional({
    type: String,
    example: 'clones',
    description:
      'Jira issue link type name whose target points to the triage board ' +
      '(e.g. "clones"). Null disables link-based classification. (ADR 0045)',
  })
  @IsOptional()
  @IsString()
  supportLinkType?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: 'TTB',
    description:
      'Project key prefix for the triage board (e.g. "TTB"). ' +
      'Used with supportLinkType to identify support tickets via issue links. (ADR 0045)',
  })
  @IsOptional()
  @IsString()
  triageBoardKey?: string | null;
}
