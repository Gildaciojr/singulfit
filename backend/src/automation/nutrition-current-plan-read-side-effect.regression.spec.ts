import { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';
import { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';

describe('Nutrition current-plan read side-effect regression', () => {
  it.each([
    ['qual é minha dieta?', 'UNKNOWN'],
    ['me mostre meu plano alimentar', 'DIET'],
    ['qual minha dieta atual?', 'DIET'],
    ['quero ver minha dieta', 'DIET'],
    ['o que tem na minha dieta?', 'UNKNOWN'],
    ['mande meu plano alimentar', 'DIET'],
    ['qual foi a dieta que você montou para mim?', 'DIET'],
    ['minha dieta', 'UNKNOWN'],
  ] as const)(
    'returns the pre-existing owner without any mutation for %s',
    async (message, legacyIntent) => {
      const persistence = {
        nutritionPlanV2: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'pre-existing-plan-id' }),
          create: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
        },
        dietPlan: {
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
        },
        nutritionPlanOwnership: {
          findUnique: jest.fn().mockResolvedValue({
            implementation: 'V2',
            planId: 'pre-existing-plan-id',
            profileId: 'profile-id',
          }),
          create: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
          upsert: jest.fn(),
        },
      };
      const preExisting = Object.freeze({
        id: 'pre-existing-plan-id',
        userId: 'user-id',
        profileId: 'profile-id',
        aiJobId: 'existing-ai-job-id',
        status: 'ACTIVE',
        schemaVersion: 2,
        engineVersion: 1,
        artifactType: 'DAILY_STRUCTURE',
        lifecycleReason: 'INITIAL',
        replacesPlanReference: null,
        document: Object.freeze({
          title: 'Plano canônico preexistente',
          objectiveSummary: 'Manter o plano atual',
        }),
        generatedAt: new Date('2026-09-01T20:00:00.000Z'),
        createdAt: new Date('2026-09-01T20:00:01.000Z'),
        updatedAt: new Date('2026-09-01T20:00:01.000Z'),
      });
      const validator = { reconstruct: jest.fn().mockReturnValue(preExisting) };
      const reader = new CurrentNutritionPlanReaderService(
        persistence as never,
        validator as never,
      );
      const presenter = {
        present: jest.fn(
          (plan: { id: string; title: string }) => `${plan.id}:${plan.title}`,
        ),
      };
      const providerInvocation = jest.fn();
      const dietGenerator = {
        generate: providerInvocation,
        generateCandidate: providerInvocation,
      };
      const nutritionV2Executor = { execute: providerInvocation };
      const dispatcher = new CoachPlanningExecutionDispatcherService(
        dietGenerator as never,
        { generate: jest.fn(), generateCandidate: jest.fn() } as never,
        { execute: jest.fn() } as never,
        nutritionV2Executor as never,
        { format: jest.fn() } as never,
        undefined,
        undefined,
        undefined,
        reader,
        presenter as never,
      );
      const service = new CoachPlanningExecutionService(dispatcher);

      const result = await service.executeStructured('user-id', legacyIntent, {
        conversationId: 'conversation-id',
        messageId: 'message-id',
        correlationId: 'message-id',
        currentMessage: message,
        referenceDate: new Date('2026-09-02T00:13:28.000Z'),
      });

      expect(result).toMatchObject({
        content: 'pre-existing-plan-id:Plano canônico preexistente',
        selectedSource: 'NUTRITION_CANONICAL',
        dispatch: {
          executor: 'NUTRITION_CANONICAL_READER',
          generationCompleted: false,
        },
        metadata: {
          routeSelection: {
            reason: 'NUTRITION_CANONICAL_READ',
            suppressNutritionShadow: true,
          },
        },
      });
      expect(presenter.present).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'pre-existing-plan-id',
          aiJobId: 'existing-ai-job-id',
        }),
      );
      expect(providerInvocation).toHaveBeenCalledTimes(0);
      expect(persistence.nutritionPlanV2.create).not.toHaveBeenCalled();
      expect(persistence.dietPlan.create).not.toHaveBeenCalled();
      expect(persistence.nutritionPlanV2.update).not.toHaveBeenCalled();
      expect(persistence.nutritionPlanV2.updateMany).not.toHaveBeenCalled();
      expect(persistence.dietPlan.update).not.toHaveBeenCalled();
      expect(persistence.dietPlan.updateMany).not.toHaveBeenCalled();
      expect(persistence.nutritionPlanOwnership.create).not.toHaveBeenCalled();
      expect(persistence.nutritionPlanOwnership.update).not.toHaveBeenCalled();
      expect(
        persistence.nutritionPlanOwnership.updateMany,
      ).not.toHaveBeenCalled();
      expect(persistence.nutritionPlanOwnership.upsert).not.toHaveBeenCalled();
    },
  );
});
