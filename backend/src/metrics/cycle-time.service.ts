import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  BoardConfig,
} from '../database/entities/index.js';
import { classifyCycleTime, type CycleTimeBand } from './cycle-time-bands.js';
import { percentile, round2 } from './statistics.js';
import { isWorkItem } from './issue-type-filters.js';
import { WorkingTimeService } from './working-time.service.js';
import { extractCycles, resolveResetNames } from './cycle.js';

// ---------------------------------------------------------------------------
// Authoritative type definitions (single source of truth)
// Imported by the DTO file; NOT re-declared there.
// ---------------------------------------------------------------------------

export interface CycleTimeObservation {
  issueKey: string;
  issueType: string;
  summary: string;
  cycleTimeDays: number;
  completedAt: string;   // ISO — done transition
  startedAt: string;     // ISO — in-progress transition
  periodKey: string;     // e.g. "2026-Q1" or sprint name
  jiraUrl: string;       // deep-link into Jira
  /** True when this observation is the second-or-later cycle for the issue. */
  isReopen: boolean;
}

export interface CycleTimeResult {
  boardId: string;
  /** Percentile fields are null when observations.length === 0 (proposal 0054 AC5). */
  p50Days: number | null;
  p75Days: number | null;
  p85Days: number | null;
  p95Days: number | null;
  count: number;
  anomalyCount: number;
  /** Number of issues whose representative cycle is a reopen (proposal 0054 AC C). */
  reopenedIssueCount: number;
  observations: CycleTimeObservation[];
  /** Null when count === 0 — frontend renders "No data" rather than an "elite" band. */
  band: CycleTimeBand | null;
}

export interface CycleTimeTrendPoint {
  label: string;
  start: string;
  end: string;
  /** Null when the period had no completed cycles (proposal 0054 AC5). */
  medianCycleTimeDays: number | null;
  /** Null when the period had no completed cycles (proposal 0054 AC5). */
  p85CycleTimeDays: number | null;
  sampleSize: number;
  /** Null when the period had no completed cycles — UI renders a gap. */
  band: CycleTimeBand | null;
}

// ---------------------------------------------------------------------------
// CycleTimeService
// ---------------------------------------------------------------------------

@Injectable()
export class CycleTimeService {
  private readonly logger = new Logger(CycleTimeService.name);
  private readonly jiraBaseUrl: string;

  constructor(
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(JiraVersion)
    private readonly versionRepo: Repository<JiraVersion>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    private readonly configService: ConfigService,
    private readonly workingTimeService: WorkingTimeService,
  ) {
    const baseUrl = this.configService.get<string>('JIRA_BASE_URL', '');
    if (!baseUrl) {
      this.logger.warn(
        'JIRA_BASE_URL is not configured — jiraUrl fields will be empty strings',
      );
    }
    this.jiraBaseUrl = baseUrl;
  }

