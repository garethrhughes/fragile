/**
 * SupportSnapshotReadService
 *
 * Reads the pre-computed Support summary snapshots (rolling time-period windows)
 * from the `support_snapshots` table. Attaches staleness metadata based on the
 * snapshot's age. Mirrors CycleTimeSnapshotReadService (proposal 0080).
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  SupportSnapshot,
  SupportSnapshotType,
} from '../database/entities/index.js';

export interface SupportSnapshotResult {
  payload: object;
  ageSeconds: number;
  stale: boolean;
}

@Injectable()
export class SupportSnapshotReadService {
  constructor(
    @InjectRepository(SupportSnapshot)
    private readonly snapshotRepo: Repository<SupportSnapshot>,
    private readonly config: ConfigService,
  ) {}

  async getSnapshot(
    boardId: string,
    snapshotType: SupportSnapshotType,
  ): Promise<SupportSnapshotResult | null> {
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
