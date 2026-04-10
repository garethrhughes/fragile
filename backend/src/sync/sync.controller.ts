import { Controller, Post, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard.js';
import { SyncService } from './sync.service.js';

@ApiTags('sync')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard)
@Controller('api/sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @ApiOperation({ summary: 'Trigger a full sync of all boards' })
  @Post()
  async triggerSync() {
    return this.syncService.syncAll();
  }

  @ApiOperation({ summary: 'Get sync status per board' })
  @Get('status')
  async getStatus() {
    return this.syncService.getStatus();
  }
}
