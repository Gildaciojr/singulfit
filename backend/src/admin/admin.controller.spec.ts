import { UserRole } from '@prisma/client';
import { OutboxService } from '../event-bus/outbox.service';
import { EventService } from '../observability/event.service';
import { OperationalHealthService } from '../operations/operational-health.service';
import { OperationalMetricsService } from '../operations/operational-metrics.service';
import { AdminController } from './admin.controller';

describe('AdminController', () => {
  it('delegates outbox, retry and system event operations', async () => {
    const outboxService = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      retry: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
    };
    const eventService = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    const metricsService = {
      getAll: jest.fn(),
      getOutboxStats: jest.fn(),
      getWebhookStats: jest.fn(),
      getSystemEventStats: jest.fn(),
    };
    const healthService = {
      check: jest.fn(),
    };
    const controller = new AdminController(
      outboxService as unknown as OutboxService,
      eventService as unknown as EventService,
      metricsService as unknown as OperationalMetricsService,
      healthService as unknown as OperationalHealthService,
    );
    const user = {
      userId: 'admin-id',
      role: UserRole.ADMIN,
      sessionId: 'session-id',
      jti: 'access-jti',
    };

    await controller.getOutbox({ limit: 50 });
    await controller.retryOutboxEvent('outbox-id', user);
    await controller.getSystemEvents({ limit: 50 });
    await controller.getMetrics();
    await controller.getOutboxStats();
    await controller.getWebhookStats();
    await controller.getSystemEventStats();
    await controller.getHealth();

    expect(outboxService.list).toHaveBeenCalledWith({ limit: 50 });
    expect(outboxService.retry).toHaveBeenCalledWith('outbox-id', 'admin-id');
    expect(eventService.list).toHaveBeenCalledWith({ limit: 50 });
    expect(metricsService.getAll).toHaveBeenCalled();
    expect(metricsService.getOutboxStats).toHaveBeenCalled();
    expect(metricsService.getWebhookStats).toHaveBeenCalled();
    expect(metricsService.getSystemEventStats).toHaveBeenCalled();
    expect(healthService.check).toHaveBeenCalled();
  });
});
