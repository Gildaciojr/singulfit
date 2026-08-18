import { UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { GenerateWorkoutPlanV2InputBuilder } from './v2/generate-workout-plan-v2-input.builder';
import { WorkoutApplicationExecutorService } from './v2/execution/workout-application-executor.service';
import { WorkoutController } from './workout.controller';
import { WorkoutService } from './workout.service';

describe('WorkoutController', () => {
  async function setup(execution: object) {
    const publicPlan = {
      id: 'plan-id',
      title: 'Treino V2',
      days: [{ exercises: [{ exerciseName: 'Agachamento' }] }],
    };
    const workoutService = {
      getById: jest.fn().mockResolvedValue(publicPlan),
      getCurrent: jest.fn(),
      listHistory: jest.fn(),
    };
    const subscriptions = { getProfileSubscription: jest.fn() };
    const inputBuilder = {
      build: jest.fn().mockResolvedValue({
        profileId: 'profile-id',
        generationInput: { userId: 'user-id' },
      }),
    };
    const executor = { execute: jest.fn().mockResolvedValue(execution) };
    const module = await Test.createTestingModule({
      controllers: [WorkoutController],
      providers: [
        { provide: WorkoutService, useValue: workoutService },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: GenerateWorkoutPlanV2InputBuilder, useValue: inputBuilder },
        { provide: WorkoutApplicationExecutorService, useValue: executor },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();
    return {
      controller: module.get(WorkoutController),
      workoutService,
      subscriptions,
      inputBuilder,
      executor,
      publicPlan,
    };
  }

  const user = {
    userId: 'user-id',
    role: UserRole.USER,
    sessionId: 'session-id',
    jti: 'jti',
  };

  it('uses only V2 and returns the existing public WorkoutPlan shape', async () => {
    const subject = await setup({ kind: 'PLAN', aggregateId: 'plan-id' });

    await expect(subject.controller.generate(user)).resolves.toEqual(
      subject.publicPlan,
    );
    expect(subject.subscriptions.getProfileSubscription).toHaveBeenCalledWith(
      'user-id',
    );
    expect(subject.inputBuilder.build).toHaveBeenCalledTimes(1);
    expect(subject.executor.execute).toHaveBeenCalledTimes(1);
    expect(subject.workoutService.getById).toHaveBeenCalledWith(
      'user-id',
      'plan-id',
    );
  });

  it('returns typed insufficient context without a legacy fallback', async () => {
    const subject = await setup({
      kind: 'CLARIFICATION',
      missingFields: ['MODALITY'],
      confirmationRequiredFields: [],
      aiJobCompleted: false,
    });

    await expect(subject.controller.generate(user)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(subject.executor.execute).toHaveBeenCalledTimes(1);
    expect(subject.workoutService.getById).not.toHaveBeenCalled();
  });

  it('keeps current and history reads unchanged', async () => {
    const subject = await setup({ kind: 'PLAN', aggregateId: 'plan-id' });
    await subject.controller.getCurrent(user);
    await subject.controller.getExplicitHistory(user);
    await subject.controller.getById(user, 'plan-id');
    await subject.controller.getHistory(user);

    expect(subject.workoutService.getCurrent).toHaveBeenCalledWith('user-id');
    expect(subject.workoutService.getById).toHaveBeenCalledWith(
      'user-id',
      'plan-id',
    );
    expect(subject.workoutService.listHistory).toHaveBeenCalledTimes(2);
  });
});
