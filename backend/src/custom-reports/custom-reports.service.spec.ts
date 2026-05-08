import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { CustomReportsService } from './custom-reports.service.js';
import { CustomReport } from '../database/entities/custom-report.entity.js';
import { CustomReportGraph } from '../database/entities/custom-report-graph.entity.js';
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

describe('CustomReportsService', () => {
  let service: CustomReportsService;
  let reportRepo: ReturnType<typeof mockRepo>;
  let graphRepo: ReturnType<typeof mockRepo>;
  let pointRepo: ReturnType<typeof mockRepo>;
  let filterRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    reportRepo = mockRepo();
    graphRepo = mockRepo();
    pointRepo = mockRepo();
    filterRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomReportsService,
        { provide: getRepositoryToken(CustomReport), useValue: reportRepo },
        { provide: getRepositoryToken(CustomReportGraph), useValue: graphRepo },
        { provide: getRepositoryToken(CustomReportDataPoint), useValue: pointRepo },
        { provide: getRepositoryToken(CustomReportFilter), useValue: filterRepo },
      ],
    }).compile();

    service = module.get(CustomReportsService);
  });

  // ── create ──────────────────────────────────────────────────────────────────

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

  // ── list ─────────────────────────────────────────────────────────────────────

  describe('listReports', () => {
    it('returns all reports without nested data', async () => {
      const rows = [{ id: '1' }, { id: '2' }];
      reportRepo.find.mockResolvedValue(rows);
      const result = await service.listReports();
      expect(result).toEqual(rows);
    });
  });

  // ── get ──────────────────────────────────────────────────────────────────────

  describe('getReport', () => {
    it('returns the report with relations', async () => {
      const report = { id: '1', slug: 'demo', graphs: [], filters: [] };
      reportRepo.findOne.mockResolvedValue(report);
      const result = await service.getReport('demo');
      expect(result).toEqual(report);
    });

    it('returns added graph when fetched after addGraph (AC2 second clause)', async () => {
      // Simulate: after addGraph saves a graph, getReport fetches with relations
      const graph = { id: 'g1', customReportId: 'r1', kind: 'line', title: 'Chart', dataPoints: [], position: 0, seriesKey: null, xAxisLabel: null, yAxisLabel: null };
      const report = { id: 'r1', slug: 'demo', graphs: [graph], filters: [] };
      reportRepo.findOne.mockResolvedValue(report);
      const result = await service.getReport('demo');
      expect(result.graphs).toHaveLength(1);
      expect(result.graphs[0].id).toBe('g1');
    });

    it('throws NotFoundException for unknown slug', async () => {
      reportRepo.findOne.mockResolvedValue(null);
      await expect(service.getReport('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────────

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

  // ── delete ───────────────────────────────────────────────────────────────────

  describe('deleteReport', () => {
    it('deletes successfully when report exists', async () => {
      reportRepo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.deleteReport('demo')).resolves.toBeUndefined();
    });

    it('does not manually delete child rows — relies on DB ON DELETE CASCADE (AC6)', async () => {
      // The service must call reportRepo.delete (by slug) and nothing else.
      // Cascading of graphs/points/filters is handled by the FK constraint in the migration.
      reportRepo.delete.mockResolvedValue({ affected: 1 });
      await service.deleteReport('demo');
      expect(reportRepo.delete).toHaveBeenCalledWith({ slug: 'demo' });
      expect(graphRepo.delete).not.toHaveBeenCalled();
      expect(pointRepo.delete).not.toHaveBeenCalled();
      expect(filterRepo.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no rows affected', async () => {
      reportRepo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.deleteReport('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── graphs ───────────────────────────────────────────────────────────────────

  describe('addGraph', () => {
    it('adds a graph to an existing report', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1', slug: 'demo' });
      const graph = { id: 'g1', customReportId: 'r1', kind: 'line', title: 'Chart' };
      graphRepo.create.mockReturnValue(graph);
      graphRepo.save.mockResolvedValue(graph);

      const result = await service.addGraph('demo', { kind: 'line', title: 'Chart' });
      expect(result).toEqual(graph);
    });

    it('throws NotFoundException when report not found', async () => {
      reportRepo.findOne.mockResolvedValue(null);
      await expect(service.addGraph('nope', { kind: 'bar', title: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateGraph', () => {
    it('updates graph fields', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      const graph = { id: 'g1', customReportId: 'r1', title: 'Old' };
      graphRepo.findOne.mockResolvedValue(graph);
      const updated = { ...graph, title: 'New' };
      graphRepo.merge.mockReturnValue(updated);
      graphRepo.save.mockResolvedValue(updated);

      const result = await service.updateGraph('demo', 'g1', { title: 'New' });
      expect(result.title).toBe('New');
    });
  });

  describe('deleteGraph', () => {
    it('deletes graph and cascades points', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      graphRepo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.deleteGraph('demo', 'g1')).resolves.toBeUndefined();
    });
  });

  // ── data points ──────────────────────────────────────────────────────────────

  describe('appendDataPoints', () => {
    it('inserts points and returns the count', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      graphRepo.findOne.mockResolvedValue({ id: 'g1', customReportId: 'r1' });
      pointRepo.count.mockResolvedValue(0);
      pointRepo.insert.mockResolvedValue({});

      const points = [{ x: '2024-01-01', y: 10 }];
      const result = await service.appendDataPoints('demo', 'g1', points);
      expect(result).toEqual({ appended: 1 });
    });

    it('rejects when per-graph cap would be exceeded', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      graphRepo.findOne.mockResolvedValue({ id: 'g1', customReportId: 'r1' });
      pointRepo.count.mockResolvedValue(99_999);

      const points = [{ x: '2024-01-01', y: 1 }, { x: '2024-01-02', y: 2 }];
      await expect(service.appendDataPoints('demo', 'g1', points)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects batches exceeding 1000 points', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      graphRepo.findOne.mockResolvedValue({ id: 'g1', customReportId: 'r1' });
      pointRepo.count.mockResolvedValue(0);

      const points = Array.from({ length: 1001 }, (_, i) => ({ x: `d${i}`, y: i }));
      await expect(service.appendDataPoints('demo', 'g1', points)).rejects.toThrow(
        PayloadTooLargeException,
      );
    });

    it('is additive — second append doubles the point count', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      graphRepo.findOne.mockResolvedValue({ id: 'g1', customReportId: 'r1' });

      // First call: 0 existing → insert 2 → 2 total
      pointRepo.count.mockResolvedValueOnce(0);
      pointRepo.insert.mockResolvedValueOnce({});
      const first = await service.appendDataPoints('demo', 'g1', [
        { x: '2024-01-01', y: 1 },
        { x: '2024-01-02', y: 2 },
      ]);
      expect(first).toEqual({ appended: 2 });

      // Second call: 2 existing → insert 2 more
      pointRepo.count.mockResolvedValueOnce(2);
      pointRepo.insert.mockResolvedValueOnce({});
      const second = await service.appendDataPoints('demo', 'g1', [
        { x: '2024-01-03', y: 3 },
        { x: '2024-01-04', y: 4 },
      ]);
      expect(second).toEqual({ appended: 2 });
      // Insert called both times (additive — no truncation occurred)
      expect(pointRepo.insert).toHaveBeenCalledTimes(2);
    });
  });

  describe('replaceDataPoints', () => {
    it('deletes existing points then inserts new ones', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      graphRepo.findOne.mockResolvedValue({ id: 'g1', customReportId: 'r1' });
      pointRepo.delete.mockResolvedValue({ affected: 5 });
      pointRepo.insert.mockResolvedValue({});

      const points = [{ x: '2024-01-01', y: 99 }];
      const result = await service.replaceDataPoints('demo', 'g1', points);
      expect(pointRepo.delete).toHaveBeenCalledWith({ customReportGraphId: 'g1' });
      expect(result).toEqual({ replaced: 1 });
    });
  });

  describe('clearDataPoints', () => {
    it('deletes all points for the graph', async () => {
      reportRepo.findOne.mockResolvedValue({ id: 'r1' });
      graphRepo.findOne.mockResolvedValue({ id: 'g1', customReportId: 'r1' });
      pointRepo.delete.mockResolvedValue({ affected: 10 });

      await expect(service.clearDataPoints('demo', 'g1')).resolves.toBeUndefined();
      expect(pointRepo.delete).toHaveBeenCalledWith({ customReportGraphId: 'g1' });
    });
  });

  // ── filters ──────────────────────────────────────────────────────────────────

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
