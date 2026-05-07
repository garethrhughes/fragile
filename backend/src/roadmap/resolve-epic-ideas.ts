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

export function resolveEpicIdeas(
  ideas: ReadonlyArray<ResolveIdeaInput>,
  rule: EpicConflictResolution,
): Map<string, ResolvedEpicIdea> {
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
    const sorted = [...candidates].sort((a, b) => {
      const at = a.targetDate!.getTime();
      const bt = b.targetDate!.getTime();
      // 'earliest' → ascending; 'latest' → descending.
      return rule === 'earliest' ? at - bt : bt - at;
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
