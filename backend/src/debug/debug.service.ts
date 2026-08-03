/**
 * DebugService — read-only inspection of everything stored in the Postgres
 * mirror for a single Jira issue key (ADR 0076). No live Jira calls; all
 * queries are scoped to the key.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  JiraIssue,
  JiraChangelog,
  JiraIssueSprint,
  JiraSprint,
  JiraIssueLink,
  JpdIdea,
} from '../database/entities/index.js';
import type {
  IssueDebugResponse,
  IssueDebugChangelogEntry,
  IssueDebugSprintMembership,
  IssueDebugLink,
  IssueDebugRoadmapIdea,
} from './dto/issue-debug-response.dto.js';

@Injectable()
export class DebugService {
  constructor(
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(JiraIssueSprint)
    private readonly issueSprintRepo: Repository<JiraIssueSprint>,
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(JiraIssueLink)
    private readonly issueLinkRepo: Repository<JiraIssueLink>,
    @InjectRepository(JpdIdea)
    private readonly jpdIdeaRepo: Repository<JpdIdea>,
  ) {}

  async getIssueDebug(key: string): Promise<IssueDebugResponse> {
    const issue = await this.issueRepo.findOne({ where: { key } });
    if (!issue) {
      throw new NotFoundException(`No stored data for issue "${key}"`);
    }

    const [changelog, sprintMemberships, linksAsSource, linksAsTarget, roadmapIdeas] =
      await Promise.all([
        this.loadChangelog(key),
        this.loadSprintMemberships(key),
        this.loadLinks({ sourceIssueKey: key }),
        this.loadLinks({ targetIssueKey: key }),
        this.loadRoadmapIdeas(key, issue.epicKey),
      ]);

    return {
      issue,
      changelog,
      sprintMemberships,
      linksAsSource,
      linksAsTarget,
      roadmapIdeas,
    };
  }

  private async loadChangelog(key: string): Promise<IssueDebugChangelogEntry[]> {
    const rows = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey = :key', { key })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    return rows.map((cl) => ({
      id: cl.id,
      field: cl.field,
      fromValue: cl.fromValue,
      toValue: cl.toValue,
      fromId: cl.fromId,
      toId: cl.toId,
      changedAt: cl.changedAt.toISOString(),
    }));
  }

  private async loadSprintMemberships(key: string): Promise<IssueDebugSprintMembership[]> {
    const memberships = await this.issueSprintRepo.find({ where: { issueKey: key } });
    if (memberships.length === 0) return [];

    const sprintIds = memberships.map((m) => m.sprintId);
    const sprints = await this.sprintRepo.find({ where: { id: In(sprintIds) } });
    const sprintById = new Map(sprints.map((s) => [s.id, s]));

    return memberships.map((m) => {
      const sprint = sprintById.get(m.sprintId);
      return {
        sprintId: m.sprintId,
        name: sprint?.name ?? null,
        state: sprint?.state ?? null,
        startDate: sprint?.startDate ? sprint.startDate.toISOString() : null,
        endDate: sprint?.endDate ? sprint.endDate.toISOString() : null,
        completeDate: sprint?.completeDate ? sprint.completeDate.toISOString() : null,
        boardId: sprint?.boardId ?? null,
      };
    });
  }

  private async loadLinks(
    where: { sourceIssueKey: string } | { targetIssueKey: string },
  ): Promise<IssueDebugLink[]> {
    const rows = await this.issueLinkRepo.find({ where });
    return rows.map((l) => ({
      id: l.id,
      sourceIssueKey: l.sourceIssueKey,
      targetIssueKey: l.targetIssueKey,
      linkTypeName: l.linkTypeName,
      isInward: l.isInward,
    }));
  }

  /**
   * Ideas whose `deliveryIssueKeys` contains the issue key (direct) or the
   * issue's epic key (epic). Direct match takes precedence when both apply.
   *
   * `deliveryIssueKeys` is a TypeORM `simple-array` (comma-joined text), so we
   * scope the query with LIKE predicates on the candidate keys rather than
   * scanning the whole table, then confirm exact membership in memory.
   */
  private async loadRoadmapIdeas(
    key: string,
    epicKey: string | null,
  ): Promise<IssueDebugRoadmapIdea[]> {
    const candidateKeys = epicKey ? [key, epicKey] : [key];

    const qb = this.jpdIdeaRepo.createQueryBuilder('idea');
    candidateKeys.forEach((k, i) => {
      const clause = `idea.deliveryIssueKeys LIKE :like${i}`;
      const param = { [`like${i}`]: `%${k}%` };
      if (i === 0) qb.where(clause, param);
      else qb.orWhere(clause, param);
    });
    const ideas = await qb.getMany();

    const matched: IssueDebugRoadmapIdea[] = [];
    for (const idea of ideas) {
      const delivered = idea.deliveryIssueKeys ?? [];
      // Exact membership check (LIKE is only a coarse pre-filter).
      const matchesDirect = delivered.includes(key);
      const matchesEpic = epicKey !== null && delivered.includes(epicKey);
      if (!matchesDirect && !matchesEpic) continue;

      matched.push({
        key: idea.key,
        summary: idea.summary,
        status: idea.status,
        jpdKey: idea.jpdKey,
        startDate: idea.startDate ? idea.startDate.toISOString() : null,
        targetDate: idea.targetDate ? idea.targetDate.toISOString() : null,
        matchReason: matchesDirect ? 'direct' : 'epic',
      });
    }
    return matched;
  }
}
