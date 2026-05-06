import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  JiraSprint,
  BoardConfig,
  JiraIssueLink,
} from '../database/entities/index.js';
import { isWorkItem } from '../metrics/issue-type-filters.js';
import { quarterToDates } from '../metrics/period-utils.js';
import { percentile, round2 } from '../metrics/statistics.js';
import { classifyCycleTime } from '../metrics/cycle-time-bands.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';
import type {
  SupportTicketDto,
  SupportResult,
  SupportSummaryDto,
  SupportBoardBreakdown,
} from './dto/support-response.dto.js';
import type { SupportQueryDto } from './dto/support-query.dto.js';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly jiraBaseUrl: string;

  constructor(
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(JiraVersion)
    private readonly versionRepo: Repository<JiraVersion>,
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    @InjectRepository(JiraIssueLink)
    private readonly issueLinkRepo: Repository<JiraIssueLink>,
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

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async getSupportTickets(query: SupportQueryDto): Promise<SupportResult[]> {
    const { startDate, endDate, isSprint, sprintName, isCurrentPeriod } = await this.resolvePeriod(query);
    const boardIds = await this.resolveBoardIds(query.boardId);

    return Promise.all(
      boardIds.map((boardId) =>
        this.getSupportResultForBoard(boardId, startDate, endDate, isSprint, sprintName, isCurrentPeriod),
      ),
    );
  }

  async getSupportSummary(query: SupportQueryDto): Promise<SupportSummaryDto> {
    const results = await this.getSupportTickets(query);

    const totalIssues = results.reduce((s, r) => s + r.totalIssues, 0);
    const supportIssues = results.reduce((s, r) => s + r.supportIssues, 0);
    const supportPercentage =
      totalIssues > 0 ? round2((supportIssues / totalIssues) * 100) : 0;

    // Pool all support ticket cycle times for org-level percentiles
    const allCycleTimes = results
      .flatMap((r) => r.tickets)
      .map((t) => t.cycleTimeDays)
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b);

    const p50Days = round2(percentile(allCycleTimes, 50));
    const p95Days = round2(percentile(allCycleTimes, 95));

    const byBoard: SupportBoardBreakdown[] = results.map((r) => ({
      boardId: r.boardId,
      supportIssues: r.supportIssues,
      totalIssues: r.totalIssues,
      percentage: r.supportPercentage,
    }));

    return { totalIssues, supportIssues, supportPercentage, p50Days, p95Days, byBoard };
  }

  // ---------------------------------------------------------------------------
  // Per-board calculation
  // ---------------------------------------------------------------------------

  private async getSupportResultForBoard(
    boardId: string,
    startDate: Date,
    endDate: Date,
    isSprint: boolean = false,
    sprintName?: string,
    isCurrentPeriod: boolean = false,
  ): Promise<SupportResult> {
    const config = await this.boardConfigRepo.findOne({ where: { boardId } });
    const supportLabels: string[] = config?.supportLabels ?? [];
    const supportLinkType: string | null = config?.supportLinkType ?? null;
    const triageBoardKey: string | null = config?.triageBoardKey ?? null;
    const inProgressNames: string[] = config?.inProgressStatusNames ?? [
      'In Progress', 'In Review', 'Peer-Review', 'Peer Review', 'PEER REVIEW',
      'PEER CODE REVIEW', 'Ready for Review', 'In Test', 'IN TEST', 'QA',
      'QA testing', 'QA Validation', 'IN TESTING', 'Under Test', 'ready to test',
      'Ready for Testing', 'READY FOR TESTING', 'Ready for Release',
      'Ready for release', 'READY FOR RELEASE', 'Awaiting Release', 'READY',
    ];
    const doneStatuses: string[] = config?.doneStatusNames ?? ['Done', 'Closed', 'Released'];

    // Step 1: Load all work items for this board
    const issues = (await this.issueRepo.find({ where: { boardId } })).filter(
      (i) => isWorkItem(i.issueType),
    );

    if (issues.length === 0) {
      return { boardId, totalIssues: 0, supportIssues: 0, supportPercentage: 0, p50Days: 0, p95Days: 0, tickets: [] };
    }

    const issueKeys = issues.map((i) => i.key);

    // Step 2: Bulk-load status changelogs (for cycle time)
    const changelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    const changelogsByIssue = new Map<string, JiraChangelog[]>();
    for (const cl of changelogs) {
      const list = changelogsByIssue.get(cl.issueKey) ?? [];
      list.push(cl);
      changelogsByIssue.set(cl.issueKey, list);
    }

    // Step 2b (sprint mode): Bulk-load sprint changelogs to determine membership
    // An issue belongs to the target sprint if its name appears in any sprint
    // changelog toValue (comma-separated) OR if its current sprintId matches.
    let sprintMemberKeys: Set<string> | null = null;
    if (isSprint && sprintName) {
      const sprintChangelogs = await this.changelogRepo
        .createQueryBuilder('cl')
        .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
        .andWhere('cl.field = :field', { field: 'Sprint' })
        .getMany();

      sprintMemberKeys = new Set<string>();
      const sprintIssueMap = new Map<string, JiraChangelog[]>();
      for (const cl of sprintChangelogs) {
        const list = sprintIssueMap.get(cl.issueKey) ?? [];
        list.push(cl);
        sprintIssueMap.set(cl.issueKey, list);
      }

      // Pre-resolve sprint ID from name to avoid N+1 in the loop below
      const sprintByName = await this.sprintRepo.findOne({ where: { name: sprintName, boardId } });
      const sprintIdByName = sprintByName?.id;

      for (const issue of issues) {
        // Changelog membership: sprint name appears in any toValue
        const logs = sprintIssueMap.get(issue.key) ?? [];
        const inSprintViaChangelog = logs.some((cl) => {
          const names = (cl.toValue ?? '').split(',').map((n) => n.trim());
          return names.includes(sprintName);
        });
        // Current assignment fallback (covers issues added mid-sprint with no prior history)
        const inSprintViaAssignment =
          sprintIdByName !== undefined &&
          issue.sprintId !== null &&
          String(issue.sprintId) === String(sprintIdByName);
        if (inSprintViaChangelog || inSprintViaAssignment) {
          sprintMemberKeys.add(issue.key);
        }
      }
    }

    // Step 3: Bulk-load issue links for link-based classification
    let linksByIssue = new Map<string, JiraIssueLink[]>();
    if (supportLinkType && triageBoardKey) {
      const links = await this.issueLinkRepo
        .createQueryBuilder('lnk')
        .where('lnk.sourceIssueKey IN (:...keys)', { keys: issueKeys })
        .getMany();
      for (const lnk of links) {
        const list = linksByIssue.get(lnk.sourceIssueKey) ?? [];
        list.push(lnk);
        linksByIssue.set(lnk.sourceIssueKey, list);
      }
    }

    // Step 4: Load fix versions for cycle time fallback
    const versionNames = [
      ...new Set(issues.map((i) => i.fixVersion).filter((v): v is string => v !== null)),
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

    // Step 5: Working time config (for cycle time calculation)
    const wtEntity = await this.workingTimeService.getConfig();
    const wtConfig = this.workingTimeService.toConfig(wtEntity);
    const triagePrefix = triageBoardKey ? `${triageBoardKey}-` : null;

    // Step 6: Classify and compute cycle time
    // Quarter mode: totalIssues = issues that completed within the period.
    // Sprint mode: totalIssues = all sprint-member work items regardless of status.
    let totalIssues = 0;
    const tickets: SupportTicketDto[] = [];

    for (const issue of issues) {
      // Sprint mode: skip issues that are not members of this sprint
      if (isSprint && sprintMemberKeys !== null && !sprintMemberKeys.has(issue.key)) {
        continue;
      }

      const issueLogs = changelogsByIssue.get(issue.key) ?? [];
      const inProgressTransition = issueLogs.find((cl) =>
        inProgressNames.includes(cl.toValue ?? ''),
      );
      const doneTransition = issueLogs
        .filter(
          (cl) =>
            doneStatuses.includes(cl.toValue ?? '') &&
            cl.changedAt >= startDate &&
            cl.changedAt <= endDate,
        )
        .at(-1);

      let cycleEnd: Date | null = null;
      if (doneTransition) {
        cycleEnd = doneTransition.changedAt;
      } else if (issue.fixVersion) {
        const releaseDate = versionDateMap.get(issue.fixVersion);
        if (
          releaseDate &&
          releaseDate >= startDate &&
          releaseDate <= endDate &&
          (!inProgressTransition || releaseDate >= inProgressTransition.changedAt)
        ) {
          cycleEnd = releaseDate;
        }
      }

      if (isSprint || isCurrentPeriod) {
        // Sprint mode and current-quarter mode: count all members in denominator; no completion gate
        totalIssues += 1;
      } else {
        // Past quarter mode: only count issues that completed in the period
        if (cycleEnd === null) continue;
        totalIssues += 1;
      }

      // --- Classify ---
      const labelMatch =
        supportLabels.length > 0 &&
        Array.isArray(issue.labels) &&
        (issue.labels as string[]).some((l) => supportLabels.includes(l));

      const linkMatch =
        supportLinkType !== null &&
        triagePrefix !== null &&
        (linksByIssue.get(issue.key) ?? []).some(
          (lnk) =>
            lnk.linkTypeName === supportLinkType &&
            lnk.targetIssueKey.startsWith(triagePrefix),
        );

      if (!labelMatch && !linkMatch) continue;

      const matchReason: 'label' | 'link' | 'both' =
        labelMatch && linkMatch ? 'both' : labelMatch ? 'label' : 'link';

      let cycleTimeDays: number | null = null;
      let startedAt: string | null = null;
      let completedAt: string | null = null;
      let band = null;

      if (cycleEnd && inProgressTransition) {
        const cycleStart = inProgressTransition.changedAt;
        const rawDays = wtEntity.excludeWeekends
          ? this.workingTimeService.workingDaysBetween(cycleStart, cycleEnd, wtConfig)
          : (cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000;

        cycleTimeDays = round2(Math.max(0, rawDays));
        startedAt = cycleStart.toISOString();
        completedAt = cycleEnd.toISOString();
        band = classifyCycleTime(cycleTimeDays);
      }

      tickets.push({
        issueKey: issue.key,
        summary: issue.summary ?? '',
        issueType: issue.issueType ?? 'Unknown',
        boardId,
        cycleTimeDays,
        completedAt,
        startedAt,
        band,
        jiraUrl: this.jiraBaseUrl ? `${this.jiraBaseUrl}/browse/${issue.key}` : '',
        matchReason,
      });
    }

    // Step 7: Percentiles across support tickets with cycle time
    const cycleTimes = tickets
      .map((t) => t.cycleTimeDays)
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b);

    const supportIssues = tickets.length;
    const supportPercentage =
      totalIssues > 0 ? round2((supportIssues / totalIssues) * 100) : 0;
    const p50Days = round2(percentile(cycleTimes, 50));
    const p95Days = round2(percentile(cycleTimes, 95));

    // Sort tickets: completed first (most recent first), then unresolved
    tickets.sort((a, b) => {
      if (a.completedAt && b.completedAt) {
        return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
      }
      if (a.completedAt) return -1;
      if (b.completedAt) return 1;
      return a.issueKey.localeCompare(b.issueKey);
    });

    return { boardId, totalIssues, supportIssues, supportPercentage, p50Days, p95Days, tickets };
  }

  // ---------------------------------------------------------------------------
  // Helpers (mirroring MetricsService pattern)
  // ---------------------------------------------------------------------------

  private async resolveBoardIds(boardId: string | undefined): Promise<string[]> {
    if (boardId) {
      return boardId.split(',').map((id) => id.trim());
    }
    const configs = await this.boardConfigRepo.find({ select: ['boardId'] });
    return configs.map((c) => c.boardId);
  }

  private async resolvePeriod(
    query: SupportQueryDto,
  ): Promise<{ startDate: Date; endDate: Date; isSprint: boolean; sprintName?: string; isCurrentPeriod: boolean }> {
    if (query.quarter) {
      const { startDate, endDate } = quarterToDates(query.quarter);
      const isCurrentPeriod = endDate > new Date();
      return { startDate, endDate, isSprint: false, isCurrentPeriod };
    }

    if (query.sprintId) {
      const sprint = await this.sprintRepo.findOne({ where: { id: query.sprintId } });
      if (sprint?.startDate && sprint?.endDate) {
        return {
          startDate: sprint.startDate,
          endDate: sprint.endDate,
          isSprint: true,
          sprintName: sprint.name,
          isCurrentPeriod: false,
        };
      }
    }

    if (query.period && query.period.includes(':')) {
      const [start, end] = query.period.split(':');
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
        return { startDate, endDate, isSprint: false, isCurrentPeriod: false };
      }
    }

    // Default: last 90 days — treat as current period since it ends now
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    return { startDate, endDate, isSprint: false, isCurrentPeriod: true };
  }
}