  /**
   * Returns per-issue cycle-time observations for a board/period.
   * Called by calculate() and by getCycleTimeTrend() for pooled-median.
   *
   * periodKey is embedded on every observation for display purposes.
   */
  async getCycleTimeObservations(
    boardId: string,
    startDate: Date,
    endDate: Date,
    periodKey: string,
    issueTypeFilter?: string,
  ): Promise<{
    observations: CycleTimeObservation[];
    anomalyCount: number;
    reopenedIssueCount: number;
  }> {
    // 1. Load board config
    const config = await this.boardConfigRepo.findOne({ where: { boardId } });
    const inProgressNames = config?.inProgressStatusNames ?? [
      // Standard Jira active-work statuses
      'In Progress',
      // Review / peer-review variants (case-sensitive match against real data)
      'In Review',
      'Peer-Review',
      'Peer Review',
      'PEER REVIEW',
      'PEER CODE REVIEW',
      'Ready for Review',
      // Test / QA variants
      'In Test',
      'IN TEST',
      'QA',
      'QA testing',
      'QA Validation',
      'IN TESTING',
      'Under Test',
      'ready to test',
      'Ready for Testing',
      'READY FOR TESTING',
      // Pre-release staging variants
      'Ready for Release',
      'Ready for release',
      'READY FOR RELEASE',
      'Awaiting Release',
      'READY',
    ];
    const doneStatuses = config?.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const resetNames = resolveResetNames(config?.boardEntryStatuses ?? null);
    const inProgressSet = new Set(inProgressNames);
    const doneSet = new Set(doneStatuses);
    const resetSet = new Set(resetNames);

    // 2. Load all issues for this board (filtered by type if provided).
    // Epics and Sub-tasks are always excluded as non-deliverable issue types.
    // If issueTypeFilter is itself an excluded type, return empty immediately.
    if (issueTypeFilter && !isWorkItem(issueTypeFilter)) {
      return { observations: [], anomalyCount: 0, reopenedIssueCount: 0 };
    }
    const issueWhere: { boardId: string; issueType?: string } = { boardId };
    if (issueTypeFilter) {
      issueWhere.issueType = issueTypeFilter;
    }
    const issues = (await this.issueRepo.find({ where: issueWhere }))
      .filter((i) => isWorkItem(i.issueType));

    if (issues.length === 0) {
      return { observations: [], anomalyCount: 0, reopenedIssueCount: 0 };
    }

    const issueKeys = issues.map((i) => i.key);

    // 3. Fetch all status changelogs in bulk (ASC order → last match = most recent)
    const changelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Group changelogs by issue key
    const changelogsByIssue = new Map<string, JiraChangelog[]>();
    for (const cl of changelogs) {
      const list = changelogsByIssue.get(cl.issueKey) ?? [];
      list.push(cl);
      changelogsByIssue.set(cl.issueKey, list);
    }

    // Pre-fetch version release dates for fixVersion fallback
    const versionNames = [
      ...new Set(
        issues.map((i) => i.fixVersion).filter((v): v is string => v !== null),
      ),
    ];
    const versions =
      versionNames.length > 0
        ? await this.versionRepo.find({
            where: { name: In(versionNames), projectKey: boardId },
          })
        : [];
    const versionDateMap = new Map(
      versions
        .filter((v) => v.releaseDate !== null)
        .map((v) => [v.name, v.releaseDate as Date]),
    );

    const observations: CycleTimeObservation[] = [];
    let anomalyCount = 0;
    let reopenedIssueCount = 0;

    // Load working-time config once for the whole batch.
    const wtEntity = await this.workingTimeService.getConfig();
    const wtConfig = this.workingTimeService.toConfig(wtEntity);

    for (const issue of issues) {
      const issueLogs = changelogsByIssue.get(issue.key) ?? [];

      // Use the shared cycle helper (proposal 0054). Returns null when no
      // completed cycle exists in the issue's changelog.
      const issueCycles = extractCycles(
        issueLogs,
        inProgressSet,
        doneSet,
        resetSet,
      );

      // Accumulate per-issue anomalies (e.g. dangling open IP at end of changelog).
      if (issueCycles) {
        anomalyCount += issueCycles.anomalyCount;
      }

      // Determine cycleStart and cycleEnd for THIS analysis window.
      let cycleStart: Date | null = null;
      let cycleEnd: Date | null = null;
      let isReopen = false;

      if (issueCycles) {
        // Pick the last cycle whose end falls inside the analysis window.
        const inWindow = issueCycles.cycles.filter(
          (c) => c.end >= startDate && c.end <= endDate,
        );
        const repForWindow = inWindow.length > 0 ? inWindow[inWindow.length - 1] : null;

        if (repForWindow) {
          cycleStart = repForWindow.start;
          cycleEnd = repForWindow.end;
          isReopen = repForWindow.isReopen;
        }
      }

      // FixVersion fallback: only when no in-window completed cycle exists.
      // The cycle start in this case is the FIRST in-progress transition
      // (matches the previous behaviour for un-completed issues released
      // via fixVersion).
      if (cycleEnd === null && issue.fixVersion) {
        const releaseDate = versionDateMap.get(issue.fixVersion);
        const firstInProgress = issueLogs.find(
          (cl) => inProgressSet.has(cl.toValue ?? ''),
        );
        if (
          releaseDate &&
          releaseDate >= startDate &&
          releaseDate <= endDate &&
          (firstInProgress === undefined ||
            releaseDate >= firstInProgress.changedAt)
        ) {
          cycleEnd = releaseDate;
          if (firstInProgress) {
            cycleStart = firstInProgress.changedAt;
          }
        }
      }

      if (!cycleEnd) {
        // No completed cycle in window and no fixVersion fallback applies.
        //
        // Window-scoped anomaly preservation: if the issue has a Done
        // transition inside the window but no In Progress at all, the
        // helper returns null but the previous service treated this as a
        // window-scoped anomaly. Preserve that signal.
        const hasDoneInWindow = issueLogs.some(
          (cl) =>
            doneSet.has(cl.toValue ?? '') &&
            cl.changedAt >= startDate &&
            cl.changedAt <= endDate,
        );
        const hasAnyInProgress = issueLogs.some(
          (cl) => inProgressSet.has(cl.toValue ?? ''),
        );
        if (hasDoneInWindow && !hasAnyInProgress) {
          anomalyCount += 1;
        }
        continue;
      }

      if (!cycleStart) {
        // FixVersion released but no in-progress transition exists at all.
        anomalyCount += 1;
        continue;
      }

      // Compute cycle time, clamp negative values (data anomaly)
      const rawDays = wtEntity.excludeWeekends
        ? this.workingTimeService.workingDaysBetween(cycleStart, cycleEnd, wtConfig)
        : (cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000;

      if (rawDays < 0) {
        this.logger.warn(
          `Negative cycle time for ${issue.key}: ${rawDays.toFixed(2)} days — clamping to 0`,
        );
      }

      const cycleTimeDays = Math.max(0, rawDays);

      if (isReopen) {
        reopenedIssueCount += 1;
      }

      observations.push({
        issueKey: issue.key,
        issueType: issue.issueType ?? 'Unknown',
        summary: issue.summary ?? '',
        cycleTimeDays: round2(cycleTimeDays),
        completedAt: cycleEnd.toISOString(),
        startedAt: cycleStart.toISOString(),
        periodKey,
        jiraUrl: this.jiraBaseUrl
          ? `${this.jiraBaseUrl}/browse/${issue.key}`
          : '',
        isReopen,
      });
    }

    // Sort by cycleTimeDays ASC (required for percentile calculation)
    observations.sort((a, b) => a.cycleTimeDays - b.cycleTimeDays);

    return { observations, anomalyCount, reopenedIssueCount };
  }

  /**
   * Main public method — aggregates observations into CycleTimeResult.
   * Returns null percentiles + null band when observations is empty
   * (proposal 0054 AC5 — no longer misclassifies empty data as 'excellent').
   */
  async calculate(
    boardId: string,
    startDate: Date,
    endDate: Date,
    periodKey: string,
    issueTypeFilter?: string,
  ): Promise<CycleTimeResult> {
    const { observations, anomalyCount, reopenedIssueCount } =
      await this.getCycleTimeObservations(
        boardId,
        startDate,
        endDate,
        periodKey,
        issueTypeFilter,
      );

    // Per-board structured log (proposal 0054 AC G)
    this.logger.log(
      `cycle_aggregate_computed boardId=${boardId} period=${periodKey} observations=${observations.length} reopenedIssueCount=${reopenedIssueCount} anomalyCount=${anomalyCount}`,
    );

    // Empty: null band + null percentiles (was previously 'excellent' / 0).
    if (observations.length === 0) {
      return {
        boardId,
        p50Days: null,
        p75Days: null,
        p85Days: null,
        p95Days: null,
        count: 0,
        anomalyCount,
        reopenedIssueCount,
        observations: [],
        band: null,
      };
    }

    const cycleTimes = observations.map((o) => o.cycleTimeDays);
    // Array is already sorted ASC by getCycleTimeObservations
    const p50 = percentile(cycleTimes, 50);
    const p75 = percentile(cycleTimes, 75);
    const p85 = percentile(cycleTimes, 85);
    const p95 = percentile(cycleTimes, 95);

    return {
      boardId,
      p50Days: round2(p50),
      p75Days: round2(p75),
      p85Days: round2(p85),
      p95Days: round2(p95),
      count: observations.length,
      anomalyCount,
      reopenedIssueCount,
      observations,
      band: classifyCycleTime(p50),
    };
  }
}
