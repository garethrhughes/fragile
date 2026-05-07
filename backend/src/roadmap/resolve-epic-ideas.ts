/**
 * Shared conflict-resolution helper for the roadmap idea↔epic graph
 * (proposal 0053).
 *
 * Both code paths route through this function:
 *   - `RoadmapService.filterIdeasForWindow` (deliveryIssueKeys path).
 *   - `buildDirectLinkIdeaMap`              (direct issue-link path).
 *
 * It groups ideas by linked target key (the "epic key" — for the direct-link
 * path the caller substitutes the source issue key, see ADR 0044), then
 * picks a primary idea per `RoadmapConfig.epicConflictResolution`:
 *   - 'earliest' (default) — strictest committed targetDate wins.
 *   - 'latest'             — legacy pre-0053 behaviour.
 *
 * Non-primary ideas are surfaced as `conflictingIdeas` for the per-epic
 * detail endpoint (GET /api/roadmap/epics).
 *
 * Pure function — no DB, no IO, no side effects.
 */

export type EpicConflictResolution = 'earliest' | 'latest';

/**
 * Minimal shape required from a JPD idea — duck-typed so the helper can
 * accept both real `JpdIdea` rows and synthetic objects manufactured by
 * the direct-link path.
 */
export interface ResolveIdeaInput {
  key: string;
  summary: string | null;
  deliveryIssueKeys: string[] | null;
  startDate: Date | null;
  targetDate: Date | null;
}

export interface ResolvedConflictingIdea {
  ideaKey: string;
  ideaSummary: string | null;
  targetDate: Date;
  /** Signed integer days: positive = later than primary, negative = earlier. */
  daysFromPrimary: number;
}

export interface ResolvedEpicIdea {
  epicKey: string;
  primaryIdea: {
    ideaKey: string;
    ideaSummary: string | null;
    targetDate: Date;
    startDate: Date | null;
  };
  conflictingIdeas: ResolvedConflictingIdea[];
}

const MS_PER_DAY = 86_400_000;

/**
 * `rule` may be either a single resolution rule (applied to every group)
 * or a function that resolves the rule per primary candidate. The
 * per-candidate form is used by callers that load ideas across multiple
 * `RoadmapConfig`s with potentially different `epicConflictResolution`
 * settings — the rule is evaluated against the *primary* idea so the
 * resolution scope follows the roadmap that "owns" the chosen idea.
 */
export type ResolutionRuleResolver =
  | EpicConflictResolution
  | ((idea: ResolveIdeaInput) => EpicConflictResolution);

export function resolveEpicIdeas(
  ideas: ReadonlyArray<ResolveIdeaInput>,
  rule: ResolutionRuleResolver,
): Map<string, ResolvedEpicIdea> {
  // Resolve a per-candidate rule. For sorting we need ONE rule per group,
  // so we use the rule of the first candidate as a stable proxy — when all
  // ideas in a group share a jpdKey (the common case), this is exact;
  // when they differ, it consistently picks the rule of whichever idea
  // appears first in input order.
  const resolveRule: (idea: ResolveIdeaInput) => EpicConflictResolution =
    typeof rule === 'function' ? rule : () => rule;
  // Group eligible ideas by the epic key they link to. An idea is eligible
  // iff it has both startDate and targetDate (matches existing
  // filterIdeasForWindow behaviour, decision 2) and a non-null
  // deliveryIssueKeys list with at least one truthy entry.
  const grouped = new Map<string, ResolveIdeaInput[]>();
  for (const idea of ideas) {
    if (idea.startDate === null || idea.targetDate === null) continue;
    if (!idea.deliveryIssueKeys) continue;
    for (const epicKey of idea.deliveryIssueKeys.filter(Boolean)) {
      const list = grouped.get(epicKey);
      if (list) {
        list.push(idea);
      } else {
        grouped.set(epicKey, [idea]);
      }
    }
  }

  const result = new Map<string, ResolvedEpicIdea>();

  for (const [epicKey, candidates] of grouped) {
    // Sort copy so we can safely mutate. Stable enough for a small N.
    // Use the first candidate's rule as the group rule (see comment on
    // ResolutionRuleResolver).
    const groupRule = resolveRule(candidates[0]);
    const sorted = [...candidates].sort((a, b) => {
      const at = a.targetDate!.getTime();
      const bt = b.targetDate!.getTime();
      // 'earliest' → ascending; 'latest' → descending.
      return groupRule === 'earliest' ? at - bt : bt - at;
    });

    const primary = sorted[0];
    const primaryTargetMs = primary.targetDate!.getTime();

    const conflictingIdeas: ResolvedConflictingIdea[] = sorted.slice(1).map((c) => ({
      ideaKey: c.key,
      ideaSummary: c.summary,
      targetDate: c.targetDate!,
      daysFromPrimary: Math.round((c.targetDate!.getTime() - primaryTargetMs) / MS_PER_DAY),
    }));

    result.set(epicKey, {
      epicKey,
      primaryIdea: {
        ideaKey: primary.key,
        ideaSummary: primary.summary,
        targetDate: primary.targetDate!,
        startDate: primary.startDate,
      },
      conflictingIdeas,
    });
  }

  return result;
}
