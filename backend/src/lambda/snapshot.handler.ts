/**
 * snapshot.handler.ts
 *
 * Lambda handler for post-sync DORA snapshot computation.
 *
 * This module intentionally does NOT bootstrap NestJS. It creates a TypeORM
 * DataSource directly and instantiates the metric services with `new`.
 * NestJS decorators (@Injectable, @InjectRepository, etc.) are no-ops at
 * runtime when used outside a NestJS IoC container — only reflect-metadata
 * is required for the TypeORM entity decorators to work.
 *
 * The DataSource is module-scoped and reused across warm Lambda invocations
 * to avoid repeated connection overhead.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  BoardConfig,
  JiraIssueLink,
  WorkingTimeConfigEntity,
  DoraSnapshot,
  CycleTimeSnapshot,
  SupportSnapshot,
  JiraFieldConfig,
  JiraSprint,
  JiraIssueSprint,
  SyncLog,
  RoadmapConfig,
  JpdIdea,
  SprintReport,
} from '../database/entities/index.js';
import type {
  DoraSnapshotType,
  CycleTimeSnapshotType,
  SupportSnapshotType,
} from '../database/entities/index.js';
import { TrendDataLoader } from '../metrics/trend-data-loader.service.js';
import type { TrendDataSlice } from '../metrics/trend-data-loader.service.js';
import { DeploymentFrequencyService } from '../metrics/deployment-frequency.service.js';
import { LeadTimeService } from '../metrics/lead-time.service.js';
import { CfrService } from '../metrics/cfr.service.js';
import { MttrService } from '../metrics/mttr.service.js';
import { CycleTimeService } from '../metrics/cycle-time.service.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';
import { SupportService } from '../support/support.service.js';
import { SprintMembershipService } from '../sprint-membership/sprint-membership.service.js';
import {
  listRecentQuarters,
  listRollingBuckets,
  windowToDates,
  quarterToDates,
  TIME_PERIOD_WINDOWS,
} from '../metrics/period-utils.js';
import { dateParts } from '../metrics/tz-utils.js';
import { percentile, round2 } from '../metrics/statistics.js';
import {
  classifyDeploymentFrequency,
  classifyLeadTime,
  classifyChangeFailureRate,
  classifyMTTR,
} from '../metrics/dora-bands.js';
import { classifyCycleTime } from '../metrics/cycle-time-bands.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Org-level snapshot key — must match the value used in
 * InProcessSnapshotService. Declared here to avoid a circular import at
 * Lambda runtime.
 */
const ORG_SNAPSHOT_KEY = '__org__';

// ── Types ────────────────────────────────────────────────────────────────────

/** Raw outputs from the metric services for one board + one period. */
interface RawPeriodMetrics {
  df:   { boardId: string; totalDeployments: number; deploymentsPerDay: number; band: string; periodDays: number };
  lt:   { observations: number[]; anomalyCount: number };
  cfr:  { boardId: string; totalDeployments: number; failureCount: number; changeFailureRate: number; band: string; usingDefaultConfig: boolean };
  mttr: { recoveryHours: number[]; openIncidentCount: number; anomalyCount: number };
  boardType?: 'scrum' | 'kanban';
}

/**
 * Assemble an OrgDoraResult-shaped aggregate payload from raw metric outputs
 * across one or more boards. This mirrors MetricsService.buildOrgDoraResult()
 * so that the snapshot payload matches what the frontend expects.
 */
