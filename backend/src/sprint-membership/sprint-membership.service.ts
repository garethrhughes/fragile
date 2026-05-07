import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  JiraSprint,
  JiraIssue,
  JiraIssueSprint,
  JiraChangelog,
} from '../database/entities/index.js';

/**
 * The reconstructed membership of a single sprint, derived from the canonical
 * algorithm: ID-based changelog matching with name-based fallback, plus the
 * `JiraIssueSprint` join table for issues created directly into the sprint
 * with no changelog history.
 *
 * See ADR 0049.
 */
export interface SprintMembership {
  /** Issues that were in the sprint at `sprint.startDate` + grace period. */
  committedKeys: Set<string>;
  /** Issues added to the sprint after start (mid-sprint additions, not carry-overs). */
  addedKeys: Set<string>;
  /**
   * Subset of `committedKeys` whose membership ended before `sprint.endDate`.
   * Disjoint from `addedRemovedKeys`. See proposal 0050 / ADR 0052.
   */
  committedRemovedKeys: Set<string>;
  /**
   * Subset of `addedKeys` whose membership ended before `sprint.endDate`
   * (i.e. mid-sprint add-then-remove churn). Disjoint from
   * `committedRemovedKeys`. See proposal 0050 / ADR 0052.
   */
  addedRemovedKeys: Set<string>;
  /** Issues currently in the sprint per the `JiraIssueSprint` join table. */
  currentMemberKeys: Set<string>;
  /**
   * Per-issue Sprint-field changelog rows scoped to this sprint, ordered by
   * `changedAt` ASC. An empty array means the issue has no Sprint-field
   * history but is in `currentMemberKeys` (created directly into the sprint).
   */
  logsByIssue: Map<string, JiraChangelog[]>;
}

/**
 * Pure summary of a `SprintMembership` for planning-accuracy callers.
 *
 * `addedCount` is the gross count of `addedKeys` (includes add-then-remove
 * churn). `removedCount` reports committed-removed only — add-then-remove
 * churn is reflected via `addedKeys` exclusively to avoid double-counting in
 * `scopeChangePercent`. See proposal 0050 / ADR 0052.
 */
export interface MembershipSummary {
  commitmentCount: number;
  addedCount: number;
  netAddedCount: number;
  removedCount: number;
  finalSetSize: number;
  scopeChangePercent: number;
}

/**
 * Grace period applied to sprint start when classifying changelog entries.
 *
 * When Jira "Start Sprint" is invoked, the sprint's `startDate` is recorded
 * at that instant but the bulk add of backlog issues is processed ~20-60s
 * later. Any Sprint-field changelog within this window is treated as part
 * of the original commitment, not a mid-sprint addition.
 */
export const SPRINT_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Single source of truth for sprint membership reconstruction.
 *
 * Replaces the four divergent implementations previously inlined in
 * `PlanningService`, `SprintDetailService`, `RoadmapService`, and
 * `SupportService`. See ADR 0049 and proposal 0048.
 */
@Injectable()
export class SprintMembershipService {
  private readonly logger = new Logger(SprintMembershipService.name);

  constructor(
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(JiraIssueSprint)
    private readonly issueSprintRepo: Repository<JiraIssueSprint>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
  ) {}

  /**
   * Reconstruct the membership of a single sprint.
   *
   * The caller is responsible for pre-filtering `boardIssues` to exclude
   * Epics and sub-tasks (per ADR 0018) — this service does not apply
   * issue-type filtering itself.
   *
   * @param input.sprint        The sprint to reconstruct membership for. Must have `startDate` set; otherwise an empty membership is returned.
   * @param input.boardId       The board the sprint belongs to (used to scope closed-sprint lookups for carry-over detection).
   * @param input.boardIssues   All non-Epic, non-Sub-task issues for the board.
   */
  async reconstruct(input: {
    sprint: JiraSprint;
    boardId: string;
    boardIssues: JiraIssue[];
  }): Promise<SprintMembership> {
    const { sprint, boardId, boardIssues } = input;
    const map = await this.reconstructMany({
      sprints: [sprint],
      boardId,
      boardIssues,
    });
    return map.get(sprint.id) ?? this.empty();
  }

