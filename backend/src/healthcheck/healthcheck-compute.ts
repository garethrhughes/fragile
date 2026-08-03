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
import {
  classifySupport,
  type SupportClassifierConfig,
} from '../support/support-classification.js';

/**
 * Raw per-dimension counts for one board/week. `applicable` is false when the
 * dimension does not apply to the board (Stability/Roadmap on kanban) — such
 * boards contribute nothing to the pooled denominator or numerator.
 */
export interface DimensionCount {
  numerator: number;
  denominator: number;
  applicable: boolean;
}

/**
 * Per-board Healthcheck contribution — raw counts plus the included tickets.
 * The service pools the counts across boards (ADR 0074) to produce the org-wide
 * scores, and concatenates the tickets for the selected week's table.
 */
export interface BoardHealthcheckResult {
  boardId: string;
  boardType: 'scrum' | 'kanban';
  /** |D| — tickets that started this week on this board. */
  denominator: number;
  stability: DimensionCount;
  roadmap: DimensionCount;
  support: DimensionCount;
  /** The started-this-week tickets on this board, with their dimension flags. */
  tickets: HealthcheckTicket[];
}

/**
 * A single ticket in the week's denominator, flagged by which dimensions it
 * contributed to. `planned`/`onRoadmap` are always false for kanban tickets
 * (those dimensions don't apply).
 */
export interface HealthcheckTicket {
  key: string;
  summary: string;
  boardId: string;
  boardType: 'scrum' | 'kanban';
  issueType: string;
  status: string;
  /** Counted toward Stability (committed/carry-over at sprint start). */
  planned: boolean;
  /** Counted toward Roadmap (roadmap-linked). */
  onRoadmap: boolean;
  /** Counted toward Support (classified as reactive support). */
  support: boolean;
}

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
}

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
): BoardHealthcheckResult {
  const isKanban = input.boardType === 'kanban';

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
  const tickets: HealthcheckTicket[] = [];

  for (const { issue, startedAt } of started) {
    const planned = !isKanban && input.committedKeysAt(issue.key, startedAt);
    const onRoadmap = !isKanban && input.isRoadmapLinked(issue.key);

    const classification = classifySupport(
      {
        epicKey: issue.epicKey ?? null,
        labels: Array.isArray(issue.labels) ? (issue.labels as string[]) : [],
      },
      input.linksByIssue.get(issue.key) ?? [],
      input.supportConfig,
    );
    const isSupport = classification.isSupport;

    if (planned) stabilityNumerator += 1;
    if (onRoadmap) roadmapNumerator += 1;
    if (isSupport) supportNumerator += 1;

    tickets.push({
      key: issue.key,
      summary: issue.summary,
      boardId: input.boardId,
      boardType: input.boardType,
      issueType: issue.issueType,
      status: issue.status,
      planned,
      onRoadmap,
      support: isSupport,
    });
  }

  return {
    boardId: input.boardId,
    boardType: input.boardType,
    denominator,
    // Stability & Roadmap only apply to scrum boards (ADR 0070).
    stability: { numerator: stabilityNumerator, denominator, applicable: !isKanban },
    roadmap: { numerator: roadmapNumerator, denominator, applicable: !isKanban },
    // Support applies to all boards.
    support: { numerator: supportNumerator, denominator, applicable: true },
    tickets,
  };
}
