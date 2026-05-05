import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SupportService } from './support.service.js';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  JiraSprint,
  BoardConfig,
  JiraIssueLink,
} from '../database/entities/index.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-01T00:00:00.000Z');
const DONE_AT = new Date('2026-03-20T12:00:00.000Z');
const STARTED_AT = new Date('2026-03-15T09:00:00.000Z');

function makeIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    id: 1,
    key: 'ACC-1',
    summary: 'Test issue',
    status: 'Done',
    issueType: 'Story',
    boardId: 'ACC',
    fixVersion: null,
    points: 3,
    sprintId: null,
    epicKey: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-03-20'),
    labels: [],
    priority: null,
    assignee: null,
    ...overrides,
  } as unknown as JiraIssue;
}

function makeChangelog(
  issueKey: string,
  from: string | null,
  to: string,
  changedAt: Date,
): JiraChangelog {
  return { id: 1, issueKey, field: 'status', fromValue: from, toValue: to, changedAt } as JiraChangelog;
}

function makeLink(
  sourceIssueKey: string,
  targetIssueKey: string,
  linkTypeName: string,
): JiraIssueLink {
  return { id: 1, sourceIssueKey, targetIssueKey, linkTypeName, isInward: false } as JiraIssueLink;
}

function makeConfig(overrides: Partial<BoardConfig> = {}): BoardConfig {
  return {
    boardId: 'ACC',
    boardType: 'scrum',
    doneStatusNames: ['Done'],
    inProgressStatusNames: ['In Progress'],
    supportLabels: [],
    supportLinkType: null,
    triageBoardKey: null,
    ...overrides,
  } as unknown as BoardConfig;
}

function makeWtEntity() {
  return { excludeWeekends: false, hoursPerDay: 8 };
}

// ---------------------------------------------------------------------------
// Repository mock factory
// ---------------------------------------------------------------------------

