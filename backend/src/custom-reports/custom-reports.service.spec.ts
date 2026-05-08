import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomReportsService } from './custom-reports.service.js';
import { CustomReport } from '../database/entities/custom-report.entity.js';
import { CustomReportWidget } from '../database/entities/custom-report-widget.entity.js';
import { CustomReportDataPoint } from '../database/entities/custom-report-data-point.entity.js';
import { CustomReportFilter } from '../database/entities/custom-report-filter.entity.js';

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  merge: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
  insert: jest.fn(),
});

function mockConfigService(jiraBaseUrl = 'https://mycompany.atlassian.net'): jest.Mocked<ConfigService> {
  return {
    get: jest.fn((_key: string, def = '') => {
      if (_key === 'JIRA_BASE_URL') return jiraBaseUrl;
      return def;
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

describe('CustomReportsService', () => {
  let service: CustomReportsService;
  let reportRepo: ReturnType<typeof mockRepo>;
  let widgetRepo: ReturnType<typeof mockRepo>;
  let pointRepo: ReturnType<typeof mockRepo>;
  let filterRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    reportRepo = mockRepo();
    widgetRepo = mockRepo();
    pointRepo = mockRepo();
    filterRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomReportsService,
        { provide: getRepositoryToken(CustomReport), useValue: reportRepo },
        { provide: getRepositoryToken(CustomReportWidget), useValue: widgetRepo },
        { provide: getRepositoryToken(CustomReportDataPoint), useValue: pointRepo },
        { provide: getRepositoryToken(CustomReportFilter), useValue: filterRepo },
        { provide: ConfigService, useValue: mockConfigService() },
      ],
    }).compile();

    service = module.get(CustomReportsService);
  });

  // ── createReport ──────────────────────────────────────────────────────────

  describe('createReport', () => {
    it('creates and returns a new report', async () => {
      reportRepo.findOne.mockResolvedValue(null);
      const created = { id: 'uuid-1', slug: 'demo', title: 'Demo' };
      reportRepo.create.mockReturnValue(created);
      reportRepo.save.mockResolvedValue(created);

      const result = await service.createReport({ slug: 'demo', title: 'Demo' });

      expect(reportRepo.findOne).toHaveBeenCalledWith({ where: { slug: 'demo' } });
      expect(reportRepo.create).toHaveBeenCalledWith({ slug: 'demo', title: 'Demo' });
      expect(result).toEqual(created);
    });

    it('throws ConflictException when slug is already taken', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'existing', slug: 'demo' });

      await expect(service.createReport({ slug: 'demo', title: 'Dup' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── listReports ───────────────────────────────────────────────────────────

  describe('listReports', () => {
    it('returns all reports without nested data', async () => {
      const rows = [{ id: '1' }, { id: '2' }];
      reportRepo.find.mockResolvedValue(rows);
      const result = await service.listReports();
      expect(result).toEqual(rows);
    });
  });

  // ── getReport ─────────────────────────────────────────────────────────────

  describe('getReport', () => {
    it('returns the report with relations and jiraBaseUrl', async () => {
      const report = { id: '1', slug: 'demo', widgets: [], filters: [] };
      reportRepo.findOne.mockResolvedValue(report);
      const result = await service.getReport('demo');
      expect(result.widgets).toEqual([]);
      expect(result.jiraBaseUrl).toBe('https://mycompany.atlassian.net');
    });

    it('throws NotFoundException for unknown slug', async () => {
      reportRepo.findOne.mockResolvedValue(null);
      await expect(service.getReport('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateReport ──────────────────────────────────────────────────────────

  describe('updateReport', () => {
    it('merges and saves updated fields', async () => {
      const existing = { id: '1', slug: 'demo', title: 'Old' };
      const updated = { ...existing, title: 'New' };
      reportRepo.findOne.mockResolvedValue(existing);
      reportRepo.merge.mockReturnValue(updated);
      reportRepo.save.mockResolvedValue(updated);

      const result = await service.updateReport('demo', { title: 'New' });
      expect(result.title).toBe('New');
    });
  });

  // ── deleteReport ──────────────────────────────────────────────────────────

  describe('deleteReport', () => {
    it('deletes successfully when report exists', async () => {
      reportRepo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.deleteReport('demo')).resolves.toBeUndefined();
    });

    it('relies on DB ON DELETE CASCADE — does not manually delete child rows', async () => {
      reportRepo.delete.mockResolvedValue({ affected: 1 });
      await service.deleteReport('demo');
      expect(reportRepo.delete).toHaveBeenCalledWith({ slug: 'demo' });
      expect(widgetRepo.delete).not.toHaveBeenCalled();
      expect(pointRepo.delete).not.toHaveBeenCalled();
      expect(filterRepo.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no rows affected', async () => {
      reportRepo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.deleteReport('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── addWidget ─────────────────────────────────────────────────────────────

  describe('addWidget', () => {
    it('adds a line chart widget to an existing report', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1', slug: 'demo' });
      const widget = { id: 'w1', customReportId: 'r1', kind: 'line', title: 'Chart' };
      widgetRepo.create.mockReturnValue(widget);
      widgetRepo.save.mockResolvedValue(widget);

      const result = await service.addWidget('demo', { kind: 'line', title: 'Chart' });
      expect(result).toEqual(widget);
    });

    it('adds a table widget with columns', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      const cols = [{ key: 'x', label: 'Issue', type: 'issue' as const, sortable: true }];
      const widget = { id: 'w2', kind: 'table', title: 'Issues', columns: cols };
      widgetRepo.create.mockReturnValue(widget);
      widgetRepo.save.mockResolvedValue(widget);

      const result = await service.addWidget('demo', { kind: 'table', title: 'Issues', columns: cols });
      expect(result.columns).toEqual(cols);
    });

    it('adds a stat widget without columns', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      const widget = { id: 'w3', kind: 'stat', title: 'Metric', statUnit: 'days', statBand: 'high' };
      widgetRepo.create.mockReturnValue(widget);
      widgetRepo.save.mockResolvedValue(widget);

      const result = await service.addWidget('demo', {
        kind: 'stat',
        title: 'Metric',
        statUnit: 'days',
        statBand: 'high',
      });
      expect(result.statBand).toBe('high');
    });

    it('adds a table widget without columns (AC4)', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      const widget = { id: 'w4', kind: 'table', title: 'Empty table', columns: null };
      widgetRepo.create.mockReturnValue(widget);
      widgetRepo.save.mockResolvedValue(widget);

      const result = await service.addWidget('demo', { kind: 'table', title: 'Empty table' });
      expect(result.kind).toBe('table');
      expect(result.columns).toBeNull();
    });

    it('throws BadRequestException when stat widget includes columns', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      await expect(
        service.addWidget('demo', {
          kind: 'stat',
          title: 'Bad',
          columns: [{ key: 'x', label: 'X', type: 'text' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when report not found', async () => {
      reportRepo.findOne.mockResolvedValue(null);
      await expect(service.addWidget('nope', { kind: 'bar', title: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── updateWidget ──────────────────────────────────────────────────────────

  describe('updateWidget', () => {
    it('updates widget fields', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      const widget = { id: 'w1', customReportId: 'r1', kind: 'line', title: 'Old' };
      widgetRepo.findOne.mockResolvedValue(widget);
      const updated = { ...widget, title: 'New' };
      widgetRepo.merge.mockReturnValue(updated);
      widgetRepo.save.mockResolvedValue(updated);

      const result = await service.updateWidget('demo', 'w1', { title: 'New' });
      expect(result.title).toBe('New');
    });

    it('throws BadRequestException when updating a stat widget to include columns', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      widgetRepo.findOne.mockResolvedValue({ id: 'w1', kind: 'stat', customReportId: 'r1' });

      await expect(
        service.updateWidget('demo', 'w1', {
          columns: [{ key: 'x', label: 'X', type: 'text' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── deleteWidget ──────────────────────────────────────────────────────────

  describe('deleteWidget', () => {
    it('deletes widget and cascades points', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      widgetRepo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.deleteWidget('demo', 'w1')).resolves.toBeUndefined();
    });
  });

  // ── appendDataPoints ──────────────────────────────────────────────────────

  describe('appendDataPoints', () => {
    it('inserts points and returns the count', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      widgetRepo.findOne.mockResolvedValue({ id: 'w1', customReportId: 'r1' });
      pointRepo.count.mockResolvedValue(0);
      pointRepo.insert.mockResolvedValue({});

      const points = [{ x: '2024-01-01', y: 10 }];
      const result = await service.appendDataPoints('demo', 'w1', points);
      expect(result).toEqual({ appended: 1 });
    });

    it('rejects when per-widget cap would be exceeded', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      widgetRepo.findOne.mockResolvedValue({ id: 'w1', customReportId: 'r1' });
      pointRepo.count.mockResolvedValue(99_999);

      const points = [{ x: '2024-01-01', y: 1 }, { x: '2024-01-02', y: 2 }];
      await expect(service.appendDataPoints('demo', 'w1', points)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects batches exceeding 1000 points', async () => {
      const points = Array.from({ length: 1001 }, (_, i) => ({ x: `d${i}`, y: i }));
      await expect(service.appendDataPoints('demo', 'w1', points)).rejects.toThrow(
        PayloadTooLargeException,
      );
    });

    it('is additive — second append preserves existing points', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      widgetRepo.findOne.mockResolvedValue({ id: 'w1', customReportId: 'r1' });

      pointRepo.count.mockResolvedValueOnce(0);
      pointRepo.insert.mockResolvedValueOnce({});
      await service.appendDataPoints('demo', 'w1', [{ x: '2024-01-01', y: 1 }, { x: '2024-01-02', y: 2 }]);

      pointRepo.count.mockResolvedValueOnce(2);
      pointRepo.insert.mockResolvedValueOnce({});
      const second = await service.appendDataPoints('demo', 'w1', [{ x: '2024-01-03', y: 3 }]);
      expect(second).toEqual({ appended: 1 });
      expect(pointRepo.insert).toHaveBeenCalledTimes(2);
    });
  });

  // ── replaceDataPoints ─────────────────────────────────────────────────────

  describe('replaceDataPoints', () => {
    it('deletes existing points then inserts new ones', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      widgetRepo.findOne.mockResolvedValue({ id: 'w1', customReportId: 'r1' });
      pointRepo.delete.mockResolvedValue({ affected: 5 });
      pointRepo.insert.mockResolvedValue({});

      const points = [{ x: '2024-01-01', y: 99 }];
      const result = await service.replaceDataPoints('demo', 'w1', points);
      expect(pointRepo.delete).toHaveBeenCalledWith({ customReportWidgetId: 'w1' });
      expect(result).toEqual({ replaced: 1 });
    });
  });

  // ── clearDataPoints ───────────────────────────────────────────────────────

  describe('clearDataPoints', () => {
    it('deletes all points for the widget', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      widgetRepo.findOne.mockResolvedValue({ id: 'w1', customReportId: 'r1' });
      pointRepo.delete.mockResolvedValue({ affected: 10 });

      await expect(service.clearDataPoints('demo', 'w1')).resolves.toBeUndefined();
      expect(pointRepo.delete).toHaveBeenCalledWith({ customReportWidgetId: 'w1' });
    });
  });

  // ── filters ───────────────────────────────────────────────────────────────

  describe('addFilter', () => {
    it('creates a filter on the report', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      const filter = { id: 'f1', customReportId: 'r1', key: 'team', label: 'Team', kind: 'select' };
      filterRepo.create.mockReturnValue(filter);
      filterRepo.save.mockResolvedValue(filter);

      const result = await service.addFilter('demo', { key: 'team', label: 'Team', kind: 'select' });
      expect(result).toEqual(filter);
    });
  });

  describe('deleteFilter', () => {
    it('deletes the filter', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      filterRepo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.deleteFilter('demo', 'f1')).resolves.toBeUndefined();
    });

    it('throws NotFoundException when filter does not exist', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      filterRepo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.deleteFilter('demo', 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
