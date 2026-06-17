import { Test } from '@nestjs/testing';
import { EnergyLevel, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CheckInService } from './check-in.service';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

describe('ProgressController', () => {
  it('uses the authenticated user for every progress operation', async () => {
    const progressService = {
      getProgress: jest.fn(),
      getInsights: jest.fn(),
    };
    const checkInService = {
      create: jest.fn(),
      list: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [ProgressController],
      providers: [
        {
          provide: ProgressService,
          useValue: progressService,
        },
        {
          provide: CheckInService,
          useValue: checkInService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .compile();
    const controller = module.get(ProgressController);
    const user = {
      userId: 'user-id',
      role: UserRole.USER,
      sessionId: 'session-id',
      jti: 'jti',
    };
    const checkIn = {
      mood: 'Bem',
      energyLevel: EnergyLevel.MEDIUM,
      adherenceScore: 80,
    };

    await controller.createCheckIn(user, checkIn);
    await controller.getCheckIns(user);
    await controller.getProgress(user);
    await controller.getInsights(user);

    expect(checkInService.create).toHaveBeenCalledWith('user-id', checkIn);
    expect(checkInService.list).toHaveBeenCalledWith('user-id');
    expect(progressService.getProgress).toHaveBeenCalledWith('user-id');
    expect(progressService.getInsights).toHaveBeenCalledWith('user-id');
  });
});
