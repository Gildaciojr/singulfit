import { BadGatewayException } from '@nestjs/common';
import {
  ActivityLevel,
  AIJobType,
  FitnessGoal,
  Gender,
  Prisma,
  WorkoutStatus,
} from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WORKOUT_PROMPT_BY_GOAL } from './workout.constants';
import { WorkoutGeneratorService } from './workout-generator.service';
import { AuditService } from '../observability/audit.service';

describe('WorkoutGeneratorService', () => {
  function createSubject(goal: FitnessGoal = FitnessGoal.WEIGHT_LOSS) {
    const profile = {
      id: 'profile-id',
      userId: 'user-id',
      gender: Gender.FEMALE,
      birthDate: new Date('1992-05-10T00:00:00.000Z'),
      heightCm: 168,
      currentWeightKg: new Prisma.Decimal('72.40'),
      targetWeightKg: new Prisma.Decimal('64.00'),
      activityLevel: ActivityLevel.MODERATE,
      goal,
      foodRestrictions: [
        {
          id: 'food-id',
          type: 'INTOLERANCE',
          description: 'Lactose',
        },
      ],
      injuryRestrictions: [
        {
          id: 'injury-id',
          description: 'Sensibilidade no joelho direito',
        },
      ],
      bodyMeasurements: [
        {
          id: 'measurement-id',
          weightKg: new Prisma.Decimal('71.80'),
          bodyFatPercent: new Prisma.Decimal('24.50'),
          muscleMassKg: new Prisma.Decimal('28.20'),
          measuredAt: new Date('2026-06-09T12:00:00.000Z'),
        },
      ],
    };
    const persistedPlan = {
      id: 'workout-plan-id',
      status: WorkoutStatus.ACTIVE,
      title: 'Plano personalizado',
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      workoutPlan: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(persistedPlan),
      },
    };
    const prisma = {
      fitnessProfile: {
        findUnique: jest.fn().mockResolvedValue(profile),
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
        id: 'workout-job-id',
        type: AIJobType.WORKOUT,
      }),
      runTextJob: jest.fn().mockResolvedValue({
        responseId: 'response-id',
        model: 'text-model',
        outputText: JSON.stringify({
          title: 'Plano personalizado',
          days: [
            {
              dayNumber: 1,
              title: 'Treino A',
              exercises: [
                {
                  exerciseName: 'Agachamento no banco',
                  sets: 3,
                  reps: '10-12',
                  restSeconds: 60,
                  notes: 'Movimento sem dor',
                },
              ],
            },
          ],
        }),
        promptTokens: 300,
        completionTokens: 200,
        totalTokens: 500,
      }),
      completeJobInTransaction: jest.fn().mockResolvedValue({}),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const auditService = {
      recordInTransaction: jest.fn().mockResolvedValue({
        id: 'audit-id',
      }),
    };
    const service = new WorkoutGeneratorService(
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
      persistedPlan,
    };
  }

  it.each(Object.values(FitnessGoal))(
    'selects the specialized prompt for %s',
    async (goal) => {
      const subject = createSubject(goal);

      await subject.service.generate('user-id');

      expect(subject.aiService.createStandaloneJob).toHaveBeenCalledWith({
        userId: 'user-id',
        type: AIJobType.WORKOUT,
        promptName: WORKOUT_PROMPT_BY_GOAL[goal],
      });
    },
  );

  it('sends profile restrictions and measurements as structured context', async () => {
    const subject = createSubject();

    await subject.service.generate('user-id');

    expect(subject.aiService.runTextJob).toHaveBeenCalledWith(
      'workout-job-id',
      expect.objectContaining({
        jsonSchema: expect.objectContaining({
          name: 'personalized_workout_plan',
          schema: expect.objectContaining({
            type: 'object',
          }),
        }),
      }),
    );
    const request = subject.aiService.runTextJob.mock.calls[0][1] as {
      input: string;
    };

    expect(JSON.parse(request.input)).toEqual(
      expect.objectContaining({
        profile: expect.objectContaining({
          goal: FitnessGoal.WEIGHT_LOSS,
          currentWeightKg: 72.4,
        }),
        restrictions: {
          food: [
            {
              type: 'INTOLERANCE',
              description: 'Lactose',
            },
          ],
          injuries: ['Sensibilidade no joelho direito'],
        },
        measurements: [
          expect.objectContaining({
            weightKg: 71.8,
            bodyFatPercent: 24.5,
            muscleMassKg: 28.2,
          }),
        ],
      }),
    );
  });

  it('archives the previous plan and persists days and exercises atomically', async () => {
    const subject = createSubject();

    await expect(subject.service.generate('user-id')).resolves.toBe(
      subject.persistedPlan,
    );
    expect(subject.transaction.workoutPlan.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        status: WorkoutStatus.ACTIVE,
      },
      data: {
        status: WorkoutStatus.ARCHIVED,
      },
    });
    expect(subject.transaction.workoutPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-id',
        profileId: 'profile-id',
        aiJobId: 'workout-job-id',
        objective: FitnessGoal.WEIGHT_LOSS,
        status: WorkoutStatus.ACTIVE,
        days: {
          create: [
            {
              dayNumber: 1,
              title: 'Treino A',
              exercises: {
                create: [
                  {
                    exerciseName: 'Agachamento no banco',
                    sets: 3,
                    reps: '10-12',
                    restSeconds: 60,
                    notes: 'Movimento sem dor',
                  },
                ],
              },
            },
          ],
        },
      }),
      include: expect.any(Object),
    });
    expect(subject.auditService.recordInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      expect.objectContaining({
        userId: 'user-id',
        entityId: 'workout-plan-id',
      }),
    );
  });

  it('does not persist an invalid OpenAI response', async () => {
    const subject = createSubject();
    subject.aiService.runTextJob.mockResolvedValue({
      responseId: 'response-id',
      model: 'text-model',
      outputText: 'not-json',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });

    await expect(subject.service.generate('user-id')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(subject.prisma.$transaction).not.toHaveBeenCalled();
  });
});
