import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AnalyticsQueryService } from './analytics-query.service';
import { AnalyticsDashboardQueryDto } from './dto/analytics-dashboard-query.dto';

@Controller('api/v1/admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AnalyticsAdminController {
  constructor(private readonly analytics: AnalyticsQueryService) {}

  @Get('revenue')
  revenue(@Query() query: AnalyticsDashboardQueryDto) {
    return this.analytics.revenue(query);
  }

  @Get('churn')
  churn(@Query() query: AnalyticsDashboardQueryDto) {
    return this.analytics.churn(query);
  }

  @Get('retention')
  retention(@Query() query: AnalyticsDashboardQueryDto) {
    return this.analytics.retention(query);
  }

  @Get('costs')
  costs(@Query() query: AnalyticsDashboardQueryDto) {
    return this.analytics.costs(query);
  }

  @Get('profitability')
  profitability(@Query() query: AnalyticsDashboardQueryDto) {
    return this.analytics.profitability(query);
  }

  @Get('growth')
  growth(@Query() query: AnalyticsDashboardQueryDto) {
    return this.analytics.growth(query);
  }

  @Get('plans')
  plans(@Query() query: AnalyticsDashboardQueryDto) {
    return this.analytics.plans(query);
  }
}
