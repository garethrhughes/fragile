import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  JiraSprint,
  JiraIssue,
  JiraChangelog,
  JpdIdea,
  RoadmapConfig,
  BoardConfig,
} from '../database/entities/index.js';
import { SyncService } from '../sync/sync.service.js';

export interface RoadmapSprintAccuracy {
  sprintId: string;
  sprintName: string;
  state: string;
  startDate: string | null;
  totalIssues: number;
  coveredIssues: number;
  uncoveredIssues: number;
  roadmapCoverage: number;
  linkedCompletedIssues: number;
  roadmapDeliveryRate: number;
}

@Injectable()
export class RoadmapService {
  private readonly logger = new Logger(RoadmapService.name);

  constructor(
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(JpdIdea)
    private readonly jpdIdeaRepo: Repository<JpdIdea>,
    @InjectRepository(RoadmapConfig)
    private readonly roadmapConfigRepo: Repository<RoadmapConfig>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    private readonly syncService: SyncService,
  ) {}

  async getAccuracy(
    boardId: string,
    sprintId?: string,
    quarter?: string,
  ): Promise<RoadmapSprintAccuracy[]> {
    const boardConfig = await this.boardConfigRepo.findOne({ where: { boardId } });
    const isKanban = boardConfig?.boardType === 'kanban';

    // Kanban boards have no sprints — sprintId filter is unsupported
    if (isKanban && sprintId) {
      throw new BadRequestException(
        'Sprint-level accuracy is not available for Kanban boards. Use quarter mode instead.',
      );
    }

    if (isKanban) {
      return this.getKanbanAccuracy(boardId, boardConfig, quarter);
    }

    // Resolve sprints
    let sprints: JiraSprint[];

    if (sprintId) {
      const sprint = await this.sprintRepo.findOne({ where: { id: sprintId, boardId } });
      sprints = sprint ? [sprint] : [];
    } else if (quarter) {
      const { startDate, endDate } = this.quarterToDates(quarter);
      sprints = await this.sprintRepo
        .createQueryBuilder('s')
        .where('s.boardId = :boardId', { boardId })
        .andWhere('s.state = :state', { state: 'closed' })
        .andWhere('s.startDate >= :start', { start: startDate })
        .andWhere('s.endDate <= :end', { end: endDate })
        .orderBy('s.startDate', 'ASC')
        .getMany();
    } else {
      // Active first, then closed descending
      const active = await this.sprintRepo.find({
        where: { boardId, state: 'active' },
        order: { startDate: 'DESC' },
      });
      const closed = await this.sprintRepo.find({
        where: { boardId, state: 'closed' },
        order: { startDate: 'DESC' },
      });
      sprints = [...active, ...closed];
    }

    // Build coveredEpicKeys scoped to configured JPD projects (B3 + M2)
    const coveredEpicKeys = await this.loadCoveredEpicKeys();

    // Resolve doneStatusNames from board config
    const doneStatusNames: string[] =
      boardConfig?.doneStatusNames ?? ['Done', 'Closed', 'Released'];

    if (sprints.length === 0) {
      return [];
    }

    // M3: bulk-load all issues for all sprints in one query
    const sprintIds = sprints.map((s) => s.id);
    const allIssues = await this.issueRepo.find({
      where: { sprintId: In(sprintIds), boardId },
    });
    const issuesBySprint = new Map<string, JiraIssue[]>();
    for (const issue of allIssues) {
      if (!issue.sprintId) continue;
      const list = issuesBySprint.get(issue.sprintId) ?? [];
      list.push(issue);
      issuesBySprint.set(issue.sprintId, list);
    }

    const results: RoadmapSprintAccuracy[] = [];
    for (const sprint of sprints) {
      const sprintIssues = issuesBySprint.get(sprint.id) ?? [];
      const accuracy = await this.calculateSprintAccuracy(
        sprint,
        sprintIssues,
        coveredEpicKeys,
        doneStatusNames,
      );
      results.push(accuracy);
    }

    return results;
  }

