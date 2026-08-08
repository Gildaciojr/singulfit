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
      userId: 'user-id',
      profileId: 'profile-id',
      aiJobId: 'workout-job-id',
      status: WorkoutStatus.ACTIVE,
      title: 'Plano personalizado',
      objective: goal,
      generatedAt: new Date('2026-06-10T12:00:00.000Z'),
      createdAt: new Date('2026-06-10T12:00:00.000Z'),
      updatedAt: new Date('2026-06-10T12:00:00.000Z'),
      days: [],
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      fitnessProfile: {
        findFirst: jest.fn().mockResolvedValue({ goal }),
      },
      aIJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'workout-job-id',
          userId: 'user-id',
          type: AIJobType.WORKOUT,
          status: 'PROCESSING',
          operationKey: null,
        }),
      },
      workoutPlan: {
        findUnique: jest.fn().mockResolvedValue(null),
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
        status: 'PENDING',
        operationKey: null,
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
      profile,
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
    expect(subject.transaction.$queryRaw).toHaveBeenCalledTimes(1);
  });

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

  it('generates a validated immutable candidate without canonical side effects', async () => {
    const subject = createSubject();

    const candidate = await subject.service.generateCandidate('user-id');

    expect(candidate).toMatchObject({
      status: 'PENDING_COMPLETION',
      userId: 'user-id',
      profileId: 'profile-id',
      objective: FitnessGoal.WEIGHT_LOSS,
      aiJobId: 'workout-job-id',
      operationKey: null,
      output: {
        title: 'Plano personalizado',
        days: [{ dayNumber: 1, title: 'Treino A' }],
      },
      completion: {
        userId: 'user-id',
        aiJobId: 'workout-job-id',
        jobType: AIJobType.WORKOUT,
      },
    });
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.output)).toBe(true);
    expect(subject.aiService.runTextJob).toHaveBeenCalledTimes(1);
    expect(subject.prisma.$transaction).not.toHaveBeenCalled();
    expect(subject.transaction.workoutPlan.updateMany).not.toHaveBeenCalled();
    expect(subject.transaction.workoutPlan.create).not.toHaveBeenCalled();
    expect(subject.aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(subject.auditService.recordInTransaction).not.toHaveBeenCalled();
  });

  it('does not call or fail the provider when the AIJob is already PROCESSING', async () => {
    const subject = createSubject();
    subject.aiService.createStandaloneJob.mockResolvedValue({
      id: 'workout-job-id',
      type: AIJobType.WORKOUT,
      status: 'PROCESSING',
      operationKey: null,
    });

    await expect(subject.service.generateCandidate('user-id')).rejects.toThrow(
      'já está em andamento',
    );
    expect(subject.aiService.runTextJob).not.toHaveBeenCalled();
    expect(subject.aiService.failJob).not.toHaveBeenCalled();
  });

  it('does not regenerate when createStandaloneJob reports COMPLETED', async () => {
    const subject = createSubject();
    subject.aiService.createStandaloneJob.mockResolvedValue({
      id: 'workout-job-id',
      type: AIJobType.WORKOUT,
      status: 'COMPLETED',
      operationKey: null,
    });

    await expect(subject.service.generateCandidate('user-id')).rejects.toThrow(
      'já concluído sem candidato reutilizável',
    );
    expect(subject.aiService.runTextJob).not.toHaveBeenCalled();
    expect(subject.aiService.failJob).not.toHaveBeenCalled();
  });

  it('commits an existing candidate without invoking the provider', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    subject.aiService.runTextJob.mockClear();

    await subject.service.commitCandidate(candidate);

    expect(subject.aiService.runTextJob).not.toHaveBeenCalled();
    expect(subject.transaction.workoutPlan.create).toHaveBeenCalledTimes(1);
    expect(subject.aiService.completeJobInTransaction).toHaveBeenCalledWith(
      subject.transaction,
      {
        userId: candidate.userId,
        aiJobId: candidate.aiJobId,
        jobType: AIJobType.WORKOUT,
        response: candidate.completion.response,
      },
    );
  });

  it('rolls back the logical transaction when persistence fails', async () => {
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
    subject.transaction.workoutPlan.create.mockRejectedValue(
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

  it('does not leave a committed plan when AIJob completion fails', async () => {
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
    expect(subject.transaction.workoutPlan.create).not.toHaveBeenCalled();
  });

  it('rolls back plan application when audit fails', async () => {
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
    expect(subject.transaction.workoutPlan.create).toHaveBeenCalledTimes(1);
    expect(committed).toBe(false);
  });

  it('reuses a completed candidate commit without duplicating the plan', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    const existing = {
      ...subject.persistedPlan,
      generatedAt: candidate.generatedAt,
      days: candidate.output.days.map((day) => ({
        id: `day-${day.dayNumber}`,
        workoutPlanId: 'workout-plan-id',
        dayNumber: day.dayNumber,
        title: day.title,
        exercises: day.exercises.map((exercise, index) => ({
          id: `exercise-${index}`,
          workoutDayId: `day-${day.dayNumber}`,
          ...exercise,
        })),
      })),
    };
    subject.transaction.aIJob.findUnique.mockResolvedValue({
      id: candidate.aiJobId,
      userId: candidate.userId,
      type: AIJobType.WORKOUT,
      status: 'COMPLETED',
      operationKey: null,
    });
    subject.transaction.workoutPlan.findUnique.mockResolvedValue(existing);

    await expect(subject.service.commitCandidate(candidate)).resolves.toBe(
      existing,
    );
    expect(subject.transaction.workoutPlan.updateMany).not.toHaveBeenCalled();
    expect(subject.transaction.workoutPlan.create).not.toHaveBeenCalled();
    expect(subject.aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(subject.auditService.recordInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a completed workout AIJob without its canonical plan', async () => {
    const subject = createSubject();
    const candidate = await subject.service.generateCandidate('user-id');
    subject.transaction.aIJob.findUnique.mockResolvedValue({
      id: candidate.aiJobId,
      userId: candidate.userId,
      type: AIJobType.WORKOUT,
      status: 'COMPLETED',
      operationKey: null,
    });

    await expect(subject.service.commitCandidate(candidate)).rejects.toThrow(
      'concluído sem plano persistido',
    );
    expect(subject.transaction.workoutPlan.create).not.toHaveBeenCalled();
  });

  it('keeps generate as the compatible candidate-plus-commit facade', async () => {
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
      output: { title: 'Plano personalizado' },
    });
  });
});
