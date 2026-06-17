import { PilotGoStatus, PilotCohortStatus } from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { PilotGoNoGoService } from './pilot-go-no-go.service';
import { PilotMetricsService } from './pilot-metrics.service';
import { PilotReportService } from './pilot-report.service';

describe('PilotReportService', () => {
  it('returns a structured report with metrics, risks, costs and decision', async () => {
    const prisma = {
      pilotCohort: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cohort-id',
          name: 'Pilot',
          description: 'Controlled pilot',
          status: PilotCohortStatus.ACTIVE,
          startsAt: new Date('2026-06-01T00:00:00.000Z'),
          endsAt: new Date('2026-06-30T00:00:00.000Z'),
          participants: [{ id: 'participant-id', userId: 'user-id' }],
        }),
      },
      systemEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'failure-id',
            severity: 'ERROR',
            eventType: 'PROVIDER_ERROR',
          },
        ]),
      },
    };
    const metrics = {
      calculate: jest.fn().mockResolvedValue({
        invitedUsers: 2,
        activatedUsers: 1,
        initialChurnUsers: 0,
        initialChurnRate: 0,
        retentionRate: 100,
        aiEvaluations: 4,
        averageAIQuality: 78,
        averageAISafety: 96,
        blockedAIResponses: 0,
        fallbackAIResponses: 1,
        costs: {
          aiUsd: '0.20000000',
          whatsappBrl: '0.50000000',
          storageBrl: '0.10000000',
        },
      }),
    };
    const goNoGo = {
      evaluate: jest.fn().mockResolvedValue({
        status: PilotGoStatus.WARNING,
        checks: [
          {
            code: 'AI_QUALITY',
            status: PilotGoStatus.WARNING,
            message: 'Monitorar qualidade',
          },
        ],
      }),
    };
    const events = {
      record: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const service = new PilotReportService(
      prisma as unknown as PrismaService,
      metrics as unknown as PilotMetricsService,
      goNoGo as unknown as PilotGoNoGoService,
      events as unknown as EventService,
    );

    const result = await service.generate(
      'cohort-id',
      new Date('2026-06-15T12:00:00.000Z'),
    );

    expect(result.summary.recommendedDecision).toBe(PilotGoStatus.WARNING);
    expect(result.metrics.invitedUsers).toBe(2);
    expect(result.risks).toEqual([
      expect.objectContaining({ code: 'AI_QUALITY' }),
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.costs.aiUsd).toBe('0.20000000');
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'PILOT_REPORT_GENERATED' }),
    );
  });
});