function buildAggregatePayload(
  boardMetrics: RawPeriodMetrics[],
  startDate: Date | string,
  endDate: Date | string,
  period: string,
): object {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end   = typeof endDate   === 'string' ? new Date(endDate)   : endDate;
  const periodMs   = end.getTime() - start.getTime();
  const periodDays = Math.max(periodMs / (1000 * 60 * 60 * 24), 1);

  const totalDeployments = boardMetrics.reduce((s, r) => s + r.df.totalDeployments, 0);
  const deploymentsPerDay = totalDeployments / periodDays;
  const dfContributing = boardMetrics.filter((r) => r.df.totalDeployments > 0).length;

  const allLtObs = boardMetrics.flatMap((r) => r.lt.observations).sort((a, b) => a - b);
  const ltMedian = percentile(allLtObs, 50);
  const ltP95    = percentile(allLtObs, 95);
  const ltContributing = boardMetrics.filter((r) => r.lt.observations.length > 0).length;
  const ltAnomalyTotal = boardMetrics.reduce((s, r) => s + r.lt.anomalyCount, 0);

  const totalFailures    = boardMetrics.reduce((s, r) => s + r.cfr.failureCount, 0);
  const totalDeplForCfr  = boardMetrics.reduce((s, r) => s + r.cfr.totalDeployments, 0);
  const orgCfr = totalDeplForCfr > 0
    ? Math.round((totalFailures / totalDeplForCfr) * 10000) / 100
    : 0;
  const cfrContributing = boardMetrics.filter((r) => r.cfr.totalDeployments > 0).length;
  const boardsUsingDefaultConfig = boardMetrics
    .filter((r) => r.cfr.usingDefaultConfig)
    .map((r) => r.cfr.boardId);
  const anyBoardUsingDefaultConfig = boardsUsingDefaultConfig.length > 0;

  const allMttrObs = boardMetrics.flatMap((r) => r.mttr.recoveryHours).sort((a, b) => a - b);
  const mttrMedian = percentile(allMttrObs, 50);
  const mttrContributing = boardMetrics.filter((r) => r.mttr.recoveryHours.length > 0).length;

  // Per-board breakdowns — computed from each board's raw metrics
  const boardBreakdowns = boardMetrics.map((r) => {
    const boardLtObs = [...r.lt.observations].sort((a, b) => a - b);
    const boardMttrObs = [...r.mttr.recoveryHours].sort((a, b) => a - b);
    const boardDpd = r.df.totalDeployments / periodDays;
    return {
      boardId: r.df.boardId,
      period: { start: start.toISOString(), end: end.toISOString() },
      boardType: r.boardType ?? 'scrum',
      deploymentFrequency: {
        boardId: r.df.boardId,
        totalDeployments: r.df.totalDeployments,
        deploymentsPerDay: round2(boardDpd),
        band: classifyDeploymentFrequency(boardDpd),
        periodDays: Math.round(periodDays),
      },
      leadTime: {
        boardId: r.df.boardId,
        medianDays: round2(percentile(boardLtObs, 50)),
        p95Days: round2(percentile(boardLtObs, 95)),
        band: classifyLeadTime(percentile(boardLtObs, 50)),
        sampleSize: boardLtObs.length,
      },
      changeFailureRate: {
        boardId: r.cfr.boardId,
        totalDeployments: r.cfr.totalDeployments,
        failureCount: r.cfr.failureCount,
        changeFailureRate: r.cfr.changeFailureRate,
        band: classifyChangeFailureRate(r.cfr.changeFailureRate),
        usingDefaultConfig: r.cfr.usingDefaultConfig,
      },
      mttr: {
        boardId: r.df.boardId,
        medianHours: round2(percentile(boardMttrObs, 50)),
        band: classifyMTTR(percentile(boardMttrObs, 50)),
        incidentCount: boardMttrObs.length,
      },
    };
  });

  return {
    period: { label: period, start: start.toISOString(), end: end.toISOString() },
    orgDeploymentFrequency: {
      totalDeployments,
      deploymentsPerDay: round2(deploymentsPerDay),
      band: classifyDeploymentFrequency(deploymentsPerDay),
      periodDays: Math.round(periodDays),
      contributingBoards: dfContributing,
    },
    orgLeadTime: {
      medianDays: round2(ltMedian),
      p95Days: round2(ltP95),
      band: classifyLeadTime(ltMedian),
      sampleSize: allLtObs.length,
      contributingBoards: ltContributing,
      anomalyCount: ltAnomalyTotal,
    },
    orgChangeFailureRate: {
      totalDeployments: totalDeplForCfr,
      failureCount: totalFailures,
      changeFailureRate: orgCfr,
      band: classifyChangeFailureRate(orgCfr),
      contributingBoards: cfrContributing,
      anyBoardUsingDefaultConfig,
      boardsUsingDefaultConfig,
    },
    orgMttr: {
      medianHours: round2(mttrMedian),
      band: classifyMTTR(mttrMedian),
      incidentCount: allMttrObs.length,
      contributingBoards: mttrContributing,
    },
    boardBreakdowns,
    anyBoardUsingDefaultConfig,
    boardsUsingDefaultConfig,
  };
}

export interface SnapshotHandlerEvent {
  boardId: string;
  /** Number of past quarters to compute snapshots for. Defaults to 8. */
  quartersBack?: number;
  /**
   * When true, compute the org-level (__org__) snapshot by merging all boards.
   * Used by the dedicated org invocation fired after all per-board syncs complete.
   * Per-board invocations leave this unset and skip org computation entirely.
   */
  orgSnapshot?: boolean;
}

/** Services needed to build DORA window snapshots from a loaded data slice. */
interface DoraMetricServices {
  df: DeploymentFrequencyService;
  lt: LeadTimeService;
  cfr: CfrService;
  mttr: MttrService;
}

/**
 * Builds the DORA time-period (7/30/90-day) snapshot rows for one or more
 * boards from their pre-loaded data slices. Aggregate = whole window;
 * trend = rolling daily/weekly buckets. Payloads match the shapes the
 * frontend reads (mirrors MetricsService.getDoraAggregate / getDoraTrend).
 */
function buildDoraWindowRows(
  svc: DoraMetricServices,
  slices: TrendDataSlice[],
  boardTypeMap: Map<string, 'scrum' | 'kanban'>,
  snapshotKey: string,
  tz: string,
): Array<{ boardId: string; snapshotType: DoraSnapshotType; payload: object; triggeredBy: string; stale: boolean }> {
  const rows: Array<{ boardId: string; snapshotType: DoraSnapshotType; payload: object; triggeredBy: string; stale: boolean }> = [];

  const rawFor = (slice: TrendDataSlice, start: Date, end: Date): RawPeriodMetrics => ({
    df:   svc.df.calculateFromData(slice, start, end),
    lt:   svc.lt.getLeadTimeObservationsFromData(slice, start, end),
    cfr:  svc.cfr.calculateFromData(slice, start, end),
    mttr: svc.mttr.getMttrObservationsFromData(slice, start, end),
    boardType: boardTypeMap.get(slice.boardId) ?? 'scrum',
  });

  for (const window of TIME_PERIOD_WINDOWS) {
    const { startDate, endDate } = windowToDates(window, tz);
    const aggregate = buildAggregatePayload(
      slices.map((s) => rawFor(s, startDate, endDate)),
      startDate,
      endDate,
      `last-${window}d`,
    );

    const buckets = listRollingBuckets(window, tz); // oldest → newest
    const trend = buckets.map((b) =>
      buildAggregatePayload(
        slices.map((s) => rawFor(s, b.startDate, b.endDate)),
        b.startDate,
        b.endDate,
        b.label,
      ),
    );

    rows.push(
      { boardId: snapshotKey, snapshotType: `aggregate-${window}d` as DoraSnapshotType, payload: aggregate, triggeredBy: snapshotKey, stale: false },
      { boardId: snapshotKey, snapshotType: `trend-${window}d` as DoraSnapshotType, payload: trend, triggeredBy: snapshotKey, stale: false },
    );
  }

  return rows;
}

