import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObservabilityModule } from '../observability/observability.module';
import { OperationalHealthService } from './operational-health.service';
import { OperationalMetricsService } from './operational-metrics.service';
import { OperationsConfigService } from './operations-config.service';
import { RetentionService } from './retention.service';
import { ProductionModule } from '../production/production.module';

@Module({
  imports: [ConfigModule, ObservabilityModule, ProductionModule],
  providers: [
    OperationsConfigService,
    RetentionService,
    OperationalMetricsService,
    OperationalHealthService,
  ],
  exports: [
    OperationsConfigService,
    RetentionService,
    OperationalMetricsService,
    OperationalHealthService,
  ],
})
export class OperationsModule {}
