/**
 * InProcessSnapshotService
 *
 * In-process fallback for DORA snapshot computation, used when
 * USE_LAMBDA=false (local development). Delegates to MetricsService which
 * produces the correct OrgDoraResult / TrendResponse wire shapes.
 *
 * After each board sync, computes three snapshots:
 *   1. Per-board  — keyed to the board's own ID (e.g. 'ACC')
 *      a. aggregate — OrgDoraResult for the current quarter
 *      b. trend     — raw TrendResponse (oldest→newest) kept for symmetry with
 *                     the Lambda path; used as the per-board raw trend store
 *      c. trend-display — OrgDoraResult[] per quarter (oldest→newest), the
 *                         display-ready shape the frontend trend endpoint reads
 *   2. Org-level  — keyed to ORG_SNAPSHOT_KEY ('__org__'), covering all boards
 *      a. aggregate — OrgDoraResult for the current quarter across all boards
 *      b. trend     — OrgDoraResult[] per quarter (oldest→newest) for multi-board
 *                     trend view
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
import { SupportService } from '../support/support.service.js';
import {
  BoardConfig,
  CycleTimeSnapshot,
  CycleTimeSnapshotType,
  DoraSnapshot,
  DoraSnapshotType,
  SupportSnapshot,
  SupportSnapshotType,
} from '../database/entities/index.js';
import { listRecentQuarters, TIME_PERIOD_WINDOWS } from '../metrics/period-utils.js';

/** Snapshot key for the org-level (all boards) aggregate and trend. */
export const ORG_SNAPSHOT_KEY = '__org__';

/** Number of quarters to include in trend snapshots. */
const TREND_QUARTERS = 8;

/** Maps a time-period window (days) to its aggregate/trend snapshot type names. */
function windowSnapshotTypes(window: number): {
  aggregate: DoraSnapshotType;
  trend: DoraSnapshotType;
} {
  return {
    aggregate: `aggregate-${window}d` as DoraSnapshotType,
    trend: `trend-${window}d` as DoraSnapshotType,
  };
}

@Injectable()
export class InProcessSnapshotService {
  private readonly logger = new Logger(InProcessSnapshotService.name);

  constructor(
    private readonly metricsService: MetricsService,
    private readonly supportService: SupportService,
    @InjectRepository(DoraSnapshot)
    private readonly snapshotRepo: Repository<DoraSnapshot>,
    @InjectRepository(CycleTimeSnapshot)
    private readonly cycleTimeSnapshotRepo: Repository<CycleTimeSnapshot>,
    @InjectRepository(SupportSnapshot)
    private readonly supportSnapshotRepo: Repository<SupportSnapshot>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
  ) {}

  /** Compute and persist only the per-board snapshot rows for a single board. */
  async computeBoard(boardId: string): Promise<void> {
    const currentQuarter = listRecentQuarters(1)[0].label;

    const boardConfig = await this.boardConfigRepo.findOne({
      where: { boardId },
      select: { boardType: true },
    });
    const isKanban = boardConfig?.boardType === 'kanban';

    const [boardAggregate, boardTrend] = await Promise.all([
      this.metricsService.getDoraAggregate({ boardId, quarter: currentQuarter }),
      this.metricsService.getDoraTrend({ boardId, limit: TREND_QUARTERS }),
    ]);

    // trend-display: getDoraTrend already returns OrgDoraResult[] (oldest→newest),
    // which is exactly the display-ready shape the frontend trend endpoint reads
    // for per-board views. Reuse it directly to avoid redundant DB queries.
    const trendDisplay = boardTrend;

    const rows: Array<{
      boardId: string;
      snapshotType: DoraSnapshotType;
      payload: object;
      triggeredBy: string;
      stale: boolean;
    }> = [
      {
        boardId,
        snapshotType: 'aggregate',
        payload: boardAggregate,
        triggeredBy: boardId,
        stale: false,
      },
      {
        boardId,
        snapshotType: 'trend',
        payload: boardTrend,
        triggeredBy: boardId,
        stale: false,
      },
      {
        boardId,
        snapshotType: 'trend-display',
        payload: trendDisplay,
        triggeredBy: boardId,
        stale: false,
      },
    ];

    // trend-sprint: one data point per closed sprint (Scrum boards only).
    // Kanban boards have no sprints — skip to avoid a BadRequestException.
    if (!isKanban) {
      const sprintTrend = await this.metricsService.getDoraTrend({
        boardId,
        limit: TREND_QUARTERS,
        mode: 'sprint',
      });
      rows.push({
        boardId,
        snapshotType: 'trend-sprint',
        payload: sprintTrend,
        triggeredBy: boardId,
        stale: false,
      });
    }

    // Time-period snapshots (7/30/90-day rolling windows) — DORA aggregate + trend.
    for (const window of TIME_PERIOD_WINDOWS) {
      const types = windowSnapshotTypes(window);
      const [aggregate, trend] = await Promise.all([
        this.metricsService.getDoraAggregate({ boardId, window }),
        this.metricsService.getDoraTrend({ boardId, mode: 'timeperiod', window }),
      ]);
      rows.push(
        { boardId, snapshotType: types.aggregate, payload: aggregate, triggeredBy: boardId, stale: false },
        { boardId, snapshotType: types.trend, payload: trend, triggeredBy: boardId, stale: false },
      );
    }

    await this.snapshotRepo.upsert(rows, ['boardId', 'snapshotType']);

    // Cycle-time time-period snapshots for this board.
    await this.computeCycleTimeWindows(boardId, boardId);
    await this.computeSupportWindows(boardId, boardId);

    this.logger.log(`Per-board snapshots persisted for board ${boardId}`);
  }

