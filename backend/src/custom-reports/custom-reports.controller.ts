import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CustomReportsService } from './custom-reports.service.js';
import { CreateCustomReportDto } from './dto/create-custom-report.dto.js';
import { UpdateCustomReportDto } from './dto/update-custom-report.dto.js';
import { CreateWidgetDto } from './dto/create-widget.dto.js';
import { UpdateWidgetDto } from './dto/update-widget.dto.js';
import { AppendDataPointsDto } from './dto/append-data-points.dto.js';
import { ReplaceDataPointsDto } from './dto/replace-data-points.dto.js';
import { CreateFilterDto } from './dto/create-filter.dto.js';

@ApiTags('custom-reports')
@Controller('api/custom-reports')
export class CustomReportsController {
  constructor(private readonly service: CustomReportsService) {}

  // ── Reports ────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List all custom reports' })
  @Get()
  listReports() {
    return this.service.listReports();
  }

  @ApiOperation({ summary: 'Create a custom report' })
  @Post()
  @HttpCode(201)
  createReport(@Body() dto: CreateCustomReportDto) {
    return this.service.createReport(dto);
  }

  @ApiOperation({ summary: 'Get a custom report with all widgets, filters, and data points' })
  @ApiParam({ name: 'slug' })
  @Get(':slug')
  getReport(@Param('slug') slug: string) {
    return this.service.getReport(slug);
  }

  @ApiOperation({ summary: 'Update report metadata' })
  @ApiParam({ name: 'slug' })
  @Patch(':slug')
  updateReport(@Param('slug') slug: string, @Body() dto: UpdateCustomReportDto) {
    return this.service.updateReport(slug, dto);
  }

  @ApiOperation({ summary: 'Delete a report and all its data' })
  @ApiParam({ name: 'slug' })
  @HttpCode(204)
  @Delete(':slug')
  deleteReport(@Param('slug') slug: string): Promise<void> {
    return this.service.deleteReport(slug);
  }

  // ── Widgets ─────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Add a widget to a report' })
  @ApiParam({ name: 'slug' })
  @Post(':slug/widgets')
  @HttpCode(201)
  addWidget(@Param('slug') slug: string, @Body() dto: CreateWidgetDto) {
    return this.service.addWidget(slug, dto);
  }

  @ApiOperation({ summary: 'Update a widget' })
  @ApiParam({ name: 'slug' })
  @ApiParam({ name: 'widgetId' })
  @Patch(':slug/widgets/:widgetId')
  updateWidget(
    @Param('slug') slug: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: UpdateWidgetDto,
  ) {
    return this.service.updateWidget(slug, widgetId, dto);
  }

  @ApiOperation({ summary: 'Delete a widget and all its data points' })
  @ApiParam({ name: 'slug' })
  @ApiParam({ name: 'widgetId' })
  @HttpCode(204)
  @Delete(':slug/widgets/:widgetId')
  deleteWidget(
    @Param('slug') slug: string,
    @Param('widgetId') widgetId: string,
  ): Promise<void> {
    return this.service.deleteWidget(slug, widgetId);
  }

  // ── Data points ────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Append data points to a widget (additive)' })
  @ApiParam({ name: 'slug' })
  @ApiParam({ name: 'widgetId' })
  @Post(':slug/widgets/:widgetId/data-points')
  @HttpCode(201)
  appendDataPoints(
    @Param('slug') slug: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: AppendDataPointsDto,
  ) {
    return this.service.appendDataPoints(slug, widgetId, dto.points);
  }

  @ApiOperation({ summary: 'Replace all data points for a widget' })
  @ApiParam({ name: 'slug' })
  @ApiParam({ name: 'widgetId' })
  @Put(':slug/widgets/:widgetId/data-points')
  replaceDataPoints(
    @Param('slug') slug: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: ReplaceDataPointsDto,
  ) {
    return this.service.replaceDataPoints(slug, widgetId, dto.points);
  }

  @ApiOperation({ summary: 'Clear all data points for a widget' })
  @ApiParam({ name: 'slug' })
  @ApiParam({ name: 'widgetId' })
  @HttpCode(204)
  @Delete(':slug/widgets/:widgetId/data-points')
  clearDataPoints(
    @Param('slug') slug: string,
    @Param('widgetId') widgetId: string,
  ): Promise<void> {
    return this.service.clearDataPoints(slug, widgetId);
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Add a filter definition to a report' })
  @ApiParam({ name: 'slug' })
  @Post(':slug/filters')
  @HttpCode(201)
  addFilter(@Param('slug') slug: string, @Body() dto: CreateFilterDto) {
    return this.service.addFilter(slug, dto);
  }

  @ApiOperation({ summary: 'Remove a filter from a report' })
  @ApiParam({ name: 'slug' })
  @ApiParam({ name: 'filterId' })
  @HttpCode(204)
  @Delete(':slug/filters/:filterId')
  deleteFilter(
    @Param('slug') slug: string,
    @Param('filterId') filterId: string,
  ): Promise<void> {
    return this.service.deleteFilter(slug, filterId);
  }
}
