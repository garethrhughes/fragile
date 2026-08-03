/**
 * healthcheck-compute.ts
 *
 * Pure per-board Healthcheck computation (ADR 0070/0071/0073). No DB, no I/O —
 * the service loads data and injects it (including resolver callbacks for
 * sprint-membership and roadmap-link lookups, which require pre-loaded state).
 *
 * Model: the denominator D is the set of issues whose FIRST-EVER start
 * transition falls within the week window:
 *   - scrum:  first transition into an `inProgressStatuses` status
 *   - kanban: first transition into a `boardEntryStatuses` status
 *
 * Each score = (100 / |D|) * numerator (see healthcheck-scoring.ts):
 *   - Stability (scrum only): started tickets that were committed/carry-over at
 *     their sprint start (resolved via `committedKeysAt`).
 *   - Roadmap  (scrum only): started tickets that are roadmap-linked
 *     (membership — `isRoadmapLinked`).
 *   - Support  (all boards): started tickets classified as support.
 */
import type { JiraIssue, JiraChangelog, JiraIssueLink } from '../database/entities/index.js';
import { computeScore } from './healthcheck-scoring.js';
import {
  classifyStabilityBand,
  classifyRoadmapBand,
  classifySupportBand,
} from './healthcheck-bands.js';
import {
  classifySupport,
  type SupportClassifierConfig,
} from '../support/support-classification.js';
import type { HealthcheckBoardResult, HealthcheckDimension } from './dto/healthcheck-response.dto.js';

export interface BoardHealthcheckInput {
  boardId: string;
  boardType: 'scrum' | 'kanban';
  week: string;
  weekStart: Date;
  weekEnd: Date;
  /** Non-Epic/non-subtask work items for the board (caller-filtered, ADR 0018). */
  issues: JiraIssue[];
  /** Per-issue status changelogs, ordered by changedAt ASC. */
  statusChangelogsByIssue: Map<string, JiraChangelog[]>;
  /** In-progress status names (scrum start signal). Case-sensitive match on toValue. */
  inProgressStatuses: Set<string>;
  /** Board-entry status names, pre-lowercased (kanban start signal). */
  boardEntryStatuses: Set<string>;
  doneStatusNames: string[];
  /** Cancelled status names, pre-lowercased. */
  cancelledStatuses: Set<string>;
  /**
   * Resolver: was `issueKey` committed/carry-over at the start of the sprint
   * active at its `startedAt` in-progress moment? (ADR 0071). Scrum only.
   */
  committedKeysAt: (issueKey: string, startedAt: Date) => boolean;
  /** Resolver: is `issueKey` roadmap-linked (in-scope|linked)? (ADR 0073). Scrum only. */
  isRoadmapLinked: (issueKey: string) => boolean;
  supportConfig: SupportClassifierConfig;
  /** Per-issue links (source = issue) for support link classification. */
  linksByIssue: Map<string, JiraIssueLink[]>;
  /** Roadmap-delivery target (%) for the board (default 80). */
  roadmapDeliveryTarget?: number;
}

const DEFAULT_ROADMAP_TARGET = 80;

/**
 * The first-ever start transition date for an issue, or null if it never
 * started within observable history.
 *   - scrum:  first transition into any `inProgressStatuses` status
 *   - kanban: first transition into any `boardEntryStatuses` status
 */
function firstStartDate(
  logs: JiraChangelog[],
  isKanban: boolean,
  inProgressStatuses: Set<string>,
  boardEntryStatuses: Set<string>,
): Date | null {
  const match = logs.find((cl) => {
    if (cl.field !== 'status' || cl.toValue === null) return false;
    return isKanban
      ? boardEntryStatuses.has(cl.toValue.toLowerCase())
      : inProgressStatuses.has(cl.toValue);
  });
  return match?.changedAt ?? null;
}

export function computeBoardHealthcheck(
  input: BoardHealthcheckInput,
): HealthcheckBoardResult {
  const isKanban = input.boardType === 'kanban';
  const target = input.roadmapDeliveryTarget ?? DEFAULT_ROADMAP_TARGET;

  // --- Build denominator D: first-ever start transition within the week ---
  const started: { issue: JiraIssue; startedAt: Date }[] = [];
  for (const issue of input.issues) {
    const logs = input.statusChangelogsByIssue.get(issue.key) ?? [];
    const startedAt = firstStartDate(
      logs,
      isKanban,
      input.inProgressStatuses,
      input.boardEntryStatuses,
    );
    if (
      startedAt !== null &&
      startedAt >= input.weekStart &&
      startedAt <= input.weekEnd
    ) {
      started.push({ issue, startedAt });
    }
  }

  const denominator = started.length;

  // --- Numerators ---
  let stabilityNumerator = 0;
  let roadmapNumerator = 0;
  let supportNumerator = 0;

  for (const { issue, startedAt } of started) {
    if (!isKanban) {
      if (input.committedKeysAt(issue.key, startedAt)) stabilityNumerator += 1;
      if (input.isRoadmapLinked(issue.key)) roadmapNumerator += 1;
    }

    const classification = classifySupport(
      {
        epicKey: issue.epicKey ?? null,
        labels: Array.isArray(issue.labels) ? (issue.labels as string[]) : [],
      },
      input.linksByIssue.get(issue.key) ?? [],
      input.supportConfig,
    );
    if (classification.isSupport) supportNumerator += 1;
  }

  const stabilityScore = computeScore(stabilityNumerator, denominator, {
    applicable: !isKanban,
  });
  const roadmapScore = computeScore(roadmapNumerator, denominator, {
    applicable: !isKanban,
  });
  const supportScore = computeScore(supportNumerator, denominator);

  const stability: HealthcheckDimension = {
    ...stabilityScore,
    band: classifyStabilityBand(stabilityScore.score),
  };
  const roadmap: HealthcheckDimension = {
    ...roadmapScore,
    band: classifyRoadmapBand(roadmapScore.score, target),
  };
  const support: HealthcheckDimension = {
    ...supportScore,
    band: classifySupportBand(supportScore.score),
  };

  return {
    boardId: input.boardId,
    boardType: input.boardType,
    denominator,
    stability,
    roadmap,
    support,
    trend: [], // filled by the service across the 8-week window
  };
}
