import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AIJobStatus, AIJobType } from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { ReservationService } from '../entitlements/reservation.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { AIUsageService } from './ai-usage.service';
import { AIService } from './ai.service';
import { OpenAIGateway } from './openai.gateway';
import { PromptService } from './prompt.service';

describe('AIService standalone operation key', () => {
  it('reuses the same compatible AI job before checking concurrent jobs', async () => {
    const existing = {
      id: 'job-id',
      userId: 'user-id',
      type: AIJobType.DIET,
      status: AIJobStatus.COMPLETED,
      promptVersionId: 'prompt-id',
      operationKey: 'nutrition-planning-v2:digest',
      promptVersion: { id: 'prompt-id' },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      aIJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(existing),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        AIService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: PromptService,
          useValue: {
            getActive: jest.fn().mockResolvedValue({ id: 'prompt-id' }),
          },
        },
        { provide: OpenAIGateway, useValue: {} },
        { provide: AIUsageService, useValue: {} },
        { provide: ReservationService, useValue: {} },
        { provide: UsageService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('120') },
        },
        { provide: EventBusService, useValue: {} },
      ],
    }).compile();

    const result = await module.get(AIService).createStandaloneJob({
      userId: 'user-id',
      type: AIJobType.DIET,
      promptName: 'nutrition_planning_v2',
      operationKey: 'nutrition-planning-v2:digest',
    });

    expect(result).toBe(existing);
    expect(transaction.aIJob.findFirst).not.toHaveBeenCalled();
    expect(transaction.aIJob.create).not.toHaveBeenCalled();
  });
});
