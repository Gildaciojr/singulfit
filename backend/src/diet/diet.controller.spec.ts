import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { AutomationModule } from '../automation/automation.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventBusModule } from '../event-bus/event-bus.module';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { DietGeneratorService } from './diet-generator.service';
import { DietController } from './diet.controller';
import { DietService } from './diet.service';
import { CurrentNutritionPlanReaderService } from './current-nutrition-plan-reader.service';
import { NutritionApplicationExecutorService } from './v2/execution/nutrition-application-executor.service';
import { GenerateNutritionPlanV2InputBuilder } from './v2/generate-nutrition-plan-v2-input.builder';

describe('DietController', () => {
  it('generates through Nutrition V2 for the authenticated owner and preserves canonical reads', async () => {
    const dietService = {
      getById: jest.fn(),
      getCurrent: jest.fn(),
      listHistory: jest.fn(),
    };
    const generator = {
      generate: jest.fn(),
    };
    const canonicalPlan = { implementation: 'V2', id: 'nutrition-v2-id' };
    const currentReader = {
      getCurrent: jest.fn().mockResolvedValue(canonicalPlan),
    };
    const subscriptions = {
      getProfileSubscription: jest
        .fn()
        .mockResolvedValue({ id: 'subscription-id' }),
    };
    const prisma = {
      fitnessProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 'profile-id' }),
      },
    };
    const snapshot = {
      completion: {
        overall: 'PARTIAL',
        sections: [
          {
            section: 'NUTRITION',
            state: 'COMPLETE',
            ready: true,
            requiredFields: [],
            availableFields: [],
            missingFields: [],
            confirmationRequiredFields: [],
          },
        ],
      },
    };
    const snapshotBuilder = { build: jest.fn().mockResolvedValue(snapshot) };
    const generationInput = { userId: 'user-id' };
    const inputBuilder = { build: jest.fn().mockReturnValue(generationInput) };
    const nutritionExecutor = {
      execute: jest.fn().mockResolvedValue({
        kind: 'PLAN',
        aggregateId: 'nutrition-v2-id',
      }),
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
        {
          provide: CurrentNutritionPlanReaderService,
          useValue: currentReader,
        },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: PrismaService, useValue: prisma },
        { provide: CoachProfileSnapshotBuilder, useValue: snapshotBuilder },
        {
          provide: GenerateNutritionPlanV2InputBuilder,
          useValue: inputBuilder,
        },
        {
          provide: NutritionApplicationExecutorService,
          useValue: nutritionExecutor,
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

    await expect(controller.generate(user)).resolves.toEqual(canonicalPlan);
    await controller.getCurrent(user);
    await controller.getExplicitHistory(user);
    await controller.getById(user, 'diet-plan-id');
    await controller.getHistory(user);

    expect(generator.generate).not.toHaveBeenCalled();
    expect(subscriptions.getProfileSubscription).toHaveBeenCalledWith(
      'user-id',
    );
    expect(snapshotBuilder.build).toHaveBeenCalledWith(
      'user-id',
      expect.any(Date),
    );
    expect(inputBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        snapshot,
        decision: expect.objectContaining({
          goal: 'GENERATE_DIET_PLAN',
          targetPlan: 'DIET',
        }),
      }),
    );
    expect(nutritionExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        generationInput,
        ownership: { userId: 'user-id', profileId: 'profile-id' },
      }),
    );
    expect(currentReader.getCurrent).toHaveBeenCalledWith('user-id');
    expect(dietService.getCurrent).not.toHaveBeenCalled();
    expect(dietService.getById).toHaveBeenCalledWith('user-id', 'diet-plan-id');
    expect(dietService.listHistory).toHaveBeenCalledTimes(2);
  });
  it('resolves the real Automation/Diet/Context/Nutrition module graph and preserves POST generate', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        EventBusModule,
        AutomationModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    try {
      const controller = module.get(DietController);
      const generate: unknown = Object.getOwnPropertyDescriptor(
        DietController.prototype,
        'generate',
      )?.value;
      if (typeof generate !== 'function')
        throw new Error('POST generate handler missing');
      expect(controller).toBeInstanceOf(DietController);
      expect(module.get(NutritionApplicationExecutorService)).toBeInstanceOf(
        NutritionApplicationExecutorService,
      );
      expect(Reflect.getMetadata(PATH_METADATA, DietController)).toBe(
        'api/v1/diets',
      );
      expect(Reflect.getMetadata(PATH_METADATA, generate)).toBe('generate');
      expect(Reflect.getMetadata(METHOD_METADATA, generate)).toBe(
        RequestMethod.POST,
      );
      expect(Reflect.getMetadata(GUARDS_METADATA, DietController)).toContain(
        JwtAuthGuard,
      );
    } finally {
      await module.close();
    }
  });
});