  /**
   * Reconstruct the membership of multiple sprints in a single pass.
   *
   * Performs one Sprint-field changelog query and one `JiraIssueSprint`
   * lookup, then replays per-sprint classification in memory. This is the
   * preferred entry point for callers that need membership for several
   * sprints (e.g. roadmap accuracy across a quarter).
   *
   * The caller is responsible for pre-filtering `boardIssues` to exclude
   * Epics and sub-tasks (per ADR 0018).
   *
   * @returns Map keyed by `sprint.id`. Sprints with no `startDate` or with
   *          no relevant membership are present with an empty `SprintMembership`.
   */
  async reconstructMany(input: {
    sprints: JiraSprint[];
    boardId: string;
    boardIssues: JiraIssue[];
  }): Promise<Map<string, SprintMembership>> {
    const { sprints, boardId, boardIssues } = input;
    const result = new Map<string, SprintMembership>();

    if (sprints.length === 0) {
      return result;
    }

    // Seed every requested sprint with an empty membership so callers can
    // always `.get(sprintId)` without null-checking.
    for (const s of sprints) {
      result.set(s.id, this.empty());
    }

    if (boardIssues.length === 0) {
      return result;
    }

    const allKeys = boardIssues.map((i) => i.key);
    const issueCreatedAtMap = new Map(
      boardIssues.map((i) => [i.key, i.createdAt]),
    );

    // Closed sprints on this board — used for carry-over detection.
    const closed = await this.sprintRepo.find({
      where: { boardId, state: 'closed' },
      select: ['id', 'name', 'endDate'],
    });
    const closedSprintNames = new Set(closed.map((s) => s.name));
    const closedSprintIds = new Set(closed.map((s) => s.id));

    // One Sprint-field changelog query for the entire board.
    const allSprintChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: allKeys })
      .andWhere('cl.field = :field', { field: 'Sprint' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    const issueKeysWithAnySprintLog = new Set(
      allSprintChangelogs.map((cl) => cl.issueKey),
    );

    // One JiraIssueSprint lookup for all requested sprints.
    const sprintIds = sprints.map((s) => s.id);
    const allMemberRows = await this.issueSprintRepo.find({
      where: { sprintId: In(sprintIds) },
    });
    const memberKeysBySprint = new Map<string, Set<string>>();
    for (const s of sprints) memberKeysBySprint.set(s.id, new Set());
    for (const row of allMemberRows) {
      memberKeysBySprint.get(row.sprintId)?.add(row.issueKey);
    }

    // Replay membership per sprint.
    for (const sprint of sprints) {
      if (!sprint.startDate) continue;

      const membership = this.classifyForSprint({
        sprint,
        allSprintChangelogs,
        issueKeysWithAnySprintLog,
        currentMemberKeys: memberKeysBySprint.get(sprint.id) ?? new Set(),
        issueCreatedAtMap,
        closedSprintNames,
        closedSprintIds,
      });
      result.set(sprint.id, membership);
    }

    return result;
  }

  /**
   * Pure per-sprint classification. Operates entirely on data already loaded
   * by the caller — performs no I/O. Extracted so `reconstructMany` can
   * share one set of DB queries across many sprints.
   */
  private classifyForSprint(input: {
    sprint: JiraSprint;
    allSprintChangelogs: JiraChangelog[];
    issueKeysWithAnySprintLog: Set<string>;
    currentMemberKeys: Set<string>;
    issueCreatedAtMap: Map<string, Date>;
    closedSprintNames: Set<string>;
    closedSprintIds: Set<string>;
  }): SprintMembership {
    const {
      sprint,
      allSprintChangelogs,
      issueKeysWithAnySprintLog,
      currentMemberKeys,
      issueCreatedAtMap,
      closedSprintNames,
      closedSprintIds,
    } = input;

    const sprintName = sprint.name;
    const sprintId = sprint.id;
    const sprintStart = sprint.startDate!;
    const sprintEnd = sprint.endDate ?? new Date();

    // Group changelogs by issue, keeping only those that reference this sprint.
    // Prefer ID matching (handles renames); fall back to name for legacy rows.
    const logsByIssue = new Map<string, JiraChangelog[]>();
    for (const cl of allSprintChangelogs) {
      const matchesThisSprint =
        cl.toId != null || cl.fromId != null
          ? sprintIdContains(cl.fromId, sprintId) ||
            sprintIdContains(cl.toId, sprintId)
          : sprintValueContains(cl.fromValue, sprintName) ||
            sprintValueContains(cl.toValue, sprintName);

      if (matchesThisSprint) {
        const list = logsByIssue.get(cl.issueKey) ?? [];
        list.push(cl);
        logsByIssue.set(cl.issueKey, list);
      }
    }

    // Issues currently in the sprint with no Sprint-field changelog were
    // created directly in the sprint — record them with an empty log array.
    for (const key of currentMemberKeys) {
      if (!issueKeysWithAnySprintLog.has(key) && !logsByIssue.has(key)) {
        if (issueCreatedAtMap.has(key)) {
          logsByIssue.set(key, []);
        }
      }
    }

    if (logsByIssue.size === 0) {
      return {
        ...this.empty(),
        currentMemberKeys,
      };
    }

    const effectiveSprintStart = new Date(
      sprintStart.getTime() + SPRINT_GRACE_PERIOD_MS,
    );
    const committedKeys = new Set<string>();
    const addedKeys = new Set<string>();
    const committedRemovedKeys = new Set<string>();
    const addedRemovedKeys = new Set<string>();

    for (const [issueKey, logs] of logsByIssue) {
      const createdAt = issueCreatedAtMap.get(issueKey);
      const createdMidSprint =
        logs.length === 0 &&
        createdAt != null &&
        createdAt > effectiveSprintStart;

      const wasAtStart =
        !createdMidSprint &&
        wasInSprintAtDate(logs, sprintName, sprintId, sprintStart);

      let inSprintAtEnd = wasAtStart || createdMidSprint;
      let wasAddedDuringSprint = createdMidSprint;
      let wasCarryOver = false;

      for (const cl of logs) {
        if (
          cl.changedAt <
          new Date(sprintStart.getTime() - SPRINT_GRACE_PERIOD_MS)
        ) {
          continue;
        }
        if (cl.changedAt > sprintEnd) break;

        const clToHasSprint =
          cl.toId != null
            ? sprintIdContains(cl.toId, sprintId)
            : sprintValueContains(cl.toValue, sprintName);
        const clFromHasSprint =
          cl.fromId != null
            ? sprintIdContains(cl.fromId, sprintId)
            : sprintValueContains(cl.fromValue, sprintName);

        if (clToHasSprint) {
          if (!inSprintAtEnd && !wasAtStart) {
            if (
              isCarryOverFromSprint(
                cl.fromValue,
                cl.fromId,
                sprintName,
                sprintId,
                closedSprintNames,
                closedSprintIds,
              )
            ) {
              wasCarryOver = true;
            } else {
              wasAddedDuringSprint = true;
            }
          }
          inSprintAtEnd = true;
        }
        if (clFromHasSprint && !clToHasSprint) {
          inSprintAtEnd = false;
        }
      }

      if (wasAtStart || wasCarryOver) {
        committedKeys.add(issueKey);
        if (!inSprintAtEnd) committedRemovedKeys.add(issueKey);
      } else if (wasAddedDuringSprint) {
        addedKeys.add(issueKey);
        if (!inSprintAtEnd) addedRemovedKeys.add(issueKey);
      }
    }

    return {
      committedKeys,
      addedKeys,
      committedRemovedKeys,
      addedRemovedKeys,
      currentMemberKeys,
      logsByIssue,
    };
  }

  private empty(): SprintMembership {
    return {
      committedKeys: new Set(),
      addedKeys: new Set(),
      committedRemovedKeys: new Set(),
      addedRemovedKeys: new Set(),
      currentMemberKeys: new Set(),
      logsByIssue: new Map(),
    };
  }

  /**
   * Compute, per issue, the timestamp at which the issue first entered any
   * sprint (i.e. the earliest `Sprint`-field changelog entry).
   *
   * Returns a `Map<issueKey, Date>` covering only those issues that have at
   * least one Sprint changelog entry. Callers that need a fallback (e.g.
   * `issue.createdAt` for issues never assigned to a sprint) should apply
   * it themselves — this helper deliberately returns no entry when no
   * Sprint history exists, so the absence is distinguishable from an
   * issue-creation-time fallback.
   *
   * Used by `quarter-detail.service.ts` to derive a "board entry" date for
   * Scrum boards (proposal 0055, fix C-2). Centralised here so the Sprint
   * changelog scan lives in one place — see ADR 0049 single-source-of-truth
   * mandate.
   */
  firstSprintEntryDates(input: {
    issueKeys: readonly string[];
    changelogsByIssue: ReadonlyMap<string, readonly JiraChangelog[]>;
  }): Map<string, Date> {
    const result = new Map<string, Date>();

    for (const key of input.issueKeys) {
      const logs = input.changelogsByIssue.get(key);
      if (!logs || logs.length === 0) continue;

      // Find the earliest Sprint-field changelog. We do not assume the input
      // is pre-sorted: callers commonly hand us a mixed-field changelog list.
      let earliest: Date | null = null;
      for (const cl of logs) {
        if (cl.field !== 'Sprint') continue;
        if (earliest === null || cl.changedAt < earliest) {
          earliest = cl.changedAt;
        }
      }
      if (earliest !== null) {
        result.set(key, earliest);
      }
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit testing and for the rare caller
// that needs the same matching primitives without invoking the full service.
// ---------------------------------------------------------------------------

/**
 * Exact sprint-name match inside a comma-separated Sprint field value.
 * Prevents "Sprint 1" from matching "Sprint 10".
 */
export function sprintValueContains(
  value: string | null,
  sprintName: string,
): boolean {
  if (!value) return false;
  return value.split(',').some((s) => s.trim() === sprintName);
}

/**
 * Exact sprint-ID match inside a comma-separated Sprint ID field value.
 * Jira stores IDs as e.g. "3864, 3903, 3941".
 */
export function sprintIdContains(
  value: string | null,
  sprintId: string,
): boolean {
  if (!value) return false;
  return value.split(',').some((s) => s.trim() === sprintId);
}

/**
 * Replay Sprint-field changelogs to determine whether an issue was in the
 * sprint at the given date. Applies `SPRINT_GRACE_PERIOD_MS` to absorb the
 * bulk-add delay at sprint start.
 */
export function wasInSprintAtDate(
  sprintChangelogs: JiraChangelog[],
  sprintName: string,
  sprintId: string,
  date: Date,
): boolean {
  const effectiveDate = new Date(date.getTime() + SPRINT_GRACE_PERIOD_MS);
  let inSprint = false;

  for (const cl of sprintChangelogs) {
    if (cl.changedAt > effectiveDate) break;

    const clToHasSprint =
      cl.toId != null
        ? sprintIdContains(cl.toId, sprintId)
        : sprintValueContains(cl.toValue, sprintName);
    const clFromHasSprint =
      cl.fromId != null
        ? sprintIdContains(cl.fromId, sprintId)
        : sprintValueContains(cl.fromValue, sprintName);

    if (clToHasSprint) inSprint = true;
    if (clFromHasSprint && !clToHasSprint) inSprint = false;
  }

  // No changelog ⇒ assigned at creation.
  if (sprintChangelogs.length === 0) return true;

  return inSprint;
}

/**
 * Returns true when a Sprint-field changelog `fromValue`/`fromId` indicates
 * the issue was carried over from a **closed** sprint (Jira "Complete Sprint"
 * carry-over flow). Issues moved from future or groomed sprints are NOT
 * carry-overs — they are mid-sprint scope additions.
 *
 * Prefer ID-based matching when `fromId` is present, so sprints renamed
 * after carry-over (e.g. "Ready to estimate 2" → "Sprint 2") are still
 * correctly identified.
 *
 * See ADR 0039.
 */
export function isCarryOverFromSprint(
  fromValue: string | null,
  fromId: string | null,
  currentSprintName: string,
  currentSprintId: string,
  closedSprintNames: Set<string>,
  closedSprintIds: Set<string>,
): boolean {
  if (fromId != null) {
    return fromId.split(',').some((s) => {
      const id = s.trim();
      return id !== '' && id !== currentSprintId && closedSprintIds.has(id);
    });
  }
  if (!fromValue) return false;
  return fromValue.split(',').some((s) => {
    const name = s.trim();
    return (
      name !== '' && name !== currentSprintName && closedSprintNames.has(name)
    );
  });
}

/**
 * Pure projection of a `SprintMembership` to the counts and derived
 * percentages that planning-accuracy and sprint-detail callers need.
 *
 * No I/O, no DB access — safe to call in tight loops or unit tests. See
 * proposal 0050 / ADR 0052 for the canonical formulas.
 */
export function summariseMembership(m: SprintMembership): MembershipSummary {
  const commitmentCount = m.committedKeys.size;
  const addedCount = m.addedKeys.size;
  const netAddedCount = m.addedKeys.size - m.addedRemovedKeys.size;
  const removedCount = m.committedRemovedKeys.size;
  const finalSetSize = m.currentMemberKeys.size;

  const scopeChangePercent =
    commitmentCount > 0
      ? Math.round(
          ((m.addedKeys.size + m.committedRemovedKeys.size) /
            commitmentCount) *
            10000,
        ) / 100
      : 0;

  return {
    commitmentCount,
    addedCount,
    netAddedCount,
    removedCount,
    finalSetSize,
    scopeChangePercent,
  };
}
