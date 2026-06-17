import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsAdminController } from '../analytics/analytics-admin.controller';
import { AnalyticsDateService } from '../analytics/analytics-date.service';
import { AnalyticsQueryService } from '../analytics/analytics-query.service';
import { AnalyticsSnapshotService } from '../analytics/analytics-snapshot.service';
import { ChurnAnalyticsService } from '../analytics/churn-analytics.service';
import { CostAnalyticsService } from '../analytics/cost-analytics.service';
import { GrowthAnalyticsService } from '../analytics/growth-analytics.service';
import { PlanPerformanceService } from '../analytics/plan-performance.service';
import { RetentionAnalyticsService } from '../analytics/retention-analytics.service';
import { RevenueMetricsService } from '../analytics/revenue-metrics.service';
import { UserProfitabilityService } from '../analytics/user-profitability.service';
import { AuthModule } from '../auth/auth.module';
import { AIUsageSummaryService } from './ai-usage-summary.service';
import { AuditService } from './audit.service';
import { EventService } from './event.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ObservabilityAdminController } from './observability-admin.controller';
import { ProductionModule } from '../production/production.module';

@Global()
@Module({
  imports: [AuthModule, ConfigModule, ProductionModule],
  controllers: [
    HealthController,
    ObservabilityAdminController,
    AnalyticsAdminController,
  ],
  providers: [
    AuditService,
    EventService,
    HealthService,
    AIUsageSummaryService,
    AnalyticsDateService,
    RevenueMetricsService,
    ChurnAnalyticsService,
    RetentionAnalyticsService,
    CostAnalyticsService,
    UserProfitabilityService,
    PlanPerformanceService,
    GrowthAnalyticsService,
    AnalyticsSnapshotService,
    AnalyticsQueryService,
  ],
  exports: [
    AuditService,
    EventService,
    HealthService,
    AIUsageSummaryService,
    AnalyticsSnapshotService,
    AnalyticsQueryService,
  ],
})
export class ObservabilityModule {}
