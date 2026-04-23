/**
 * InProcessSnapshotService
 *
 * In-process fallback for DORA snapshot computation, used when
 * USE_LAMBDA=false (local development). Delegates to MetricsService which
 * produces the correct OrgDoraResult / TrendResponse wire shapes.
 *
 * After each board sync, computes two snapshots:
 *   1. Per-board  — keyed to the board's own ID (e.g. 'ACC')
 *   2. Org-level  — keyed to ORG_SNAPSHOT_KEY ('__org__'), covering all boards
 *
 * The org snapshot powers the "All boards" view in the DORA page. Per-board
 * snapshots power the individual board drill-down view.
 *
 * In production, the Lambda handler performs this computation in a separate
 * AWS Lambda function after each sync, keeping the App Runner heap free of
 * the combined sync + computation working set.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service.js';
import { BoardConfig, DoraSnapshot } from '../database/entities/index.js';
import { listRecentQuarters } from '../metrics/period-utils.js';

/** Snapshot key for the org-level (all boards) aggregate and trend. */
export const ORG_SNAPSHOT_KEY = '__org__';

@Injectable()
export class InProcessSnapshotService {
  private readonly logger = new Logger(InProcessSnapshotService.name);

  constructor(
    private readonly metricsService: MetricsService,
    @InjectRepository(DoraSnapshot)
    private readonly snapshotRepo: Repository<DoraSnapshot>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
  ) {}

  async computeAndPersist(triggeredBy: string): Promise<void> {
    const quarters = listRecentQuarters(8);
    const latestQuarter = quarters[0];

    // Resolve all configured board IDs for the org-level snapshot.
    const configs = await this.boardConfigRepo.find({ select: ['boardId'] });
    const allBoardIdStr = configs.map((c) => c.boardId).join(',');

    // Per-board snapshot for the triggering board.
    const [boardAggregate, boardTrend] = await Promise.all([
      this.metricsService.getDoraAggregate({ boardId: triggeredBy, quarter: latestQuarter.label }),
      this.metricsService.getDoraTrend({ boardId: triggeredBy, mode: 'quarters', limit: 8 }),
    ]);

    // Org-level snapshot covering all boards.
    const [orgAggregate, orgTrend] = await Promise.all([
      this.metricsService.getDoraAggregate({ boardId: allBoardIdStr, quarter: latestQuarter.label }),
      this.metricsService.getDoraTrend({ boardId: allBoardIdStr, mode: 'quarters', limit: 8 }),
    ]);

    await this.snapshotRepo.upsert(
      [
        {
          boardId: triggeredBy,
          snapshotType: 'aggregate' as const,
          payload: boardAggregate,
          triggeredBy,
          stale: false,
        },
        {
          boardId: triggeredBy,
          snapshotType: 'trend' as const,
          payload: boardTrend,
          triggeredBy,
          stale: false,
        },
        {
          boardId: ORG_SNAPSHOT_KEY,
          snapshotType: 'aggregate' as const,
          payload: orgAggregate,
          triggeredBy,
          stale: false,
        },
        {
          boardId: ORG_SNAPSHOT_KEY,
          snapshotType: 'trend' as const,
          payload: orgTrend,
          triggeredBy,
          stale: false,
        },
      ],
      ['boardId', 'snapshotType'],
    );

    this.logger.log(
      `Snapshots computed and persisted for board ${triggeredBy} and org-level (triggered by: ${triggeredBy})`,
    );
  }
}
