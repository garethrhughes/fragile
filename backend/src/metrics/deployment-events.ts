/**
 * Pure functions that derive deployment events from raw Jira data.
 *
 * Per ADR 0051 (CFR Denominator Semantics — Definition C), a deployment is a
 * single discrete event:
 *   - one fixVersion release (primary signal, per ADR 0001), OR
 *   - one issue transitioning to a done status (fallback, when no fixVersion
 *     is associated with the issue).
 *
 * Both DeploymentFrequencyService and CfrService derive their counts and
 * deployed-issue sets from the same event list, so that the CFR percentage
 * (failures / events) has matching units in numerator and denominator.
 *
 * This supersedes the distinct-day counting introduced by Fix C-4 of
 * proposal 0030.
 */
import type {
  JiraIssue,
  JiraVersion,
  JiraChangelog,
} from '../database/entities/index.js';
import { isWorkItem } from './issue-type-filters.js';

export type DeploymentSource = 'fixVersion' | 'doneTransition';

export interface DeploymentEvent {
  /** When the deployment occurred. For fixVersion sources, this is releaseDate. */
  readonly date: Date;
  /** Which signal produced the event. */
  readonly source: DeploymentSource;
  /** Issue key — present for doneTransition events. */
  readonly issueKey?: string;
  /** Version name — present for fixVersion events. */
  readonly versionName?: string;
}

export interface DeploymentEventInputs {
  readonly issues: readonly JiraIssue[];
  readonly versions: readonly JiraVersion[];
  readonly changelogs: readonly JiraChangelog[];
  readonly doneStatuses: readonly string[];
  readonly startDate: Date;
  readonly endDate: Date;
}

export interface DeploymentEventResult {
  readonly events: readonly DeploymentEvent[];
  /**
   * Set of issue keys that participated in any deployment in the period.
   * Used by CfrService to classify which deployed issues are failures.
   *
   * Includes:
   *   - All issues whose fixVersion matches a released version in the period.
   *   - All issues with no fixVersion that transitioned to done in the period.
   */
  readonly deployedIssueKeys: ReadonlySet<string>;
}

/**
 * Derive deployment events from in-memory data.  Pure function, no DB calls.
 *
 * One event per released fixVersion (one row per version, on its releaseDate).
 * One event per first done-transition for an issue with no fixVersion (one
 * row per issue, on the changelog timestamp).
 *
 * Issues are filtered through {@link isWorkItem} (epics and subtasks excluded
 * per ADR 0018) before considering them for either signal.
 */
export function deriveDeploymentEvents(
  inputs: DeploymentEventInputs,
): DeploymentEventResult {
  const { issues, versions, changelogs, doneStatuses, startDate, endDate } =
    inputs;

  const workItems = issues.filter((i) => isWorkItem(i.issueType));
  const events: DeploymentEvent[] = [];
  const deployedIssueKeys = new Set<string>();

  // Primary path: one event per released fixVersion in period (ADR 0051).
  const periodVersions = versions.filter(
    (v) =>
      v.released &&
      v.releaseDate != null &&
      v.releaseDate >= startDate &&
      v.releaseDate <= endDate,
  );
  const versionNames = new Set(periodVersions.map((v) => v.name));
  for (const v of periodVersions) {
    events.push({
      date: v.releaseDate!,
      source: 'fixVersion',
      versionName: v.name,
    });
  }

  // Issues attached to those releases are deployed (failure-classification set).
  for (const issue of workItems) {
    if (issue.fixVersion != null && versionNames.has(issue.fixVersion)) {
      deployedIssueKeys.add(issue.key);
    }
  }

  // Fallback path: issues with no fixVersion that transitioned to done in
  // the period.  One event per first done-transition per issue.  Re-opens
  // and subsequent done-transitions for the same issue do not double-count.
  const noVersionKeys = new Set(
    workItems.filter((i) => !i.fixVersion).map((i) => i.key),
  );
  // Sort changelogs by time so "first done-transition" semantics are stable.
  const sortedChangelogs = [...changelogs].sort(
    (a, b) => a.changedAt.getTime() - b.changedAt.getTime(),
  );
  for (const cl of sortedChangelogs) {
    if (
      cl.field === 'status' &&
      noVersionKeys.has(cl.issueKey) &&
      doneStatuses.includes(cl.toValue ?? '') &&
      cl.changedAt >= startDate &&
      cl.changedAt <= endDate &&
      !deployedIssueKeys.has(cl.issueKey)
    ) {
      events.push({
        date: cl.changedAt,
        source: 'doneTransition',
        issueKey: cl.issueKey,
      });
      deployedIssueKeys.add(cl.issueKey);
    }
  }

  return { events, deployedIssueKeys };
}
