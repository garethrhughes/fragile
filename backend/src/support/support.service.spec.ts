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

function makeSprintChangelog(
  issueKey: string,
  fromValue: string | null,
  toValue: string,
  changedAt: Date,
): JiraChangelog {
  return { id: 2, issueKey, field: 'Sprint', fromValue, toValue, changedAt } as JiraChangelog;
}

function makeSprint(overrides: Partial<JiraSprint> = {}): JiraSprint {
  return {
    id: '3906',
    name: 'Sprint 6 - 2026',
    state: 'active',
    startDate: new Date('2026-04-22T04:00:00.000Z'),
    endDate: new Date('2026-05-13T04:00:00.000Z'),
    boardId: 'SPS',
    ...overrides,
  } as unknown as JiraSprint;
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
    // Only ACC-1 has a Done transition in the 2026-Q1 window.
    // ACC-2/3/4 have no changelogs, so they are excluded from totalIssues
    // (period-scoped denominator — completed in period only).
    const qb = changelogRepo.createQueryBuilder();
    qb.getMany.mockResolvedValue([
      makeChangelog('ACC-1', 'To Do', 'In Progress', STARTED_AT),
      makeChangelog('ACC-1', 'In Progress', 'Done', DONE_AT),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.totalIssues).toBe(1);
    expect(result.supportIssues).toBe(1);
    expect(result.supportPercentage).toBe(100);
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
    // ACC-1 has no done transition in period → totalIssues for ACC = 0.
    // BPT-1 completes in period and is labelled support → totalIssues = 1, supportIssues = 1.
    expect(summary.totalIssues).toBe(1);
    expect(summary.supportIssues).toBe(1);
    expect(summary.supportPercentage).toBe(100);
    expect(summary.byBoard).toHaveLength(2);
  });

  // ── Period-scoped totalIssues ─────────────────────────────────────────────

  it('counts only issues completed within the period in totalIssues', async () => {
    // ACC-1 completes inside 2026-Q1; ACC-2 completes outside the period.
    // totalIssues should be 1, not 2.
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', labels: ['support'] }),
      makeIssue({ key: 'ACC-2', labels: [] }),
    ]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeChangelog('ACC-1', 'To Do', 'In Progress', STARTED_AT),
      makeChangelog('ACC-1', 'In Progress', 'Done', DONE_AT), // 2026-03-20 — inside Q1
      makeChangelog('ACC-2', 'To Do', 'In Progress', new Date('2025-12-01T09:00:00Z')),
      makeChangelog('ACC-2', 'In Progress', 'Done', new Date('2025-12-10T12:00:00Z')), // outside Q1
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    expect(result.totalIssues).toBe(1);
    expect(result.supportIssues).toBe(1);
    expect(result.supportPercentage).toBe(100);
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

  // ── Sprint mode: membership-based population (Proposal 0044) ─────────────

  it('sprint mode: includes in-progress support tickets (no completion gate)', async () => {
    const sprint = makeSprint();
    sprintRepo.findOne.mockResolvedValue(sprint);
    const config = makeConfig({ boardId: 'SPS', supportLinkType: 'clones', triageBoardKey: 'TTB' });
    boardConfigRepo.findOne.mockResolvedValue(config);
    // Issue is in the sprint (sprintId matches) but not done
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'SPS-1', boardId: 'SPS', sprintId: '3906', status: 'In Progress', labels: [] }),
    ]);
    // Sprint changelog: issue assigned to this sprint
    const sprintQbResults = [
      makeSprintChangelog('SPS-1', null, 'Sprint 6 - 2026', new Date('2026-04-23T00:00:00Z')),
    ];
    // Status changelog: no done transition
    const statusQbResults = [
      makeChangelog('SPS-1', 'To Do', 'In Progress', new Date('2026-04-24T09:00:00Z')),
    ];
    changelogRepo.createQueryBuilder().getMany
      .mockResolvedValueOnce(statusQbResults)
      .mockResolvedValueOnce(sprintQbResults);
    issueLinkRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeLink('SPS-1', 'TTB-4421', 'clones'),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'SPS', sprintId: '3906' });
    expect(result.supportIssues).toBe(1);
    expect(result.tickets[0].issueKey).toBe('SPS-1');
    expect(result.tickets[0].cycleTimeDays).toBeNull();
    expect(result.tickets[0].completedAt).toBeNull();
    expect(result.tickets[0].band).toBeNull();
  });

  it('sprint mode: totalIssues counts all sprint-member work items including in-progress', async () => {
    const sprint = makeSprint();
    sprintRepo.findOne.mockResolvedValue(sprint);
    const config = makeConfig({ boardId: 'SPS', supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'SPS-1', boardId: 'SPS', sprintId: '3906', labels: ['support'] }),
      makeIssue({ key: 'SPS-2', boardId: 'SPS', sprintId: '3906', labels: [] }),
      // SPS-3 is NOT in this sprint
      makeIssue({ key: 'SPS-3', boardId: 'SPS', sprintId: '9999', labels: [] }),
    ]);
    const sprintQbResults = [
      makeSprintChangelog('SPS-1', null, 'Sprint 6 - 2026', new Date('2026-04-22T10:00:00Z')),
      makeSprintChangelog('SPS-2', null, 'Sprint 6 - 2026', new Date('2026-04-22T10:00:00Z')),
      // SPS-3 has no sprint changelog for Sprint 6
    ];
    const statusQbResults = [
      makeChangelog('SPS-1', 'To Do', 'In Progress', new Date('2026-04-24T09:00:00Z')),
      makeChangelog('SPS-2', 'To Do', 'In Progress', new Date('2026-04-24T09:00:00Z')),
    ];
    changelogRepo.createQueryBuilder().getMany
      .mockResolvedValueOnce(statusQbResults)
      .mockResolvedValueOnce(sprintQbResults);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'SPS', sprintId: '3906' });
    // SPS-1 and SPS-2 are sprint members; SPS-3 is not
    expect(result.totalIssues).toBe(2);
    expect(result.supportIssues).toBe(1);
    expect(result.supportPercentage).toBe(50);
  });

  it('sprint mode: carry-over issue appears in both Sprint 5 and Sprint 6', async () => {
    const sprint5 = makeSprint({
      id: '3863',
      name: 'Sprint 5 - 2026',
      state: 'closed',
      startDate: new Date('2026-04-01T04:00:00.000Z'),
      endDate: new Date('2026-04-22T04:00:00.000Z'),
    });
    const sprint6 = makeSprint({ id: '3906', name: 'Sprint 6 - 2026' });

    const config = makeConfig({ boardId: 'SPS', supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'SPS-498', boardId: 'SPS', sprintId: '3906', labels: ['support'] }),
    ]);

    // Carry-over changelog: added to Sprint 5 first, then Sprint 5 + Sprint 6 on carry-over
    const sprintChangelogs = [
      makeSprintChangelog('SPS-498', null, 'Sprint 5 - 2026', new Date('2026-04-02T00:00:00Z')),
      makeSprintChangelog('SPS-498', 'Sprint 5 - 2026', 'Sprint 5 - 2026, Sprint 6 - 2026', new Date('2026-04-22T07:00:00Z')),
    ];
    const statusChangelogs = [
      makeChangelog('SPS-498', 'To Do', 'In Progress', new Date('2026-04-05T09:00:00Z')),
      makeChangelog('SPS-498', 'In Progress', 'Done', new Date('2026-05-01T00:27:00Z')),
    ];

    // Sprint 5 query
    sprintRepo.findOne.mockResolvedValueOnce(sprint5);
    changelogRepo.createQueryBuilder().getMany
      .mockResolvedValueOnce(statusChangelogs)
      .mockResolvedValueOnce(sprintChangelogs);
    versionRepo.find.mockResolvedValue([]);

    const [result5] = await service.getSupportTickets({ boardId: 'SPS', sprintId: '3863' });
    expect(result5.supportIssues).toBe(1);
    expect(result5.tickets[0].issueKey).toBe('SPS-498');

    // Sprint 6 query — reset mocks
    sprintRepo.findOne.mockResolvedValueOnce(sprint6);
    changelogRepo.createQueryBuilder().getMany
      .mockResolvedValueOnce(statusChangelogs)
      .mockResolvedValueOnce(sprintChangelogs);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'SPS-498', boardId: 'SPS', sprintId: '3906', labels: ['support'] }),
    ]);

    const [result6] = await service.getSupportTickets({ boardId: 'SPS', sprintId: '3906' });
    expect(result6.supportIssues).toBe(1);
    expect(result6.tickets[0].issueKey).toBe('SPS-498');
  });

  it('quarter mode: totalIssues still counts only completed issues (regression guard)', async () => {
    const config = makeConfig({ supportLabels: ['support'] });
    boardConfigRepo.findOne.mockResolvedValue(config);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', labels: ['support'] }), // completes in Q1
      makeIssue({ key: 'ACC-2', labels: [] }),           // never completes
    ]);
    changelogRepo.createQueryBuilder().getMany.mockResolvedValue([
      makeChangelog('ACC-1', 'To Do', 'In Progress', STARTED_AT),
      makeChangelog('ACC-1', 'In Progress', 'Done', DONE_AT),
      // ACC-2 has no done transition
      makeChangelog('ACC-2', 'To Do', 'In Progress', STARTED_AT),
    ]);
    versionRepo.find.mockResolvedValue([]);

    const [result] = await service.getSupportTickets({ boardId: 'ACC', quarter: '2026-Q1' });
    // Quarter mode: ACC-2 never completes → not in denominator
    expect(result.totalIssues).toBe(1);
    expect(result.supportIssues).toBe(1);
  });
});
