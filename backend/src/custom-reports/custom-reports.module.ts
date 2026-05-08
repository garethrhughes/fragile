import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomReport } from '../database/entities/custom-report.entity.js';
import { CustomReportWidget } from '../database/entities/custom-report-widget.entity.js';
import { CustomReportDataPoint } from '../database/entities/custom-report-data-point.entity.js';
import { CustomReportFilter } from '../database/entities/custom-report-filter.entity.js';
import { CustomReportsService } from './custom-reports.service.js';
import { CustomReportsController } from './custom-reports.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomReport,
      CustomReportWidget,
      CustomReportDataPoint,
      CustomReportFilter,
    ]),
  ],
  controllers: [CustomReportsController],
  providers: [CustomReportsService],
  exports: [CustomReportsService],
})
export class CustomReportsModule {}
