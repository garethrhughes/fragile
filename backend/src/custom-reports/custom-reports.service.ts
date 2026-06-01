import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { CustomReport } from '../database/entities/custom-report.entity.js';
import { CustomReportWidget } from '../database/entities/custom-report-widget.entity.js';
import { CustomReportDataPoint } from '../database/entities/custom-report-data-point.entity.js';
import { CustomReportFilter } from '../database/entities/custom-report-filter.entity.js';
import { CreateCustomReportDto } from './dto/create-custom-report.dto.js';
import { UpdateCustomReportDto } from './dto/update-custom-report.dto.js';
import { CreateWidgetDto } from './dto/create-widget.dto.js';
import { UpdateWidgetDto } from './dto/update-widget.dto.js';
import { CreateFilterDto } from './dto/create-filter.dto.js';
import type { DataPointDto } from './dto/append-data-points.dto.js';

const MAX_POINTS_PER_REQUEST = 1_000;
const MAX_POINTS_PER_WIDGET = 100_000;

export interface CustomReportWithMeta extends CustomReport {
  jiraBaseUrl: string;
}

@Injectable()
export class CustomReportsService {
  private readonly logger = new Logger(CustomReportsService.name);
  private readonly jiraBaseUrl: string;

  constructor(
    @InjectRepository(CustomReport)
    private readonly reportRepo: Repository<CustomReport>,
    @InjectRepository(CustomReportWidget)
    private readonly widgetRepo: Repository<CustomReportWidget>,
    @InjectRepository(CustomReportDataPoint)
    private readonly pointRepo: Repository<CustomReportDataPoint>,
    @InjectRepository(CustomReportFilter)
    private readonly filterRepo: Repository<CustomReportFilter>,
    private readonly configService: ConfigService,
  ) {
    this.jiraBaseUrl = this.configService.get<string>('JIRA_BASE_URL', '');
  }

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

  async getReport(slug: string): Promise<CustomReportWithMeta> {
    const report = await this.reportRepo.findOne({
      where: { slug },
      relations: { widgets: { dataPoints: true }, filters: true },
      order: {
        widgets: { position: 'ASC' },
        filters: { position: 'ASC' },
      },
    });
    if (!report) {
      throw new NotFoundException(`Report "${slug}" not found`);
    }
    return Object.assign(report, { jiraBaseUrl: this.jiraBaseUrl });
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

  // ── Widgets ───────────────────────────────────────────────────────────────

  async addWidget(slug: string, dto: CreateWidgetDto): Promise<CustomReportWidget> {
    if (dto.kind === 'stat' && dto.columns !== undefined && dto.columns !== null) {
      throw new BadRequestException(
        'columns must not be provided when kind is "stat"',
      );
    }
    const report = await this.findReportOrThrow(slug);
    const widget = this.widgetRepo.create({ ...dto, customReportId: report.id });
    const saved = await this.widgetRepo.save(widget);
    this.logger.log(`Added widget "${saved.id}" to report "${slug}"`);
    return saved;
  }

  async updateWidget(
    slug: string,
    widgetId: string,
    dto: UpdateWidgetDto,
  ): Promise<CustomReportWidget> {
    const report = await this.findReportOrThrow(slug);
    const widget = await this.findWidgetOrThrow(report.id, widgetId);
    const effectiveKind = dto.kind ?? widget.kind;
    if (effectiveKind === 'stat' && dto.columns !== undefined && dto.columns !== null) {
      throw new BadRequestException(
        'columns must not be provided when kind is "stat"',
      );
    }
    const merged = this.widgetRepo.merge(widget, dto);
    return this.widgetRepo.save(merged);
  }

  async deleteWidget(slug: string, widgetId: string): Promise<void> {
    const report = await this.findReportOrThrow(slug);
    const result = await this.widgetRepo.delete({ id: widgetId, customReportId: report.id });
    if (result.affected === 0) {
      throw new NotFoundException(`Widget "${widgetId}" not found on report "${slug}"`);
    }
  }

  // ── Data points ───────────────────────────────────────────────────────────

  async appendDataPoints(
    slug: string,
    widgetId: string,
    points: DataPointDto[],
  ): Promise<{ appended: number }> {
    if (points.length > MAX_POINTS_PER_REQUEST) {
      throw new PayloadTooLargeException(
        `Maximum ${MAX_POINTS_PER_REQUEST} data points per request`,
      );
    }
    const report = await this.findReportOrThrow(slug);
    const widget = await this.findWidgetOrThrow(report.id, widgetId);

    const existing = await this.pointRepo.count({ where: { customReportWidgetId: widget.id } });
    if (existing + points.length > MAX_POINTS_PER_WIDGET) {
      throw new ConflictException(
        `Widget "${widgetId}" would exceed the ${MAX_POINTS_PER_WIDGET} data-point limit ` +
        `(currently ${existing})`,
      );
    }

    const rows = points.map((p) => ({ ...p, customReportWidgetId: widget.id }));
    await this.pointRepo.insert(rows);
    this.logger.debug(`Appended ${points.length} points to widget "${widgetId}"`);
    return { appended: points.length };
  }

  async replaceDataPoints(
    slug: string,
    widgetId: string,
    points: DataPointDto[],
  ): Promise<{ replaced: number }> {
    if (points.length > MAX_POINTS_PER_REQUEST) {
      throw new PayloadTooLargeException(
        `Maximum ${MAX_POINTS_PER_REQUEST} data points per request`,
      );
    }
    const report = await this.findReportOrThrow(slug);
    const widget = await this.findWidgetOrThrow(report.id, widgetId);

    await this.pointRepo.delete({ customReportWidgetId: widget.id });
    if (points.length > 0) {
      const rows = points.map((p) => ({ ...p, customReportWidgetId: widget.id }));
      await this.pointRepo.insert(rows);
    }
    this.logger.log(`Replaced data for widget "${widgetId}" on report "${slug}" (${points.length} points)`);
    return { replaced: points.length };
  }

  async clearDataPoints(slug: string, widgetId: string): Promise<void> {
    const report = await this.findReportOrThrow(slug);
    const widget = await this.findWidgetOrThrow(report.id, widgetId);
    await this.pointRepo.delete({ customReportWidgetId: widget.id });
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

  private async findWidgetOrThrow(reportId: string, widgetId: string): Promise<CustomReportWidget> {
    const widget = await this.widgetRepo.findOne({
      where: { id: widgetId, customReportId: reportId },
    });
    if (!widget) {
      throw new NotFoundException(`Widget "${widgetId}" not found`);
    }
    return widget;
  }
}
