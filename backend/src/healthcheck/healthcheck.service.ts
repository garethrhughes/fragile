/**
 * HealthcheckService — weekly per-board engineering healthcheck (ADR 0070).
 *
 * Replaces the former Pulse (`all-items`) report. For a selected ISO week,
 * computes three per-board scores (Stability, Roadmap, Support) against a
 * single shared denominator, plus a trailing 8-week trend. Live-computed —
 * nothing is persisted. All Jira data is read from the Postgres mirror
 * (ADR 0002); no live Jira calls.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BoardConfig,
  JiraIssue,
  JiraChangelog,
  JiraSprint,
  JiraIssueLink,
  JpdIdea,
  RoadmapConfig,
} from '../database/entities/index.js';
import { isWorkItem } from '../metrics/issue-type-filters.js';
import { isoWeekKeyToDates, dateToIsoWeekKey } from '../lib/iso-week.js';
import { effectiveSprintEnd } from '../lib/sprint-window.js';
import { DEFAULT_BOARD_ENTRY_STATUSES } from '../lib/kanban-week-stats.js';
import { buildDirectLinkIdeaMap } from '../metrics/roadmap-link-utils.js';
import { classifyRoadmapStatus } from '../metrics/roadmap-classification.js';
import { SprintMembershipService } from '../sprint-membership/sprint-membership.service.js';
import {
  resolveEpicIdeas,
  type EpicConflictResolution,
} from '../roadmap/resolve-epic-ideas.js';
import { computeBoardHealthcheck, type BoardHealthcheckResult } from './healthcheck-compute.js';
import { poolDimension } from './healthcheck-scoring.js';
import {
  classifyStabilityBand,
  classifyRoadmapBand,
  classifySupportBand,
} from './healthcheck-bands.js';
import type { SupportClassifierConfig } from '../support/support-classification.js';
import type {
  HealthcheckResponse,
  HealthcheckTrendPoint,
  HealthcheckTicketDto,
} from './dto/healthcheck-response.dto.js';

/** Number of weeks shown in the trend, including the selected week (ADR 0070). */
const TREND_WEEKS = 8;

/**
 * Org-wide roadmap-delivery target (%) used for the pooled Roadmap RAG band.
 * Only scrum boards contribute to the Roadmap score and they default to 80
 * (ADR 0067); a single org target keeps the band meaningful (ADR 0074).
 */
const ORG_ROADMAP_TARGET = 80;

@Injectable()
export class HealthcheckService {
  private readonly logger = new Logger(HealthcheckService.name);
  private readonly jiraBaseUrl: string;

