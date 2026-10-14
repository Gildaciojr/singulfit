import { MemoryType, Prisma } from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY,
  ACTIVATION_ONBOARDING_SOURCE_KEY,
  ACTIVATION_ONBOARDING_STATE,
} from './activation-onboarding.constants';
import { ActivationOnboardingService } from './activation-onboarding.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { EventHandlerRegistry } from '../event-bus/event-handler.registry';
import { IntegrationEventHandlersService } from '../event-bus/integration-event-handlers.service';
import type { OutboxEvent } from '@prisma/client';
import { OutboundMessageStatus } from '@prisma/client';
import { EvolutionSendService } from '../evolution/evolution-send.service';
import type { EvolutionGateway } from '../evolution/evolution.gateway';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import type { ConfigService } from '@nestjs/config';
import { DeliveryPendingError } from '../event-bus/delivery-pending.error';

type StoredMemory = {
  id: string;
  userId: string;
  memoryType: MemoryType;
  sourceKey: string;
  content: Prisma.JsonValue;
  summary: string;
  relevanceScore: Prisma.Decimal;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ConversationMemoryUpsertInput = {
  where: {
    userId_memoryType_sourceKey: {
      userId: string;
      memoryType: MemoryType;
      sourceKey: string;
    };
  };
  update: {
    content: Prisma.InputJsonObject;
    summary: string;
    relevanceScore: Prisma.Decimal;
    generatedAt: Date;
  };
  create: {
    userId: string;
    memoryType: MemoryType;
    sourceKey: string;
    content: Prisma.InputJsonObject;
    summary: string;
    relevanceScore: Prisma.Decimal;
    generatedAt: Date;
  };
};

describe('ActivationOnboardingService', () => {
  function subject() {
    const memories = new Map<string, StoredMemory>();
    let onboardingCompleted = false;
    const events = new Map<string, { id: string }>();
    let message = {
      id: 'message-1',
      content: 'sim',
      timestamp: new Date('2026-06-23T12:00:00.000Z'),
      conversationId: 'conversation-id',
      replyToExternalMessageId: null as string | null,
    };
    const conversationMemory = {
      findUnique: jest.fn().mockImplementation(
        (input: {
          where: {
            userId_memoryType_sourceKey: {
              userId: string;
              memoryType: MemoryType;
              sourceKey: string;
            };
          };
        }) =>
          Promise.resolve(
            memories.get(memoryKey(input.where.userId_memoryType_sourceKey)) ??
              null,
          ),
      ),
      upsert: jest
        .fn()
        .mockImplementation((input: ConversationMemoryUpsertInput) => {
          const identity = input.where.userId_memoryType_sourceKey;
          const memory = {
            id: 'memory-id',
            userId: identity.userId,
            memoryType: identity.memoryType,
            sourceKey: identity.sourceKey,
            content: JSON.parse(
              JSON.stringify(input.update.content),
            ) as Prisma.JsonValue,
            summary: input.update.summary,
            relevanceScore: input.update.relevanceScore,
            generatedAt: input.update.generatedAt,
            createdAt: input.update.generatedAt,
            updatedAt: input.update.generatedAt,
          };

          memories.set(memoryKey(identity), memory);

          return Promise.resolve(memory);
        }),
    };
    const transaction = {
      evolutionInboundEvent: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      conversationMemory,
      outboxEvent: {
        findUnique: jest.fn().mockImplementation(
          (input: {
            where: {
              eventType_aggregateType_aggregateId: {
                eventType: string;
                aggregateId: string;
              };
            };
          }) =>
            Promise.resolve(
              events.get(
                input.where.eventType_aggregateType_aggregateId.eventType +
                  ':' +
                  input.where.eventType_aggregateType_aggregateId.aggregateId,
              ) ?? null,
            ),
        ),
      },
      outboundMessage: {
        // Sequential wizard cases model each previous prompt as delivered.
        findUnique: jest.fn().mockResolvedValue({ status: 'SENT' }),
        create: jest
          .fn()
          .mockImplementation(
            (input: { data: { content: string; sourceMessageId: string } }) =>
              Promise.resolve({
                id: `outbound:${input.data.sourceMessageId}`,
                ...input.data,
              }),
          ),
      },
      fitnessProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'fitness-profile-id' }),
        update: jest.fn().mockResolvedValue({ id: 'fitness-profile-id' }),
      },
      foodRestriction: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      nutritionProfile: {
        upsert: jest.fn().mockResolvedValue({ id: 'nutrition-profile-id' }),
      },
      userPreferences: {
        upsert: jest.fn().mockResolvedValue({ id: 'preferences-id' }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ onboardingCompleted })),
        update: jest
          .fn()
          .mockImplementation(
            (input: { data: { onboardingCompleted: boolean } }) => {
              onboardingCompleted = input.data.onboardingCompleted;
              return Promise.resolve({ id: 'user-id' });
            },
          ),
      },
      userGoalClassification: {
        upsert: jest.fn().mockResolvedValue({ id: 'goal-id' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
      conversationMemory: {
        findUnique: conversationMemory.findUnique,
        upsert: conversationMemory.upsert,
      },
      message: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(message)),
      },
      outboundMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      activationEvent: { findFirst: jest.fn().mockResolvedValue(null) },
      outboxEvent: transaction.outboxEvent,
      user: {
        findUnique: jest.fn().mockResolvedValue({
          phone: '11999999999',
          phoneE164: '+5511999999999',
        }),
      },
    };
    const evolution = {
      sendText: jest.fn().mockResolvedValue({
        externalMessageId: 'evolution-message-id',
      }),
    };
    const eventBus = {
      publish: jest
        .fn()
        .mockImplementation(
          (input: { eventType: string; aggregateId: string }) => {
            const event = { id: `event:${input.aggregateId}` };
            events.set(input.eventType + ':' + input.aggregateId, event);
            return Promise.resolve(event);
          },
        ),
    };
    const service = new ActivationOnboardingService(
      prisma as unknown as PrismaService,
      eventBus as unknown as EventBusService,
    );

    return {
      service,
      prisma,
      transaction,
      evolution,
      eventBus,
      getMemory: (
        sourceKey = ACTIVATION_ONBOARDING_SOURCE_KEY,
        memoryType: MemoryType = MemoryType.SHORT_TERM,
      ) =>
        memories.get(
          memoryKey({
            userId: 'user-id',
            memoryType,
            sourceKey,
          }),
        ) ?? null,
      setMessage: (
        id: string,
        content: string,
        quote: string | null = null,
      ) => {
        message = {
          id,
          content,
          timestamp: new Date('2026-06-23T12:00:00.000Z'),
          conversationId: 'conversation-id',
          replyToExternalMessageId: quote,
        };
      },
    };
  }

  function memoryKey(input: {
    userId: string;
    memoryType: MemoryType;
    sourceKey: string;
  }): string {
    return `${input.userId}:${input.memoryType}:${input.sourceKey}`;
  }

  async function answer(
    setup: ReturnType<typeof subject>,
    id: string,
    text: string,
  ) {
    setup.setMessage(id, text);
    return setup.service.processTextMessage({
      userId: 'user-id',
      messageId: id,
    });
  }

  async function restrictionsStep(setup: ReturnType<typeof subject>) {
    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
    });
    for (const [index, text] of [
      '32',
      '178',
      '82',
      'masculino',
      'emagrecimento',
      'moderado',
    ].entries())
      await answer(setup, `base-${index}`, text);
  }

  it('keeps sim pending, captures the named allergy and requires explicit confirmation', async () => {
    const setup = subject();
    await restrictionsStep(setup);
    await answer(setup, 'allergy-yes', 'sim');
    expect((await setup.service.get('user-id'))?.content.currentState).toBe(
      'ASK_RESTRICTIONS',
    );
    await answer(setup, 'allergy-name', 'amendoim');
    expect(
      (await setup.service.get('user-id'))?.content.answers.restrictions,
    ).toEqual([]);
    expect(setup.transaction.nutritionProfile.upsert).not.toHaveBeenCalled();
    await answer(setup, 'allergy-confirm', 'sim');
    await answer(setup, 'result', 'perder 5 kg');
    const session = await setup.service.get('user-id');
    expect(session?.content.answers.desiredResultText).toBe('perder 5 kg');
    expect(session?.content.dietary).toMatchObject({
      status: 'CONFIRMED',
      allergies: ['amendoim'],
    });
    expect(setup.transaction.nutritionProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          allergies: [{ type: 'ALLERGY', description: 'amendoim' }],
        }),
      }),
    );
  });

  it.each(['sim', 'não', 'ok', 'confirmado'])(
    'does not complete the desired result with %s after dietary confirmation, including replay',
    async (text) => {
      const setup = subject();
      await restrictionsStep(setup);
      await answer(setup, 'named-allergy', 'tenho alergia a camarão');
      await answer(setup, 'diet-confirm', 'sim');
      const before = (await setup.service.get('user-id'))?.content;
      await answer(setup, 'invalid-result', text);
      const after = (await setup.service.get('user-id'))?.content;
      expect(after).toMatchObject({
        currentState: 'ASK_DESIRED_RESULT',
        status: 'IN_PROGRESS',
        completedAt: null,
      });
      expect(after?.answers).toEqual(before?.answers);
      expect(after?.dietary).toEqual(before?.dietary);
      expect(setup.transaction.nutritionProfile.upsert).not.toHaveBeenCalled();
      const published = setup.eventBus.publish.mock.calls.length;
      await answer(setup, 'invalid-result', text);
      expect(setup.eventBus.publish.mock.calls.length).toBe(published);
    },
  );

  it.each(['quero perder 5 kg', 'quero melhorar meu condicionamento'])(
    'accepts a meaningful desired result: %s',
    async (text) => {
      const setup = subject();
      await restrictionsStep(setup);
      await answer(setup, 'none-result', 'tenho alergia a camarão');
      await answer(setup, 'confirm-result', 'sim');
      await answer(setup, 'meaningful-result', text);
      expect((await setup.service.get('user-id'))?.content).toMatchObject({
        currentState: 'PROFILE_COMPLETED',
        answers: { desiredResultText: text },
      });
    },
  );

  it.each(['não', 'não.', 'nenhuma', 'não tenho'])(
    'records explicit absence only after confirmation: %s',
    async (text) => {
      const setup = subject();
      await restrictionsStep(setup);
      await answer(setup, 'absence', text);
      expect(
        (await setup.service.get('user-id'))?.content.dietary,
      ).toMatchObject({ status: 'CONFIRMATION_PENDING', allergies: [] });
      await answer(setup, 'confirm', 'sim');
      expect(
        (await setup.service.get('user-id'))?.content.answers.restrictions,
      ).toEqual([]);
      expect(
        (await setup.service.get('user-id'))?.content.dietary
          ?.allergiesExplicit,
      ).toBe(true);
    },
  );

  it.each([
    'depois',
    'não sei',
    'quero mudar de assunto',
    'como funciona?',
    'bom dia',
  ])('does not save an interruption or ambiguous answer: %s', async (text) => {
    const setup = subject();
    await restrictionsStep(setup);
    await answer(setup, 'interrupt', text);
    expect(
      (await setup.service.get('user-id'))?.content.answers.restrictions,
    ).toEqual([]);
    expect((await setup.service.get('user-id'))?.content.currentState).toBe(
      'ASK_RESTRICTIONS',
    );
    await answer(setup, 'resume', 'tenho alergia a amendoim e camarão');
    await answer(setup, 'confirm', 'sim');
    expect(
      (await setup.service.get('user-id'))?.content.dietary?.allergies,
    ).toEqual(['amendoim', 'camarão']);
  });

  it('preserves both allergens sent in separate turns and corrects one category without losing profile data', async () => {
    const setup = subject();
    await restrictionsStep(setup);
    await answer(setup, 'a', 'amendoim');
    await answer(setup, 'b', 'camarão');
    await answer(setup, 'confirm', 'sim');
    expect(
      (await setup.service.get('user-id'))?.content.dietary?.allergies,
    ).toEqual(['amendoim', 'camarão']);
    await answer(setup, 'correction', 'corrigindo tenho alergia a ovo');
    await answer(setup, 'confirm-correction', 'sim');
    const content = (await setup.service.get('user-id'))?.content;
    expect(content?.currentState).toBe('ASK_DESIRED_RESULT');
    expect(content?.answers).toMatchObject({
      age: 32,
      heightCm: 178,
      currentWeightKg: '82.00',
    });
    expect(content?.dietary?.allergies).toEqual(['ovo']);
  });

  it('does not infer allergy absence from an intolerance or preference declaration', async () => {
    const setup = subject();
    await restrictionsStep(setup);
    await answer(
      setup,
      'intolerance',
      'tenho intolerância à lactose, não gosto de peixe',
    );
    await answer(setup, 'confirm', 'sim');
    await answer(setup, 'result', 'perder 5 kg');
    expect((await setup.service.get('user-id'))?.content.dietary).toMatchObject(
      {
        allergiesExplicit: false,
        allergies: [],
        intolerances: ['LACTOSE'],
        avoidedFoods: ['peixe'],
      },
    );
    expect(
      setup.getMemory(
        ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY,
        MemoryType.LONG_TERM,
      )?.content,
    ).toMatchObject({ allergiesConfirmed: false });
  });

  it('confirms a correction after completion, preserves other categories and refreshes without reusing the original event', async () => {
    const setup = subject();
    await restrictionsStep(setup);
    await answer(
      setup,
      'dietary',
      'tenho alergia a amendoim, tenho intolerância à lactose, não gosto de peixe',
    );
    await answer(setup, 'confirm', 'sim');
    await answer(setup, 'result', 'perder 5 kg');
    await answer(setup, 'correction', 'corrigindo não tenho alergias');
    await answer(setup, 'confirm-correction', 'sim');
    expect((await setup.service.get('user-id'))?.content).toMatchObject({
      currentState: 'PROFILE_COMPLETED',
      dietary: {
        allergies: [],
        intolerances: ['LACTOSE'],
        avoidedFoods: ['peixe'],
        status: 'CONFIRMED',
      },
      answers: { age: 32, heightCm: 178, desiredResultText: 'perder 5 kg' },
    });
    expect(setup.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: expect.stringContaining(':correction:confirm-correction'),
      }),
      setup.transaction,
    );
  });

  it('normalizes a historical session without assuming that an empty array confirms absence', async () => {
    const setup = subject();
    await restrictionsStep(setup);
    const session = await setup.service.get('user-id');
    if (!session) throw new Error('Fixture missing');
    delete session.content.dietary;
    session.content.currentState = 'ASK_DESIRED_RESULT';
    await setup.service.persist({
      userId: 'user-id',
      content: session.content,
    });
    await answer(setup, 'desired', 'perder 5 kg');
    expect((await setup.service.get('user-id'))?.content.currentState).toBe(
      'ASK_RESTRICTIONS',
    );
    expect(setup.transaction.nutritionProfile.upsert).not.toHaveBeenCalled();
    await answer(setup, 'none', 'não.');
    await answer(setup, 'confirm', 'sim');
    expect((await setup.service.get('user-id'))?.content.currentState).toBe(
      'PROFILE_COMPLETED',
    );
    expect(
      (await setup.service.get('user-id'))?.content.answers.desiredResultText,
    ).toBe('perder 5 kg');
  });

  it('commits state and dispatch intent together and replay does not transition twice', async () => {
    const setup = subject();
    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
    });
    await answer(setup, 'age', '28');
    const first = (await setup.service.get('user-id'))?.content;
    const result = await answer(setup, 'age', '28');
    expect(result.duplicated).toBe(true);
    expect((await setup.service.get('user-id'))?.content).toEqual(first);
    expect(setup.transaction.outboundMessage.create).toHaveBeenCalledTimes(1);
    expect(setup.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: INTERNAL_EVENT.ACTIVATION_ONBOARDING_RESPONSE_REQUESTED,
      }),
      setup.transaction,
    );
    expect(setup.evolution.sendText).not.toHaveBeenCalled();
  });

  it('does not advance to a new answer while the previous prompt is pending or failed', async () => {
    const setup = subject();
    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
    });
    await answer(setup, 'age', '28');
    setup.transaction.outboundMessage.findUnique.mockResolvedValue({
      status: 'FAILED',
    });
    await expect(answer(setup, 'height', '178')).rejects.toThrow(
      'Entrega pendente',
    );
    expect(
      (await setup.service.get('user-id'))?.content.answers.heightCm,
    ).toBeNull();
    setup.transaction.outboundMessage.findUnique.mockResolvedValue({
      status: 'SENT',
    });
    await answer(setup, 'height', '178');
    expect((await setup.service.get('user-id'))?.content.answers.heightCm).toBe(
      178,
    );
  });

  it.each([
    ['Quero minha dieta agora', 'completar seu perfil'],
    ['Pode montar meu treino?', 'completar seu perfil'],
    ['Como funciona?', 'recursos disponíveis'],
    ['Quero corrigir minha idade', 'idade correta'],
    ['Tenho uma dúvida', 'Pode me contar'],
    ['Estou com dor no peito', 'serviço de urgência'],
  ])(
    'durably handles the integrated interruption %s without generation or changing the pending step',
    async (text, expected) => {
      const setup = subject();
      await setup.service.start({
        userId: 'user-id',
        activationId: 'activation-id',
      });
      const before = (await setup.service.get('user-id'))?.content;
      const registry = new EventHandlerRegistry();
      const coach = {
        processReadOnlyText: jest.fn(),
        processCanonicalContinuation: jest.fn(),
        processTextMessage: jest.fn(),
      };
      const args = [
        registry,
        {},
        {},
        {},
        {},
        {},
        {},
        coach,
        {},
        {},
        setup.service,
        {},
        { authorizeOrNotify: () => Promise.resolve(true) },
      ] as const;
      new IntegrationEventHandlersService(
        ...(args as unknown as ConstructorParameters<
          typeof IntegrationEventHandlersService
        >),
      ).onModuleInit();
      setup.setMessage('interrupt', text);
      const handler = registry.get(
        INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
      );
      if (!handler) throw new Error('Handler missing');
      const event = {
        payload: { userId: 'user-id', messageId: 'interrupt' },
        createdAt: new Date(),
      } as unknown as OutboxEvent;
      await handler(event);
      await handler(event);
      const after = (await setup.service.get('user-id'))?.content;
      expect(after?.answers).toEqual(before?.answers);
      expect(after?.currentState).toBe(before?.currentState);
      expect(after?.lastProcessedMessageId).toBe(
        before?.lastProcessedMessageId,
      );
      expect(setup.transaction.outboundMessage.create).toHaveBeenCalledTimes(1);
      expect(setup.transaction.outboundMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining(expected),
          }),
        }),
      );
      expect(coach.processReadOnlyText).not.toHaveBeenCalled();
      expect(coach.processCanonicalContinuation).not.toHaveBeenCalled();
      expect(coach.processTextMessage).not.toHaveBeenCalled();
    },
  );

  it('repairs a falsely PROCESSED prompt before deferring the waiting answer', async () => {
    const setup = subject();
    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
    });
    await answer(setup, 'age', '28');
    setup.transaction.outboundMessage.findUnique.mockResolvedValue({
      status: 'SENDING',
    });
    setup.transaction.outboxEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'dependency', status: 'PROCESSED' });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    Object.assign(setup.transaction.outboxEvent, { updateMany });
    await expect(answer(setup, 'height', '178')).rejects.toBeInstanceOf(
      DeliveryPendingError,
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dependency', status: 'PROCESSED' },
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
    expect(
      (await setup.service.get('user-id'))?.content.answers.heightCm,
    ).toBeNull();
  });

  it('signals the exact dead-letter dependency without advancing or bypassing its retries', async () => {
    const setup = subject();
    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
    });
    await answer(setup, 'age', '28');
    setup.transaction.outboundMessage.findUnique.mockResolvedValue({
      status: 'FAILED',
    });
    setup.transaction.outboxEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'dead-delivery', status: 'DEAD_LETTER' });
    await expect(answer(setup, 'height', '178')).rejects.toThrow(
      'recuperação operacional: dead-delivery',
    );
    expect(
      (await setup.service.get('user-id'))?.content.answers.heightCm,
    ).toBeNull();
  });

  it('recovers a failed durable send through the real handler without advancing again', async () => {
    const setup = subject();
    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
    });
    await answer(setup, 'age', '28');
    const pending =
      await setup.transaction.outboundMessage.create.mock.results[0].value;
    const current = {
      ...pending,
      userId: 'user-id',
      conversationId: 'conversation-id',
      status: OutboundMessageStatus.PENDING,
      leaseExpiresAt: null as Date | null,
      externalMessageId: null as string | null,
      conversation: {
        id: 'conversation-id',
        phoneNumber: 'fixture-number',
        remoteJid: null,
      },
    };
    const outbound = {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(current)),
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(() => Promise.resolve(current)),
      update: jest
        .fn()
        .mockImplementation(
          (input: {
            data: { status: OutboundMessageStatus; leaseExpiresAt: Date };
          }) => {
            Object.assign(current, input.data);
            return Promise.resolve(current);
          },
        ),
      updateMany: jest.fn().mockImplementation(
        (input: {
          data: {
            status: OutboundMessageStatus;
            externalMessageId?: string;
            leaseExpiresAt: Date | null;
          };
        }) => {
          Object.assign(current, input.data);
          return Promise.resolve({ count: 1 });
        },
      ),
    };
    const sendTransaction = {
      outboundMessage: outbound,
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const db = {
      outboundMessage: outbound,
      $transaction: jest.fn(
        (operation: (tx: typeof sendTransaction) => unknown) =>
          operation(sendTransaction),
      ),
    };
    const gateway = {
      sendText: jest
        .fn()
        .mockRejectedValueOnce(
          new Error('simulated lost ACK or transport failure'),
        )
        .mockResolvedValue({ externalMessageId: 'fixture-ack' }),
    };
    const sender = new EvolutionSendService(
      db as unknown as PrismaService,
      gateway as unknown as EvolutionGateway,
      {
        requireAccessInTransaction: jest.fn().mockResolvedValue({}),
      } as unknown as SubscriptionAccessService,
      { get: jest.fn().mockReturnValue('60') } as unknown as ConfigService,
    );
    const registry = new EventHandlerRegistry();
    const args = [
      registry,
      {},
      {},
      {},
      {},
      {},
      sender,
      {},
      {},
      {},
      setup.service,
      {},
      {},
    ] as const;
    new IntegrationEventHandlersService(
      ...(args as unknown as ConstructorParameters<
        typeof IntegrationEventHandlersService
      >),
    ).onModuleInit();
    const handler = registry.get(
      INTERNAL_EVENT.ACTIVATION_ONBOARDING_RESPONSE_REQUESTED,
    );
    if (!handler) throw new Error('Handler missing');
    const event = {
      payload: { outboundMessageId: pending.id },
    } as unknown as OutboxEvent;
    await expect(handler(event)).rejects.toThrow('simulated');
    expect(current.status).toBe('FAILED');
    await answer(setup, 'age', '28');
    expect(setup.transaction.outboundMessage.create).toHaveBeenCalledTimes(1);
    await handler(event);
    expect(current.status).toBe('SENT');
    expect(current.externalMessageId).toBe('fixture-ack');
    await handler(event);
    expect(gateway.sendText).toHaveBeenCalledTimes(2);
    expect((await setup.service.get('user-id'))?.content.currentState).toBe(
      'ASK_HEIGHT',
    );
  });

  it('corrects an explicitly named earlier physical field without advancing the current question', async () => {
    const setup = subject();
    await restrictionsStep(setup);
    await answer(setup, 'correct-age', 'corrigindo tenho 28 anos');
    const content = (await setup.service.get('user-id'))?.content;
    expect(content?.currentState).toBe('ASK_RESTRICTIONS');
    expect(content?.answers).toMatchObject({
      age: 28,
      heightCm: 178,
      currentWeightKg: '82.00',
    });
  });

  it('does not interpret an older out-of-order age message as the pending height', async () => {
    const setup = subject();
    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
    });
    setup.setMessage('age', '28');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'age',
      receivedAt: new Date('2026-10-13T12:01:00Z'),
    });
    setup.setMessage('late', '32');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'late',
      receivedAt: new Date('2026-10-13T12:00:00Z'),
    });
    const session = (await setup.service.get('user-id'))?.content;
    expect(session?.answers.age).toBe(28);
    expect(session?.answers.heightCm).toBeNull();
    expect(session?.lastProcessedMessageId).toBe('age');
    expect(setup.transaction.outboundMessage.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('mensagem anterior'),
        }),
      }),
    );
  });

  it('does not silently replace other categories after rejection of an allergy correction', async () => {
    const setup = subject();
    await restrictionsStep(setup);
    await answer(
      setup,
      'initial',
      'tenho alergia a amendoim, tenho intolerância à lactose',
    );
    await answer(setup, 'confirm', 'sim');
    await answer(setup, 'correction', 'corrigindo tenho alergia a ovo');
    await answer(setup, 'reject', 'não');
    await answer(setup, 'replacement', 'tenho alergia a camarão');
    await answer(setup, 'confirm-replacement', 'sim');
    expect((await setup.service.get('user-id'))?.content.dietary).toMatchObject(
      { allergies: ['camarão'], intolerances: ['LACTOSE'] },
    );
  });

  it.each([false, true])(
    'distinguishes a foreign quoted prompt from the actual D0: %s',
    async (owned) => {
      const setup = subject();
      await setup.service.start({
        userId: 'user-id',
        activationId: 'activation-id',
      });
      setup.prisma.activationEvent.findFirst.mockResolvedValue(
        owned ? { id: 'welcome' } : null,
      );
      setup.setMessage('quoted', 'tenho 28 anos', 'quoted-prompt');
      const result = await setup.service.processActiveTextMessage({
        userId: 'user-id',
        messageId: 'quoted',
      });
      expect(result.handled).toBe(owned);
      expect(setup.transaction.outboundMessage.create).toHaveBeenCalledTimes(
        owned ? 1 : 0,
      );
    },
  );

  it.each(['absent', 'completed', 'ineligible'])(
    'preserves the appropriate downstream owner or access denial: %s',
    async (mode) => {
      const setup = subject();
      if (mode !== 'absent')
        await setup.service.start({
          userId: 'user-id',
          activationId: 'activation-id',
        });
      if (mode === 'completed')
        await setup.service.complete({ userId: 'user-id' });
      const registry = new EventHandlerRegistry();
      const coach = {
        processCanonicalContinuation: jest.fn().mockResolvedValue(false),
        processReadOnlyText: jest.fn().mockResolvedValue(false),
        processUncorrelatedShortReply: jest.fn().mockResolvedValue(false),
        processTextMessage: jest.fn().mockResolvedValue({ handled: true }),
      };
      const acquisition = {
        captureActiveResponse: jest
          .fn()
          .mockResolvedValue({ handled: mode === 'completed' }),
      };
      const lifecycle = {
        authorizeOrNotify: jest.fn().mockResolvedValue(mode !== 'ineligible'),
      };
      const args = [
        registry,
        {},
        {},
        {},
        {},
        {},
        {},
        coach,
        {},
        {},
        setup.service,
        acquisition,
        lifecycle,
      ] as const;
      new IntegrationEventHandlersService(
        ...(args as unknown as ConstructorParameters<
          typeof IntegrationEventHandlersService
        >),
      ).onModuleInit();
      const handler = registry.get(
        INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
      );
      if (!handler) throw new Error('Handler missing');
      setup.setMessage('fallback', 'sim');
      await handler({
        payload: { userId: 'user-id', messageId: 'fallback' },
        createdAt: new Date(),
      } as unknown as OutboxEvent);
      expect(setup.transaction.outboundMessage.create).not.toHaveBeenCalled();
      if (mode === 'absent')
        expect(coach.processTextMessage).toHaveBeenCalledTimes(1);
      if (mode === 'completed')
        expect(acquisition.captureActiveResponse).toHaveBeenCalledTimes(1);
      if (mode === 'ineligible') {
        expect(acquisition.captureActiveResponse).not.toHaveBeenCalled();
        expect(coach.processCanonicalContinuation).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['BASIC:basic-v2', 'PREMIUM:legacy-v1', 'BASIC:legacy-v1'])(
    'completes D0 through the real handler without short-reply interception: %s',
    async (contract) => {
      const setup = subject();
      const registry = new EventHandlerRegistry();
      const coach = {
        processCanonicalContinuation: jest.fn().mockResolvedValue(true),
        processReadOnlyText: jest.fn(),
        processUncorrelatedShortReply: jest.fn(),
        processTextMessage: jest.fn(),
      };
      const acquisition = {
        captureActiveResponse: jest.fn().mockResolvedValue({ handled: false }),
      };
      const [type, contractVersion] = contract.split(':');
      const access = new SubscriptionAccessService({
        subscription: {
          findFirst: jest.fn().mockResolvedValue({
            userId: 'user-id',
            status: 'ACTIVE',
            plan: { isActive: true, type, contractVersion },
            currentPeriodEnd: new Date('2099-01-01'),
            endedAt: null,
            cancelAtPeriodEnd: false,
          }),
        },
      } as unknown as PrismaService);
      const lifecycle = {
        authorizeOrNotify: jest.fn(async () => {
          await access.requireAccess('user-id');
          return true;
        }),
      };
      const args = [
        registry,
        {},
        {},
        {},
        {},
        {},
        {},
        coach,
        {},
        {},
        setup.service,
        acquisition,
        lifecycle,
      ] as const;
      const handlers = new IntegrationEventHandlersService(
        ...(args as unknown as ConstructorParameters<
          typeof IntegrationEventHandlersService
        >),
      );
      handlers.onModuleInit();
      const handler = registry.get(
        INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
      );
      if (!handler) throw new Error('Handler missing');
      await setup.service.start({
        userId: 'user-id',
        activationId: 'activation-id',
      });
      for (const [index, text] of [
        'sim',
        'tenho 28 anos',
        '178',
        '82',
        'masculino',
        'emagrecimento',
        'moderado',
        'não.',
        'sim',
        'perder 5 kg',
      ].entries()) {
        const id = `turn-${index}`;
        setup.setMessage(id, text);
        await handler({
          payload: { userId: 'user-id', messageId: id },
          createdAt: new Date(),
        } as unknown as OutboxEvent);
      }
      expect((await setup.service.get('user-id'))?.content.currentState).toBe(
        'PROFILE_COMPLETED',
      );
      expect(coach.processUncorrelatedShortReply).not.toHaveBeenCalled();
      expect(acquisition.captureActiveResponse).not.toHaveBeenCalled();
      expect(coach.processCanonicalContinuation).not.toHaveBeenCalled();
    },
  );

  it('starts from a positive reply and advances through all text states', async () => {
    const setup = subject();

    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
      userFirstName: 'Maria Silva',
      startedAt: new Date('2026-06-23T11:59:00.000Z'),
    });

    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-1',
    });
    setup.setMessage('message-2', 'Tenho 32 anos');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-2',
    });
    setup.setMessage('message-3', '1,78');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-3',
    });
    setup.setMessage('message-4', '82,5kg');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-4',
    });
    setup.setMessage('message-5', 'Masculino');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-5',
    });
    setup.setMessage('message-6', 'Emagrecimento');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-6',
    });
    setup.setMessage('message-7', 'Moderado');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-7',
    });
    setup.setMessage('message-8', 'lactose');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-8',
    });
    setup.setMessage('confirm-restrictions', 'sim');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'confirm-restrictions',
    });
    setup.setMessage('message-9', 'perder 10 kg');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-9',
    });

    const session = await setup.service.get('user-id');

    expect(session?.sourceKey).toBe(ACTIVATION_ONBOARDING_SOURCE_KEY);
    expect(session?.content.currentState).toBe(
      ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED,
    );
    expect(session?.content.answers).toEqual(
      expect.objectContaining({
        age: 32,
        birthDate: '1994-06-23',
        heightCm: 178,
        currentWeightKg: '82.50',
        gender: 'MALE',
        commercialGoal: 'WEIGHT_LOSS',
        fitnessGoal: 'WEIGHT_LOSS',
        activityLevel: 'MODERATE',
        restrictions: ['lactose'],
        desiredResultText: 'perder 10 kg',
        targetWeightKg: '72.50',
      }),
    );
    expect(setup.evolution.sendText).not.toHaveBeenCalled();
    expect(setup.transaction.outboundMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conversation-id',
          responseType: 'PROFILE_ACQUISITION',
        }),
      }),
    );
    expect(setup.transaction.fitnessProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-id',
          heightCm: 178,
          goal: 'WEIGHT_LOSS',
          activityLevel: 'MODERATE',
        }),
      }),
    );
    expect(setup.transaction.nutritionProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-id' },
        create: expect.objectContaining({
          userId: 'user-id',
          heightCm: 178,
          goal: 'WEIGHT_LOSS',
        }),
      }),
    );
    expect(setup.transaction.userPreferences.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-id' },
        create: { userId: 'user-id' },
      }),
    );
    expect(setup.transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { onboardingCompleted: true },
    });
    expect(setup.transaction.userGoalClassification.upsert).toHaveBeenCalled();
    expect(
      setup.getMemory(
        ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY,
        MemoryType.LONG_TERM,
      )?.content,
    ).toEqual(
      expect.objectContaining({
        commercialGoal: 'WEIGHT_LOSS',
        desiredResultText: 'perder 10 kg',
        restrictions: ['lactose'],
      }),
    );
    expect(setup.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_CONTEXT_REFRESH_REQUESTED',
        aggregateType: 'ONBOARDING_PROFILE',
        payload: expect.objectContaining({
          userId: 'user-id',
          fitnessProfileId: 'fitness-profile-id',
        }),
      }),
      setup.transaction,
    );
  });

  it('accepts age as the first reply without forcing confirmation', async () => {
    const setup = subject();

    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
      userFirstName: 'Maria',
      startedAt: new Date('2026-06-23T11:59:00.000Z'),
    });
    setup.setMessage('message-1', '32 anos');

    const result = await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-1',
    });
    const session = await setup.service.get('user-id');

    expect(result.state).toBe(ACTIVATION_ONBOARDING_STATE.ASK_HEIGHT);
    expect(session?.content.answers.age).toBe(32);
  });

  it('understands natural language answers with accents and casing', async () => {
    const setup = subject();

    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
      userFirstName: 'Maria',
      startedAt: new Date('2026-06-23T11:59:00.000Z'),
    });

    setup.setMessage('message-1', 'BORA');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-1',
    });
    setup.setMessage('message-2', 'Tenho 32 anos');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-2',
    });
    setup.setMessage('message-3', '178cm');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-3',
    });
    setup.setMessage('message-4', '82.5 KG');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-4',
    });
    setup.setMessage('message-5', 'sou homem');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-5',
    });
    setup.setMessage('message-6', 'Quero perder barriga e reduzir medidas');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-6',
    });
    setup.setMessage('message-7', 'treino 3 vezes por semana');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-7',
    });
    setup.setMessage(
      'message-8',
      'tenho intolerância à lactose, não gosto de peixe',
    );
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-8',
    });
    setup.setMessage('message-9', 'perder 5 quilos');
    setup.setMessage('confirm-restrictions', 'sim');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'confirm-restrictions',
    });
    setup.setMessage('message-9', 'perder 5 quilos');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-9',
    });

    const session = await setup.service.get('user-id');

    expect(session?.content.currentState).toBe(
      ACTIVATION_ONBOARDING_STATE.PROFILE_COMPLETED,
    );
    expect(session?.content.answers).toEqual(
      expect.objectContaining({
        commercialGoal: 'WEIGHT_LOSS',
        fitnessGoal: 'WEIGHT_LOSS',
        activityLevel: 'MODERATE',
        restrictions: ['tenho intolerância à lactose', 'não gosto de peixe'],
        desiredResultText: 'perder 5 quilos',
        targetWeightKg: '77.50',
      }),
    );
  });

  it('reconciles the latest explicit desired-result goal before projection', async () => {
    const setup = subject();
    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
      userFirstName: 'Maria',
      startedAt: new Date('2026-06-23T11:59:00.000Z'),
    });
    const answers = [
      '32',
      '1,78',
      '82',
      'FEMININO',
      'Definição',
      'moderado',
      'nenhuma',
      'sim',
      'Ganhar massa muscular',
    ];
    for (const [index, content] of answers.entries()) {
      const messageId = `goal-reconciliation-${index}`;
      setup.setMessage(messageId, content);
      await setup.service.processTextMessage({ userId: 'user-id', messageId });
    }

    const session = await setup.service.get('user-id');
    expect(session?.content.answers).toEqual(
      expect.objectContaining({
        commercialGoal: 'MUSCLE_GAIN',
        fitnessGoal: 'MUSCLE_GAIN',
        desiredResultText: 'Ganhar massa muscular',
        targetWeightSource: 'ESTIMATED_FROM_GOAL',
      }),
    );
    expect(setup.transaction.fitnessProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ goal: 'MUSCLE_GAIN' }),
      }),
    );
    expect(setup.transaction.nutritionProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ goal: 'MUSCLE_GAIN' }),
      }),
    );
    expect(
      setup.transaction.userGoalClassification.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ goal: 'HYPERTROPHY' }),
      }),
    );
  });

  it.each([
    ['preciso emagrecer e perder gordura', 'WEIGHT_LOSS', 'WEIGHT_LOSS'],
    ['quero ganhar músculos e crescer', 'MUSCLE_GAIN', 'MUSCLE_GAIN'],
    ['quero ficar definido', 'BODY_DEFINITION', 'MAINTENANCE'],
    ['quero mais disposição e viver melhor', 'HEALTH', 'MAINTENANCE'],
    [
      'quero correr melhor e melhorar rendimento',
      'SPORTS_PERFORMANCE',
      'MAINTENANCE',
    ],
  ])(
    'maps free-form goal "%s"',
    async (goalText, commercialGoal, fitnessGoal) => {
      const setup = subject();

      await setup.service.start({
        userId: 'user-id',
        activationId: 'activation-id',
        userFirstName: 'Maria',
        startedAt: new Date('2026-06-23T11:59:00.000Z'),
      });

      setup.setMessage('message-1', '32');
      await setup.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-1',
      });
      setup.setMessage('message-2', '1,78');
      await setup.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-2',
      });
      setup.setMessage('message-3', '82');
      await setup.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-3',
      });
      setup.setMessage('message-4', 'FEMININO');
      await setup.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-4',
      });
      setup.setMessage('message-5', goalText);
      await setup.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-5',
      });

      const session = await setup.service.get('user-id');

      expect(session?.content.currentState).toBe(
        ACTIVATION_ONBOARDING_STATE.ASK_ACTIVITY_LEVEL,
      );
      expect(session?.content.answers.commercialGoal).toBe(commercialGoal);
      expect(session?.content.answers.fitnessGoal).toBe(fitnessGoal);
    },
  );

  it.each([
    ['não treino', 'SEDENTARY'],
    ['quase não faço exercícios', 'SEDENTARY'],
    ['treino às vezes', 'LIGHT'],
    ['treino todos os dias', 'HIGH'],
    ['sou atleta', 'ATHLETE'],
  ])('maps natural activity "%s"', async (activityText, activityLevel) => {
    const setup = subject();

    await setup.service.start({
      userId: 'user-id',
      activationId: 'activation-id',
      userFirstName: 'Maria',
      startedAt: new Date('2026-06-23T11:59:00.000Z'),
    });

    setup.setMessage('message-1', '32');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-1',
    });
    setup.setMessage('message-2', '178');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-2',
    });
    setup.setMessage('message-3', '82');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-3',
    });
    setup.setMessage('message-4', 'mulher');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-4',
    });
    setup.setMessage('message-5', 'saúde');
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-5',
    });
    setup.setMessage('message-6', activityText);
    await setup.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-6',
    });

    const session = await setup.service.get('user-id');

    expect(session?.content.currentState).toBe(
      ACTIVATION_ONBOARDING_STATE.ASK_RESTRICTIONS,
    );
    expect(session?.content.answers.activityLevel).toBe(activityLevel);
  });
});