/**
 * Builds the Support summary time-period (7/30/90-day) snapshot rows for the
 * given board selection. Only the summary is snapshotted (proposal 0080). The
 * SupportService resolves the window date range internally via its
 * timezone-aware resolvePeriod, so we pass the board query string + window.
 */
async function buildSupportWindowRows(
  supportService: SupportService,
  boardIdQuery: string,
  snapshotKey: string,
): Promise<Array<{ boardId: string; snapshotType: SupportSnapshotType; payload: object; triggeredBy: string; stale: boolean }>> {
  const rows: Array<{ boardId: string; snapshotType: SupportSnapshotType; payload: object; triggeredBy: string; stale: boolean }> = [];

  for (const window of TIME_PERIOD_WINDOWS) {
    const summary = await supportService.getSupportSummary({ boardId: boardIdQuery, window });
    rows.push({
      boardId: snapshotKey,
      snapshotType: `summary-${window}d` as SupportSnapshotType,
      payload: summary,
      triggeredBy: snapshotKey,
      stale: false,
    });
  }

  return rows;
}

/**
 * Builds the cycle-time time-period (7/30/90-day) snapshot rows for the given
 * board selection. Aggregate = CycleTimeService result per board over the whole
 * window; trend = pooled cross-board percentiles per rolling bucket. Mirrors
 * MetricsService.getCycleTime / getCycleTimeTrend.
 */
async function buildCycleTimeWindowRows(
  cycleTimeService: CycleTimeService,
  boardIds: string[],
  snapshotKey: string,
  tz: string,
): Promise<Array<{ boardId: string; snapshotType: CycleTimeSnapshotType; payload: object; triggeredBy: string; stale: boolean }>> {
  const rows: Array<{ boardId: string; snapshotType: CycleTimeSnapshotType; payload: object; triggeredBy: string; stale: boolean }> = [];
  // The cycle-time helper below builds daily/weekly bucketed trend + aggregate.

  for (const window of TIME_PERIOD_WINDOWS) {
    const { startDate, endDate } = windowToDates(window, tz);
    const aggregate = await Promise.all(
      boardIds.map((boardId) =>
        cycleTimeService.calculate(boardId, startDate, endDate, `last-${window}d`),
      ),
    );

    // Trend: pooled cross-board percentiles per rolling bucket (oldest → newest).
    const buckets = listRollingBuckets(window, tz);
    const trend = await Promise.all(
      buckets.map(async (b) => {
        const results = await Promise.all(
          boardIds.map((boardId) =>
            cycleTimeService.getCycleTimeObservations(boardId, b.startDate, b.endDate, b.label),
          ),
        );
        const sorted = results
          .flatMap((r) => r.observations)
          .map((o) => o.cycleTimeDays)
          .sort((a, z) => a - z);
        if (sorted.length === 0) {
          return {
            label: b.label,
            start: b.startDate.toISOString(),
            end: b.endDate.toISOString(),
            medianCycleTimeDays: null,
            p85CycleTimeDays: null,
            sampleSize: 0,
            band: null,
          };
        }
        const p50 = percentile(sorted, 50);
        return {
          label: b.label,
          start: b.startDate.toISOString(),
          end: b.endDate.toISOString(),
          medianCycleTimeDays: round2(p50),
          p85CycleTimeDays: round2(percentile(sorted, 85)),
          sampleSize: sorted.length,
          band: classifyCycleTime(p50),
        };
      }),
    );

    rows.push(
      { boardId: snapshotKey, snapshotType: `aggregate-${window}d` as CycleTimeSnapshotType, payload: aggregate, triggeredBy: snapshotKey, stale: false },
      { boardId: snapshotKey, snapshotType: `trend-${window}d` as CycleTimeSnapshotType, payload: trend, triggeredBy: snapshotKey, stale: false },
    );
  }

  return rows;
}

// ── Quarter snapshot helpers (proposal 0082 — prod parity with the in-process
//    writer). The Lambda keeps its own implementation (per proposal 0083 we are
//    NOT unifying yet), so this duplicates the in-process quarter logic:
//    recompute the current quarter every run; compute each historical quarter
//    once (skip if a row already exists — closed-quarter data is immutable).

/**
 * Enumerates the quarter labels (YYYY-QN) the UI can request — derived from
 * closed sprints, matching PlanningService.getQuarters and the in-process
 * writer. The current quarter is always included and returned separately.
 */
async function enumerateQuarters(
  sprintRepo: import('typeorm').Repository<JiraSprint>,
  tz: string,
): Promise<{ current: string; historical: string[] }> {
  const current = listRecentQuarters(1, tz)[0].label;
  const sprints = await sprintRepo.find({
    where: { state: 'closed' },
    select: { startDate: true },
  });
  const labels = new Set<string>();
  for (const s of sprints) {
    if (!s.startDate) continue;
    const { year, month } = dateParts(s.startDate, tz);
    labels.add(`${year}-Q${Math.floor(month / 3) + 1}`);
  }
  labels.delete(current);
  return { current, historical: [...labels] };
}

