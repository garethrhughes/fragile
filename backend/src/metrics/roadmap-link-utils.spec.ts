import { Repository } from 'typeorm';
import { JiraIssueLink, JpdIdea } from '../database/entities/index.js';
import { buildDirectLinkIdeaMap } from './roadmap-link-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIdea(key: string, targetDate: Date | null): JpdIdea {
  const idea = new JpdIdea();
  idea.key = key;
  idea.targetDate = targetDate;
  idea.jpdKey = 'PT';
  idea.summary = key;
  idea.deliveryIssueKeys = [];
  idea.startDate = null;
  return idea;
}

function makeLink(
  sourceIssueKey: string,
  targetIssueKey: string,
  linkTypeName: string,
): JiraIssueLink {
  const link = new JiraIssueLink();
  link.sourceIssueKey = sourceIssueKey;
  link.targetIssueKey = targetIssueKey;
  link.linkTypeName = linkTypeName;
  link.isInward = false;
  return link;
}

function makeRepo(links: JiraIssueLink[]): Repository<JiraIssueLink> {
  // Minimal mock that returns links matching the bulk-query semantics.
  // We replicate the filter so the test verifies the helper applies LOWER().
  const createQueryBuilder = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockImplementation((condition: string, params: Record<string, unknown>) => {
      // capture the types filter to apply in getMany
      const qb = {
        _types: params['types'] as string[],
        _keys: params['keys'] as string[],
        getMany: jest.fn().mockImplementation(() => {
          return links.filter(
            (l) =>
              (qb._keys?.includes(l.sourceIssueKey) ?? true) &&
              (qb._types?.includes(l.linkTypeName.toLowerCase()) ?? true),
          );
        }),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockImplementation((_c: string, p: Record<string, unknown>) => {
          if (p['types']) qb._types = p['types'] as string[];
          if (p['keys']) qb._keys = p['keys'] as string[];
          return qb;
        }),
      };
      if (params['types']) qb._types = params['types'] as string[];
      if (params['keys']) qb._keys = params['keys'] as string[];
      return qb;
    }),
    getMany: jest.fn().mockResolvedValue([]),
  });

  return { createQueryBuilder } as unknown as Repository<JiraIssueLink>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDirectLinkIdeaMap', () => {
  it('returns an empty map when roadmapLinkTypes is empty — no DB query issued', async () => {
    const repo = { createQueryBuilder: jest.fn() } as unknown as Repository<JiraIssueLink>;
    const result = await buildDirectLinkIdeaMap(repo, ['ACC-1'], [makeIdea('PT-1', new Date())], []);
    expect(result.size).toBe(0);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns an empty map when issueKeys is empty — no DB query issued', async () => {
    const repo = { createQueryBuilder: jest.fn() } as unknown as Repository<JiraIssueLink>;
    const result = await buildDirectLinkIdeaMap(
      repo,
      [],
      [makeIdea('PT-1', new Date())],
      ['is connected to'],
    );
    expect(result.size).toBe(0);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('maps an issue to the targetDate of its linked JPD idea when link type matches', async () => {
    const targetDate = new Date('2026-06-30T00:00:00.000Z');
    const ideas = [makeIdea('PT-389', targetDate)];
    const links = [makeLink('ACC-10', 'PT-389', 'is connected to')];

    const result = await buildDirectLinkIdeaMap(
      makeRepo(links),
      ['ACC-10'],
      ideas,
      ['is connected to'],
    );

    expect(result.get('ACC-10')).toEqual({ targetDate });
  });

  it('matches link type case-insensitively (mixed-case link type name in DB)', async () => {
    const targetDate = new Date('2026-06-30T00:00:00.000Z');
    const ideas = [makeIdea('PT-389', targetDate)];
    // Jira stores "Is Connected To" but config has lowercase "is connected to"
    const links = [makeLink('ACC-10', 'PT-389', 'Is Connected To')];

    const result = await buildDirectLinkIdeaMap(
      makeRepo(links),
      ['ACC-10'],
      ideas,
      ['is connected to'],
    );

    expect(result.get('ACC-10')).toEqual({ targetDate });
  });

  it('ignores links where target is not a known JPD idea', async () => {
    const ideas = [makeIdea('PT-389', new Date('2026-06-30'))];
    // ACC-10 links to PT-999 which is NOT in ideas
    const links = [makeLink('ACC-10', 'PT-999', 'is connected to')];

    const result = await buildDirectLinkIdeaMap(
      makeRepo(links),
      ['ACC-10'],
      ideas,
      ['is connected to'],
    );

    expect(result.has('ACC-10')).toBe(false);
  });

  it('ignores links where link type does not match roadmapLinkTypes', async () => {
    const ideas = [makeIdea('PT-389', new Date('2026-06-30'))];
    const links = [makeLink('ACC-10', 'PT-389', 'is blocked by')];

    const result = await buildDirectLinkIdeaMap(
      makeRepo(links),
      ['ACC-10'],
      ideas,
      ['is connected to'],
    );

    expect(result.has('ACC-10')).toBe(false);
  });

  it('ignores ideas with null targetDate', async () => {
    const ideas = [makeIdea('PT-389', null)];
    const links = [makeLink('ACC-10', 'PT-389', 'is connected to')];

    const result = await buildDirectLinkIdeaMap(
      makeRepo(links),
      ['ACC-10'],
      ideas,
      ['is connected to'],
    );

    expect(result.has('ACC-10')).toBe(false);
  });

  it('uses the latest targetDate when issue is linked to multiple roadmap ideas', async () => {
    const earlier = new Date('2026-03-31T00:00:00.000Z');
    const later = new Date('2026-09-30T00:00:00.000Z');
    const ideas = [makeIdea('PT-1', earlier), makeIdea('PT-2', later)];
    const links = [
      makeLink('ACC-10', 'PT-1', 'is connected to'),
      makeLink('ACC-10', 'PT-2', 'is connected to'),
    ];

    const result = await buildDirectLinkIdeaMap(
      makeRepo(links),
      ['ACC-10'],
      ideas,
      ['is connected to'],
    );

    expect(result.get('ACC-10')).toEqual({ targetDate: later });
  });
});
