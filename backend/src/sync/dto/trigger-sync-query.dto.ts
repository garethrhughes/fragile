import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { SyncMode } from '../sync.service.js';

/**
 * Query params for POST /api/sync (proposal 0078).
 *
 * `mode` selects sync granularity. Defaults to 'full' to preserve the prior
 * behaviour of the endpoint. An invalid value is rejected by the global
 * ValidationPipe with HTTP 400.
 */
export class TriggerSyncQueryDto {
  @ApiPropertyOptional({
    description:
      "Sync granularity. 'full' (default) fetches every issue for each board; " +
      "'incremental' fetches only issues changed since the last successful sync.",
    enum: ['full', 'incremental'],
    default: 'full',
  })
  @IsOptional()
  @IsIn(['full', 'incremental'], {
    message: "mode must be 'full' or 'incremental'",
  })
  mode?: SyncMode;
}