  /**
   * For Kanban boards: group issues by the quarter in which they were first
   * moved off "To Do" (i.e. pulled onto the board). Falls back to createdAt
   * for issues that have no such changelog entry.
   */
  private async getKanbanAccuracy(
    boardId: string,
    boardConfig: BoardConfig | null,
    quarter?: string,
  ): Promise<RoadmapSprintAccuracy[]> {
    const coveredEpicKeys = await this.loadCoveredEpicKeys();
    const doneStatusNames: string[] =
      boardConfig?.doneStatusNames ?? ['Done', 'Closed', 'Released'];

    // Load all Kanban issues for this board, excluding Epics and Sub-tasks
    const allIssues = (await this.issueRepo.find({ where: { boardId } })).filter(
      (i) => i.issueType !== 'Epic' && i.issueType !== 'Sub-task',
    );

    if (allIssues.length === 0) {
      return [];
    }

    // Bulk-load status changelogs for all these issues in one query
    const issueKeys = allIssues.map((i) => i.key);
    const changelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .andWhere('cl.fromValue = :from', { from: 'To Do' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Build map: issueKey → earliest date it left "To Do"
    const boardEntryDate = new Map<string, Date>();
    for (const cl of changelogs) {
      if (!boardEntryDate.has(cl.issueKey)) {
        boardEntryDate.set(cl.issueKey, cl.changedAt);
      }
    }

    // Group issues by the quarter of their board-entry date (fall back to createdAt)
    const quarterMap = new Map<string, JiraIssue[]>();
    for (const issue of allIssues) {
      const entryDate = boardEntryDate.get(issue.key) ?? issue.createdAt;
      const key = this.issueToQuarterKey(entryDate);
      const list = quarterMap.get(key) ?? [];
      list.push(issue);
      quarterMap.set(key, list);
    }

    // Filter to requested quarter if provided; otherwise all, newest first
    const filteredKeys = quarter
      ? Array.from(quarterMap.keys()).filter((k) => k === quarter)
      : Array.from(quarterMap.keys()).sort((a, b) => b.localeCompare(a));

    const now = new Date();
    const currentQuarterKey = this.issueToQuarterKey(now);

    const results: RoadmapSprintAccuracy[] = [];
    for (const qKey of filteredKeys) {
      const issues = quarterMap.get(qKey)!;
      const { startDate } = this.quarterToDates(qKey);
      const state = qKey === currentQuarterKey ? 'active' : 'closed';

      const coveredIssues = issues.filter(
        (i) => i.epicKey !== null && coveredEpicKeys.has(i.epicKey),
      );
      const coveredKeys = new Set(coveredIssues.map((i) => i.key));

      const completedKeys = new Set<string>(
        issues
          .filter((i) => doneStatusNames.includes(i.status))
          .map((i) => i.key),
      );

      const totalIssues = issues.length;
      const coveredCount = coveredIssues.length;
      const linkedCompletedIssues = [...completedKeys].filter((k) =>
        coveredKeys.has(k),
      ).length;

      results.push({
        sprintId: qKey,
        sprintName: qKey,
        state,
        startDate: startDate.toISOString(),
        totalIssues,
        coveredIssues: coveredCount,
        uncoveredIssues: totalIssues - coveredCount,
        roadmapCoverage:
          totalIssues > 0
            ? Math.round((coveredCount / totalIssues) * 10000) / 100
            : 0,
        linkedCompletedIssues,
        roadmapDeliveryRate:
          coveredCount > 0
            ? Math.round((linkedCompletedIssues / coveredCount) * 10000) / 100
            : 0,
      });
    }

    return results;
  }

  /** Load covered epic keys scoped to configured JPD projects, filtering empty strings (B3 + M2). */
  private async loadCoveredEpicKeys(): Promise<Set<string>> {
    const configs = await this.roadmapConfigRepo.find();
    if (configs.length === 0) return new Set();
    const jpdKeys = configs.map((c) => c.jpdKey);
    const ideas = await this.jpdIdeaRepo.find({ where: { jpdKey: In(jpdKeys) } });
    return new Set<string>(
      ideas
        .flatMap((idea) => idea.deliveryIssueKeys ?? [])
        .filter(Boolean),
    );
  }

  private issueToQuarterKey(date: Date): string {
    const q = Math.floor(date.getMonth() / 3) + 1;
    return `${date.getFullYear()}-Q${q}`;
  }

  private async calculateSprintAccuracy(
    sprint: JiraSprint,
    sprintIssues: JiraIssue[],
    coveredEpicKeys: Set<string>,
    doneStatusNames: string[],
  ): Promise<RoadmapSprintAccuracy> {
    const filteredIssues = sprintIssues.filter(
      (i) => i.issueType !== 'Epic' && i.issueType !== 'Sub-task',
    );

    if (filteredIssues.length === 0) {
      return this.emptyAccuracy(sprint);
    }

    // Classify covered issues
    const coveredIssues = filteredIssues.filter(
      (i) => i.epicKey !== null && coveredEpicKeys.has(i.epicKey),
    );
    const coveredKeys = new Set(coveredIssues.map((i) => i.key));

    // Build completed set — check current status first, then changelogs for remainder
    const completedKeys = new Set<string>();
    const needsChangelogCheck: string[] = [];

    for (const issue of filteredIssues) {
      if (doneStatusNames.includes(issue.status)) {
        completedKeys.add(issue.key);
      } else {
        needsChangelogCheck.push(issue.key);
      }
    }

    // Only query changelogs for issues not already in done status
    if (needsChangelogCheck.length > 0) {
      const sprintStart = sprint.startDate ?? new Date(0);
      const sprintEnd = sprint.endDate ?? new Date();

      const changelogs = await this.changelogRepo
        .createQueryBuilder('cl')
        .where('cl.issueKey IN (:...keys)', { keys: needsChangelogCheck })
        .andWhere('cl.field = :field', { field: 'status' })
        .andWhere('cl.changedAt >= :start', { start: sprintStart })
        .andWhere('cl.changedAt <= :end', { end: sprintEnd })
        .getMany();

      for (const cl of changelogs) {
        if (cl.toValue !== null && doneStatusNames.includes(cl.toValue)) {
          completedKeys.add(cl.issueKey);
        }
      }
    }

    // Compute metrics
    const totalIssues = filteredIssues.length;
    const coveredCount = coveredIssues.length;
    const uncoveredIssues = totalIssues - coveredCount;
    const roadmapCoverage =
      totalIssues > 0
        ? Math.round((coveredCount / totalIssues) * 10000) / 100
        : 0;

    const linkedCompletedIssues = [...completedKeys].filter((k) =>
      coveredKeys.has(k),
    ).length;
    const roadmapDeliveryRate =
      coveredCount > 0
        ? Math.round((linkedCompletedIssues / coveredCount) * 10000) / 100
        : 0;

    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      totalIssues,
      coveredIssues: coveredCount,
      uncoveredIssues,
      roadmapCoverage,
      linkedCompletedIssues,
      roadmapDeliveryRate,
    };
  }

  private emptyAccuracy(sprint: JiraSprint): RoadmapSprintAccuracy {
    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      totalIssues: 0,
      coveredIssues: 0,
      uncoveredIssues: 0,
      roadmapCoverage: 0,
      linkedCompletedIssues: 0,
      roadmapDeliveryRate: 0,
    };
  }

