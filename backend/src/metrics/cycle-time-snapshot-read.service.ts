/**
 * CycleTimeSnapshotReadService
 *
 * Reads pre-computed cycle-time snapshots (rolling time-period windows) from
 * the `cycle_time_snapshots` table. Attaches staleness metadata based on the
 * snapshot's age. Mirrors DoraSnapshotReadService (proposal 0079).
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  CycleTimeSnapshot,
  CycleTimeSnapshotType,
} from '../database/entities/index.js';

export interface CycleTimeSnapshotResult {
  payload: object;
  ageSeconds: number;
  stale: boolean;
}

@Injectable()
export class CycleTimeSnapshotReadService {
  constructor(
    @InjectRepository(CycleTimeSnapshot)
    private readonly snapshotRepo: Repository<CycleTimeSnapshot>,
    private readonly config: ConfigService,
  ) {}

  async getSnapshot(
    boardId: string,
    snapshotType: CycleTimeSnapshotType,
  ): Promise<CycleTimeSnapshotResult | null> {
    const row = await this.snapshotRepo.findOne({
      where: { boardId, snapshotType },
    });
    if (!row) return null;

    const ageSeconds = Math.floor(
      (Date.now() - row.computedAt.getTime()) / 1000,
    );
    const staleThresholdSeconds =
      (this.config.get<number>('SNAPSHOT_STALE_THRESHOLD_MINUTES') ?? 60) * 60;
    const stale = ageSeconds > staleThresholdSeconds;

    return { payload: row.payload, ageSeconds, stale };
  }
}
