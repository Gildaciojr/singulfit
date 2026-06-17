import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { ListOutboxEventsDto } from '../event-bus/dto/list-outbox-events.dto';
import { OutboxService } from '../event-bus/outbox.service';
import { ListEventsDto } from '../observability/dto/list-events.dto';
import { EventService } from '../observability/event.service';
import { OperationalHealthService } from '../operations/operational-health.service';
import { OperationalMetricsService } from '../operations/operational-metrics.service';

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly outboxService: OutboxService,
    private readonly eventService: EventService,
    private readonly metricsService: OperationalMetricsService,
    private readonly healthService: OperationalHealthService,
  ) {}

  @Get('outbox')
  getOutbox(@Query() query: ListOutboxEventsDto) {
    return this.outboxService.list(query);
  }

  @Post('outbox/:id/retry')
  retryOutboxEvent(
    @Param('id', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.outboxService.retry(eventId, user.userId);
  }

  @Get('system-events')
  getSystemEvents(@Query() query: ListEventsDto) {
    return this.eventService.list(query);
  }

  @Get('metrics')
  getMetrics() {
    return this.metricsService.getAll();
  }

  @Get('outbox/stats')
  getOutboxStats() {
    return this.metricsService.getOutboxStats();
  }

  @Get('webhooks/stats')
  getWebhookStats() {
    return this.metricsService.getWebhookStats();
  }

  @Get('system-events/stats')
  getSystemEventStats() {
    return this.metricsService.getSystemEventStats();
  }

  @Get('health')
  getHealth() {
    return this.healthService.check();
  }
}
