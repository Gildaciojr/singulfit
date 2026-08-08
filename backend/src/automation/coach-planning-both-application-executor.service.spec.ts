import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { DietGeneratorService } from '../diet/diet-generator.service';
import type { LegacyDietCandidate } from '../diet/interfaces/legacy-diet-candidate.interface';
import type { WorkoutGeneratorService } from '../workout/workout-generator.service';
import type { LegacyWorkoutCandidate } from '../workout/interfaces/legacy-workout-candidate.interface';
import { CoachPlanningBothApplicationExecutorService } from './coach-planning-both-application-executor.service';
import { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';

describe('CoachPlanningBothApplicationExecutorService', () => {
  function dietCandidate(): LegacyDietCandidate {
    return Object.freeze({
      userId: 'user-id',
      profileId: 'profile-id',
      aiJobId: 'diet-job-id',
    }) as unknown as LegacyDietCandidate;
  }

  function workoutCandidate(): LegacyWorkoutCandidate {
    return Object.freeze({
      userId: 'user-id',
      profileId: 'profile-id',
      aiJobId: 'workout-job-id',
    }) as unknown as LegacyWorkoutCandidate;
  }

  function setup(options?: {
    dietPersistence?: 'CREATED' | 'REUSED';
    workoutPersistence?: 'CREATED' | 'REUSED';
    dietFailure?: Error;
    workoutFailure?: Error;
  }) {
    const transaction = Object.freeze({ marker: 'shared-transaction' });
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const dietPlan = { id: 'diet-plan-id' };
    const workoutPlan = { id: 'workout-plan-id' };
    const dietGenerator = {
      commitCandidate: jest.fn(),
      commitCandidateInTransaction: options?.dietFailure
        ? jest.fn().mockRejectedValue(options.dietFailure)
        : jest.fn().mockResolvedValue({
            persistence: options?.dietPersistence ?? 'CREATED',
            plan: dietPlan,
          }),
      failCandidate: jest.fn().mockResolvedValue(undefined),
    };
    const workoutGenerator = {
      commitCandidate: jest.fn(),
      commitCandidateInTransaction: options?.workoutFailure
        ? jest.fn().mockRejectedValue(options.workoutFailure)
        : jest.fn().mockResolvedValue({
            persistence: options?.workoutPersistence ?? 'CREATED',
            plan: workoutPlan,
          }),
      failCandidate: jest.fn().mockResolvedValue(undefined),
    };
    const executor = new CoachPlanningBothApplicationExecutorService(
      prisma as unknown as PrismaService,
      dietGenerator as unknown as DietGeneratorService,
      workoutGenerator as unknown as WorkoutGeneratorService,
    );
    return {
      executor,
      prisma,
      transaction,
      dietGenerator,
      workoutGenerator,
      dietPlan,
      workoutPlan,
    };
  }

  it('applies both candidates in one transaction and in Diet-then-Workout lock order', async () => {
    const subject = setup();
    const diet = dietCandidate();
    const workout = workoutCandidate();

    await expect(subject.executor.execute(diet, workout)).resolves.toEqual({
      persistence: 'CREATED',
      dietPlan: subject.dietPlan,
      workoutPlan: subject.workoutPlan,
    });
    expect(subject.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(
      subject.dietGenerator.commitCandidateInTransaction,
    ).toHaveBeenCalledWith(subject.transaction, diet);
    expect(
      subject.workoutGenerator.commitCandidateInTransaction,
    ).toHaveBeenCalledWith(subject.transaction, workout);
    expect(
      subject.dietGenerator.commitCandidateInTransaction.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      subject.workoutGenerator.commitCandidateInTransaction.mock
        .invocationCallOrder[0],
    );
    expect(subject.dietGenerator.commitCandidate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.commitCandidate).not.toHaveBeenCalled();
  });

  it.each([
    ['Diet', { dietFailure: new Error('diet commit failed') }],
    ['Workout', { workoutFailure: new Error('workout commit failed') }],
  ] as const)(
    'fails both candidates after a %s transaction failure',
    async (_domain, options) => {
      const subject = setup(options);
      const diet = dietCandidate();
      const workout = workoutCandidate();

      await expect(subject.executor.execute(diet, workout)).rejects.toThrow(
        /commit failed/,
      );
      expect(subject.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(subject.dietGenerator.failCandidate).toHaveBeenCalledWith(
        diet,
        expect.any(Error),
      );
      expect(subject.workoutGenerator.failCandidate).toHaveBeenCalledWith(
        workout,
        expect.any(Error),
      );
    },
  );

  it('reuses both sides only when their persistence state is coherent', async () => {
    const subject = setup({
      dietPersistence: 'REUSED',
      workoutPersistence: 'REUSED',
    });

    await expect(
      subject.executor.execute(dietCandidate(), workoutCandidate()),
    ).resolves.toMatchObject({ persistence: 'REUSED' });
  });

  it('rejects and does not repair a partial preexisting cross-domain state', async () => {
    const subject = setup({
      dietPersistence: 'REUSED',
      workoutPersistence: 'CREATED',
    });

    await expect(
      subject.executor.execute(dietCandidate(), workoutCandidate()),
    ).rejects.toThrow('Estado parcial preexistente');
    expect(subject.dietGenerator.failCandidate).toHaveBeenCalledTimes(1);
    expect(subject.workoutGenerator.failCandidate).toHaveBeenCalledTimes(1);
  });

  it('rejects candidates from different ownership contexts before opening a transaction', async () => {
    const subject = setup();
    const workout = Object.freeze({
      ...workoutCandidate(),
      userId: 'other-user-id',
    });

    await expect(
      subject.executor.execute(dietCandidate(), workout),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(subject.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('generates both candidates before the coordinator opens its transaction', async () => {
    const events: string[] = [];
    const dietPlan = {
      title: 'Dieta',
      objective: 'WEIGHT_LOSS',
      dailyCaloriesTarget: new Prisma.Decimal(1800),
      proteinTarget: new Prisma.Decimal(140),
      carbsTarget: new Prisma.Decimal(180),
      fatTarget: new Prisma.Decimal(60),
      meals: [],
    };
    const workoutPlan = {
      title: 'Treino',
      objective: 'WEIGHT_LOSS',
      days: [],
    };
    const dietGenerator = {
      generateCandidate: jest.fn().mockImplementation(() => {
        events.push('diet-provider');
        return Promise.resolve(dietCandidate());
      }),
      commitCandidateInTransaction: jest.fn().mockResolvedValue({
        persistence: 'CREATED',
        plan: dietPlan,
      }),
      failCandidate: jest.fn().mockResolvedValue(undefined),
    };
    const workoutGenerator = {
      generateCandidate: jest.fn().mockImplementation(() => {
        events.push('workout-provider');
        return Promise.resolve(workoutCandidate());
      }),
      commitCandidateInTransaction: jest.fn().mockResolvedValue({
        persistence: 'CREATED',
        plan: workoutPlan,
      }),
      failCandidate: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: object) => Promise<unknown>) => {
          events.push('transaction');
          return operation({});
        },
      ),
    };
    const coordinator = new CoachPlanningBothApplicationExecutorService(
      prisma as unknown as PrismaService,
      dietGenerator as unknown as DietGeneratorService,
      workoutGenerator as unknown as WorkoutGeneratorService,
    );
    const dispatcher = new CoachPlanningExecutionDispatcherService(
      dietGenerator as unknown as DietGeneratorService,
      workoutGenerator as unknown as WorkoutGeneratorService,
      coordinator,
    );

    await dispatcher.dispatch({
      userId: 'user-id',
      legacyIntent: 'BOTH',
      decision: null,
    });

    expect(events).toEqual([
      'diet-provider',
      'workout-provider',
      'transaction',
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
