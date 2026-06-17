import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

describe('AutomationController', () => {
  it('uses the authenticated user for preferences and automations', async () => {
    const automationService = {
      getPreferences: jest.fn(),
      updatePreferences: jest.fn(),
      getAutomations: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [AutomationController],
      providers: [
        {
          provide: AutomationService,
          useValue: automationService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .compile();
    const controller = module.get(AutomationController);
    const user = {
      userId: 'user-id',
      role: UserRole.USER,
      sessionId: 'session-id',
      jti: 'jti',
    };
    const update = {
      workoutReminderEnabled: false,
    };

    await controller.getPreferences(user);
    await controller.updatePreferences(user, update);
    await controller.getAutomations(user);

    expect(automationService.getPreferences).toHaveBeenCalledWith('user-id');
    expect(automationService.updatePreferences).toHaveBeenCalledWith(
      'user-id',
      update,
    );
    expect(automationService.getAutomations).toHaveBeenCalledWith('user-id');
  });
});
