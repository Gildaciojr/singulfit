import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OnboardingService } from './onboarding.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

describe('ProfileController', () => {
  it('uses the authenticated user for profile operations', async () => {
    const profileService = {
      get: jest.fn().mockResolvedValue({
        id: 'profile-id',
      }),
      create: jest.fn(),
      update: jest.fn(),
      createMeasurement: jest.fn(),
      listMeasurements: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        {
          provide: ProfileService,
          useValue: profileService,
        },
        {
          provide: OnboardingService,
          useValue: {
            getChecklist: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .compile();
    const controller = module.get(ProfileController);
    const user = {
      userId: 'user-id',
      role: UserRole.USER,
      sessionId: 'session-id',
      jti: 'jti',
    };

    await controller.getProfile(user);

    expect(profileService.get).toHaveBeenCalledWith('user-id');
  });
});
