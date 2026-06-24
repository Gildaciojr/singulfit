import { MemoryType, Prisma } from '@prisma/client';
import { EventBusService } from '../event-bus/event-bus.service';
import { EvolutionGateway } from '../evolution/evolution.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY,
  ACTIVATION_ONBOARDING_SOURCE_KEY,
  ACTIVATION_ONBOARDING_STATE,
} from './activation-onboarding.constants';
import { ActivationOnboardingService } from './activation-onboarding.service';

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
    let message = {
      id: 'message-1',
      content: 'sim',
      timestamp: new Date('2026-06-23T12:00:00.000Z'),
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
            content: input.update.content,
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
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      conversationMemory,
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
        update: jest.fn().mockResolvedValue({ id: 'user-id' }),
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
      publish: jest.fn().mockResolvedValue({
        id: 'outbox-id',
      }),
    };
    const service = new ActivationOnboardingService(
      prisma as unknown as PrismaService,
      evolution as unknown as EvolutionGateway,
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
        memoryType = MemoryType.SHORT_TERM,
      ) =>
        memories.get(
          memoryKey({
            userId: 'user-id',
            memoryType,
            sourceKey,
          }),
        ) ?? null,
      setMessage: (id: string, content: string) => {
        message = {
          id,
          content,
          timestamp: new Date('2026-06-23T12:00:00.000Z'),
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
    expect(setup.evolution.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '+5511999999999',
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