function repoMock() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupportService', () => {
  let service: SupportService;
  let issueRepo: ReturnType<typeof repoMock>;
  let changelogRepo: ReturnType<typeof repoMock>;
  let versionRepo: ReturnType<typeof repoMock>;
  let sprintRepo: ReturnType<typeof repoMock>;
  let boardConfigRepo: ReturnType<typeof repoMock>;
  let issueLinkRepo: ReturnType<typeof repoMock>;
  let workingTimeService: Partial<WorkingTimeService>;

  beforeEach(async () => {
    issueRepo = repoMock();
    changelogRepo = repoMock();
    versionRepo = repoMock();
    sprintRepo = repoMock();
    boardConfigRepo = repoMock();
    issueLinkRepo = repoMock();

    workingTimeService = {
      getConfig: jest.fn().mockResolvedValue(makeWtEntity()),
      toConfig: jest.fn().mockReturnValue({ excludeWeekends: false, hoursPerDay: 8 }),
      workingDaysBetween: jest.fn().mockReturnValue(5),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: getRepositoryToken(JiraIssue), useValue: issueRepo },
        { provide: getRepositoryToken(JiraChangelog), useValue: changelogRepo },
        { provide: getRepositoryToken(JiraVersion), useValue: versionRepo },
        { provide: getRepositoryToken(JiraSprint), useValue: sprintRepo },
        { provide: getRepositoryToken(BoardConfig), useValue: boardConfigRepo },
        { provide: getRepositoryToken(JiraIssueLink), useValue: issueLinkRepo },
        { provide: WorkingTimeService, useValue: workingTimeService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('https://jira.example.com') },
        },
      ],
    }).compile();

    service = module.get(SupportService);
  });

  // ── Board resolution ──────────────────────────────────────────────────────

  it('resolves all boards when boardId is not provided', async () => {
    boardConfigRepo.find.mockResolvedValue([makeConfig({ boardId: 'ACC' }), makeConfig({ boardId: 'BPT' })]);
    issueRepo.find.mockResolvedValue([]);
    boardConfigRepo.findOne.mockResolvedValue(makeConfig());

    const results = await service.getSupportTickets({});
    expect(results).toHaveLength(2);
  });

  // ── Empty board ───────────────────────────────────────────────────────────

  it('returns zero counts when no issues exist for the board', async () => {
    boardConfigRepo.find.mockResolvedValue([makeConfig()]);
    boardConfigRepo.findOne.mockResolvedValue(makeConfig());
    issueRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC' });
    expect(result.totalIssues).toBe(0);
    expect(result.supportIssues).toBe(0);
    expect(result.supportPercentage).toBe(0);
    expect(result.tickets).toHaveLength(0);
  });

  // ── Label classification ──────────────────────────────────────────────────

  it('classifies a ticket as support when its labels intersect supportLabels', async () => {
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', labels: ['support', 'backend'] }),
    ]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeChangelog('ACC-1', 'To Do', 'In Progress', STARTED_AT),
      makeChangelog('ACC-1', 'In Progress', 'Done', DONE_AT),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.supportIssues).toBe(1);
    expect(result.tickets[0].matchReason).toBe('label');
    expect(result.tickets[0].issueKey).toBe('ACC-1');
  });

  it('does not classify a ticket when labels do not match supportLabels', async () => {
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', labels: ['feature', 'backend'] }),
    ]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.supportIssues).toBe(0);
  });

  // ── Link classification ───────────────────────────────────────────────────

  it('classifies a ticket as support when link type and triage board key match', async () => {
    const config = makeConfig({ supportLinkType: 'clones', triageBoardKey: 'TTB' });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([makeIssue({ key: 'ACC-1', labels: [] })]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeChangelog('ACC-1', 'To Do', 'In Progress', STARTED_AT),
      makeChangelog('ACC-1', 'In Progress', 'Done', DONE_AT),
    ]);
    issueLinkRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeLink('ACC-1', 'TTB-42', 'clones'),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.supportIssues).toBe(1);
    expect(result.tickets[0].matchReason).toBe('link');
  });

  it('does not classify a ticket when link type matches but triage board key does not', async () => {
    const config = makeConfig({ supportLinkType: 'clones', triageBoardKey: 'TTB' });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([makeIssue({ key: 'ACC-1', labels: [] })]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([]);
    issueLinkRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeLink('ACC-1', 'OTHER-99', 'clones'),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.supportIssues).toBe(0);
  });

  it('does not classify when triage board key matches but link type does not', async () => {
    const config = makeConfig({ supportLinkType: 'clones', triageBoardKey: 'TTB' });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([makeIssue({ key: 'ACC-1', labels: [] })]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([]);
    issueLinkRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeLink('ACC-1', 'TTB-42', 'is blocked by'),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.supportIssues).toBe(0);
  });

  // ── Both criteria ─────────────────────────────────────────────────────────

  it('reports matchReason=both when ticket matches label AND link', async () => {
    const config = makeConfig({ supportLabels: ['support'], supportLinkType: 'clones', triageBoardKey: 'TTB' });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([makeIssue({ key: 'ACC-1', labels: ['support'] })]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeChangelog('ACC-1', 'To Do', 'In Progress', STARTED_AT),
      makeChangelog('ACC-1', 'In Progress', 'Done', DONE_AT),
    ]);
    issueLinkRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeLink('ACC-1', 'TTB-1', 'clones'),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    // Should appear only once
    expect(result.supportIssues).toBe(1);
    expect(result.tickets[0].matchReason).toBe('both');
  });

  // ── Epic / subtask exclusion (ADR 0018) ───────────────────────────────────

  it('excludes Epics from support classification', async () => {
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', issueType: 'Epic', labels: ['support'] }),
    ]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.totalIssues).toBe(0);
    expect(result.supportIssues).toBe(0);
  });

  it('excludes Sub-tasks from support classification', async () => {
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-2', issueType: 'Sub-task', labels: ['support'] }),
    ]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.totalIssues).toBe(0);
  });

  // ── Support percentage ────────────────────────────────────────────────────

  it('calculates supportPercentage correctly', async () => {
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', labels: ['support'] }),
      makeIssue({ key: 'ACC-2', labels: [] }),
      makeIssue({ key: 'ACC-3', labels: [] }),
      makeIssue({ key: 'ACC-4', labels: [] }),
    ]);
    // Only ACC-1 has a Done transition in window — others have no logs at all
    const qb = changelogRepo.createQueryBuilder();
    qb.getMany.mockResolvedValue([
      makeChangelog('ACC-1', 'To Do', 'In Progress', STARTED_AT),
      makeChangelog('ACC-1', 'In Progress', 'Done', DONE_AT),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.totalIssues).toBe(4);
    expect(result.supportIssues).toBe(1);
    expect(result.supportPercentage).toBe(25);
  });

  // ── Cycle time ────────────────────────────────────────────────────────────

  it('computes cycle time for support tickets with In Progress → Done transitions', async () => {
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([makeIssue({ key: 'ACC-1', labels: ['support'] })]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeChangelog('ACC-1', 'To Do', 'In Progress', STARTED_AT),
      makeChangelog('ACC-1', 'In Progress', 'Done', DONE_AT),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    const ticket = result.tickets[0];
    expect(ticket.cycleTimeDays).not.toBeNull();
    expect(ticket.cycleTimeDays).toBeGreaterThan(0);
    expect(ticket.completedAt).toBe(DONE_AT.toISOString());
    expect(ticket.startedAt).toBe(STARTED_AT.toISOString());
    expect(ticket.band).not.toBeNull();
  });

  it('returns null cycle time when issue has no In Progress transition', async () => {
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([makeIssue({ key: 'ACC-1', labels: ['support'] })]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeChangelog('ACC-1', 'To Do', 'Done', DONE_AT),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    // Ticket is still included as a support ticket; cycle time is null (no start)
    expect(result.supportIssues).toBe(1);
    expect(result.tickets[0].cycleTimeDays).toBeNull();
  });

  // ── getSupportSummary ─────────────────────────────────────────────────────

  it('getSupportSummary aggregates totals across boards', async () => {
    boardConfigRepo.find.mockResolvedValue([
      makeConfig({ boardId: 'ACC' }),
      makeConfig({ boardId: 'BPT', supportLabels: ['support'] }),
    ]);
    boardConfigRepo.findOne
      .mockResolvedValueOnce(makeConfig({ boardId: 'ACC' }))
      .mockResolvedValueOnce(makeConfig({ boardId: 'BPT', supportLabels: ['support'] }));

    issueRepo.find
      .mockResolvedValueOnce([makeIssue({ key: 'ACC-1', boardId: 'ACC', labels: [] })])
      .mockResolvedValueOnce([makeIssue({ key: 'BPT-1', boardId: 'BPT', labels: ['support'] })]);

    const qb = changelogRepo.createQueryBuilder();
    qb.getMany
      .mockResolvedValueOnce([]) // ACC changelogs
      .mockResolvedValueOnce([  // BPT changelogs
        makeChangelog('BPT-1', 'To Do', 'In Progress', STARTED_AT),
        makeChangelog('BPT-1', 'In Progress', 'Done', DONE_AT),
      ]);

    versionRepo.find.mockResolvedValue([]);

    const summary = await service.getSupportSummary({});
    expect(summary.totalIssues).toBe(2);
    expect(summary.supportIssues).toBe(1);
    expect(summary.supportPercentage).toBe(50);
    expect(summary.byBoard).toHaveLength(2);
  });

  // ── Jira deep-link ────────────────────────────────────────────────────────

  it('populates jiraUrl for support tickets when JIRA_BASE_URL is set', async () => {
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([makeIssue({ key: 'ACC-99', labels: ['support'] })]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeChangelog('ACC-99', 'To Do', 'In Progress', STARTED_AT),
      makeChangelog('ACC-99', 'In Progress', 'Done', DONE_AT),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.tickets[0].jiraUrl).toBe('https://jira.example.com/browse/ACC-99');
  });
});