  /** Compute and persist only the org-level (__org__) snapshot rows. */
  async computeOrg(): Promise<void> {
    const currentQuarter = listRecentQuarters(1)[0].label;
    const quarters = listRecentQuarters(TREND_QUARTERS);

    const configs = await this.boardConfigRepo.find({ select: { boardId: true } });
    const allBoardIdStr = configs.map((c) => c.boardId).join(',');

    // Org aggregate: current quarter, all boards
    const orgAggregate = await this.metricsService.getDoraAggregate({
      boardId: allBoardIdStr,
      quarter: currentQuarter,
    });

    // Org trend: OrgDoraResult per quarter across all boards (oldest→newest).
    // This matches the shape the frontend expects from the multi-board trend endpoint.
    const orgTrendItems = await Promise.all(
      quarters.map((q) =>
        this.metricsService.getDoraAggregate({ boardId: allBoardIdStr, quarter: q.label }),
      ),
    );
    const orgTrend = orgTrendItems.reverse(); // oldest → newest

    const orgRows: Array<{
      boardId: string;
      snapshotType: DoraSnapshotType;
      payload: object;
      triggeredBy: string;
      stale: boolean;
    }> = [
      {
        boardId: ORG_SNAPSHOT_KEY,
        snapshotType: 'aggregate',
        payload: orgAggregate,
        triggeredBy: ORG_SNAPSHOT_KEY,
        stale: false,
      },
      {
        boardId: ORG_SNAPSHOT_KEY,
        snapshotType: 'trend',
        payload: orgTrend,
        triggeredBy: ORG_SNAPSHOT_KEY,
        stale: false,
      },
    ];

    // Org-level time-period snapshots (7/30/90-day rolling windows).
    for (const window of TIME_PERIOD_WINDOWS) {
      const types = windowSnapshotTypes(window);
      const [aggregate, trend] = await Promise.all([
        this.metricsService.getDoraAggregate({ boardId: allBoardIdStr, window }),
        this.metricsService.getDoraTrend({ boardId: allBoardIdStr, mode: 'timeperiod', window }),
      ]);
      orgRows.push(
        { boardId: ORG_SNAPSHOT_KEY, snapshotType: types.aggregate, payload: aggregate, triggeredBy: ORG_SNAPSHOT_KEY, stale: false },
        { boardId: ORG_SNAPSHOT_KEY, snapshotType: types.trend, payload: trend, triggeredBy: ORG_SNAPSHOT_KEY, stale: false },
      );
    }

    await this.snapshotRepo.upsert(orgRows, ['boardId', 'snapshotType']);

    // Cycle-time org-level time-period snapshots (all boards pooled).
    await this.computeCycleTimeWindows(allBoardIdStr, ORG_SNAPSHOT_KEY);
    await this.computeSupportWindows(allBoardIdStr, ORG_SNAPSHOT_KEY);

    this.logger.log(`Org-level snapshots persisted`);
  }

  /**
   * Computes and persists the cycle-time time-period snapshots (aggregate +
   * trend for each of the 7/30/90-day windows) for the given board selection.
   *
   * @param boardIdQuery - Comma-separated board IDs passed to MetricsService
   *                       (a single board key, or all boards for the org row).
   * @param snapshotKey  - The key the snapshot rows are stored under
   *                       (a board key, or ORG_SNAPSHOT_KEY).
   */
  private async computeCycleTimeWindows(
    boardIdQuery: string,
    snapshotKey: string,
  ): Promise<void> {
    const rows: Array<{
      boardId: string;
      snapshotType: CycleTimeSnapshotType;
      payload: object;
      triggeredBy: string;
      stale: boolean;
    }> = [];

    for (const window of TIME_PERIOD_WINDOWS) {
      const aggregate = await this.metricsService.getCycleTime({ boardId: boardIdQuery, window });
      const trend = await this.metricsService.getCycleTimeTrend({
        boardId: boardIdQuery,
        mode: 'timeperiod',
        window,
      });
      rows.push(
        { boardId: snapshotKey, snapshotType: `aggregate-${window}d` as CycleTimeSnapshotType, payload: aggregate, triggeredBy: snapshotKey, stale: false },
        { boardId: snapshotKey, snapshotType: `trend-${window}d` as CycleTimeSnapshotType, payload: trend, triggeredBy: snapshotKey, stale: false },
      );
    }

    await this.cycleTimeSnapshotRepo.upsert(rows, ['boardId', 'snapshotType']);
  }

  /**
   * Computes and persists the Support summary time-period snapshots (one per
   * 7/30/90-day window) for the given board selection. Only the summary is
   * snapshotted — the per-ticket list stays live-computed (proposal 0080).
   */
  private async computeSupportWindows(
    boardIdQuery: string,
    snapshotKey: string,
  ): Promise<void> {
    const rows: Array<{
      boardId: string;
      snapshotType: SupportSnapshotType;
      payload: object;
      triggeredBy: string;
      stale: boolean;
    }> = [];

    for (const window of TIME_PERIOD_WINDOWS) {
      const summary = await this.supportService.getSupportSummary({ boardId: boardIdQuery, window });
      rows.push({
        boardId: snapshotKey,
        snapshotType: `summary-${window}d` as SupportSnapshotType,
        payload: summary,
        triggeredBy: snapshotKey,
        stale: false,
      });
    }

    await this.supportSnapshotRepo.upsert(rows, ['boardId', 'snapshotType']);
  }

  /** @deprecated Use computeBoard() + computeOrg() separately. */
  async computeAndPersist(triggeredBy: string): Promise<void> {
    await this.computeBoard(triggeredBy);
    await this.computeOrg();
  }
}
