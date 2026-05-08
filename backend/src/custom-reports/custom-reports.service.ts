import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomReport } from '../database/entities/custom-report.entity.js';
import { CustomReportGraph } from '../database/entities/custom-report-graph.entity.js';
import { CustomReportDataPoint } from '../database/entities/custom-report-data-point.entity.js';
import { CustomReportFilter } from '../database/entities/custom-report-filter.entity.js';
import { CreateCustomReportDto } from './dto/create-custom-report.dto.js';
import { UpdateCustomReportDto } from './dto/update-custom-report.dto.js';
import { CreateGraphDto } from './dto/create-graph.dto.js';
import { UpdateGraphDto } from './dto/update-graph.dto.js';
import { CreateFilterDto } from './dto/create-filter.dto.js';
import type { DataPointDto } from './dto/append-data-points.dto.js';

const MAX_POINTS_PER_REQUEST = 1_000;
const MAX_POINTS_PER_GRAPH = 100_000;

@Injectable()
export class CustomReportsService {
  private readonly logger = new Logger(CustomReportsService.name);

  constructor(
    @InjectRepository(CustomReport)
    private readonly reportRepo: Repository<CustomReport>,
    @InjectRepository(CustomReportGraph)
    private readonly graphRepo: Repository<CustomReportGraph>,
    @InjectRepository(CustomReportDataPoint)
    private readonly pointRepo: Repository<CustomReportDataPoint>,
    @InjectRepository(CustomReportFilter)
    private readonly filterRepo: Repository<CustomReportFilter>,
  ) {}

  // ── Reports ───────────────────────────────────────────────────────────────

  async listReports(): Promise<CustomReport[]> {
    return this.reportRepo.find();
  }

  async createReport(dto: CreateCustomReportDto): Promise<CustomReport> {
    const existing = await this.reportRepo.findOne({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException(`Report with slug "${dto.slug}" already exists`);
    }
    const report = this.reportRepo.create(dto);
    const saved = await this.reportRepo.save(report);
    this.logger.log(`Created custom report "${saved.slug}" (${saved.id})`);
    return saved;
  }

  async getReport(slug: string): Promise<CustomReport> {
    const report = await this.reportRepo.findOne({
      where: { slug },
      relations: ['graphs', 'graphs.dataPoints', 'filters'],
      order: {
        graphs: { position: 'ASC' },
        filters: { position: 'ASC' },
      },
    });
    if (!report) {
      throw new NotFoundException(`Report "${slug}" not found`);
    }
    return report;
  }

  async updateReport(slug: string, dto: UpdateCustomReportDto): Promise<CustomReport> {
    const report = await this.findReportOrThrow(slug);
    const merged = this.reportRepo.merge(report, dto);
    return this.reportRepo.save(merged);
  }

  async deleteReport(slug: string): Promise<void> {
    const result = await this.reportRepo.delete({ slug });
    if (result.affected === 0) {
      throw new NotFoundException(`Report "${slug}" not found`);
    }
    this.logger.log(`Deleted custom report "${slug}"`);
  }

  // ── Graphs ────────────────────────────────────────────────────────────────

  async addGraph(slug: string, dto: CreateGraphDto): Promise<CustomReportGraph> {
    const report = await this.findReportOrThrow(slug);
    const graph = this.graphRepo.create({ ...dto, customReportId: report.id });
    const saved = await this.graphRepo.save(graph);
    this.logger.log(`Added graph "${saved.id}" to report "${slug}"`);
    return saved;
  }

  async updateGraph(slug: string, graphId: string, dto: UpdateGraphDto): Promise<CustomReportGraph> {
    const report = await this.findReportOrThrow(slug);
    const graph = await this.findGraphOrThrow(report.id, graphId);
    const merged = this.graphRepo.merge(graph, dto);
    return this.graphRepo.save(merged);
  }

  async deleteGraph(slug: string, graphId: string): Promise<void> {
    const report = await this.findReportOrThrow(slug);
    const result = await this.graphRepo.delete({ id: graphId, customReportId: report.id });
    if (result.affected === 0) {
      throw new NotFoundException(`Graph "${graphId}" not found on report "${slug}"`);
    }
  }

  // ── Data points ───────────────────────────────────────────────────────────

  async appendDataPoints(
    slug: string,
    graphId: string,
    points: DataPointDto[],
  ): Promise<{ appended: number }> {
    if (points.length > MAX_POINTS_PER_REQUEST) {
      throw new PayloadTooLargeException(
        `Maximum ${MAX_POINTS_PER_REQUEST} data points per request`,
      );
    }
    const report = await this.findReportOrThrow(slug);
    const graph = await this.findGraphOrThrow(report.id, graphId);

    const existing = await this.pointRepo.count({ where: { customReportGraphId: graph.id } });
    if (existing + points.length > MAX_POINTS_PER_GRAPH) {
      throw new ConflictException(
        `Graph "${graphId}" would exceed the ${MAX_POINTS_PER_GRAPH} data-point limit ` +
        `(currently ${existing})`,
      );
    }

    const rows = points.map((p) => ({ ...p, customReportGraphId: graph.id }));
    await this.pointRepo.insert(rows);
    this.logger.debug(`Appended ${points.length} points to graph "${graphId}"`);
    return { appended: points.length };
  }

  async replaceDataPoints(
    slug: string,
    graphId: string,
    points: DataPointDto[],
  ): Promise<{ replaced: number }> {
    if (points.length > MAX_POINTS_PER_REQUEST) {
      throw new PayloadTooLargeException(
        `Maximum ${MAX_POINTS_PER_REQUEST} data points per request`,
      );
    }
    const report = await this.findReportOrThrow(slug);
    const graph = await this.findGraphOrThrow(report.id, graphId);

    await this.pointRepo.delete({ customReportGraphId: graph.id });
    if (points.length > 0) {
      const rows = points.map((p) => ({ ...p, customReportGraphId: graph.id }));
      await this.pointRepo.insert(rows);
    }
    this.logger.log(`Replaced data for graph "${graphId}" on report "${slug}" (${points.length} points)`);
    return { replaced: points.length };
  }

  async clearDataPoints(slug: string, graphId: string): Promise<void> {
    const report = await this.findReportOrThrow(slug);
    const graph = await this.findGraphOrThrow(report.id, graphId);
    await this.pointRepo.delete({ customReportGraphId: graph.id });
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  async addFilter(slug: string, dto: CreateFilterDto): Promise<CustomReportFilter> {
    const report = await this.findReportOrThrow(slug);
    const filter = this.filterRepo.create({ ...dto, customReportId: report.id });
    return this.filterRepo.save(filter);
  }

  async deleteFilter(slug: string, filterId: string): Promise<void> {
    const report = await this.findReportOrThrow(slug);
    const result = await this.filterRepo.delete({ id: filterId, customReportId: report.id });
    if (result.affected === 0) {
      throw new NotFoundException(`Filter "${filterId}" not found on report "${slug}"`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async findReportOrThrow(slug: string): Promise<CustomReport> {
    const report = await this.reportRepo.findOne({ where: { slug } });
    if (!report) {
      throw new NotFoundException(`Report "${slug}" not found`);
    }
    return report;
  }

  private async findGraphOrThrow(reportId: string, graphId: string): Promise<CustomReportGraph> {
    const graph = await this.graphRepo.findOne({
      where: { id: graphId, customReportId: reportId },
    });
    if (!graph) {
      throw new NotFoundException(`Graph "${graphId}" not found`);
    }
    return graph;
  }
}
