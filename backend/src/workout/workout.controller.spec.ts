import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkoutController } from './workout.controller';
import { WorkoutGeneratorService } from './workout-generator.service';
import { WorkoutService } from './workout.service';

describe('WorkoutController', () => {
  it('uses the authenticated user for generation and reads', async () => {
    const workoutService = {
      getById: jest.fn(),
      getCurrent: jest.fn(),
      listHistory: jest.fn(),
    };
    const generator = {
      generate: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [WorkoutController],
      providers: [
        {
          provide: WorkoutService,
          useValue: workoutService,
        },
        {
          provide: WorkoutGeneratorService,
          useValue: generator,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .compile();
    const controller = module.get(WorkoutController);
    const user = {
      userId: 'user-id',
      role: UserRole.USER,
      sessionId: 'session-id',
      jti: 'jti',
    };

    await controller.generate(user);
    await controller.getCurrent(user);
    await controller.getExplicitHistory(user);
    await controller.getById(user, 'plan-id');
    await controller.getHistory(user);

    expect(generator.generate).toHaveBeenCalledWith('user-id');
    expect(workoutService.getCurrent).toHaveBeenCalledWith('user-id');
    expect(workoutService.getById).toHaveBeenCalledWith('user-id', 'plan-id');
    expect(workoutService.listHistory).toHaveBeenCalledTimes(2);
    expect(workoutService.listHistory).toHaveBeenCalledWith('user-id');
  });
});
