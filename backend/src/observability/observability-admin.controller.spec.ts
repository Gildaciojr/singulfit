import { AIUsageSummaryService } from './ai-usage-summary.service';
import { AuditService } from './audit.service';
import { EventService } from './event.service';
import { ObservabilityAdminController } from './observability-admin.controller';

describe('ObservabilityAdminController', () => {
  it('delegates all administrative queries to their services', async () => {
    const auditService = {
      list: jest.fn().mockResolvedValue({ items: [] }),
    };
    const eventService = {
      list: jest.fn().mockResolvedValue({ items: [] }),
    };
    const usageSummaryService = {
      list: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new ObservabilityAdminController(
      auditService as unknown as AuditService,
      eventService as unknown as EventService,
      usageSummaryService as unknown as AIUsageSummaryService,
    );

    await controller.getAuditLogs({ limit: 20 });
    await controller.getEvents({ limit: 20 });
    await controller.getUsageSummary({ limit: 20 });

    expect(auditService.list).toHaveBeenCalledWith({ limit: 20 });
    expect(eventService.list).toHaveBeenCalledWith({ limit: 20 });
    expect(usageSummaryService.list).toHaveBeenCalledWith({ limit: 20 });
  });
});
