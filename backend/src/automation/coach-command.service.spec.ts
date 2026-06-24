import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ScheduledMessageStatus } from '@prisma/client';
import { DietGeneratorService } from '../diet/diet-generator.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutGeneratorService } from '../workout/workout-generator.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';
import { CoachCommandService } from './coach-command.service';

describe('CoachCommandService', () => {
  function dietPlan(): Parameters<CoachCommandService['formatDiet']>[0] {
    return {
      id: 'diet-id',
      userId: 'user-id',
      profileId: 'profile-id',
      aiJobId: 'ai-job-id',
      title: 'Plano alimentar brasileiro',
      objective: 'WEIGHT_LOSS',
      dailyCaloriesTarget: new Prisma.Decimal('1800'),
      proteinTarget: new Prisma.Decimal('140'),
      carbsTarget: new Prisma.Decimal('180'),
      fatTarget: new Prisma.Decimal('60'),
      status: 'ACTIVE',
      generatedAt: new Date('2026-06-10T12:00:00.000Z'),
      createdAt: new Date('2026-06-10T12:00:00.000Z'),
      updatedAt: new Date('2026-06-10T12:00:00.000Z'),
      meals: [
        {
          id: 'meal-id',
          dietPlanId: 'diet-id',
          name: 'Café da manhã',
          order: 1,
          caloriesTarget: new Prisma.Decimal('430'),
          notes: 'Priorize proteína.',
          items: [
            {
              id: 'item-id',
              dietMealId: 'meal-id',
              foodName: 'Ovos',
              quantity: '2 unidades',
              calories: new Prisma.Decimal('140'),
              protein: new Prisma.Decimal('12'),
              carbs: new Prisma.Decimal('1'),
              fat: new Prisma.Decimal('10'),
              substitutionGroup: 'proteína',
            },
          ],
        },
      ],
      aiJob: {
        usage: [],
      },
    } as unknown as Parameters<CoachCommandService['formatDiet']>[0];
  }

  function workoutPlan(): Parameters<CoachCommandService['formatWorkout']>[0] {
    return {
      id: 'workout-id',
      userId: 'user-id',
      profileId: 'profile-id',
      aiJobId: 'ai-job-id',
      title: 'Treino inicial',
      objective: 'MUSCLE_GAIN',
      status: 'ACTIVE',
      generatedAt: new Date('2026-06-10T12:00:00.000Z'),
      createdAt: new Date('2026-06-10T12:00:00.000Z'),
      updatedAt: new Date('2026-06-10T12:00:00.000Z'),
      days: [
        {
          id: 'day-id',
          workoutPlanId: 'workout-id',
          dayNumber: 1,
          title: 'Força geral',
          exercises: [
            {
              id: 'exercise-id',
              workoutDayId: 'day-id',
              exerciseName: 'Agachamento',
              sets: 3,
              reps: '10',
              restSeconds: 90,
              notes: null,
            },
          ],
        },
      ],
    } as unknown as Parameters<CoachCommandService['formatWorkout']>[0];
  }

  function createSubject(options?: {
    content?: string;
    onboardingCompleted?: boolean;
    existingContent?: string | null;
    dietFailure?: Error;
    workoutFailure?: Error;
  }) {
    const at = new Date('2026-06-10T12:00:00.000Z');
    const rule = {
      id: 'rule-id',
      code: AUTOMATION_RULE_CODES.DAILY_COACH,
      name: 'Coach diário',
      enabled: true,
    };
    const scheduledMessage = {
      id: 'scheduled-id',
      userId: 'user-id',
      automationRuleId: rule.id,
      scheduledFor: at,
      status: ScheduledMessageStatus.PENDING,
      content: 'Resposta',
      attempts: 0,
      leaseExpiresAt: null,
      createdAt: at,
      automationRule: rule,
    };
    const transaction = {
      scheduledMessage: {
        upsert: jest.fn().mockResolvedValue(scheduledMessage),
      },
    };
    const prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message-id',
          content: options?.content ?? 'quero uma dieta',
          timestamp: at,
          conversation: {
            user: {
              onboardingCompleted: options?.onboardingCompleted ?? true,
            },
          },
        }),
      },
      coachMessage: {
        findUnique: jest.fn().mockResolvedValue(
          options?.existingContent
            ? {
                id: 'coach-message-id',
                content: options.existingContent,
              }
            : null,
        ),
        create: jest.fn().mockResolvedValue({
          id: 'coach-message-id',
        }),
      },
      automationRule: {
        findUnique: jest.fn().mockResolvedValue(rule),
      },
      userAutomationPreference: {
        upsert: jest.fn().mockResolvedValue({
          id: 'preference-id',
        }),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const dietGenerator = {
      generate: options?.dietFailure
        ? jest.fn().mockRejectedValue(options.dietFailure)
        : jest.fn().mockResolvedValue(dietPlan()),
    };
    const workoutGenerator = {
      generate: options?.workoutFailure
        ? jest.fn().mockRejectedValue(options.workoutFailure)
        : jest.fn().mockResolvedValue(workoutPlan()),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({
        id: 'outbox-id',
      }),
    };
    const service = new CoachCommandService(
      prisma as unknown as PrismaService,
      dietGenerator as unknown as DietGeneratorService,
      workoutGenerator as unknown as WorkoutGeneratorService,
      eventBus as unknown as EventBusService,
    );

    return {
      service,
      prisma,
      transaction,
      dietGenerator,
      workoutGenerator,
      eventBus,
    };
  }

  it.each([
    ['quero uma dieta', 'DIET'],
    ['Me ajuda com alimentação', 'DIET'],
    ['monte meu treino', 'WORKOUT'],
    ['quero treinar na academia', 'WORKOUT'],
    ['quero os dois', 'BOTH'],
    ['dieta e treino', 'BOTH'],
    ['olá', 'UNKNOWN'],
  ] as const)('classifies "%s" as %s', (text, intent) => {
    const subject = createSubject();

    expect(subject.service.classify(text)).toBe(intent);
  });

  it('generates and schedules a diet command response', async () => {
    const subject = createSubject({ content: 'quero uma dieta' });

    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        handled: true,
        duplicated: false,
        intent: 'DIET',
      }),
    );
    expect(subject.dietGenerator.generate).toHaveBeenCalledWith('user-id');
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'user-id:WHATSAPP_COACH_COMMAND:message-id',
          content: expect.stringContaining('Plano alimentar'),
        }),
      }),
    );
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'AUTOMATION_TRIGGERED',
        payload: expect.objectContaining({
          source: 'WHATSAPP_COACH_COMMAND',
          sourceMessageId: 'message-id',
        }),
      }),
      subject.transaction,
    );
  });

  it('generates and schedules a workout command response', async () => {
    const subject = createSubject({ content: 'monte meu treino' });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.workoutGenerator.generate).toHaveBeenCalledWith('user-id');
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('Plano de treino'),
        }),
      }),
    );
  });

  it('generates both plans for a combined command', async () => {
    const subject = createSubject({ content: 'quero os dois' });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.dietGenerator.generate).toHaveBeenCalledWith('user-id');
    expect(subject.workoutGenerator.generate).toHaveBeenCalledWith('user-id');
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('Plano alimentar'),
        }),
      }),
    );
  });

  it('responds with a menu for unknown commands', async () => {
    const subject = createSubject({ content: 'oi' });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('Escolha uma opção'),
        }),
      }),
    );
  });

  it('does not process commands before onboarding is completed', async () => {
    const subject = createSubject({ onboardingCompleted: false });

    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        handled: false,
        reason: 'ONBOARDING_NOT_COMPLETED',
      }),
    );
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
  });

  it('keeps idempotency by messageId for repeated events', async () => {
    const subject = createSubject({ existingContent: 'Resposta existente' });

    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        handled: true,
        duplicated: true,
      }),
    );
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).not.toHaveBeenCalled();
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          content: 'Resposta existente',
        }),
      }),
    );
  });

  it('sends a profile guidance message when the user has no profile', async () => {
    const subject = createSubject({
      dietFailure: new NotFoundException(
        'Complete o perfil fitness antes de gerar uma dieta',
      ),
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('perfil completo'),
        }),
      }),
    );
  });

  it('sends an access guidance message when subscription is inactive', async () => {
    const subject = createSubject({
      dietFailure: new ForbiddenException('Assinatura expirada'),
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('assinatura precisa estar ativa'),
        }),
      }),
    );
  });

  it('sends a safe failure message when OpenAI fails', async () => {
    const subject = createSubject({
      dietFailure: new BadGatewayException('OpenAI retornou JSON inválido'),
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('falha ao gerar'),
        }),
      }),
    );
  });

  it('formats diet and workout plans for WhatsApp', () => {
    const subject = createSubject();

    expect(subject.service.formatDiet(dietPlan())).toContain(
      'Refeições principais',
    );
    expect(subject.service.formatWorkout(workoutPlan())).toContain(
      'Divisão semanal',
    );
  });
});
