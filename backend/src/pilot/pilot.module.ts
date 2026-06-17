import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProductionModule } from '../production/production.module';
import { PilotAdminController } from './pilot-admin.controller';
import { PilotGoNoGoService } from './pilot-go-no-go.service';
import { PilotMetricsService } from './pilot-metrics.service';
import { PilotReportService } from './pilot-report.service';
import { PilotService } from './pilot.service';

@Module({
  imports: [AuthModule, ProductionModule],
  controllers: [PilotAdminController],
  providers: [
    PilotService,
    PilotMetricsService,
    PilotGoNoGoService,
    PilotReportService,
  ],
  exports: [
    PilotService,
    PilotMetricsService,
    PilotGoNoGoService,
    PilotReportService,
  ],
})
export class PilotModule {}
