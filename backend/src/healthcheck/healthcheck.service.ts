/**
 * HealthcheckService — weekly org-wide engineering healthcheck (ADR 0070).
 *
 * Replaces the former Pulse (`all-items`) report. For a selected ISO week,
 * computes three pooled scores (Stability, Roadmap, Support) against a
 * per-dimension denominator, plus a trailing 8-week trend. All Jira data is
 * read from the Postgres mirror (ADR 0002); no live Jira calls.
 *
 * Reproducibility (ADR 0092): a completed week's canonical figure
 * (`includeSupport=true`) is persisted on first read and served from storage by
 * default, so a closed week's numerator, denominator, ticket list and predicate
 * config hash are all recoverable. `view=live` forces a recompute and reports
 * drift against the stored figure rather than replacing it.
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
  HealthcheckSnapshot,
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
import { computeConfigHash } from './healthcheck-config-hash.js';
import { compareHealthcheck, type HealthcheckDrift } from './healthcheck-drift.js';
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
    @InjectRepository(HealthcheckSnapshot)
    private readonly snapshotRepo: Repository<HealthcheckSnapshot>,
    private readonly sprintMembership: SprintMembershipService,
    private readonly configService: ConfigService,
  ) {
    this.jiraBaseUrl = this.configService.get<string>('JIRA_BASE_URL', '');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async getHealthcheck(
    weekParam?: string,
    includeSupport = true,
    view: 'stored' | 'live' = 'stored',
  ): Promise<HealthcheckResponse> {
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

    // Only the canonical view of a COMPLETED week is storable. The current week
    // is legitimately still moving, and includeSupport=false is an exploratory
    // re-slice rather than the canonical figure (ADR 0092).
    const storable = includeSupport && this.isCompletedWeek(week, tz);

    if (storable && view === 'stored') {
      const stored = await this.snapshotRepo.findOne({ where: { week } });
      if (stored) {
        return {
          ...(stored.payload as HealthcheckResponse),
          source: 'stored',
          computedAt: stored.computedAt.toISOString(),
          configHash: stored.configHash,
          includeSupport: true,
          drift: null,
        };
      }
    }

    const live = await this.computeLive(
      week,
      weekStart,
      weekEnd,
      tz,
      includeSupport,
      // The trend must agree with the per-week figures the dashboard shows if
      // you navigate to those weeks. For the canonical stored view, take each
      // trend point from its own stored row where one exists. The live view is
      // deliberately fully recomputed so the drift comparison is
      // apples-to-apples, and includeSupport=false has no stored counterpart.
      storable && view === 'stored',
    );

    // Per-ticket derived first_start, logged every run so this class of question
    // ("did the denominator move, and which tickets moved it?") is answerable by
    // diffing two log lines instead of reconstructing from the Jira API.
    this.logger.debug(
      `healthcheck ${week} includeSupport=${includeSupport} ` +
        `D(stability)=${live.response.stability.denominator} ` +
        `N(stability)=${String(live.response.stability.numerator)} ` +
        `first_start=${JSON.stringify(live.firstStarts)}`,
    );

    if (!storable) {
      return { ...live.response, source: 'live', drift: null };
    }

    const stored = await this.snapshotRepo.findOne({ where: { week } });

    if (!stored) {
      // Write-through, but only on the default `stored` path. A `live` request
      // is a drift probe: letting it establish the canonical baseline would
      // enshrine the very value being investigated.
      if (view === 'live') {
        return { ...live.response, source: 'live', drift: null };
      }
      await this.snapshotRepo.save(
        this.snapshotRepo.create({
          week,
          weekStart,
          weekEnd,
          payload: live.response,
          configHash: live.response.configHash,
          firstStarts: live.firstStarts,
          computedAt: new Date(live.response.computedAt),
        }),
      );
      return { ...live.response, source: 'stored', drift: null };
    }

    // A stored row exists and the caller explicitly asked for the live view:
    // report the difference, do not overwrite. Overwriting would destroy the
    // evidence that a discrepancy existed.
    const drift = this.buildDrift(stored, live);
    return { ...live.response, source: 'live', drift };
  }

  /**
   * Compare a live recompute against the stored figure and log accordingly.
   *
   * A ticket's `first_start` moving LATER is not a legitimate data update — it
   * is a minimum over an append-only history — so it is logged at `error`.
   * Other drift on a closed week is logged at `warn` and left for a human.
   */
  private buildDrift(
    stored: HealthcheckSnapshot,
    live: { response: HealthcheckResponse; firstStarts: Record<string, string> },
  ): HealthcheckDrift {
    const storedPayload = stored.payload as HealthcheckResponse;
    const drift = compareHealthcheck({
      storedComputedAt: stored.computedAt,
      storedConfigHash: stored.configHash,
      liveConfigHash: live.response.configHash,
      stored: {
        stability: storedPayload.stability,
        roadmap: storedPayload.roadmap,
        support: storedPayload.support,
        ticketKeys: storedPayload.tickets.map((t) => t.key),
        firstStarts: stored.firstStarts ?? {},
      },
      live: {
        stability: live.response.stability,
        roadmap: live.response.roadmap,
        support: live.response.support,
        ticketKeys: live.response.tickets.map((t) => t.key),
        firstStarts: live.firstStarts,
      },
    });

    if (drift.firstStartRegressions.length > 0) {
      this.logger.error(
        `Healthcheck ${stored.week}: ${drift.firstStartRegressions.length} ticket(s) ` +
          `have a first_start LATER than the stored value. first_start is a minimum ` +
          `over an append-only history, so this indicates an incomplete stored ` +
          `changelog: ${JSON.stringify(drift.firstStartRegressions)}`,
      );
    }
    if (drift.hasDrift) {
      this.logger.warn(
        `Healthcheck ${stored.week} drift vs stored figure computed at ` +
          `${drift.storedComputedAt} (configHashChanged=${drift.configHashChanged}): ` +
          `stability ${String(drift.stability.stored.numerator)}/${drift.stability.stored.denominator}` +
          ` -> ${String(drift.stability.live.numerator)}/${drift.stability.live.denominator}; ` +
          `added=[${drift.ticketsAdded.join(',')}] removed=[${drift.ticketsRemoved.join(',')}]`,
      );
    }

    return drift;
  }

  /** True when `week` is strictly before the current ISO week in `tz`. */
  private isCompletedWeek(week: string, tz: string): boolean {
    const current = dateToIsoWeekKey(new Date(), tz);
    const { weekStart } = isoWeekKeyToDates(week, tz);
    const { weekStart: currentStart } = isoWeekKeyToDates(current, tz);
    return weekStart < currentStart;
  }

  /**
   * Compute the week from the Jira mirror. Returns the response (with
   * `source`/`drift` left for the caller to set) plus the derived `first_start`
   * per ticket key, which is what the monotonicity assertion compares.
   */
  private async computeLive(
    week: string,
    weekStart: Date,
    weekEnd: Date,
    tz: string,
    includeSupport: boolean,
    useStoredTrendPoints = false,
  ): Promise<{ response: HealthcheckResponse; firstStarts: Record<string, string> }> {
    // The 8 week keys shown in the trend, oldest→newest (selected week last).
    const trendWeeks = this.trendWeekKeys(week, tz, TREND_WEEKS);

    const configs = await this.boardConfigRepo.find();
    if (configs.length === 0) {
      return {
        response: this.emptyResponse(week, weekStart, weekEnd, trendWeeks, includeSupport),
        firstStarts: {},
      };
    }

    const configHash = computeConfigHash(configs);
    const ideas = await this.loadAllIdeas();

    // One resolver per board — loads that board's data once, then computes a
    // BoardHealthcheckResult for any requested week (no per-week re-query).
    const boardResolvers = await Promise.all(
      configs.map((config) => this.buildBoardWeekResolver(config, tz, ideas, includeSupport)),
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

    // Prefer each trend week's own stored figure so the chart and the score
    // cards can never disagree about the same week. Weeks with no stored row
    // (not yet read, or still in flight) fall back to a live computation.
    const storedTrend = useStoredTrendPoints
      ? await this.loadStoredTrend(trendWeeks)
      : new Map<string, HealthcheckTrendPoint>();

    const trend: HealthcheckTrendPoint[] = trendWeeks.map((w) => {
      const stored = storedTrend.get(w);
      if (stored) return stored;
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

    const firstStarts: Record<string, string> = {};
    for (const t of tickets) firstStarts[t.key] = t.firstStart;

    return {
      response: {
        week,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        source: 'live',
        computedAt: new Date().toISOString(),
        configHash,
        includeSupport,
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
        drift: null,
      },
      firstStarts,
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
    includeSupport: boolean,
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

    this.warnOnMissingHistory(config, issues, statusChangelogsByIssue);

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
        includeSupport,
      });
    };
  }

  /**
   * Load the already-stored score for each of the given trend weeks.
   *
   * Without this the stored payload would embed a trend computed live at freeze
   * time, so week W's trend point for W-3 could disagree with W-3's own stored
   * figure — the chart and the score cards would show different numbers for the
   * same week. Reading each point from its own row makes them equal by
   * construction.
   */
  private async loadStoredTrend(
    weeks: string[],
  ): Promise<Map<string, HealthcheckTrendPoint>> {
    const rows = await this.snapshotRepo.find({ where: { week: In(weeks) } });
    const byWeek = new Map<string, HealthcheckTrendPoint>();
    for (const row of rows) {
      const payload = row.payload as HealthcheckResponse;
      byWeek.set(row.week, {
        week: row.week,
        stability: payload.stability.score,
        roadmap: payload.roadmap.score,
        support: payload.support.score,
      });
    }
    return byWeek;
  }

  // ---------------------------------------------------------------------------
  // Mirror integrity
  // ---------------------------------------------------------------------------

  /**
   * Warn about issues whose stored status history is missing.
   *
   * A scrum issue with no matching in-progress transition yields
   * `first_start = null` and is simply absent from every week's denominator —
   * no error, no warning, no "excluded" count. That makes an incomplete mirror
   * indistinguishable from work that genuinely never started, which is exactly
   * how a denominator can quietly shrink.
   *
   * Detector: the issue's CURRENT status is one it can only have reached by
   * transitioning (in-progress or done), yet it has zero stored status
   * changelog rows. That combination is not reachable through normal Jira use,
   * so it indicates the stored changelog was lost or never written.
   *
   * Heuristic, not proof: an issue created directly into an in-progress status
   * fires no status changelog event in Jira and would be reported here too.
   * Hence `warn` with the keys, rather than an exception.
   */
  private warnOnMissingHistory(
    config: BoardConfig,
    issues: JiraIssue[],
    statusChangelogsByIssue: Map<string, JiraChangelog[]>,
  ): void {
    const transitioned = new Set(
      [
        ...(config.inProgressStatusNames ?? ['In Progress']),
        ...(config.doneStatusNames ?? ['Done', 'Closed', 'Released']),
      ].map((s) => s.toLowerCase()),
    );

    const suspect = issues
      .filter(
        (i) =>
          transitioned.has(i.status.toLowerCase()) &&
          (statusChangelogsByIssue.get(i.key)?.length ?? 0) === 0,
      )
      .map((i) => i.key);

    if (suspect.length > 0) {
      this.logger.warn(
        `Board ${config.boardId}: ${suspect.length} issue(s) sit in a transitioned ` +
          `status but have NO stored status changelog, so they cannot appear in any ` +
          `week's denominator. Suspected incomplete mirror — re-run a full sync and ` +
          `check sync_logs: ${suspect.join(', ')}`,
      );
    }
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
    includeSupport: boolean,
  ): HealthcheckResponse {
    const naDimension = { score: null, numerator: null, denominator: 0, band: null };
    return {
      week,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      source: 'live',
      computedAt: new Date().toISOString(),
      // No boards configured — nothing contributes to the predicate.
      configHash: computeConfigHash([]),
      includeSupport,
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
      drift: null,
    };
  }
}
