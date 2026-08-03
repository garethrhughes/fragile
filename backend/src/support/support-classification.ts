/**
 * support-classification.ts
 *
 * Pure, DB-free support classification shared by the Support report
 * (`support.service`) and the Healthcheck report (`healthcheck.service`).
 *
 * A ticket is "support" when ANY of three signals match (ADR 0045/0047/0061):
 *   - epic:  issue.epicKey is in `supportEpics` (case-insensitive)
 *   - label: issue.labels intersects `supportLabels`
 *   - link:  a JiraIssueLink of a type in `supportLinkTypes` targets an issue
 *            on the triage board (key starts with `triageBoardKey + '-'`)
 *
 * Extracted to a single source of truth per ADR 0072 — behaviour is identical
 * to the previous inline logic in `support.service` and `all-items.service`.
 */
import type { JiraIssueLink } from '../database/entities/index.js';
import type { SupportMatchReason } from './dto/support-response.dto.js';

/** Board-config subset needed for support classification. */
export interface SupportClassifierConfig {
  /** Epic keys whose children count as support. Matched case-insensitively. */
  supportEpics: string[];
  /** Labels identifying a support ticket. */
  supportLabels: string[];
  /** Link type names pointing at the triage board. */
  supportLinkTypes: string[];
  /** Triage board key prefix (e.g. "TTB"); null disables link classification. */
  triageBoardKey: string | null;
}

/** Minimal issue shape needed for classification. */
export interface SupportClassifiableIssue {
  epicKey: string | null;
  labels: string[];
}

export interface SupportClassification {
  isSupport: boolean;
  /** True when classification matched via a triage-board (TTB) link. */
  isTtbSupport: boolean;
  /** '+'-joined signals in epic→label→link order, or null when no match. */
  matchReason: SupportMatchReason | null;
}

/**
 * Classify a single issue against the configured support signals.
 *
 * @param issue  Issue with `epicKey` and `labels`.
 * @param links  Issue links whose `sourceIssueKey` is this issue (caller-filtered).
 * @param config Support signal configuration for the board.
 */
export function classifySupport(
  issue: SupportClassifiableIssue,
  links: readonly JiraIssueLink[],
  config: SupportClassifierConfig,
): SupportClassification {
  const supportEpics = config.supportEpics.map((e) => e.toUpperCase());
  const triagePrefix = config.triageBoardKey ? `${config.triageBoardKey}-` : null;

  const epicMatch =
    supportEpics.length > 0 &&
    issue.epicKey != null &&
    supportEpics.includes(issue.epicKey.toUpperCase());

  const labelMatch =
    config.supportLabels.length > 0 &&
    Array.isArray(issue.labels) &&
    issue.labels.some((l) => config.supportLabels.includes(l));

  const linkMatch =
    config.supportLinkTypes.length > 0 &&
    triagePrefix !== null &&
    links.some(
      (lnk) =>
        config.supportLinkTypes.includes(lnk.linkTypeName) &&
        lnk.targetIssueKey.startsWith(triagePrefix),
    );

  const isSupport = epicMatch || labelMatch || linkMatch;

  if (!isSupport) {
    return { isSupport: false, isTtbSupport: false, matchReason: null };
  }

  const reasons: string[] = [];
  if (epicMatch) reasons.push('epic');
  if (labelMatch) reasons.push('label');
  if (linkMatch) reasons.push('link');

  return {
    isSupport: true,
    isTtbSupport: linkMatch,
    matchReason: reasons.join('+') as SupportMatchReason,
  };
}
