import {
  PilotGoStatus,
  PilotManualCheckStatus,
  PilotManualCheckType,
} from '@prisma/client';
import { EventService } from '../observability/event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductionReadinessService } from '../production/production-readiness.service';
import { PilotMetricsService } from './pilot-metrics.service';
import { PilotGoNoGoService } from './pilot-go-no-go.service';

describe('PilotGoNoGoService', () => {
  const evaluatedAt = new Date('2026-06-15T12:00:00.000Z');

  function createSubject(options?: {
    averageAIQuality?: number;
    deadLetters?: number;
    removeManualCheck?: PilotManualCheckType;
  }) {
    const manualChecks = Object.values(PilotManualCheckType)
      .filter((type) => type !== options?.removeManualCheck)
      .map((checkType) => ({
        checkType,
        status: PilotManualCheckStatus.PASSED,
        notes: 'verified',
        checkedAt: evaluatedAt,
      }));
    const tx = {
      $queryRaw: jest.fn(),
      pilotCohort: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          lastGoStatus: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'cohort-id' }),
      },
    };
    const prisma = {
      pilotCohort: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cohort-id',
          startsAt: new Date('2026-06-01T00:00:00.000Z'),
          manualChecks,
        }),
      },
      systemEvent: {
        findFirst: jest.fn().mockResolvedValue({
          eventType: 'SMOKE_TEST_PASSED',
          createdAt: new Date('2026-06-15T11:00:00.000Z'),
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const readiness = {
      check: jest.fn().mockResolvedValue({
        status: 'ok',
        checkedAt: evaluatedAt.toISOString(),
        checks: {
          database: { status: 'UP', latencyMs: 1, detail: {} },
          migrations: { status: 'UP', latencyMs: 1, detail: {} },
          workers: { status: 'UP', latencyMs: 1, detail: {} },
          outbox: {
            status: 'UP',
            latencyMs: 1,
            detail: { deadLetter: options?.deadLetters ?? 0 },
          },
          openai: { status: 'UP', latencyMs: 1, detail: {} },
          evolution: { status: 'UP', latencyMs: 1, detail: {} },
          pagbank: { status: 'UP', latencyMs: 1, detail: {} },
          storage: { status: 'UP', latencyMs: 1, detail: {} },
          configuration: { status: 'UP', latencyMs: 1, detail: {} },
        },
      }),
    };
    const metrics = {
      calculate: jest.fn().mockResolvedValue({
        invitedUsers: 10,
        activatedUsers: 8,
        activationRate: 80,
        initialChurnUsers: 1,
        initialChurnRate: 10,
        aiEvaluations: 20,
        averageAIQuality: options?.averageAIQuality ?? 85,
        averageAISafety: 98,
        blockedAIResponses: 0,
        fallbackAIResponses: 1,
      }),
    };
    const events = {
      recordInTransaction: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const service = new PilotGoNoGoService(
      prisma as unknown as PrismaService,
      readiness as unknown as ProductionReadinessService,
      metrics as unknown as PilotMetricsService,
      events as unknown as EventService,
    );

    return { service, tx, events };
  }

  it('returns GO when every operational and manual gate passes', async () => {
    const subject = createSubject();

    const result = await subject.service.evaluate('cohort-id', evaluatedAt);

    expect(result.status).toBe(PilotGoStatus.GO);
    expect(
      result.checks.every((check) => check.status === PilotGoStatus.GO),
    ).toBe(true);
    expect(subject.events.recordInTransaction).toHaveBeenCalledWith(
      subject.tx,
      expect.objectContaining({ eventType: 'PILOT_GO_STATUS_CHANGED' }),
    );
  });

  it('returns WARNING for non-blocking AI quality degradation', async () => {
    const result = await createSubject({
      averageAIQuality: 70,
    }).service.evaluate('cohort-id', evaluatedAt);

    expect(result.status).toBe(PilotGoStatus.WARNING);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'AI_QUALITY',
          status: PilotGoStatus.WARNING,
        }),
      ]),
    );
  });

  it.each([
    [{ deadLetters: 1 }, 'DEAD_LETTERS'],
    [{ removeManualCheck: PilotManualCheckType.RESTORE }, 'MANUAL_RESTORE'],
  ])('returns NO_GO for a blocking condition', async (options, code) => {
    const result = await createSubject(options).service.evaluate(
      'cohort-id',
      evaluatedAt,
    );

    expect(result.status).toBe(PilotGoStatus.NO_GO);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code,
          status: PilotGoStatus.NO_GO,
        }),
      ]),
    );
  });
});