  private quarterToDates(quarter: string): { startDate: Date; endDate: Date } {
    const match = quarter.match(/^(\d{4})-Q([1-4])$/);
    if (!match) {
      throw new Error(`Invalid quarter format: ${quarter}. Expected YYYY-QN`);
    }
    const year = parseInt(match[1], 10);
    const q = parseInt(match[2], 10);
    const startMonth = (q - 1) * 3;
    return {
      startDate: new Date(year, startMonth, 1),
      endDate: new Date(year, startMonth + 3, 0, 23, 59, 59, 999),
    };
  }

  async getConfigs(): Promise<RoadmapConfig[]> {
    return this.roadmapConfigRepo.find({ order: { createdAt: 'ASC' } });
  }

  async createConfig(jpdKey: string, description?: string): Promise<RoadmapConfig> {
    const existing = await this.roadmapConfigRepo.findOne({ where: { jpdKey } });
    if (existing) {
      throw new ConflictException(
        `A roadmap config for JPD key "${jpdKey}" already exists`,
      );
    }
    const config = this.roadmapConfigRepo.create({
      jpdKey,
      description: description ?? null,
    });
    return this.roadmapConfigRepo.save(config);
  }

  async deleteConfig(id: number): Promise<void> {
    const existing = await this.roadmapConfigRepo.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Roadmap config with id ${id} not found`);
    }
    await this.roadmapConfigRepo.delete({ id });
  }

  async syncRoadmaps(): Promise<{ message: string }> {
    await this.syncService.syncRoadmaps();
    return { message: 'Roadmap sync completed' };
  }
}
