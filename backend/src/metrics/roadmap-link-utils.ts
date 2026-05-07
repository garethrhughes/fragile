import { Repository } from 'typeorm';
import { JiraIssueLink, JpdIdea } from '../database/entities/index.js';
import {
  resolveEpicIdeas,
  type EpicConflictResolution,
  type ResolveIdeaInput,
} from '../roadmap/resolve-epic-ideas.js';

/**
 * Builds a map from sprint issue key → { targetDate } for issues that are
 * directly linked to a known JPD roadmap idea via a qualifying Jira issue link.
 *
 * This is Condition C in the roadmap coverage classification logic — it
 * supplements the existing epic → idea path (Conditions A/B) with a direct
 * issue → idea link path configurable per board via `BoardConfig.roadmapLinkTypes`.
 *
 * Design decisions (ADR 0044):
 *   - Empty `roadmapLinkTypes` ⟹ feature disabled; no DB query is issued.
 *   - Empty `issueKeys`       ⟹ no DB query is issued.
 *   - Link type matching is case-insensitive (LOWER() in SQL + toLowerCase() in-memory).
 *   - Ideas with null targetDate are ignored.
 *   - A single bulk query is issued regardless of the number of issue keys (no N+1).
 *
 * Conflict resolution (proposal 0053): when a single sprint issue is linked
 * to multiple ideas, the choice is delegated to the shared
 * `resolveEpicIdeas` helper, which honours each roadmap's
 * `epicConflictResolution` policy ('earliest' default, 'latest' legacy
 * override). This guarantees parity with the epic→idea path (AC6).
 */
export async function buildDirectLinkIdeaMap(
  issueLinkRepo: Repository<JiraIssueLink>,
  issueKeys: string[],
  allIdeas: JpdIdea[],
  roadmapLinkTypes: string[],
  ruleByJpdKey: Map<string, EpicConflictResolution> = new Map(),
): Promise<Map<string, { targetDate: Date }>> {
  const result = new Map<string, { targetDate: Date }>();

  if (roadmapLinkTypes.length === 0 || issueKeys.length === 0) {
    return result;
  }

  // Build an in-memory lookup of known JPD idea keys (with non-null targetDate)
  const jpdIdeaByKey = new Map<string, JpdIdea>();
  for (const idea of allIdeas) {
    if (idea.targetDate !== null) {
      jpdIdeaByKey.set(idea.key, idea);
    }
  }

  if (jpdIdeaByKey.size === 0) {
    return result;
  }

  // Single bulk query — no N+1
  const linkRows = await issueLinkRepo
    .createQueryBuilder('l')
    .select(['l.sourceIssueKey', 'l.targetIssueKey', 'l.linkTypeName'])
    .where('l.sourceIssueKey IN (:...keys)', { keys: issueKeys })
    .andWhere('LOWER(l.linkTypeName) IN (:...types)', {
      types: roadmapLinkTypes.map((t) => t.toLowerCase()),
    })
    .getMany();

  // Manufacture synthetic ResolveIdeaInput rows where deliveryIssueKeys is
  // [sourceIssueKey] — this lets us reuse the shared helper unchanged.
  // The "epic key" returned by the helper is therefore the source issue key,
  // matching the original buildDirectLinkIdeaMap contract.
  const synthetic: (ResolveIdeaInput & { jpdKey: string })[] = [];
  for (const row of linkRows) {
    const idea = jpdIdeaByKey.get(row.targetIssueKey);
    if (!idea || idea.targetDate === null) continue;
    synthetic.push({
      key: idea.key,
      summary: idea.summary,
      // Synthesise a non-null startDate when the idea lacks one — the direct
      // link path historically did not gate on startDate. We use targetDate
      // itself so the helper's null-date filter is satisfied without
      // affecting downstream eligibility (the caller only reads targetDate).
      startDate: idea.startDate ?? idea.targetDate,
      targetDate: idea.targetDate,
      deliveryIssueKeys: [row.sourceIssueKey],
      jpdKey: idea.jpdKey,
    });
  }

  const resolved = resolveEpicIdeas(
    synthetic,
    (idea) =>
      ruleByJpdKey.get((idea as ResolveIdeaInput & { jpdKey: string }).jpdKey) ??
      'earliest',
  );

  for (const [sourceIssueKey, entry] of resolved) {
    result.set(sourceIssueKey, { targetDate: entry.primaryIdea.targetDate });
  }

  return result;
}
