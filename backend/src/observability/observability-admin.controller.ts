import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AIUsageSummaryService } from './ai-usage-summary.service';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { ListUsageSummaryDto } from './dto/list-usage-summary.dto';
import { EventService } from './event.service';

@Controller('api/v1/admin/observability')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ObservabilityAdminController {
  constructor(
    private readonly auditService: AuditService,
    private readonly eventService: EventService,
    private readonly usageSummaryService: AIUsageSummaryService,
  ) {}

  @Get('audit-logs')
  getAuditLogs(@Query() query: ListAuditLogsDto) {
    return this.auditService.list(query);
  }

  @Get('events')
  getEvents(@Query() query: ListEventsDto) {
    return this.eventService.list(query);
  }

  @Get('usage-summary')
  getUsageSummary(@Query() query: ListUsageSummaryDto) {
    return this.usageSummaryService.list(query);
  }
}
