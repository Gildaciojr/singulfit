import { AIService } from '../../ai/ai.service';
import { NutritionPlanningEngineV2Service } from './nutrition-planning-engine-v2.service';
import type { NutritionGenerationRunnerV2Service } from './nutrition-generation-runner-v2.service';
import type { GenerateNutritionPlanV2Input } from './nutrition-planning-generation.contract';
import type { NutritionArtifactType } from './nutrition-planning-artifact.contract';
import type { NutritionPlanV2 } from './nutrition-plan-v2.contract';

describe('Nutrition V2 commercial generation scope', () => {
  function subject(artifactType: NutritionArtifactType) {
    const runner = {
      prepare: jest.fn().mockReturnValue({ resolution: { artifactType } }),
      describe: jest.fn().mockReturnValue({
        promptName: 'controlled',
        operationKey: 'operation',
      }),
    };
    const ai = {
      createStandaloneJob: jest
        .fn()
        .mockRejectedValue(new Error('controlled reservation stop')),
      runTextJob: jest.fn(),
    };
    return {
      ai,
      engine: new NutritionPlanningEngineV2Service(
        runner as unknown as NutritionGenerationRunnerV2Service,
        ai as unknown as AIService,
      ),
    };
  }
  it.each([
    'DAILY_STRUCTURE',
    'WEEKLY_PLAN',
    'PLAN_ADAPTATION',
    'FOOD_SUBSTITUTION',
  ] as const)(
    '%s without enforced target reserves complete generation',
    async (artifact) => {
      const s = subject(artifact);
      await expect(
        s.engine.generateCandidate({
          userId: 'owned-user',
        } as GenerateNutritionPlanV2Input),
      ).rejects.toThrow('controlled reservation stop');
      expect(s.ai.createStandaloneJob).toHaveBeenCalledWith(
        expect.objectContaining({
          usageEntitlementCode: 'NUTRITION_PLAN_GENERATION',
        }),
      );
      expect(s.ai.createStandaloneJob.mock.calls[0][0]).not.toHaveProperty(
        'generationScope',
      );
      expect(s.ai.runTextJob).not.toHaveBeenCalled();
    },
  );
  it('an enforced source/target preserves the rest of the plan without a new generation quota', async () => {
    const s = subject('FOOD_SUBSTITUTION');
    const input = {
      userId: 'owned-user',
      previousPlan: {
        generation: { aiJobId: 'source-job' },
        days: [
          {
            dayNumber: 1,
            meals: [{ mealKey: 'LUNCH', items: [{ itemKey: 'chicken' }] }],
          },
        ],
      } as unknown as NutritionPlanV2,
      mutationTarget: {
        sourcePlanId: 'owned-plan',
        dayNumber: 1,
        mealKey: 'LUNCH',
        itemKey: 'chicken',
      },
    } as GenerateNutritionPlanV2Input;
    await expect(s.engine.generateCandidate(input)).rejects.toThrow(
      'controlled reservation stop',
    );
    expect(s.ai.createStandaloneJob).toHaveBeenCalledWith(
      expect.objectContaining({
        generationScope: {
          kind: 'TARGETED',
          sourcePlanId: 'owned-plan',
          sourceAIJobId: 'source-job',
          targetKey: '1:LUNCH:chicken',
        },
      }),
    );
    expect(s.ai.createStandaloneJob.mock.calls[0][0]).not.toHaveProperty(
      'usageEntitlementCode',
    );
  });
  it.each(['POINT_GUIDANCE', 'MEAL_SUGGESTION', 'PLAN_REVIEW'] as const)(
    '%s output contract cannot create a plan and remains free',
    async (artifact) => {
      const s = subject(artifact);
      await expect(
        s.engine.generateCandidate({
          userId: 'owned-user',
        } as GenerateNutritionPlanV2Input),
      ).rejects.toThrow('controlled reservation stop');
      expect(s.ai.createStandaloneJob).toHaveBeenCalledWith(
        expect.objectContaining({ generationScope: { kind: 'NON_PLAN' } }),
      );
    },
  );
  it('current plan presentation creates no job', async () => {
    const s = subject('CURRENT_PLAN_PRESENTATION');
    await expect(
      s.engine.generateCandidate({
        userId: 'owned-user',
      } as GenerateNutritionPlanV2Input),
    ).resolves.toMatchObject({ status: 'NO_GENERATION' });
    expect(s.ai.createStandaloneJob).not.toHaveBeenCalled();
  });
  it.each(['review-only', 'missing-meal', 'missing-item', 'wrong-identity'])(
    'rejects %s targeted exemption before job/provider',
    async (caseName) => {
      const s = subject('FOOD_SUBSTITUTION');
      const source = {
        generation: { aiJobId: 'source-job' },
        days: [
          {
            dayNumber: 1,
            meals: [{ mealKey: 'LUNCH', items: [{ itemKey: 'chicken' }] }],
          },
        ],
      } as unknown as NutritionPlanV2;
      const input = {
        userId: 'owned-user',
        ...(caseName === 'review-only'
          ? { reviewedPlan: { id: 'owned-plan', plan: source } }
          : { previousPlan: source }),
        ...(caseName === 'wrong-identity'
          ? { reviewedPlan: { id: 'different-plan', plan: source } }
          : {}),
        mutationTarget: {
          sourcePlanId: 'owned-plan',
          dayNumber: 1,
          mealKey: caseName === 'missing-meal' ? 'MISSING' : 'LUNCH',
          itemKey: caseName === 'missing-item' ? 'MISSING' : 'chicken',
          request: 'authorized single item edit',
        },
      } as GenerateNutritionPlanV2Input;
      await expect(s.engine.generateCandidate(input)).rejects.toThrow(
        'source/target mismatch',
      );
      expect(s.ai.createStandaloneJob).not.toHaveBeenCalled();
      expect(s.ai.runTextJob).not.toHaveBeenCalled();
    },
  );
});
