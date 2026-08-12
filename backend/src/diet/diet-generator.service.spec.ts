import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import {
  ActivityLevel,
  AIJobStatus,
  AIJobType,
  DietPlanStatus,
  FitnessGoal,
  Gender,
  Prisma,
  WorkoutStatus,
} from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { DIET_PROMPT_BY_GOAL } from './diet.constants';
import { DietGeneratorService } from './diet-generator.service';
import { AuditService } from '../observability/audit.service';

describe('DietGeneratorService', () => {
  function generatedDiet(title = 'Plano brasileiro personalizado') {
    return {
      responseId: `response-${title}`,
      model: 'text-model',
      outputText: JSON.stringify({
        title,
        dailyCaloriesTarget: 1900,
        proteinTarget: 135,
        carbsTarget: 210,
        fatTarget: 58,
        meals: [
          {
            name: 'Café da manhã',
            order: 1,
            caloriesTarget: 450,
            notes: 'Consumir antes do trabalho',
            items: [
              {
                foodName: 'Tapioca com ovos',
                quantity: '1 tapioca média com 2 ovos',
                calories: 350,
                protein: 20,
                carbs: 42,
                fat: 12,
                substitutionGroup:
                  'Pode substituir por cuscuz com ovos nas mesmas porções',
              },
            ],
          },
          {
            name: 'Almoço',
            order: 2,
            caloriesTarget: 650,
            notes: null,
            items: [
              {
                foodName: 'Arroz, feijão e frango',
                quantity: '120 g, 100 g e 150 g',
                calories: 590,
                protein: 48,
                carbs: 68,
                fat: 12,
                substitutionGroup: null,
              },
            ],
          },
        ],
      }),
      promptTokens: 500,
      completionTokens: 350,
      totalTokens: 850,
    };
  }

  function createSubject(profileExists = true) {
    const profile = profileExists
      ? {
          id: 'profile-id',
          userId: 'user-id',
          gender: Gender.FEMALE,
          birthDate: new Date('1992-05-10T00:00:00.000Z'),
          heightCm: 168,
          currentWeightKg: new Prisma.Decimal('72.40'),
          targetWeightKg: new Prisma.Decimal('64.00'),
          activityLevel: ActivityLevel.MODERATE,
          goal: FitnessGoal.WEIGHT_LOSS,
          foodRestrictions: [
            {
              id: 'restriction-id',
              type: 'INTOLERANCE',
              description: 'Lactose',
            },
          ],
          bodyMeasurements: [
            {
              weightKg: new Prisma.Decimal('71.80'),
              bodyFatPercent: new Prisma.Decimal('24.50'),
              muscleMassKg: new Prisma.Decimal('28.20'),
              measuredAt: new Date('2026-06-09T12:00:00.000Z'),
            },
          ],
        }
      : null;
    const nutritionHistory = [
      {
        createdAt: new Date('2026-06-08T12:00:00.000Z'),
        analysis: {
          totalCalories: new Prisma.Decimal('620.00'),
          totalProtein: new Prisma.Decimal('42.00'),
          totalCarbs: new Prisma.Decimal('70.00'),
          totalFat: new Prisma.Decimal('18.00'),
          items: [
            {
              foodName: 'Arroz e feijão',
              estimatedGrams: new Prisma.Decimal('250.00'),
            },
          ],
        },
      },
    ];
    const progressHistory = [
      {
        weightKg: new Prisma.Decimal('71.80'),
        bodyFatPercent: new Prisma.Decimal('24.50'),
        muscleMassKg: new Prisma.Decimal('28.20'),
        bmi: new Prisma.Decimal('25.44'),
        createdAt: new Date('2026-06-09T12:00:00.000Z'),
        insights: [
          {
            insight: 'Você perdeu 1 kg nos últimos 20 dias.',
          },
        ],
      },
    ];
    const currentWorkout = {
      id: 'workout-id',
      title: 'Condicionamento atual',
      objective: FitnessGoal.WEIGHT_LOSS,
      status: WorkoutStatus.ACTIVE,
      generatedAt: new Date('2026-06-07T12:00:00.000Z'),
      days: [
        {
          dayNumber: 1,
          title: 'Treino A',
          exercises: [
            {
              id: 'exercise-id',
              exerciseName: 'Agachamento',
              sets: 3,
              reps: '10-12',
            },
          ],
        },
      ],
    };
    const persistedPlan = {
      id: 'diet-plan-id',
      title: 'Plano brasileiro personalizado',
      status: DietPlanStatus.ACTIVE,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      fitnessProfile: {
        findFirst: jest
          .fn()
          .mockResolvedValue(profile ? { goal: profile.goal } : null),
      },
      dietPlan: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(persistedPlan),
      },
      aIJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'diet-job-id',
          userId: 'user-id',
          type: AIJobType.DIET,
          status: AIJobStatus.PROCESSING,
          operationKey: null,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'diet-job-id',
          status: AIJobStatus.COMPLETED,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      fitnessProfile: {
        findUnique: jest.fn().mockResolvedValue(profile),
      },
      meal: {
        findMany: jest.fn().mockResolvedValue(nutritionHistory),
      },
      progressSnapshot: {
        findMany: jest.fn().mockResolvedValue(progressHistory),
      },
      workoutPlan: {
        findFirst: jest.fn().mockResolvedValue(currentWorkout),
      },
      aIJob: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const subscriptionsService = {
      getProfileSubscription: jest.fn().mockResolvedValue({
        status: 'ACTIVE',
      }),
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'diet-job-id',
        type: AIJobType.DIET,
        status: AIJobStatus.PENDING,
        operationKey: null,
        promptVersion: {
          id: 'prompt-id',
          prompt: 'Prompt especializado em emagrecimento e comida brasileira',
        },
      }),
      runTextJob: jest.fn().mockResolvedValue(generatedDiet()),
      completeJobInTransaction: jest.fn().mockResolvedValue({
        id: 'usage-id',
      }),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const auditService = {
      recordInTransaction: jest.fn().mockResolvedValue({
        id: 'audit-id',
      }),
    };
    const nutritionPlanOwnership = {
      acquireCanonicalLockInTransaction: jest.fn().mockResolvedValue(undefined),
      transitionInTransaction: jest.fn().mockResolvedValue({
        transition: 'CREATED',
      }),
      assertInTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DietGeneratorService(
      prisma as unknown as PrismaService,
      subscriptionsService as unknown as SubscriptionsService,
      aiService as unknown as AIService,
      auditService as unknown as AuditService,
      nutritionPlanOwnership as never,
    );

    return {
      service,
      prisma,
      transaction,
      subscriptionsService,
      aiService,
      auditService,
      nutritionPlanOwnership,
      profile,
      persistedPlan,
    };
  }

  it('uses the received transaction client without opening a nested transaction', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    subject.prisma.$transaction.mockClear();

    await expect(
      subject.service.commitCandidateInTransaction(
        subject.transaction as unknown as Prisma.TransactionClient,
        candidate,
      ),
    ).resolves.toMatchObject({ persistence: 'CREATED' });
    expect(subject.prisma.$transaction).not.toHaveBeenCalled();
    expect(
      subject.nutritionPlanOwnership.acquireCanonicalLockInTransaction,
    ).toHaveBeenCalledWith(subject.transaction, 'user-id');
  });

  it('generates a structured diet from the complete longitudinal context', async () => {
    const subject = createSubject();

    await expect(subject.service.generate('user-id')).resolves.toBe(
      subject.persistedPlan,
    );
    expect(subject.aiService.createStandaloneJob).toHaveBeenCalledWith({
      userId: 'user-id',
      type: AIJobType.DIET,
      promptName: DIET_PROMPT_BY_GOAL[FitnessGoal.WEIGHT_LOSS],
    });
    expect(subject.aiService.runTextJob).toHaveBeenCalledWith(
      'diet-job-id',
      expect.objectContaining({
        jsonSchema: expect.objectContaining({
          name: 'personalized_diet_plan',
        }),
      }),
    );
    const request = subject.aiService.runTextJob.mock.calls[0][1] as {
      input: string;
    };

    expect(JSON.parse(request.input)).toEqual(
      expect.objectContaining({
        profile: expect.objectContaining({
          currentWeightKg: 72.4,
          targetWeightKg: 64,
          goal: FitnessGoal.WEIGHT_LOSS,
        }),
        foodRestrictions: [
          {
            type: 'INTOLERANCE',
            description: 'Lactose',
          },
        ],
        nutritionHistory: [
          expect.objectContaining({
            totalCalories: 620,
            foods: [
              {
                foodName: 'Arroz e feijão',
                estimatedGrams: 250,
              },
            ],
          }),
        ],
        progress: [
          expect.objectContaining({
            insights: ['Você perdeu 1 kg nos últimos 20 dias.'],
          }),
        ],
        currentWorkout: expect.objectContaining({
          title: 'Condicionamento atual',
        }),
      }),
    );
  });

  it('reuses a completed continuation by operation key without another provider call', async () => {
    const subject = createSubject();
    subject.prisma.aIJob.findUnique.mockResolvedValue({
      userId: 'user-id',
      type: AIJobType.DIET,
      status: AIJobStatus.COMPLETED,
      dietPlan: subject.persistedPlan,
    });

    await expect(
      subject.service.generate('user-id', 'pending-continuation-key'),
    ).resolves.toBe(subject.persistedPlan);
    expect(subject.aiService.createStandaloneJob).not.toHaveBeenCalled();
    expect(subject.aiService.runTextJob).not.toHaveBeenCalled();
  });

  it('archives the previous diet and persists meals, items and AI usage atomically', async () => {
    const subject = createSubject();

    await subject.service.generate('user-id');

    expect(
      subject.nutritionPlanOwnership.acquireCanonicalLockInTransaction,
    ).toHaveBeenCalledWith(subject.transaction, 'user-id');
    expect(subject.transaction.dietPlan.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        status: DietPlanStatus.ACTIVE,
      },
      data: {
        status: DietPlanStatus.ARCHIVED,
      },
    });
    expect(subject.aiService.completeJobInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        userId: 'user-id',
        aiJobId: 'diet-job-id',
        jobType: AIJobType.DIET,
        response: expect.objectContaining({
          totalTokens: 850,
        }),
      }),
    );
    expect(subject.transaction.dietPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-id',
        profileId: 'profile-id',
        aiJobId: 'diet-job-id',
        objective: FitnessGoal.WEIGHT_LOSS,
        status: DietPlanStatus.ACTIVE,
        meals: {
          create: [
            expect.objectContaining({
              name: 'Café da manhã',
              order: 1,
              items: {
                create: [
                  expect.objectContaining({
                    foodName: 'Tapioca com ovos',
                    quantity: '1 tapioca média com 2 ovos',
                    substitutionGroup:
                      'Pode substituir por cuscuz com ovos nas mesmas porções',
                  }),
                ],
              },
            }),
            expect.objectContaining({
              name: 'Almoço',
              order: 2,
            }),
          ],
        },
      }),
      include: expect.any(Object),
    });
    expect(subject.auditService.recordInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        userId: 'user-id',
        entityId: 'diet-plan-id',
      }),
    );
  });

  it('blocks generation before OpenAI when the profile is missing', async () => {
    const subject = createSubject(false);

    await expect(subject.service.generate('user-id')).rejects.toThrow(
      'Complete o perfil fitness antes de gerar uma dieta',
    );
    expect(subject.aiService.createStandaloneJob).not.toHaveBeenCalled();
    expect(subject.aiService.runTextJob).not.toHaveBeenCalled();
  });

  it('blocks generation before loading context when subscription is ineligible', async () => {
    const subject = createSubject();
    subject.subscriptionsService.getProfileSubscription.mockRejectedValue(
      new ForbiddenException('Assinatura inválida'),
    );

    await expect(subject.service.generate('user-id')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(subject.prisma.fitnessProfile.findUnique).not.toHaveBeenCalled();
    expect(subject.aiService.runTextJob).not.toHaveBeenCalled();
  });

  it('records usage and fails the AI job when structured JSON is invalid', async () => {
    const subject = createSubject();
    subject.aiService.runTextJob.mockResolvedValue({
      ...generatedDiet(),
      outputText: 'not-json',
    });

    await expect(subject.service.generate('user-id')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(subject.transaction.dietPlan.create).not.toHaveBeenCalled();
    expect(subject.aiService.failJob).toHaveBeenCalledWith(
      'diet-job-id',
      expect.any(BadGatewayException),
      expect.objectContaining({
        totalTokens: 850,
      }),
    );
  });

  it('marks the job failed without usage when OpenAI is unavailable', async () => {
    const subject = createSubject();
    subject.aiService.runTextJob.mockRejectedValue(
      new BadGatewayException('OpenAI indisponível'),
    );

    await expect(subject.service.generate('user-id')).rejects.toThrow(
      'OpenAI indisponível',
    );
    expect(subject.aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(subject.aiService.failJob).toHaveBeenCalledWith(
      'diet-job-id',
      expect.any(BadGatewayException),
      undefined,
    );
  });

  it('generates a validated immutable candidate without persisting or completing', async () => {
    const subject = createSubject();

    const candidate = await subject.service.generateCandidate('user-id');

    expect(candidate).toMatchObject({
      status: 'PENDING_COMPLETION',
      userId: 'user-id',
      profileId: 'profile-id',
      objective: FitnessGoal.WEIGHT_LOSS,
      aiJobId: 'diet-job-id',
      operationKey: null,
      output: {
        title: 'Plano brasileiro personalizado',
        meals: [{ order: 1 }, { order: 2 }],
      },
      completion: {
        userId: 'user-id',
        aiJobId: 'diet-job-id',
        jobType: AIJobType.DIET,
      },
    });
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.output)).toBe(true);
    expect(subject.aiService.runTextJob).toHaveBeenCalledTimes(1);
    expect(subject.prisma.$transaction).not.toHaveBeenCalled();
    expect(subject.transaction.dietPlan.updateMany).not.toHaveBeenCalled();
    expect(subject.transaction.dietPlan.create).not.toHaveBeenCalled();
    expect(subject.aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(subject.auditService.recordInTransaction).not.toHaveBeenCalled();
  });

  it('opts continuation jobs into bounded abandoned-operation recovery', async () => {
    const subject = createSubject();
    const operationKey =
      'pending-goal-continuation:action-id:message-id:nutrition';

    await subject.service.generateCandidate('user-id', operationKey);

    expect(subject.aiService.createStandaloneJob).toHaveBeenCalledWith({
      userId: 'user-id',
      type: AIJobType.DIET,
      promptName: DIET_PROMPT_BY_GOAL[FitnessGoal.WEIGHT_LOSS],
      operationKey,
      recoverExpiredOperation: true,
    });
  });

  it('does not call or fail the provider when the diet AIJob is PROCESSING', async () => {
    const subject = createSubject();
    subject.aiService.createStandaloneJob.mockResolvedValue({
      id: 'diet-job-id',
      type: AIJobType.DIET,
      status: AIJobStatus.PROCESSING,
      operationKey: null,
      promptVersion: { id: 'prompt-id', prompt: 'prompt' },
    });

    await expect(subject.service.generateCandidate('user-id')).rejects.toThrow(
      'já está em andamento',
    );
    expect(subject.aiService.runTextJob).not.toHaveBeenCalled();
    expect(subject.aiService.failJob).not.toHaveBeenCalled();
  });

  it('does not regenerate when the diet standalone job reports COMPLETED', async () => {
    const subject = createSubject();
    subject.aiService.createStandaloneJob.mockResolvedValue({
      id: 'diet-job-id',
      type: AIJobType.DIET,
      status: AIJobStatus.COMPLETED,
      operationKey: null,
      promptVersion: { id: 'prompt-id', prompt: 'prompt' },
    });

    await expect(subject.service.generateCandidate('user-id')).rejects.toThrow(
      'já concluído sem candidato reutilizável',
    );
    expect(subject.aiService.runTextJob).not.toHaveBeenCalled();
    expect(subject.aiService.failJob).not.toHaveBeenCalled();
  });

  it('commits a diet candidate without invoking the provider', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    subject.aiService.runTextJob.mockClear();

    await subject.service.commitCandidate(candidate);

    expect(subject.aiService.runTextJob).not.toHaveBeenCalled();
    expect(subject.transaction.dietPlan.create).toHaveBeenCalledTimes(1);
    expect(subject.aiService.completeJobInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      {
        userId: candidate.userId,
        aiJobId: candidate.aiJobId,
        jobType: AIJobType.DIET,
        response: candidate.completion.response,
      },
    );
  });

  it('rolls back the logical diet transaction when persistence fails', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    let committed = false;
    subject.prisma.$transaction.mockImplementation(
      async (operation: (client: typeof subject.transaction) => unknown) => {
        const result = await operation(subject.transaction);
        committed = true;
        return result;
      },
    );
    subject.transaction.dietPlan.create.mockRejectedValue(
      new Error('persistence failed'),
    );

    await expect(subject.service.commitCandidate(candidate)).rejects.toThrow(
      'persistence failed',
    );
    expect(committed).toBe(false);
    expect(subject.aiService.failJob).toHaveBeenCalledWith(
      candidate.aiJobId,
      expect.any(Error),
      candidate.completion.response,
    );
  });

  it('does not leave a committed diet when AIJob completion fails', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    let committed = false;
    subject.prisma.$transaction.mockImplementation(
      async (operation: (client: typeof subject.transaction) => unknown) => {
        const result = await operation(subject.transaction);
        committed = true;
        return result;
      },
    );
    subject.aiService.completeJobInTransaction.mockRejectedValue(
      new Error('completion failed'),
    );

    await expect(subject.service.commitCandidate(candidate)).rejects.toThrow(
      'completion failed',
    );
    expect(committed).toBe(false);
    expect(subject.transaction.dietPlan.create).not.toHaveBeenCalled();
  });

  it('rolls back diet application when audit fails', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    let committed = false;
    subject.prisma.$transaction.mockImplementation(
      async (operation: (client: typeof subject.transaction) => unknown) => {
        const result = await operation(subject.transaction);
        committed = true;
        return result;
      },
    );
    subject.auditService.recordInTransaction.mockRejectedValue(
      new Error('audit failed'),
    );

    await expect(subject.service.commitCandidate(candidate)).rejects.toThrow(
      'audit failed',
    );
    expect(subject.transaction.dietPlan.create).toHaveBeenCalledTimes(1);
    expect(committed).toBe(false);
  });

  it('reuses a completed diet candidate commit without duplication', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    const existing = {
      id: 'diet-plan-id',
      userId: candidate.userId,
      profileId: candidate.profileId,
      aiJobId: candidate.aiJobId,
      title: candidate.output.title,
      objective: candidate.objective,
      dailyCaloriesTarget: new Prisma.Decimal(
        candidate.output.dailyCaloriesTarget,
      ),
      proteinTarget: new Prisma.Decimal(candidate.output.proteinTarget),
      carbsTarget: new Prisma.Decimal(candidate.output.carbsTarget),
      fatTarget: new Prisma.Decimal(candidate.output.fatTarget),
      status: DietPlanStatus.ACTIVE,
      generatedAt: candidate.generatedAt,
      createdAt: candidate.generatedAt,
      updatedAt: candidate.generatedAt,
      meals: candidate.output.meals.map((meal) => ({
        id: `meal-${meal.order}`,
        dietPlanId: 'diet-plan-id',
        name: meal.name,
        order: meal.order,
        caloriesTarget: new Prisma.Decimal(meal.caloriesTarget),
        notes: meal.notes,
        items: meal.items.map((item, index) => ({
          id: `item-${index}`,
          dietMealId: `meal-${meal.order}`,
          foodName: item.foodName,
          quantity: item.quantity,
          calories: new Prisma.Decimal(item.calories),
          protein: new Prisma.Decimal(item.protein),
          carbs: new Prisma.Decimal(item.carbs),
          fat: new Prisma.Decimal(item.fat),
          substitutionGroup: item.substitutionGroup,
        })),
      })),
      aiJob: { usage: [] },
    };
    subject.transaction.aIJob.findUnique.mockResolvedValue({
      id: candidate.aiJobId,
      userId: candidate.userId,
      type: AIJobType.DIET,
      status: AIJobStatus.COMPLETED,
      operationKey: null,
    });
    subject.transaction.dietPlan.findUnique.mockResolvedValue(existing);

    await expect(subject.service.commitCandidate(candidate)).resolves.toBe(
      existing,
    );
    expect(subject.transaction.dietPlan.updateMany).not.toHaveBeenCalled();
    expect(subject.transaction.dietPlan.create).not.toHaveBeenCalled();
    expect(subject.aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(subject.auditService.recordInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a completed diet AIJob without its canonical plan', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    subject.transaction.aIJob.findUnique.mockResolvedValue({
      id: candidate.aiJobId,
      userId: candidate.userId,
      type: AIJobType.DIET,
      status: AIJobStatus.COMPLETED,
      operationKey: null,
    });

    await expect(subject.service.commitCandidate(candidate)).rejects.toThrow(
      'concluído sem plano persistido',
    );
    expect(subject.transaction.dietPlan.create).not.toHaveBeenCalled();
  });

  it('keeps generate as the compatible diet candidate-plus-commit facade', async () => {
    const subject = createSubject();
    const generateCandidate = jest.spyOn(subject.service, 'generateCandidate');
    const commitCandidate = jest.spyOn(subject.service, 'commitCandidate');

    await expect(subject.service.generate('user-id')).resolves.toBe(
      subject.persistedPlan,
    );
    expect(generateCandidate).toHaveBeenCalledWith('user-id');
    expect(commitCandidate).toHaveBeenCalledTimes(1);
    expect(commitCandidate.mock.calls[0][0]).toMatchObject({
      status: 'PENDING_COMPLETION',
      output: { title: 'Plano brasileiro personalizado' },
    });
  });
});