/** Which quarters to compute this run: current always + historical not yet stored. */
function quartersToCompute(
  current: string,
  historical: string[],
  existingTypes: Set<string>,
  prefix: string, // e.g. 'aggregate-' or 'summary-'
): string[] {
  return [current, ...historical.filter((q) => !existingTypes.has(`${prefix}${q}`))];
}

// ── DB password cache ─────────────────────────────────────────────────────────

let resolvedDbPassword: string | null = null;

async function getDbPassword(): Promise<string> {
  if (resolvedDbPassword !== null) return resolvedDbPassword;

  const secretArn = process.env['DB_PASSWORD_SECRET_ARN'];
  if (!secretArn) {
    throw new Error('DB_PASSWORD_SECRET_ARN environment variable is not set.');
  }

  const client = new SecretsManagerClient({
    region: process.env['AWS_REGION'] ?? 'ap-southeast-2',
  });

  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  const secretString = response.SecretString ?? '';

  // Try parsing as JSON first; fall back to raw string.
  let parsed: string;
  try {
    const obj = JSON.parse(secretString) as Record<string, unknown>;
    const val = obj['password'] ?? obj['DB_PASSWORD'];
    parsed = typeof val === 'string' ? val : secretString;
  } catch {
    parsed = secretString;
  }

  resolvedDbPassword = parsed;
  return resolvedDbPassword;
}

// ── DataSource (module-level, reused across warm invocations) ────────────────

let dataSource: DataSource | null = null;

