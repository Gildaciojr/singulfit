import { ReservationService } from '../entitlements/reservation.service';
import { ConfigService } from '@nestjs/config';
import { AIJobType } from '@prisma/client';
import { AudioConversationService } from '../audio/audio-conversation.service';
import { AIRecoveryService } from '../ai/ai-recovery.service';
import { UsageService } from '../usage/usage.service';
import { AutomationService } from '../automation/automation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AIService } from '../ai/ai.service';
import { AIUsageService } from '../ai/ai-usage.service';
import { MediaService } from '../storage/media.service';
import { AudioTranscriptionGateway } from '../audio/audio-transcription.gateway';
import { EventBusService } from '../event-bus/event-bus.service';
import { EventService } from '../observability/event.service';
import { EntitlementsService } from '../entitlements/entitlements.service';

describe('contingency compatibility fences', () => {
  it.each(['OFF', 'CANARY', 'GLOBAL'])(
    'suspends audio under %s, including replay',
    async (mode) => {
      const userId = 'fa001001-0000-4000-8000-000000000001';
      const lookup = jest.fn();
      const transcribe = jest.fn();
      const service = new AudioConversationService(
        { message: { findUnique: lookup } } as unknown as PrismaService,
        {} as MediaService,
        { transcribe } as unknown as AudioTranscriptionGateway,
        {} as AIService,
        {} as AIUsageService,
        {} as EventBusService,
        new ConfigService({
          AUDIO_TRANSCRIPTION_MODE: mode,
          AUDIO_TRANSCRIPTION_CANARY_USER_IDS: userId,
          AUDIO_TRANSCRIPTION_GLOBAL_AUTHORIZED: 'true',
        }),
      );
      expect(service.isEnabledForUser(userId)).toBe(false);
      await service.process({ userId, messageId: 'synthetic-replay' });
      await service.process({ userId, messageId: 'synthetic-replay' });
      expect(lookup).not.toHaveBeenCalled();
      expect(transcribe).not.toHaveBeenCalled();
    },
  );

  it('does not recover/reverse an expired audio claim even if a stale query returned it', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'audio',
        type: AIJobType.AUDIO,
        result: { phase: 'REQUEST_STARTED' },
      },
    ]);
    const reverseInTransaction = jest.fn();
    const transaction = jest.fn();
    const service = new AIRecoveryService(
      {
        aIJob: { findMany },
        $transaction: transaction,
      } as unknown as PrismaService,
      { reverseInTransaction } as unknown as UsageService,
      {} as EventService,
      {} as AIService,
    );
    expect(await service.recover()).toBe(0);
    expect(findMany.mock.calls[0][0].where.type).toEqual({
      not: AIJobType.AUDIO,
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(reverseInTransaction).not.toHaveBeenCalled();
  });

  it.each(['confirmInTransaction', 'reverseInTransaction'] as const)(
    'preserves audio counters during %s',
    async (method) => {
      const query = jest.fn();
      const transaction = {
        aIJob: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'owner', type: AIJobType.AUDIO }),
        },
        $queryRaw: query,
      };
      const service = new UsageService(
        {} as PrismaService,
        {} as EntitlementsService,
      );
      await expect(
        service[method](
          transaction as unknown as Parameters<
            UsageService['confirmInTransaction']
          >[0],
          'audio',
        ),
      ).resolves.toEqual([]);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('preserves a factual weekly pending delivery before legacy preference/cancellation logic', async () => {
    const pending = {
      id: 'weekly',
      status: 'PENDING',
      context: { weeklyKey: 'coach-weekly-v1:owner:week' },
    };
    const transaction = {
      $queryRaw: jest.fn(),
      scheduledMessage: {
        findUnique: jest.fn().mockResolvedValue(pending),
        update: jest.fn(),
      },
    };
    const service = Object.create(
      AutomationService.prototype,
    ) as AutomationService;
    Object.defineProperty(service, 'prisma', {
      value: {
        $transaction: async (
          callback: (value: typeof transaction) => Promise<unknown>,
        ) => callback(transaction),
      },
    });
    await expect(service.sendScheduledMessage('weekly')).resolves.toBe(pending);
    expect(transaction.scheduledMessage.update).not.toHaveBeenCalled();
  });
});

describe('post-upgrade commercial settlement', () => {
  it.each(['ownership', 'ambiguous'] as const)(
    'rejects %s instead of settling another cycle',
    async (failure) => {
      const bucket = { id: 'first', reserved: 1, used: 0 };
      const update = jest.fn();
      const transaction = {
        aIJob: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ userId: 'owner', type: AIJobType.IMAGE }),
        },
        $queryRaw: jest.fn(),
        usageEvent: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'event',
              userId: failure === 'ownership' ? 'another' : 'owner',
              entitlementCode: 'IMAGE_ANALYSIS',
              quantity: 1,
              createdAt: new Date(),
            },
          ]),
          update,
        },
        usageBucket: {
          findFirstOrThrow: jest.fn().mockResolvedValue(bucket),
          findMany: jest
            .fn()
            .mockResolvedValue([bucket, { ...bucket, id: 'second' }]),
          update,
        },
      };
      const service = new UsageService(
        {} as PrismaService,
        {} as EntitlementsService,
      );
      await expect(
        service.confirmInTransaction(
          transaction as unknown as Parameters<
            UsageService['confirmInTransaction']
          >[0],
          'job',
        ),
      ).rejects.toThrow(
        failure === 'ownership'
          ? 'Usage event ownership mismatch'
          : 'Ambiguous usage bucket',
      );
      expect(update).not.toHaveBeenCalled();
    },
  );
});

describe('contingency reversed reservation identity', () => {
  it.each(['owner', 'quantity'] as const)(
    'rejects mismatched %s before reusing a reversed event',
    async (mismatch) => {
      const resolveCommercialGrantInTransaction = jest
        .fn()
        .mockResolvedValue({ unlimited: true });
      const transaction = {
        $queryRaw: jest.fn(),
        usageEvent: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'event',
            userId: mismatch === 'owner' ? 'other' : 'owner',
            quantity: mismatch === 'quantity' ? 2 : 1,
            status: 'REVERSED',
          }),
        },
      };
      const service = new ReservationService(
        {} as PrismaService,
        {
          resolveCommercialGrantInTransaction,
        } as unknown as EntitlementsService,
      );
      await expect(
        service.reserveCommercialUsageInTransaction(
          transaction as unknown as Parameters<
            ReservationService['reserveCommercialUsageInTransaction']
          >[0],
          {
            userId: 'owner',
            aiJobId: 'job',
            entitlementCode: 'IMAGE_ANALYSIS',
            quantity: 1,
          },
        ),
      ).rejects.toThrow('Reserva de uso inconsistente');
      expect(resolveCommercialGrantInTransaction).not.toHaveBeenCalled();
    },
  );
});
