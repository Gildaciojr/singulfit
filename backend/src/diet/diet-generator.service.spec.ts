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
      dietPlan: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(persistedPlan),
      },
      aIJob: {
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
    const service = new DietGeneratorService(
      prisma as unknown as PrismaService,
      subscriptionsService as unknown as SubscriptionsService,
      aiService as unknown as AIService,
      auditService as unknown as AuditService,
    );

    return {
      service,
      prisma,
      transaction,
      subscriptionsService,
      aiService,
      auditService,
      profile,
      persistedPlan,
    };
  }

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

  it('archives the previous diet and persists meals, items and AI usage atomically', async () => {
    const subject = createSubject();

    await subject.service.generate('user-id');

    expect(subject.transaction.$queryRaw).toHaveBeenCalled();
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
      {
        userId: 'user-id',
        aiJobId: 'diet-job-id',
        jobType: AIJobType.DIET,
        response: expect.objectContaining({
          totalTokens: 850,
        }),
      },
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
});