async function getDataSource(): Promise<DataSource> {
  if (dataSource && dataSource.isInitialized) return dataSource;

  const password = await getDbPassword();

  dataSource = new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
    username: process.env['DB_USERNAME'] ?? 'postgres',
    password,
    database: process.env['DB_DATABASE'] ?? 'ai_starter',
    ssl:
      process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: false } : false,
    entities: [
      JiraIssue,
      JiraChangelog,
      JiraVersion,
      BoardConfig,
      JiraIssueLink,
      WorkingTimeConfigEntity,
      DoraSnapshot,
      CycleTimeSnapshot,
      SupportSnapshot,
      JiraFieldConfig,
      JiraSprint,
      JiraIssueSprint,
      SyncLog,
      RoadmapConfig,
      JpdIdea,
      SprintReport,
    ],
    // The Lambda never runs migrations.
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  return dataSource;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: SnapshotHandlerEvent): Promise<void> => {
  const { boardId, quartersBack = 8, orgSnapshot = false } = event;
  console.log(
    orgSnapshot
      ? `[snapshot-handler] Starting org-level DORA snapshot`
      : `[snapshot-handler] Starting DORA snapshot for board: ${boardId}`,
  );

  const ds = await getDataSource();

  // Repositories
  const issueRepo       = ds.getRepository(JiraIssue);
  const changelogRepo   = ds.getRepository(JiraChangelog);
  const versionRepo     = ds.getRepository(JiraVersion);
  const boardConfigRepo = ds.getRepository(BoardConfig);
  const issueLinkRepo   = ds.getRepository(JiraIssueLink);
  const snapshotRepo    = ds.getRepository(DoraSnapshot);
  const wtConfigRepo    = ds.getRepository(WorkingTimeConfigEntity);

  // Services — manual instantiation, no NestJS IoC
  const configServiceStub = {
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      const val = process.env[key];
      return val !== undefined ? (val as unknown as T) : defaultValue;
    },
  };
  const workingTimeService = new WorkingTimeService(
    wtConfigRepo,
    configServiceStub as unknown as import('@nestjs/config').ConfigService,
  );

  const trendLoader = new TrendDataLoader(
    issueRepo,
    changelogRepo,
    versionRepo,
    boardConfigRepo,
    issueLinkRepo,
    workingTimeService,
  );
  const dfService   = new DeploymentFrequencyService(issueRepo, versionRepo, changelogRepo, boardConfigRepo);
  const ltService   = new LeadTimeService(issueRepo, changelogRepo, versionRepo, boardConfigRepo, workingTimeService);
  const cfrService  = new CfrService(issueRepo, changelogRepo, versionRepo, boardConfigRepo, issueLinkRepo);
  const mttrService = new MttrService(issueRepo, changelogRepo, boardConfigRepo);
  const cycleTimeService = new CycleTimeService(
    issueRepo,
    changelogRepo,
    versionRepo,
    boardConfigRepo,
    configServiceStub as unknown as import('@nestjs/config').ConfigService,
    workingTimeService,
  );
  const cycleTimeSnapshotRepo = ds.getRepository(CycleTimeSnapshot);
  const supportSnapshotRepo   = ds.getRepository(SupportSnapshot);
  const sprintRepo            = ds.getRepository(JiraSprint);
  const issueSprintRepo       = ds.getRepository(JiraIssueSprint);

  const sprintMembershipService = new SprintMembershipService(
    sprintRepo,
    issueSprintRepo,
    changelogRepo,
  );
  const supportService = new SupportService(
    issueRepo,
    changelogRepo,
    versionRepo,
    sprintRepo,
    boardConfigRepo,
    issueLinkRepo,
    configServiceStub as unknown as import('@nestjs/config').ConfigService,
    workingTimeService,
    sprintMembershipService,
  );

  // Compute the trend window: last N quarters (newest first)
  const quarters = listRecentQuarters(quartersBack);
  const rangeStart = quarters[quarters.length - 1].startDate;
  const rangeEnd   = quarters[0].endDate;
  const latestQuarter = quarters[0];

  // Timezone for rolling time-period window boundaries (matches MetricsService).
  const tz = configServiceStub.get<string>('TIMEZONE', 'UTC') ?? 'UTC';
  const doraSvc: DoraMetricServices = { df: dfService, lt: ltService, cfr: cfrService, mttr: mttrService };

  // ── Org-level snapshot ────────────────────────────────────────────────────
  // Fired once after all per-board syncs complete. Reads the already-written
  // per-board trend snapshots from the DB and merges their raw metric payloads
  // to produce the org aggregate and trend rows. This avoids reloading all raw
  // Jira data (which caused the previous approach to time out on large boards).
  if (orgSnapshot) {
    const allBoardConfigs = await boardConfigRepo.find({ select: { boardId: true, boardType: true } });
    const allBoardIds = allBoardConfigs
      .map((bc) => bc.boardId)
      .filter((id) => id !== ORG_SNAPSHOT_KEY);

    if (allBoardIds.length === 0) {
      console.warn('[snapshot-handler] No board configs found; skipping org-level snapshot.');
      return;
    }

    // Map boardId → boardType for use when constructing RawPeriodMetrics breakdowns
    const boardTypeMap = new Map<string, 'scrum' | 'kanban'>(
      allBoardConfigs.map((bc) => [
        bc.boardId,
        bc.boardType === 'kanban' ? 'kanban' : 'scrum',
      ]),
    );

    // Read the per-board trend snapshots written by the per-board Lambda invocations.
    // Each payload is an array of { period, startDate, endDate, df, lt, cfr, mttr }
    // where df/lt/cfr/mttr are raw metric service outputs.
    const boardTrendSnapshots = await snapshotRepo.find({
      where: allBoardIds.map((id) => ({ boardId: id, snapshotType: 'trend' as const })),
    });

    if (boardTrendSnapshots.length === 0) {
      console.warn('[snapshot-handler] No per-board trend snapshots found; cannot build org snapshot.');
      return;
    }

    // Raw shapes from the metric services stored in trend rows:
    //   df:   { boardId, totalDeployments, deploymentsPerDay, band, periodDays }
    //   lt:   { observations: number[]; anomalyCount: number }
    //   cfr:  { boardId, totalDeployments, failureCount, changeFailureRate, band, usingDefaultConfig }
    //   mttr: { recoveryHours: number[]; openIncidentCount: number; anomalyCount: number }
    type RawTrendEntry = {
      period:    string;
      startDate: string;
      endDate:   string;
      df:   { totalDeployments: number; deploymentsPerDay: number; periodDays: number };
      lt:   { observations: number[]; anomalyCount: number };
      cfr:  { totalDeployments: number; failureCount: number; changeFailureRate: number; usingDefaultConfig: boolean };
      mttr: { recoveryHours: number[]; openIncidentCount: number; anomalyCount: number };
    };

    // Merge per-period across all boards, accumulating raw values for re-aggregation
    type MergedEntry = {
      period:    string;
      startDate: string;
      endDate:   string;
      boardMetrics: RawPeriodMetrics[];
    };

    const periodMap = new Map<string, MergedEntry>();

    for (const snapshot of boardTrendSnapshots) {
      const periods = snapshot.payload as RawTrendEntry[];
      if (!Array.isArray(periods)) continue;

      for (const p of periods) {
        const raw: RawPeriodMetrics = {
          df:   { boardId: snapshot.boardId, totalDeployments: p.df?.totalDeployments ?? 0, deploymentsPerDay: p.df?.deploymentsPerDay ?? 0, band: '', periodDays: p.df?.periodDays ?? 91 },
          lt:   { observations: [...(p.lt?.observations ?? [])], anomalyCount: p.lt?.anomalyCount ?? 0 },
          cfr:  { boardId: snapshot.boardId, totalDeployments: p.cfr?.totalDeployments ?? 0, failureCount: p.cfr?.failureCount ?? 0, changeFailureRate: p.cfr?.changeFailureRate ?? 0, band: '', usingDefaultConfig: p.cfr?.usingDefaultConfig ?? false },
          mttr: { recoveryHours: [...(p.mttr?.recoveryHours ?? [])], openIncidentCount: p.mttr?.openIncidentCount ?? 0, anomalyCount: p.mttr?.anomalyCount ?? 0 },
          boardType: boardTypeMap.get(snapshot.boardId) ?? 'scrum',
        };

        const existing = periodMap.get(p.period);
        if (!existing) {
          periodMap.set(p.period, {
            period:    p.period,
            startDate: p.startDate,
            endDate:   p.endDate,
            boardMetrics: [raw],
          });
        } else {
          existing.boardMetrics.push(raw);
        }
      }
    }

    // Sort oldest → newest (ascending by startDate) so trend charts render
    // left-to-right in chronological order. This matches the in-process path
    // (InProcessSnapshotService.computeOrg) and ADR-0042 §5.
    const mergedEntries = Array.from(periodMap.values()).sort(
      (a, b) => a.startDate.localeCompare(b.startDate),
    );

    // Build the trend payload: one OrgDoraResult per period (oldest → newest)
    const orgTrendPayload = mergedEntries.map((entry) =>
      buildAggregatePayload(entry.boardMetrics, entry.startDate, entry.endDate, entry.period),
    );

    // Aggregate payload = latest quarter (last entry in oldest→newest array)
    const latestEntry = mergedEntries[mergedEntries.length - 1];
    const orgAggregatePayload = latestEntry
      ? buildAggregatePayload(latestEntry.boardMetrics, latestEntry.startDate, latestEntry.endDate, latestEntry.period)
      : {};

    await snapshotRepo.upsert(
      [
        {
          boardId: ORG_SNAPSHOT_KEY,
          snapshotType: 'trend' as const,
          payload: orgTrendPayload,
          triggeredBy: ORG_SNAPSHOT_KEY,
          stale: false,
        },
        {
          boardId: ORG_SNAPSHOT_KEY,
          snapshotType: 'aggregate' as const,
          payload: orgAggregatePayload,
          triggeredBy: ORG_SNAPSHOT_KEY,
          stale: false,
        },
      ],
      ['boardId', 'snapshotType'],
    );

    console.log(`[snapshot-handler] Org-level snapshot written from ${boardTrendSnapshots.length} board snapshots.`);

    // ── Org-level quarter aggregates (proposal 0082 — prod parity) ──────────
    // mergedEntries already holds one merged (all-board) OrgDoraResult per
    // quarter — the same data used for orgTrendPayload. Emit one
    // aggregate-<quarter> row per merged quarter (no raw reload, no timeout risk).
    const orgDoraQuarterRows = mergedEntries.map((entry) => ({
      boardId: ORG_SNAPSHOT_KEY,
      snapshotType: `aggregate-${entry.period}` as DoraSnapshotType,
      payload: buildAggregatePayload(entry.boardMetrics, entry.startDate, entry.endDate, entry.period),
      triggeredBy: ORG_SNAPSHOT_KEY,
      stale: false,
    }));
    if (orgDoraQuarterRows.length > 0) {
      await snapshotRepo.upsert(orgDoraQuarterRows, ['boardId', 'snapshotType']);
    }

    // ── Org-level time-period (rolling window) snapshots ────────────────────
    // Load raw slices only for the widest window (90 days) across all boards,
    // then derive all three windows in-memory. Bounded to ≤90 days of data.
    const widestWindow = Math.max(...TIME_PERIOD_WINDOWS);
    const { startDate: winRangeStart, endDate: winRangeEnd } = windowToDates(widestWindow, tz);
    const windowSlices = await Promise.all(
      allBoardIds.map((id) => trendLoader.load(id, winRangeStart, winRangeEnd)),
    );

    const orgDoraWindowRows = buildDoraWindowRows(
      doraSvc,
      windowSlices,
      boardTypeMap,
      ORG_SNAPSHOT_KEY,
      tz,
    );
    await snapshotRepo.upsert(orgDoraWindowRows, ['boardId', 'snapshotType']);

    const orgCycleWindowRows = await buildCycleTimeWindowRows(
      cycleTimeService,
      allBoardIds,
      ORG_SNAPSHOT_KEY,
      tz,
    );
    await cycleTimeSnapshotRepo.upsert(orgCycleWindowRows, ['boardId', 'snapshotType']);

    const orgSupportWindowRows = await buildSupportWindowRows(
      supportService,
      allBoardIds.join(','),
      ORG_SNAPSHOT_KEY,
    );
    await supportSnapshotRepo.upsert(orgSupportWindowRows, ['boardId', 'snapshotType']);

    // ── Org-level cycle-time & support quarter snapshots (proposal 0082) ────
    // Bounded per-quarter compute over all boards (current + historical-once).
    const { current: orgCurQ, historical: orgHistQ } = await enumerateQuarters(sprintRepo, tz);
    const allBoardsQuery = allBoardIds.join(',');

    const orgCtExisting = new Set(
      (await cycleTimeSnapshotRepo.find({ where: { boardId: ORG_SNAPSHOT_KEY }, select: { snapshotType: true } })).map(
        (r) => r.snapshotType,
      ),
    );
    const orgCtQuarterRows: Array<{ boardId: string; snapshotType: CycleTimeSnapshotType; payload: object; triggeredBy: string; stale: boolean }> = [];
    for (const q of quartersToCompute(orgCurQ, orgHistQ, orgCtExisting, 'aggregate-')) {
      const { startDate, endDate } = quarterToDates(q, tz);
      const perBoard = await Promise.all(
        allBoardIds.map((id) => cycleTimeService.calculate(id, startDate, endDate, q)),
      );
      orgCtQuarterRows.push({
        boardId: ORG_SNAPSHOT_KEY,
        snapshotType: `aggregate-${q}` as CycleTimeSnapshotType,
        payload: perBoard,
        triggeredBy: ORG_SNAPSHOT_KEY,
        stale: false,
      });
    }
    // trend-quarters (pooled percentiles across all boards, oldest → newest).
    const orgQuarterTrend = await Promise.all(
      listRecentQuarters(8, tz)
        .slice()
        .reverse()
        .map(async (q) => {
          const results = await Promise.all(
            allBoardIds.map((id) =>
              cycleTimeService.getCycleTimeObservations(id, q.startDate, q.endDate, q.label),
            ),
          );
          const sorted = results
            .flatMap((r) => r.observations)
            .map((o) => o.cycleTimeDays)
            .sort((a, z) => a - z);
          if (sorted.length === 0) {
            return { label: q.label, start: q.startDate.toISOString(), end: q.endDate.toISOString(), medianCycleTimeDays: null, p85CycleTimeDays: null, sampleSize: 0, band: null };
          }
          const p50 = percentile(sorted, 50);
          return { label: q.label, start: q.startDate.toISOString(), end: q.endDate.toISOString(), medianCycleTimeDays: round2(p50), p85CycleTimeDays: round2(percentile(sorted, 85)), sampleSize: sorted.length, band: classifyCycleTime(p50) };
        }),
    );
    orgCtQuarterRows.push({
      boardId: ORG_SNAPSHOT_KEY,
      snapshotType: 'trend-quarters',
      payload: orgQuarterTrend,
      triggeredBy: ORG_SNAPSHOT_KEY,
      stale: false,
    });
    await cycleTimeSnapshotRepo.upsert(orgCtQuarterRows, ['boardId', 'snapshotType']);

    const orgSupExisting = new Set(
      (await supportSnapshotRepo.find({ where: { boardId: ORG_SNAPSHOT_KEY }, select: { snapshotType: true } })).map(
        (r) => r.snapshotType,
      ),
    );
    const orgSupQuarterRows: Array<{ boardId: string; snapshotType: SupportSnapshotType; payload: object; triggeredBy: string; stale: boolean }> = [];
    for (const q of quartersToCompute(orgCurQ, orgHistQ, orgSupExisting, 'summary-')) {
      const summary = await supportService.getSupportSummary({ boardId: allBoardsQuery, quarter: q });
      orgSupQuarterRows.push({
        boardId: ORG_SNAPSHOT_KEY,
        snapshotType: `summary-${q}` as SupportSnapshotType,
        payload: summary,
        triggeredBy: ORG_SNAPSHOT_KEY,
        stale: false,
      });
    }
    await supportSnapshotRepo.upsert(orgSupQuarterRows, ['boardId', 'snapshotType']);

    console.log(`[snapshot-handler] Org-level time-period snapshots written.`);
    return;
  }

  // ── Per-board snapshot ────────────────────────────────────────────────────
  // Load only this board's data. Does NOT touch the org snapshot.
  const slice = await trendLoader.load(boardId, rangeStart, rangeEnd);

  // Look up the board's type once — used in all period metrics for this board.
  const boardConfig = await boardConfigRepo.findOne({ where: { boardId } });
  const boardType: 'scrum' | 'kanban' = boardConfig?.boardType === 'kanban' ? 'kanban' : 'scrum';

  // trendPayload: raw per-board metric output stored oldest→newest (ADR-0042 §5).
  // quarters is newest-first, so reverse after mapping.
  const trendPayload = quarters.map((q) => ({
    period:    q.label,
    startDate: q.startDate,
    endDate:   q.endDate,
    df:   dfService.calculateFromData(slice, q.startDate, q.endDate),
    lt:   ltService.getLeadTimeObservationsFromData(slice, q.startDate, q.endDate),
    cfr:  cfrService.calculateFromData(slice, q.startDate, q.endDate),
    mttr: mttrService.getMttrObservationsFromData(slice, q.startDate, q.endDate),
  })).reverse(); // oldest → newest

  const aggregateRaw: RawPeriodMetrics = {
    df:   dfService.calculateFromData(slice, latestQuarter.startDate, latestQuarter.endDate),
    lt:   ltService.getLeadTimeObservationsFromData(slice, latestQuarter.startDate, latestQuarter.endDate),
    cfr:  cfrService.calculateFromData(slice, latestQuarter.startDate, latestQuarter.endDate),
    mttr: mttrService.getMttrObservationsFromData(slice, latestQuarter.startDate, latestQuarter.endDate),
    boardType,
  };
  const aggregatePayload = buildAggregatePayload(
    [aggregateRaw],
    latestQuarter.startDate,
    latestQuarter.endDate,
    latestQuarter.label,
  );

  // trendDisplayPayload: OrgDoraResult[] per quarter, oldest→newest (ADR-0042 §5).
  // quarters is newest-first, so reverse after mapping.
  const trendDisplayPayload = quarters.map((q) => {
    const raw: RawPeriodMetrics = {
      df:   dfService.calculateFromData(slice, q.startDate, q.endDate),
      lt:   ltService.getLeadTimeObservationsFromData(slice, q.startDate, q.endDate),
      cfr:  cfrService.calculateFromData(slice, q.startDate, q.endDate),
      mttr: mttrService.getMttrObservationsFromData(slice, q.startDate, q.endDate),
      boardType,
    };
    return buildAggregatePayload([raw], q.startDate, q.endDate, q.label);
  }).reverse(); // oldest → newest

  await snapshotRepo.upsert(
    [
      {
        boardId,
        snapshotType: 'trend' as const,
        payload: trendPayload,
        triggeredBy: boardId,
        stale: false,
      },
      {
        boardId,
        snapshotType: 'trend-display' as const,
        payload: trendDisplayPayload,
        triggeredBy: boardId,
        stale: false,
      },
      {
        boardId,
        snapshotType: 'aggregate' as const,
        payload: aggregatePayload,
        triggeredBy: boardId,
        stale: false,
      },
    ],
    ['boardId', 'snapshotType'],
  );

  // Per-board time-period (rolling window) snapshots. The quarter `slice` spans
  // the last 8 quarters, which fully covers the widest (90-day) window.
  const boardTypeMapSingle = new Map<string, 'scrum' | 'kanban'>([[boardId, boardType]]);
  const boardDoraWindowRows = buildDoraWindowRows(
    doraSvc,
    [slice],
    boardTypeMapSingle,
    boardId,
    tz,
  );
  await snapshotRepo.upsert(boardDoraWindowRows, ['boardId', 'snapshotType']);

  const boardCycleWindowRows = await buildCycleTimeWindowRows(
    cycleTimeService,
    [boardId],
    boardId,
    tz,
  );
  await cycleTimeSnapshotRepo.upsert(boardCycleWindowRows, ['boardId', 'snapshotType']);

  const boardSupportWindowRows = await buildSupportWindowRows(
    supportService,
    boardId,
    boardId,
  );
  await supportSnapshotRepo.upsert(boardSupportWindowRows, ['boardId', 'snapshotType']);

  // ── Per-board quarter snapshots (proposal 0082 — prod parity) ─────────────
  // DORA historical quarters as aggregate-<quarter>; the current quarter is
  // already stored above as `aggregate`. Cycle-time aggregate-<quarter> + a
  // single trend-quarters. Support summary-<quarter>. Current quarter every run;
  // each historical quarter once (skip if a row exists).
  const { current: curQ, historical: histQ } = await enumerateQuarters(sprintRepo, tz);

  // DORA: reuse the raw slice + buildAggregatePayload (no MetricsService here).
  const doraExisting = new Set(
    (await snapshotRepo.find({ where: { boardId }, select: { snapshotType: true } })).map(
      (r) => r.snapshotType,
    ),
  );
  const doraQuarterRows: Array<{ boardId: string; snapshotType: DoraSnapshotType; payload: object; triggeredBy: string; stale: boolean }> = [];
  // Historical quarters only (current quarter is the existing `aggregate` row).
  for (const q of histQ.filter((h) => !doraExisting.has(`aggregate-${h}` as DoraSnapshotType))) {
    const { startDate, endDate } = quarterToDates(q, tz);
    const raw: RawPeriodMetrics = {
      df:   dfService.calculateFromData(slice, startDate, endDate),
      lt:   ltService.getLeadTimeObservationsFromData(slice, startDate, endDate),
      cfr:  cfrService.calculateFromData(slice, startDate, endDate),
      mttr: mttrService.getMttrObservationsFromData(slice, startDate, endDate),
      boardType,
    };
    doraQuarterRows.push({
      boardId,
      snapshotType: `aggregate-${q}` as DoraSnapshotType,
      payload: buildAggregatePayload([raw], startDate, endDate, q),
      triggeredBy: boardId,
      stale: false,
    });
  }
  if (doraQuarterRows.length > 0) {
    await snapshotRepo.upsert(doraQuarterRows, ['boardId', 'snapshotType']);
  }

  // Cycle-time quarter aggregates + a single quarter trend.
  const ctExisting = new Set(
    (await cycleTimeSnapshotRepo.find({ where: { boardId }, select: { snapshotType: true } })).map(
      (r) => r.snapshotType,
    ),
  );
  const ctQuarterRows: Array<{ boardId: string; snapshotType: CycleTimeSnapshotType; payload: object; triggeredBy: string; stale: boolean }> = [];
  for (const q of quartersToCompute(curQ, histQ, ctExisting, 'aggregate-')) {
    const { startDate, endDate } = quarterToDates(q, tz);
    const aggregate = await cycleTimeService.calculate(boardId, startDate, endDate, q);
    ctQuarterRows.push({
      boardId,
      snapshotType: `aggregate-${q}` as CycleTimeSnapshotType,
      payload: aggregate,
      triggeredBy: boardId,
      stale: false,
    });
  }
  // trend-quarters: one point per quarter (pooled percentiles), recomputed every
  // run (its latest point — the current quarter — changes each sync).
  const quarterTrendPoints = await Promise.all(
    listRecentQuarters(8, tz)
      .slice()
      .reverse() // oldest → newest
      .map(async (q) => {
        const { observations } = await cycleTimeService.getCycleTimeObservations(
          boardId,
          q.startDate,
          q.endDate,
          q.label,
        );
        const sorted = observations.map((o) => o.cycleTimeDays).sort((a, z) => a - z);
        if (sorted.length === 0) {
          return {
            label: q.label,
            start: q.startDate.toISOString(),
            end: q.endDate.toISOString(),
            medianCycleTimeDays: null,
            p85CycleTimeDays: null,
            sampleSize: 0,
            band: null,
          };
        }
        const p50 = percentile(sorted, 50);
        return {
          label: q.label,
          start: q.startDate.toISOString(),
          end: q.endDate.toISOString(),
          medianCycleTimeDays: round2(p50),
          p85CycleTimeDays: round2(percentile(sorted, 85)),
          sampleSize: sorted.length,
          band: classifyCycleTime(p50),
        };
      }),
  );
  ctQuarterRows.push({
    boardId,
    snapshotType: 'trend-quarters',
    payload: quarterTrendPoints,
    triggeredBy: boardId,
    stale: false,
  });
  await cycleTimeSnapshotRepo.upsert(ctQuarterRows, ['boardId', 'snapshotType']);

  // Support quarter summaries.
  const supExisting = new Set(
    (await supportSnapshotRepo.find({ where: { boardId }, select: { snapshotType: true } })).map(
      (r) => r.snapshotType,
    ),
  );
  const supQuarterRows: Array<{ boardId: string; snapshotType: SupportSnapshotType; payload: object; triggeredBy: string; stale: boolean }> = [];
  for (const q of quartersToCompute(curQ, histQ, supExisting, 'summary-')) {
    const summary = await supportService.getSupportSummary({ boardId, quarter: q });
    supQuarterRows.push({
      boardId,
      snapshotType: `summary-${q}` as SupportSnapshotType,
      payload: summary,
      triggeredBy: boardId,
      stale: false,
    });
  }
  await supportSnapshotRepo.upsert(supQuarterRows, ['boardId', 'snapshotType']);

  console.log(`[snapshot-handler] Snapshot written for board: ${boardId}`);
  // DataSource remains open — reused on next warm invocation.
};
