/**
 * DebugController — admin-only read-only ticket inspection (ADR 0076).
 *
 * GET /api/debug/issue/:key returns everything stored in the Postgres mirror
 * for a given Jira issue key. Guarded by AdminGuard (the global
 * AuthenticatedGuard runs first and attaches authUser).
 */
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiParam } from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { DebugService } from './debug.service.js';
import type { IssueDebugResponse } from './dto/issue-debug-response.dto.js';

@ApiTags('debug')
@UseGuards(AdminGuard)
@Controller('api/debug')
export class DebugController {
  constructor(private readonly debugService: DebugService) {}

  @Get('issue/:key')
  @ApiOperation({
    summary: 'All stored data for a Jira issue (admin only)',
    description:
      'Returns everything mirrored in Postgres for the given issue key — the issue row, ' +
      'status/Sprint changelog, sprint memberships, issue links (source and target), and ' +
      'linked roadmap ideas. Read-only; no live Jira calls.',
  })
  @ApiParam({ name: 'key', example: 'ACC-123', description: 'Jira issue key' })
  async getIssueDebug(@Param('key') key: string): Promise<IssueDebugResponse> {
    return this.debugService.getIssueDebug(key);
  }
}
