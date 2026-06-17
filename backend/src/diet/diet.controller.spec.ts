import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DietGeneratorService } from './diet-generator.service';
import { DietController } from './diet.controller';
import { DietService } from './diet.service';

describe('DietController', () => {
  it('uses the authenticated user for generation and reads', async () => {
    const dietService = {
      getById: jest.fn(),
      getCurrent: jest.fn(),
      listHistory: jest.fn(),
    };
    const generator = {
      generate: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [DietController],
      providers: [
        {
          provide: DietService,
          useValue: dietService,
        },
        {
          provide: DietGeneratorService,
          useValue: generator,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .compile();
    const controller = module.get(DietController);
    const user = {
      userId: 'user-id',
      role: UserRole.USER,
      sessionId: 'session-id',
      jti: 'jti',
    };

    await controller.generate(user);
    await controller.getCurrent(user);
    await controller.getExplicitHistory(user);
    await controller.getById(user, 'diet-plan-id');
    await controller.getHistory(user);

    expect(generator.generate).toHaveBeenCalledWith('user-id');
    expect(dietService.getCurrent).toHaveBeenCalledWith('user-id');
    expect(dietService.getById).toHaveBeenCalledWith('user-id', 'diet-plan-id');
    expect(dietService.listHistory).toHaveBeenCalledTimes(2);
  });
});