  constructor(
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(JiraIssueLink)
    private readonly issueLinkRepo: Repository<JiraIssueLink>,
    @InjectRepository(JpdIdea)
    private readonly jpdIdeaRepo: Repository<JpdIdea>,
    @InjectRepository(RoadmapConfig)
    private readonly roadmapConfigRepo: Repository<RoadmapConfig>,
    private readonly sprintMembership: SprintMembershipService,
    private readonly configService: ConfigService,
  ) {
    this.jiraBaseUrl = this.configService.get<string>('JIRA_BASE_URL', '');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async getHealthcheck(weekParam?: string): Promise<HealthcheckResponse> {
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');
    const week = weekParam ?? this.lastCompletedWeek(tz);

    let weekStart: Date;
    let weekEnd: Date;
    try {
      ({ weekStart, weekEnd } = isoWeekKeyToDates(week, tz));
    } catch {
      throw new BadRequestException(
        `Invalid week format: "${week}". Expected YYYY-Www e.g. 2026-W30`,
      );
    }

    // The 8 week keys shown in the trend, oldest→newest (selected week last).
    const trendWeeks = this.trendWeekKeys(week, tz, TREND_WEEKS);

    const configs = await this.boardConfigRepo.find();
    if (configs.length === 0) {
      return this.emptyResponse(week, weekStart, weekEnd, trendWeeks);
    }

    const ideas = await this.loadAllIdeas();

    // One resolver per board — loads that board's data once, then computes a
    // BoardHealthcheckResult for any requested week (no per-week re-query).
    const boardResolvers = await Promise.all(
      configs.map((config) => this.buildBoardWeekResolver(config, tz, ideas)),
    );

    // Pool all boards per week (ADR 0074): sum applicable boards' numerators
    // and denominators, then score = (100 / Σdenominator) * Σnumerator.
    const resultsForWeek = (w: string): BoardHealthcheckResult[] =>
      boardResolvers.map((resolve) => resolve(w));

    const scoresFrom = (results: BoardHealthcheckResult[]) => ({
      stability: poolDimension(results.map((r) => r.stability)),
      roadmap: poolDimension(results.map((r) => r.roadmap)),
      support: poolDimension(results.map((r) => r.support)),
    });

    const trend: HealthcheckTrendPoint[] = trendWeeks.map((w) => {
      const s = scoresFrom(resultsForWeek(w));
      return {
        week: w,
        stability: s.stability.score,
        roadmap: s.roadmap.score,
        support: s.support.score,
      };
    });

    const selectedResults = resultsForWeek(week);
    const selected = scoresFrom(selectedResults);

    const tickets: HealthcheckTicketDto[] = selectedResults
      .flatMap((r) => r.tickets)
      .map((t) => ({
        ...t,
        jiraUrl: this.jiraBaseUrl ? `${this.jiraBaseUrl}/browse/${t.key}` : '',
      }))
      .sort((a, b) => a.boardId.localeCompare(b.boardId) || a.key.localeCompare(b.key));

    return {
      week,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      stability: {
        ...selected.stability,
        band: classifyStabilityBand(selected.stability.score),
      },
      roadmap: {
        ...selected.roadmap,
        band: classifyRoadmapBand(selected.roadmap.score, ORG_ROADMAP_TARGET),
      },
      support: {
        ...selected.support,
        band: classifySupportBand(selected.support.score),
      },
      trend,
      tickets,
    };
  }

  // ---------------------------------------------------------------------------
  // Per-board orchestration
  // ---------------------------------------------------------------------------

  /**
   * Load a board's data once and return a resolver that computes the board's
   * raw Healthcheck contribution for any given week.
   */
  private async buildBoardWeekResolver(
    config: BoardConfig,
    tz: string,
    ideas: { allIdeas: JpdIdea[]; ruleByJpdKey: Map<string, EpicConflictResolution> },
  ): Promise<(week: string) => BoardHealthcheckResult> {
    const boardType: 'scrum' | 'kanban' = config.boardType === 'kanban' ? 'kanban' : 'scrum';

    // Load the board's work items + status changelogs once, then reuse across
    // all trend weeks (no per-week re-query — avoids N+1).
    const issues = (await this.issueRepo.find({ where: { boardId: config.boardId } })).filter(
      (i) => isWorkItem(i.issueType),
    );

    if (issues.length === 0) {
      return () => this.emptyBoardResult(config.boardId, boardType);
    }

    const issueKeys = issues.map((i) => i.key);
    const changelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    const statusChangelogsByIssue = new Map<string, JiraChangelog[]>();
    for (const cl of changelogs) {
      const list = statusChangelogsByIssue.get(cl.issueKey) ?? [];
      list.push(cl);
      statusChangelogsByIssue.set(cl.issueKey, list);
    }

    // Support links (board-wide, once).
    const supportConfig: SupportClassifierConfig = {
      supportEpics: config.supportEpics ?? [],
      supportLabels: config.supportLabels ?? [],
      supportLinkTypes: config.supportLinkTypes ?? [],
      triageBoardKey: config.triageBoardKey ?? null,
    };
    const linksByIssue = await this.loadSupportLinks(supportConfig, issueKeys);

    // Roadmap link membership (board-wide, once). Membership is not
    // week-specific, so a single classification pass serves all trend weeks.
    const roadmapLinkedKeys = await this.buildRoadmapLinkedKeys(config, issues, ideas);

    // Sprint membership resolver (scrum only) — reconstruct all board sprints
    // once, then resolve committed/carry-over against the sprint whose window
    // contains a given in-progress timestamp (ADR 0071).
    const committedKeysAt = boardType === 'scrum'
      ? await this.buildStabilityResolver(config.boardId, issues)
      : () => false;

    const inProgressStatuses = new Set(config.inProgressStatusNames ?? ['In Progress']);
    const boardEntryStatuses = new Set(
      (config.boardEntryStatuses ?? [...DEFAULT_BOARD_ENTRY_STATUSES]).map((s) => s.toLowerCase()),
    );
    const cancelledStatuses = new Set(
      (config.cancelledStatusNames ?? ['Cancelled', "Won't Do"]).map((s) => s.toLowerCase()),
    );
    const doneStatusNames = config.doneStatusNames ?? ['Done', 'Closed', 'Released'];

    return (week: string): BoardHealthcheckResult => {
      const { weekStart, weekEnd } = isoWeekKeyToDates(week, tz);
      return computeBoardHealthcheck({
        boardId: config.boardId,
        boardType,
        week,
        weekStart,
        weekEnd,
        issues,
        statusChangelogsByIssue,
        inProgressStatuses,
        boardEntryStatuses,
        doneStatusNames,
        cancelledStatuses,
        committedKeysAt,
        isRoadmapLinked: (key) => roadmapLinkedKeys.has(key),
        supportConfig,
        linksByIssue,
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Resolvers
  // ---------------------------------------------------------------------------

  /**
   * Build the Stability resolver: a function that, given an issue key and its
   * first in-progress timestamp, returns whether the issue was committed or a
   * carry-over at the start of the sprint whose window contains that timestamp
   * (ADR 0071). `committedKeys` already folds in carry-overs (ADR 0039).
   */
  private async buildStabilityResolver(
    boardId: string,
    issues: JiraIssue[],
  ): Promise<(issueKey: string, startedAt: Date) => boolean> {
    const sprints = await this.sprintRepo.find({
      where: { boardId, state: In(['active', 'closed']) },
    });
    const datedSprints = sprints.filter((s) => s.startDate != null);
    if (datedSprints.length === 0) {
      return () => false;
    }

    const membershipMap = await this.sprintMembership.reconstructMany({
      sprints: datedSprints,
      boardId,
      boardIssues: issues,
    });

    // Pre-compute each sprint's window for fast containment checks.
    const windows = datedSprints.map((s) => ({
      sprintId: s.id,
      start: s.startDate!,
      end: effectiveSprintEnd(s),
    }));

    return (issueKey: string, startedAt: Date): boolean => {
      const sprint = windows.find((w) => startedAt >= w.start && startedAt <= w.end);
      if (!sprint) return false;
      const membership = membershipMap.get(sprint.sprintId);
      return membership?.committedKeys.has(issueKey) ?? false;
    };
  }

  /**
   * Determine which board issues are roadmap-linked (`in-scope` or `linked`)
   * per `classifyRoadmapStatus` (ADR 0044/0055/0073). Membership only — no
   * completion gate. Epic-link ideas + direct-link ideas resolved once.
   */
  private async buildRoadmapLinkedKeys(
    config: BoardConfig,
    issues: JiraIssue[],
    ideas: { allIdeas: JpdIdea[]; ruleByJpdKey: Map<string, EpicConflictResolution> },
  ): Promise<Set<string>> {
    const linked = new Set<string>();
    const issueKeys = issues.map((i) => i.key);

    // Epic → idea map (resolve conflicts per board policy).
    const epicIdeaMap = this.buildEpicIdeaMap(ideas.allIdeas, ideas.ruleByJpdKey);

    const directLinkIdeaMap = await buildDirectLinkIdeaMap(
      this.issueLinkRepo,
      issueKeys,
      ideas.allIdeas,
      config.roadmapLinkTypes ?? [],
      ideas.ruleByJpdKey,
    );

    const doneStatusNames = config.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const cancelledStatuses = new Set(
      (config.cancelledStatusNames ?? ['Cancelled', "Won't Do"]).map((s) => s.toLowerCase()),
    );

    for (const issue of issues) {
      const epicIdea = issue.epicKey ? epicIdeaMap.get(issue.epicKey) : undefined;
      const directIdea = directLinkIdeaMap.get(issue.key);
      const result = classifyRoadmapStatus({
        issueStatus: issue.status,
        isCancelled: cancelledStatuses.has(issue.status.toLowerCase()),
        epicIdea,
        directIdea,
        resolvedDate: null,
        // Membership question: treat the period as active so a linked idea
        // with a not-yet-passed target still classifies as in-scope. Either
        // 'in-scope' or 'linked' counts as roadmap-linked.
        isPeriodActive: true,
        doneStatusNames,
      });
      if (result.status !== 'none') linked.add(issue.key);
    }

    return linked;
  }

  /** Build an epic-key → { targetDate } map from all ideas (conflict-resolved). */
  private buildEpicIdeaMap(
    ideas: JpdIdea[],
    ruleByJpdKey: Map<string, EpicConflictResolution>,
  ): Map<string, { targetDate: Date | null }> {
    const withTarget = ideas.filter((idea) => idea.targetDate !== null);
    const resolved = resolveEpicIdeas(
      withTarget,
      (idea) => ruleByJpdKey.get((idea as JpdIdea).jpdKey) ?? 'earliest',
    );
    const map = new Map<string, { targetDate: Date | null }>();
    for (const [epicKey, entry] of resolved) {
      map.set(epicKey, { targetDate: entry.primaryIdea.targetDate });
    }
    return map;
  }

  private async loadSupportLinks(
    supportConfig: SupportClassifierConfig,
    issueKeys: string[],
  ): Promise<Map<string, JiraIssueLink[]>> {
    const linksByIssue = new Map<string, JiraIssueLink[]>();
    if (
      supportConfig.supportLinkTypes.length === 0 ||
      !supportConfig.triageBoardKey ||
      issueKeys.length === 0
    ) {
      return linksByIssue;
    }
    const links = await this.issueLinkRepo
      .createQueryBuilder('lnk')
      .where('lnk.sourceIssueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('LOWER(lnk.linkTypeName) IN (:...types)', {
        types: supportConfig.supportLinkTypes.map((t) => t.toLowerCase()),
      })
      .getMany();
    for (const lnk of links) {
      const list = linksByIssue.get(lnk.sourceIssueKey) ?? [];
      list.push(lnk);
      linksByIssue.set(lnk.sourceIssueKey, list);
    }
    return linksByIssue;
  }

  private async loadAllIdeas(): Promise<{
    allIdeas: JpdIdea[];
    ruleByJpdKey: Map<string, EpicConflictResolution>;
  }> {
    const roadmapConfigs = await this.roadmapConfigRepo.find();
    const allIdeas: JpdIdea[] = [];
    const ruleByJpdKey = new Map<string, EpicConflictResolution>();

    if (roadmapConfigs.length > 0) {
      const jpdKeys = roadmapConfigs.map((c) => c.jpdKey);
      for (const c of roadmapConfigs) {
        ruleByJpdKey.set(
          c.jpdKey,
          (c.epicConflictResolution as EpicConflictResolution) ?? 'earliest',
        );
      }
      const ideas = await this.jpdIdeaRepo.find({ where: { jpdKey: In(jpdKeys) } });
      allIdeas.push(...ideas);
    }

    return { allIdeas, ruleByJpdKey };
  }

  // ---------------------------------------------------------------------------
  // Week helpers
  // ---------------------------------------------------------------------------

  /** The last completed ISO week (the week before the current ISO week). */
  private lastCompletedWeek(tz: string): string {
    const { weekStart } = isoWeekKeyToDates(dateToIsoWeekKey(new Date(), tz), tz);
    const priorMonday = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    return dateToIsoWeekKey(priorMonday, tz);
  }

  /** Returns `count` ISO week keys ending at `week`, oldest→newest. */
  private trendWeekKeys(week: string, tz: string, count: number): string[] {
    const keys: string[] = [week];
    let cursor = week;
    for (let i = 1; i < count; i += 1) {
      const { weekStart } = isoWeekKeyToDates(cursor, tz);
      const prior = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      cursor = dateToIsoWeekKey(prior, tz);
      keys.push(cursor);
    }
    return keys.reverse();
  }

  /** Board with no issues — contributes a zero, non-matching result to the pool. */
  private emptyBoardResult(
    boardId: string,
    boardType: 'scrum' | 'kanban',
  ): BoardHealthcheckResult {
    const isKanban = boardType === 'kanban';
    return {
      boardId,
      boardType,
      denominator: 0,
      stability: { numerator: 0, denominator: 0, applicable: !isKanban },
      roadmap: { numerator: 0, denominator: 0, applicable: !isKanban },
      support: { numerator: 0, denominator: 0, applicable: true },
      tickets: [],
    };
  }

  /** Org response when there are no boards configured — all dimensions N/A. */
  private emptyResponse(
    week: string,
    weekStart: Date,
    weekEnd: Date,
    trendWeeks: string[],
  ): HealthcheckResponse {
    const naDimension = { score: null, numerator: null, denominator: 0, band: null };
    return {
      week,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      stability: { ...naDimension },
      roadmap: { ...naDimension },
      support: { ...naDimension },
      trend: trendWeeks.map((w) => ({
        week: w,
        stability: null,
        roadmap: null,
        support: null,
      })),
      tickets: [],
    };
  }
}
