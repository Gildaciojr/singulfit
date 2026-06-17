import { Prisma } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { PROGRESS_INSIGHT_PROMPT_NAME } from './progress.constants';
import { SnapshotService } from './snapshot.service';

describe('SnapshotService', () => {
  function createSubject() {
    const previousSnapshot = {
      id: 'previous-snapshot-id',
      userId: 'user-id',
      profileId: 'profile-id',
      weightKg: new Prisma.Decimal('73.80'),
      bodyFatPercent: new Prisma.Decimal('25.10'),
      muscleMassKg: new Prisma.Decimal('27.50'),
      bmi: new Prisma.Decimal('26.15'),
      createdAt: new Date('2026-05-20T12:00:00.000Z'),
    };
    const prisma = {
      progressSnapshot: {
        findFirst: jest.fn().mockResolvedValue(previousSnapshot),
      },
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'progress-job-id',
      }),
      runTextJob: jest.fn().mockResolvedValue({
        responseId: 'response-id',
        model: 'text-model',
        outputText: JSON.stringify({
          insight: 'Você perdeu 3 kg nos últimos 20 dias.',
        }),
        promptTokens: 100,
        completionTokens: 25,
        totalTokens: 125,
      }),
      completeJobInTransaction: jest.fn().mockResolvedValue({}),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SnapshotService(
      prisma as unknown as PrismaService,
      aiService as unknown as AIService,
    );
    const input = {
      userId: 'user-id',
      profileId: 'profile-id',
      heightCm: 168,
      weightKg: 70.8,
      bodyFatPercent: 24.5,
      muscleMassKg: 28.2,
      createdAt: new Date('2026-06-09T12:00:00.000Z'),
    };

    return {
      service,
      prisma,
      aiService,
      previousSnapshot,
      input,
    };
  }

  it('calculates BMI and asks OpenAI for a structured 30-day insight', async () => {
    const subject = createSubject();
    const result = await subject.service.prepare(subject.input);

    expect(result.bmi.toNumber()).toBe(25.09);
    expect(result.insight).toBe('Você perdeu 3 kg nos últimos 20 dias.');
    expect(subject.aiService.createStandaloneJob).toHaveBeenCalledWith(
      expect.objectContaining({
        promptName: PROGRESS_INSIGHT_PROMPT_NAME,
      }),
    );
    expect(subject.aiService.runTextJob).toHaveBeenCalledWith(
      'progress-job-id',
      expect.objectContaining({
        jsonSchema: expect.objectContaining({
          name: 'progress_insight',
        }),
      }),
    );
    const requestJobId = subject.aiService.runTextJob.mock
      .calls[0][0] as string;
    const requestInput = subject.aiService.runTextJob.mock.calls[0][1] as {
      input: string;
    };

    expect(requestJobId).toBe('progress-job-id');
    expect(JSON.parse(requestInput.input)).toEqual({
      current: {
        weightKg: 70.8,
        bodyFatPercent: 24.5,
        muscleMassKg: 28.2,
        bmi: 25.09,
        measuredAt: '2026-06-09T12:00:00.000Z',
      },
      comparison: {
        weightKg: 73.8,
        bodyFatPercent: 25.1,
        muscleMassKg: 27.5,
        bmi: 26.15,
        measuredAt: '2026-05-20T12:00:00.000Z',
        weightChangeKg: -3,
      },
    });
  });

  it('persists the snapshot and insight in the supplied transaction', async () => {
    const subject = createSubject();
    const transaction = {
      progressSnapshot: {
        create: jest.fn().mockResolvedValue({
          id: 'snapshot-id',
        }),
      },
    };

    await subject.service.createInTransaction(
      transaction as unknown as Prisma.TransactionClient,
      subject.input,
      {
        bmi: new Prisma.Decimal('25.09'),
        insight: 'Você perdeu 3 kg nos últimos 20 dias.',
      },
    );

    expect(transaction.progressSnapshot.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        profileId: 'profile-id',
        weightKg: new Prisma.Decimal('70.80'),
        bodyFatPercent: new Prisma.Decimal('24.50'),
        muscleMassKg: new Prisma.Decimal('28.20'),
        bmi: new Prisma.Decimal('25.09'),
        createdAt: new Date('2026-06-09T12:00:00.000Z'),
        insights: {
          create: {
            userId: 'user-id',
            aiJobId: undefined,
            insight: 'Você perdeu 3 kg nos últimos 20 dias.',
          },
        },
      },
    });
  });

  it('uses a deterministic insight when OpenAI returns malformed JSON', async () => {
    const subject = createSubject();
    subject.aiService.runTextJob.mockResolvedValue({
      responseId: 'response-id',
      model: 'text-model',
      outputText: 'not-json',
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
    });

    await expect(subject.service.prepare(subject.input)).resolves.toEqual({
      bmi: new Prisma.Decimal('25.09'),
      insight: 'Você perdeu 3 kg nos últimos 20 dias.',
    });
  });
});
