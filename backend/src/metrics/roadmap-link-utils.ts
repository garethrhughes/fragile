import { Repository } from 'typeorm';
import { JiraIssueLink, JpdIdea } from '../database/entities/index.js';

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
 *   - Conflict resolution when one issue is linked to multiple ideas: keep the latest
 *     targetDate — consistent with the existing epicIdeaMap conflict resolution.
 *   - Ideas with null targetDate are ignored.
 *   - A single bulk query is issued regardless of the number of issue keys (no N+1).
 */
export async function buildDirectLinkIdeaMap(
  issueLinkRepo: Repository<JiraIssueLink>,
  issueKeys: string[],
  allIdeas: JpdIdea[],
  roadmapLinkTypes: string[],
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

  for (const row of linkRows) {
    const idea = jpdIdeaByKey.get(row.targetIssueKey);
    if (!idea || idea.targetDate === null) continue;

    const existing = result.get(row.sourceIssueKey);
    // Conflict resolution: keep the latest targetDate (optimistic — consistent
    // with existing epicIdeaMap behaviour in roadmap.service.ts)
    if (!existing || idea.targetDate > existing.targetDate) {
      result.set(row.sourceIssueKey, { targetDate: idea.targetDate });
    }
  }

  return result;
}
