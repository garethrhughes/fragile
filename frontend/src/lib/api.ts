// ---------------------------------------------------------------------------
// API client – typed wrappers for every backend endpoint
// ---------------------------------------------------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ---- Shared types --------------------------------------------------------

export type DoraBand = 'elite' | 'high' | 'medium' | 'low';

export interface MetricResult {
  value: number;
  unit: string;
  band: DoraBand;
  trend?: number[];
}

export interface BoardConfig {
  boardId: string;
  boardType: string;
  doneStatusNames: string[];
  failureIssueTypes: string[];
  failureLinkTypes: string[];
  failureLabels: string[];
  incidentIssueTypes: string[];
  recoveryStatusNames: string[];
  incidentLabels: string[];
  backlogStatusIds: string[];
  boardEntryStatuses: string[] | null;
  dataStartDate: string | null;
  inProgressStatusNames: string[];
  cancelledStatusNames: string[];
  roadmapLinkTypes: string[];
  supportLabels: string[];
  supportLinkTypes: string[];
  triageBoardKey: string | null;
  supportEpics: string[];
}

export interface SprintAccuracy {
  sprintId: string;
  sprintName: string;
  state: string;
  startDate: string | null;
  commitment: number;
  added: number;
  removed: number;
  completed: number;
  scopeChangePercent: number;
  completionRate: number;
  /** Planning accuracy (0-100). null when commitment is zero. */
  planningAccuracy: number | null;
  /** Sum of committed story points. null signals ticket-count fallback. */
  committedPoints: number | null;
  /** Sum of completed committed story points. null signals ticket-count fallback. */
  completedPoints: number | null;
}

export interface MetricsQueryParams {
  boardId: string;
  period?: 'sprint' | 'quarter';
  sprintId?: string;
  quarter?: string;
}

export interface PlanningQueryParams {
  boardId: string;
  sprintId?: string;
  quarter?: string;
}

export interface SprintInfo {
  id: string;
  name: string;
  state: string;
}

export interface SyncStatusItem {
  boardId: string;
  lastSync: string | null;
  status: string;
  syncType: string | null;
}

type SyncStatusResponse = SyncStatusItem[];

export interface DoraMetricsBoard {
  boardId: string;
  period: { start: string; end: string };
  deploymentFrequency: {
    boardId: string;
    totalDeployments: number;
    deploymentsPerDay: number;
    band: DoraBand;
    periodDays: number;
  };
  leadTime: {
    boardId: string;
    medianDays: number;
    p95Days: number;
    band: DoraBand;
    sampleSize: number;
  };
  changeFailureRate: {
    boardId: string;
    totalDeployments: number;
    failureCount: number;
    changeFailureRate: number;
    band: DoraBand;
    usingDefaultConfig: boolean;
  };
  mttr: {
    boardId: string;
    medianHours: number;
    band: DoraBand;
    incidentCount: number;
  };
}

type DoraMetricsResponse = DoraMetricsBoard[];

type PlanningAccuracyResponse = SprintAccuracy[];

export type SprintsResponse = SprintInfo[];

export interface QuarterInfo {
  quarter: string;
  startDate: string;
  endDate: string;
}

export type QuartersResponse = QuarterInfo[];

type BoardsResponse = BoardConfig[];

// ---- Error class ---------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Thrown by getDoraTrend / getDoraAggregate when the backend returns HTTP 202,
 * meaning the DORA snapshot has not yet been computed (first sync still running).
 */
export class SnapshotPendingError extends Error {
  constructor(message = 'DORA snapshot not yet available. Sync in progress.') {
    super(message);
    this.name = 'SnapshotPendingError';
  }
}

// ---- Core fetch helper ---------------------------------------------------

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, `API error ${res.status}: ${body}`)
  }

  // 204 No Content — return undefined (caller must type as Promise<void>)
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

// ---- Query-string helper -------------------------------------------------

function toQueryString(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (pair): pair is [string, string] => pair[1] !== undefined && pair[1] !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries).toString();
}

// ---- Typed endpoint wrappers ---------------------------------------------

export type SyncMode = 'full' | 'incremental';

export function triggerSync(mode: SyncMode = 'full'): Promise<{ message: string }> {
  return apiFetch(`/api/sync${toQueryString({ mode })}`, { method: 'POST' });
}

export function getSyncStatus(): Promise<SyncStatusResponse> {
  return apiFetch('/api/sync/status');
}

export function getBoards(): Promise<BoardsResponse> {
  return apiFetch('/api/boards');
}

export function getBoardConfig(boardId: string): Promise<BoardConfig> {
  return apiFetch(`/api/boards/${encodeURIComponent(boardId)}/config`);
}

export function updateBoardConfig(
  boardId: string,
  config: Partial<BoardConfig>,
): Promise<BoardConfig> {
  return apiFetch(`/api/boards/${encodeURIComponent(boardId)}/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export interface CreateBoardRequest {
  boardId: string
  boardType: 'scrum' | 'kanban'
}

export function createBoard(body: CreateBoardRequest): Promise<BoardConfig> {
  return apiFetch<BoardConfig>('/api/boards', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteBoard(boardId: string): Promise<void> {
  return apiFetch(`/api/boards/${encodeURIComponent(boardId)}`, {
    method: 'DELETE',
  })
}

export function getDoraMetrics(
  params: MetricsQueryParams,
): Promise<DoraMetricsResponse> {
  return apiFetch(
    `/api/metrics/dora${toQueryString({
      boardId: params.boardId,
      period: params.period,
      sprintId: params.sprintId,
      quarter: params.quarter,
    })}`,
  );
}

export function getDeploymentFrequency(
  params: MetricsQueryParams,
): Promise<unknown[]> {
  return apiFetch(
    `/api/metrics/deployment-frequency${toQueryString({
      boardId: params.boardId,
      period: params.period,
      sprintId: params.sprintId,
      quarter: params.quarter,
    })}`,
  );
}

export function getLeadTime(
  params: MetricsQueryParams,
): Promise<unknown[]> {
  return apiFetch(
    `/api/metrics/lead-time${toQueryString({
      boardId: params.boardId,
      period: params.period,
      sprintId: params.sprintId,
      quarter: params.quarter,
    })}`,
  );
}

export function getCfr(
  params: MetricsQueryParams,
): Promise<unknown[]> {
  return apiFetch(
    `/api/metrics/cfr${toQueryString({
      boardId: params.boardId,
      period: params.period,
      sprintId: params.sprintId,
      quarter: params.quarter,
    })}`,
  );
}

export function getMttr(
  params: MetricsQueryParams,
): Promise<unknown[]> {
  return apiFetch(
    `/api/metrics/mttr${toQueryString({
      boardId: params.boardId,
      period: params.period,
      sprintId: params.sprintId,
      quarter: params.quarter,
    })}`,
  );
}

export function getPlanningAccuracy(
  params: PlanningQueryParams,
): Promise<PlanningAccuracyResponse> {
  return apiFetch(
    `/api/planning/accuracy${toQueryString({
      boardId: params.boardId,
      sprintId: params.sprintId,
      quarter: params.quarter,
    })}`,
  );
}

export function getSprints(boardId: string): Promise<SprintsResponse> {
  return apiFetch(
    `/api/planning/sprints${toQueryString({ boardId })}`,
  );
}

export function getQuarters(): Promise<QuartersResponse> {
  return apiFetch('/api/planning/quarters');
}

// ---- Kanban quarterly flow metrics ---------------------------------------

export interface KanbanQuarterSummary {
  quarter: string
  state: string
  issuesPulledIn: number
  completed: number
  addedMidQuarter: number
  pointsIn: number
  pointsDone: number
  deliveryRate: number
}

export function getKanbanQuarters(boardId: string): Promise<KanbanQuarterSummary[]> {
  return apiFetch(
    `/api/planning/kanban-quarters/${encodeURIComponent(boardId)}`,
  )
}

// ---- Kanban weekly flow metrics ------------------------------------------

export interface KanbanWeekSummary {
  week: string
  state: string
  weekStart: string
  issuesPulledIn: number
  completed: number
  addedMidWeek: number
  inFlightCount: number
  pointsIn: number
  pointsDone: number
  deliveryRate: number
}

export interface WeekDetailIssue {
  key: string
  summary: string
  issueType: string
  priority: string | null
  status: string
  points: number | null
  epicKey: string | null
  assignedWeek: string
  completedInWeek: boolean
  addedMidWeek: boolean
  roadmapStatus: 'in-scope' | 'linked' | 'none'
  roadmapLinkSource: 'direct' | 'epic' | null
  isIncident: boolean
  isFailure: boolean
  labels: string[]
  boardEntryDate: string
  cycleTimeDays: number | null
  /** True when the representative cycle is a reopen (proposal 0054 AC C). */
  isReopen: boolean
  jiraUrl: string
  /** True if the issue is currently in-flight (on board, not done or cancelled). */
  inFlight: boolean
}

export interface WeekDetailSummary {
  totalIssues: number
  completedIssues: number
  addedMidWeek: number
  roadmapLinkedCount: number
  incidentCount: number
  failureCount: number
  totalPoints: number
  completedPoints: number
  medianCycleTimeDays: number | null
  /** Issues whose representative cycle is a reopen (proposal 0054 AC C). */
  reopenedIssueCount: number
  /** Count of on-board issues currently in-flight (not done, not cancelled). */
  inFlightCount: number
}

export interface WeekDetailBoardConfig {
  boardType: string
  doneStatusNames: string[]
}

export interface WeekDetailResponse {
  boardId: string
  week: string
  weekStart: string
  weekEnd: string
  summary: WeekDetailSummary
  issues: WeekDetailIssue[]
  boardConfig: WeekDetailBoardConfig
}

export function getKanbanWeeks(boardId: string): Promise<KanbanWeekSummary[]> {
  return apiFetch<KanbanWeekSummary[]>(`/api/planning/kanban-weeks/${encodeURIComponent(boardId)}`)
}

export function getWeekDetail(boardId: string, week: string): Promise<WeekDetailResponse> {
  return apiFetch<WeekDetailResponse>(`/api/weeks/${encodeURIComponent(boardId)}/${encodeURIComponent(week)}/detail`)
}

// ---- Roadmap Accuracy types and endpoints --------------------------------

export interface RoadmapConfig {
  id: number;
  jpdKey: string;
  description: string | null;
  startDateFieldId: string | null;
  targetDateFieldId: string | null;
  createdAt: string;
}

export interface RoadmapSprintAccuracy {
  sprintId: string;
  sprintName: string;
  state: string;
  startDate: string | null;
  totalIssues: number;
  coveredIssues: number;
  uncoveredIssues: number;
  /** Issues linked to a roadmap idea (green + amber). Used as on-time rate denominator. */
  linkedCount: number;
  /** Cancelled issues in the total (excluded from linkedCount regardless of link status). */
  cancelledCount: number;
  roadmapCoverage: number;
  /** On-time delivery rate: green ÷ (green + amber). 0 when no linked issues. */
  roadmapOnTimeRate: number;
}

export function getRoadmapAccuracy(params: {
  boardId: string
  sprintId?: string
  quarter?: string
  week?: string
  weekMode?: boolean
}): Promise<RoadmapSprintAccuracy[]> {
  return apiFetch(
    `/api/roadmap/accuracy${toQueryString({
      boardId: params.boardId,
      sprintId: params.sprintId,
      quarter: params.quarter,
      week: params.week,
      weekMode: params.weekMode !== undefined ? String(params.weekMode) : undefined,
    })}`,
  )
}

// Per-epic coverage detail — proposal 0053.

export interface EpicCoveragePrimaryIdea {
  ideaKey: string
  ideaSummary: string | null
  targetDate: string
  startDate: string | null
}

export interface EpicCoverageConflictingIdea {
  ideaKey: string
  ideaSummary: string | null
  targetDate: string
  daysFromPrimary: number
}

export type EpicCoverageResolvedSource = 'deliveryIssueKeys' | 'directLink' | 'none'

export type EpicCoverageState = 'green' | 'amber' | 'red' | 'unlinked'

export interface EpicCoverageDetail {
  epicKey: string
  epicSummary: string | null
  primaryIdea: EpicCoveragePrimaryIdea | null
  conflictingIdeas: EpicCoverageConflictingIdea[]
  resolvedSource: EpicCoverageResolvedSource
  coverageState: EpicCoverageState
}

export interface RoadmapEpicsResponse {
  epics: EpicCoverageDetail[]
  conflictCount: number
}

export function getRoadmapEpics(params: {
  boardId: string
  sprintId?: string
  quarter?: string
  week?: string
}): Promise<RoadmapEpicsResponse> {
  return apiFetch(
    `/api/roadmap/epics${toQueryString({
      boardId: params.boardId,
      sprintId: params.sprintId,
      quarter: params.quarter,
      week: params.week,
    })}`,
  )
}

export function getRoadmapConfigs(): Promise<RoadmapConfig[]> {
  return apiFetch('/api/roadmap/configs');
}

export function createRoadmapConfig(body: {
  jpdKey: string;
  description?: string;
}): Promise<RoadmapConfig> {
  return apiFetch('/api/roadmap/configs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateRoadmapConfig(
  id: number,
  body: { startDateFieldId?: string | null; targetDateFieldId?: string | null },
): Promise<RoadmapConfig> {
  return apiFetch(`/api/roadmap/configs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteRoadmapConfig(id: number): Promise<void> {
  return apiFetch(`/api/roadmap/configs/${id}`, { method: 'DELETE' });
}

export function triggerRoadmapSync(): Promise<{ message: string }> {
  return apiFetch('/api/roadmap/sync', { method: 'POST' });
}

// ---- Sprint Detail types and endpoint ------------------------------------

/** Board configuration rules applied to derive per-issue annotations */
export interface SprintDetailBoardConfig {
  doneStatusNames: string[]
  failureIssueTypes: string[]
  failureLabels: string[]
  incidentIssueTypes: string[]
  incidentLabels: string[]
}

export interface SprintDetailIssue {
  key: string
  summary: string
  currentStatus: string
  issueType: string
  priority: string | null
  addedMidSprint: boolean
  roadmapStatus: 'in-scope' | 'linked' | 'none'
  roadmapLinkSource: 'epic' | 'direct' | null
  isIncident: boolean
  isFailure: boolean
  completedInSprint: boolean
  resolvedAt: string | null
  /** Reopen-aware representative-cycle duration (proposal 0054). Null when no completed cycle. */
  cycleTimeDays: number | null
  /** True when the representative cycle is a reopen (proposal 0054). */
  isReopen: boolean
  jiraUrl: string
}

export interface SprintDetailSummary {
  committedCount: number
  addedMidSprintCount: number
  removedCount: number
  completedInSprintCount: number
  roadmapLinkedCount: number
  incidentCount: number
  failureCount: number
}

export interface SprintDetailResponse {
  sprintId: string
  sprintName: string
  state: string
  startDate: string | null
  endDate: string | null
  /** Actual sprint close time (Jira completeDate); null if not closed. */
  completeDate: string | null
  boardConfig: SprintDetailBoardConfig
  summary: SprintDetailSummary
  issues: SprintDetailIssue[]
}

export function getSprintDetail(
  boardId: string,
  sprintId: string,
): Promise<SprintDetailResponse> {
  return apiFetch(
    `/api/sprints/${encodeURIComponent(boardId)}/${encodeURIComponent(sprintId)}/detail`,
  )
}

// ---- Quarter Detail types and endpoint -----------------------------------

export interface QuarterDetailIssue {
  key: string
  summary: string
  issueType: string
  priority: string | null
  status: string
  points: number | null
  epicKey: string | null
  assignedQuarter: string
  completedInQuarter: boolean
  addedMidQuarter: boolean
  linkedToRoadmap: boolean
  roadmapStatus: 'in-scope' | 'linked' | 'none'
  roadmapLinkSource: 'direct' | 'epic' | null
  isIncident: boolean
  isFailure: boolean
  labels: string[]
  boardEntryDate: string
  jiraUrl: string
}

export interface QuarterDetailSummary {
  totalIssues: number
  completedIssues: number
  addedMidQuarter: number
  roadmapLinkedCount: number
  incidentCount: number
  failureCount: number
  totalPoints: number
  completedPoints: number
}

export interface QuarterDetailBoardConfig {
  boardType: string
  doneStatusNames: string[]
}

export interface QuarterDetailResponse {
  boardId: string
  quarter: string
  quarterStart: string
  quarterEnd: string
  summary: QuarterDetailSummary
  issues: QuarterDetailIssue[]
  boardConfig: QuarterDetailBoardConfig
}

export function getQuarterDetail(
  boardId: string,
  quarter: string,
): Promise<QuarterDetailResponse> {
  return apiFetch<QuarterDetailResponse>(
    `/api/quarters/${encodeURIComponent(boardId)}/${encodeURIComponent(quarter)}/detail`,
  )
}

// ---- DORA Aggregate & Trend types and endpoints --------------------------

export interface OrgDeploymentFrequencyResult {
  totalDeployments: number
  deploymentsPerDay: number
  band: DoraBand
  periodDays: number
  contributingBoards: number
}

export interface OrgLeadTimeResult {
  medianDays: number
  p95Days: number
  band: DoraBand
  sampleSize: number
  contributingBoards: number
  /** Issues completed in-window but excluded because no in-progress transition was found */
  anomalyCount: number
}

export interface OrgCfrResult {
  totalDeployments: number
  failureCount: number
  changeFailureRate: number
  band: DoraBand
  contributingBoards: number
  anyBoardUsingDefaultConfig: boolean
  boardsUsingDefaultConfig: string[]
}

export interface OrgMttrResult {
  medianHours: number
  band: DoraBand
  incidentCount: number
  contributingBoards: number
}

/** Extended board breakdown that includes boardType (RC-4) */
export interface DoraMetricsBoardBreakdown extends DoraMetricsBoard {
  boardType: 'scrum' | 'kanban'
}

export interface OrgDoraResult {
  period: { label: string; start: string; end: string }
  orgDeploymentFrequency: OrgDeploymentFrequencyResult
  orgLeadTime: OrgLeadTimeResult | undefined
  orgChangeFailureRate: OrgCfrResult
  orgMttr: OrgMttrResult
  boardBreakdowns: DoraMetricsBoardBreakdown[] | undefined
  anyBoardUsingDefaultConfig: boolean
  boardsUsingDefaultConfig: string[]
}

/** A trend entry is an OrgDoraResult — same shape as the aggregate. */
export type TrendPoint = OrgDoraResult

export type TrendResponse = TrendPoint[]

export interface DoraAggregateParams {
  /** Comma-separated board IDs (same semantics as MetricsQueryDto.boardId) */
  boardId?: string
  /** Sprint ID — when provided, metrics are scoped to the sprint window. */
  sprintId?: string
}

export interface DoraTrendParams {
  /** Comma-separated board IDs (same semantics as MetricsQueryDto.boardId) */
  boardId?: string
  limit?: number
  /** Period mode: 'quarter' (default) or 'sprint'. */
  mode?: 'quarter' | 'sprint'
  /** Sprint ID — used when mode='sprint'. */
  sprintId?: string
}

/**
 * Fetches a DORA snapshot endpoint. Throws SnapshotPendingError on HTTP 202
 * (snapshot not yet computed), which is distinct from the sync 202 response.
 */
async function fetchDoraSnapshot<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    next: { revalidate: 60 },
  } as RequestInit)

  if (res.status === 202) throw new SnapshotPendingError()

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, `API error ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

export function getDoraAggregate(params: DoraAggregateParams): Promise<OrgDoraResult> {
  return fetchDoraSnapshot(
    `/api/metrics/dora/aggregate${toQueryString({
      boardId: params.boardId,
      sprintId: params.sprintId,
    })}`,
  )
}

export function getDoraTrend(params: DoraTrendParams): Promise<TrendResponse> {
  return fetchDoraSnapshot(
    `/api/metrics/dora/trend${toQueryString({
      boardId: params.boardId,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
      mode: params.mode,
      sprintId: params.sprintId,
    })}`,
  )
}

// ---- Cycle Time types ----------------------------------------------------

export type CycleTimeBand = 'excellent' | 'good' | 'fair' | 'poor'

/**
 * Per-issue cycle time observation.
 * Note: leadTimeDays and queueTimeDays are excluded from v1 (Rec A).
 */
export interface CycleTimeObservation {
  issueKey: string
  issueType: string
  summary: string
  cycleTimeDays: number
  completedAt: string
  startedAt: string
  periodKey: string
  jiraUrl: string
  /** True when this observation comes from a reopen cycle (proposal 0054). */
  isReopen: boolean
}

/**
 * Issue 1: anomalyCount is present in this definition as required.
 *
 * Per proposal 0054, percentile fields and band are nullable: when no
 * completed cycles are present in the window, the backend returns nulls
 * rather than zeros (which would mis-band as 'excellent').
 */
export interface CycleTimeResult {
  boardId: string
  p50Days: number | null
  p75Days: number | null
  p85Days: number | null
  p95Days: number | null
  count: number
  anomalyCount: number
  /** Count of observations that came from reopen cycles (proposal 0054). */
  reopenedIssueCount: number
  observations: CycleTimeObservation[]
  band: CycleTimeBand | null
}

export type CycleTimeResponse = CycleTimeResult[]

export interface CycleTimeTrendPoint {
  label: string
  start: string
  end: string
  /** Null when the period had no completed cycles (proposal 0054 AC5). */
  medianCycleTimeDays: number | null
  /** Null when the period had no completed cycles (proposal 0054 AC5). */
  p85CycleTimeDays: number | null
  sampleSize: number
  /** Null when the period had no completed cycles — chart renders a gap. */
  band: CycleTimeBand | null
}

export type CycleTimeTrendResponse = CycleTimeTrendPoint[]

export interface CycleTimeQueryParams {
  boardId: string
  period?: string
  sprintId?: string
  quarter?: string
  issueType?: string
}

export interface CycleTimeTrendParams {
  boardId?: string
  mode?: 'quarters' | 'sprints'
  limit?: number
  issueType?: string
}

// ---- Cycle Time endpoint wrappers ----------------------------------------

export function getCycleTime(
  params: CycleTimeQueryParams,
): Promise<CycleTimeResponse> {
  return apiFetch(
    `/api/cycle-time/${encodeURIComponent(params.boardId)}${toQueryString({
      period: params.period,
      sprintId: params.sprintId,
      quarter: params.quarter,
      issueType: params.issueType,
    })}`,
  )
}

export function getCycleTimeTrend(
  params: CycleTimeTrendParams,
): Promise<CycleTimeTrendResponse> {
  return apiFetch(
    `/api/cycle-time/trend${toQueryString({
      boardId: params.boardId,
      mode: params.mode,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
      issueType: params.issueType,
    })}`,
  )
}

// ---- Gaps report types and endpoint --------------------------------------

export interface GapIssue {
  key: string
  summary: string
  issueType: string
  status: string
  boardId: string
  sprintId: string | null
  sprintName: string | null
  points: number | null
  epicKey: string | null
  jiraUrl: string
}

export interface GapsResponse {
  noEpic: GapIssue[]
  noEstimate: GapIssue[]
}

export function getGaps(): Promise<GapsResponse> {
  return apiFetch<GapsResponse>('/api/gaps')
}

// ---- Unplanned Done Tickets types and endpoint ---------------------------

export interface UnplannedDoneIssue {
  key: string
  summary: string
  issueType: string
  boardId: string
  resolvedAt: string
  resolvedStatus: string
  points: number | null
  epicKey: string | null
  priority: string | null
  assignee: string | null
  labels: string[]
  jiraUrl: string
}

export interface UnplannedDoneSummary {
  total: number
  totalPoints: number
  byIssueType: Record<string, number>
}

export interface UnplannedDoneResponse {
  boardId: string
  window: { start: string; end: string }
  issues: UnplannedDoneIssue[]
  summary: UnplannedDoneSummary
  dataQualityWarning?: boolean
}

export interface UnplannedDoneParams {
  /** Board ID to filter by. Omit (or pass undefined) to aggregate all Scrum boards. */
  boardId?: string
  sprintId?: string
  quarter?: string
}

export function getUnplannedDone(
  params: UnplannedDoneParams,
): Promise<UnplannedDoneResponse> {
  return apiFetch(
    `/api/gaps/unplanned-done${toQueryString({
      boardId: params.boardId,
      sprintId: params.sprintId,
      quarter: params.quarter,
    })}`,
  )
}

// ---- App config endpoint -------------------------------------------------

export interface AppConfig {
  timezone: string
  /** When true, weekends are excluded from cycle-time and lead-time calculations. */
  excludeWeekends: boolean
}

export function getAppConfig(): Promise<AppConfig> {
  return apiFetch<AppConfig>('/api/config')
}

// ---- Sprint Report types and endpoints --------------------------------

export type SprintReportBand = 'strong' | 'good' | 'fair' | 'needs-attention'

/** Canonical, ordered list of all scoreable sprint-report dimensions. */
// ⚠️  Must match backend/src/sprint-report/scoring.service.ts ScoreDimension.
//     Order is the canonical display order.
export type ScoreDimension =
  | 'deliveryRate'
  | 'scopeStability'
  | 'roadmapCoverage'
  | 'leadTime'
  | 'deploymentFrequency'
  | 'changeFailureRate'
  | 'mttr'

export interface SprintDimensionScore {
  /** null = insufficient data; the dimension was excluded from the composite. */
  score: number | null
  band?: DoraBand
  rawValue: number | null
  rawUnit: string
}

export interface SprintDimensionScores {
  deliveryRate: SprintDimensionScore
  scopeStability: SprintDimensionScore
  roadmapCoverage: SprintDimensionScore
  leadTime: SprintDimensionScore
  deploymentFrequency: SprintDimensionScore
  changeFailureRate: SprintDimensionScore
  mttr: SprintDimensionScore
}

export interface SprintRecommendation {
  id: string
  dimension: string
  severity: 'info' | 'warning' | 'critical'
  message: string
}

export interface SprintReportTrendPoint {
  sprintId: string
  sprintName: string
  /** null when that historical report had no data in any dimension. */
  compositeScore: number | null
  scores: SprintDimensionScores
}

export interface SprintReportResponse {
  boardId: string
  sprintId: string
  sprintName: string
  startDate: string | null
  endDate: string | null
  /** Actual sprint close time (Jira completeDate); null if not closed. */
  completeDate: string | null
  /** null = no dimension had data; UI shows "Insufficient data". */
  compositeScore: number | null
  /** null when compositeScore is null. */
  compositeBand: SprintReportBand | null
  scores: SprintDimensionScores
  /** Dimensions that contributed to the composite (had a non-null score). */
  contributingDimensions: ScoreDimension[]
  /** Dimensions excluded as N/A. UI uses this for the `~` modifier tooltip. */
  excludedDimensions: ScoreDimension[]
  /** Sum of contributing weights, in [0, 1]. UI shows `~` when < 1. */
  totalWeightApplied: number
  recommendations: SprintRecommendation[]
  trend: SprintReportTrendPoint[]
  generatedAt: string
  dataAsOf: string
  // Optional: absent in reports cached before this field was introduced.
  // The sprint report page guards this field with a truthiness check.
  unplannedDone?: {
    total: number
    totalPoints: number
    byIssueType: Record<string, number>
    issues: UnplannedDoneIssue[]
  }
}

export interface SprintReportSummary {
  boardId: string
  sprintId: string
  sprintName: string
  startDate: string | null
  endDate: string | null
  compositeScore: number | null
  compositeBand: SprintReportBand | null
  generatedAt: string
}

export function getSprintReport(
  boardId: string,
  sprintId: string,
  refresh = false,
): Promise<SprintReportResponse> {
  return apiFetch(
    `/api/sprint-report/${encodeURIComponent(boardId)}/${encodeURIComponent(sprintId)}${refresh ? '?refresh=true' : ''}`,
  )
}

export function getSprintReportList(boardId: string): Promise<SprintReportSummary[]> {
  return apiFetch(`/api/sprint-report/${encodeURIComponent(boardId)}`)
}

export function deleteSprintReport(boardId: string, sprintId: string): Promise<void> {
  return apiFetch(
    `/api/sprint-report/${encodeURIComponent(boardId)}/${encodeURIComponent(sprintId)}`,
    { method: 'DELETE' },
  )
}

// ---- Support Report types and endpoints ----------------------------------

export type SupportMatchReason =
  | 'epic'
  | 'label'
  | 'link'
  | 'epic+label'
  | 'epic+link'
  | 'label+link'
  | 'epic+label+link'

export interface SupportTicket {
  issueKey: string
  summary: string
  issueType: string
  boardId: string
  cycleTimeDays: number | null
  completedAt: string | null
  startedAt: string | null
  band: CycleTimeBand | null
  jiraUrl: string
  matchReason: SupportMatchReason
  /** True when the representative cycle is a reopen (proposal 0054 AC C). */
  isReopen: boolean
}

export interface SupportResult {
  boardId: string
  totalIssues: number
  supportIssues: number
  supportPercentage: number
  p50Days: number
  p95Days: number
  /** Tickets whose representative cycle is a reopen (proposal 0054 AC C). */
  reopenedIssueCount: number
  tickets: SupportTicket[]
}

export interface SupportBoardBreakdown {
  boardId: string
  supportIssues: number
  totalIssues: number
  percentage: number
}

export interface SupportSummary {
  totalIssues: number
  supportIssues: number
  supportPercentage: number
  p50Days: number
  p95Days: number
  /** Tickets whose representative cycle is a reopen, summed across boards. */
  reopenedIssueCount: number
  byBoard: SupportBoardBreakdown[]
}

export interface SupportQueryParams {
  boardId?: string
  quarter?: string
  sprintId?: string
  period?: string
  matchReason?: 'link' | 'label' | 'epic'
}

export function getSupportTickets(
  params: SupportQueryParams,
): Promise<SupportResult[]> {
  return apiFetch(
    `/api/support${toQueryString({
      boardId: params.boardId,
      quarter: params.quarter,
      sprintId: params.sprintId,
      period: params.period,
      matchReason: params.matchReason,
    })}`,
  )
}

export function getSupportSummary(
  params: SupportQueryParams,
): Promise<SupportSummary> {
  return apiFetch(
    `/api/support/summary${toQueryString({
      boardId: params.boardId,
      quarter: params.quarter,
      sprintId: params.sprintId,
      period: params.period,
      matchReason: params.matchReason,
    })}`,
  )
}

// ---------------------------------------------------------------------------
// Healthcheck — weekly org-wide engineering healthcheck (feature 0019, ADR 0070/0074)
// Replaces the former Pulse (all-items) report. One pooled score per dimension
// across all boards; no per-board breakdown.
// ---------------------------------------------------------------------------

export type HealthcheckBand = 'green' | 'amber' | 'red'

export interface HealthcheckDimension {
  /** Pooled percentage in [0,100], or null when N/A. */
  score: number | null
  /** Pooled matching-ticket count, or null when N/A. */
  numerator: number | null
  /** Pooled denominator (Σ started tickets across contributing boards). */
  denominator: number
  /** RAG band, or null when the score is N/A. */
  band: HealthcheckBand | null
}

export interface HealthcheckTrendPoint {
  week: string
  stability: number | null
  roadmap: number | null
  support: number | null
}

export interface HealthcheckTicket {
  key: string
  summary: string
  boardId: string
  boardType: 'scrum' | 'kanban'
  issueType: string
  status: string
  planned: boolean
  onRoadmap: boolean
  support: boolean
  jiraUrl: string
}

export interface HealthcheckResponse {
  week: string
  weekStart: string
  weekEnd: string
  /** Org-wide pooled scores for the selected week. */
  stability: HealthcheckDimension
  roadmap: HealthcheckDimension
  support: HealthcheckDimension
  /** Trailing 8-week org trend, oldest→newest, including the selected week. */
  trend: HealthcheckTrendPoint[]
  /** All tickets in the selected week's denominator, flagged by dimension. */
  tickets: HealthcheckTicket[]
}

export function getHealthcheck(week?: string): Promise<HealthcheckResponse> {
  return apiFetch<HealthcheckResponse>(
    `/api/healthcheck${toQueryString({ week })}`,
  )
}


// ---------------------------------------------------------------------------
// Debug — admin-only ticket inspection (feature 0020, ADR 0076)
// Everything stored in the Postgres mirror for a single issue key.
// ---------------------------------------------------------------------------

export interface IssueDebugChangelogEntry {
  id: number
  field: string
  fromValue: string | null
  toValue: string | null
  fromId: string | null
  toId: string | null
  changedAt: string
}

export interface IssueDebugSprintMembership {
  sprintId: string
  name: string | null
  state: string | null
  startDate: string | null
  endDate: string | null
  completeDate: string | null
  boardId: string | null
}

export interface IssueDebugLink {
  id: number
  sourceIssueKey: string
  targetIssueKey: string
  linkTypeName: string
  isInward: boolean
}

export interface IssueDebugRoadmapIdea {
  key: string
  summary: string
  status: string
  jpdKey: string
  startDate: string | null
  targetDate: string | null
  matchReason: 'epic' | 'direct'
}

export interface IssueDebugIssue {
  key: string
  summary: string
  status: string
  statusId: string | null
  issueType: string
  fixVersion: string | null
  points: number | null
  boardId: string
  epicKey: string | null
  labels: string[]
  priority: string | null
  assignee: string | null
  createdAt: string
  updatedAt: string
  inBacklog: boolean
}

export interface IssueDebugResponse {
  issue: IssueDebugIssue
  changelog: IssueDebugChangelogEntry[]
  sprintMemberships: IssueDebugSprintMembership[]
  linksAsSource: IssueDebugLink[]
  linksAsTarget: IssueDebugLink[]
  roadmapIdeas: IssueDebugRoadmapIdea[]
}

export function getIssueDebug(key: string): Promise<IssueDebugResponse> {
  return apiFetch<IssueDebugResponse>(`/api/debug/issue/${encodeURIComponent(key)}`)
}

// ---- Auth (proposal 0074) ------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
  avatarUrl: string | null
}

export function getAuthMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/auth/me')
}

export function postLogout(): Promise<void> {
  return apiFetch<void>('/api/auth/logout', { method: 'POST' })
}

// ---- Users (proposal 0074) -----------------------------------------------

export interface UserListItem {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
  avatarUrl: string | null
  lastLoginAt: string | null
  createdAt: string
}

export function getUsers(): Promise<UserListItem[]> {
  return apiFetch<UserListItem[]>('/api/users')
}

export function updateUserRole(userId: string, role: 'user' | 'admin'): Promise<UserListItem> {
  return apiFetch<UserListItem>(`/api/users/${userId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
}

// ---- API keys (proposal 0075) --------------------------------------------

export interface ApiKeyMetadata {
  id: string
  name: string
  lastUsedAt: string | null
  createdAt: string
}

export interface CreatedApiKey {
  id: string
  name: string
  /** The raw key — returned once at creation, shown to the user, never retrievable again. */
  rawKey: string
  createdAt: string
}

export function getApiKeys(): Promise<ApiKeyMetadata[]> {
  return apiFetch<ApiKeyMetadata[]>('/api/keys')
}

export function createApiKey(name: string): Promise<CreatedApiKey> {
  return apiFetch<CreatedApiKey>('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function revokeApiKey(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/keys/${id}`, { method: 'DELETE' })
}
