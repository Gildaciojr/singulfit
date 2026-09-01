import { DietPlanStatus, FitnessGoal } from '@prisma/client';
import type { LegacyCurrentNutritionPlan } from './current-nutrition-plan-reader.contract';
import { CanonicalNutritionPlanPresenterService } from './canonical-nutrition-plan-presenter.service';

describe('CanonicalNutritionPlanPresenterService', () => {
  it('projects a legacy owner into the same public nutrition contract', () => {
    const plan: LegacyCurrentNutritionPlan = {
      implementation: 'LEGACY',
      id: 'plan-id',
      userId: 'user-id',
      profileId: 'profile-id',
      aiJobId: 'job-id',
      title: 'Plano brasileiro',
      status: DietPlanStatus.ACTIVE,
      objective: FitnessGoal.WEIGHT_LOSS,
      dailyCaloriesTarget: 1800,
      proteinTarget: 120,
      carbsTarget: 180,
      fatTarget: 55,
      generatedAt: '2026-08-01T12:00:00.000Z',
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
      meals: Object.freeze([
        Object.freeze({
          id: 'meal-id',
          name: 'Almoço',
          order: 1,
          caloriesTarget: 600,
          notes: 'Ajuste o horário à sua rotina.',
          items: Object.freeze([
            Object.freeze({
              id: 'rice-id',
              foodName: 'Arroz',
              quantity: '4 colheres',
              calories: 200,
              protein: 4,
              carbs: 44,
              fat: 1,
              substitutionGroup: 'carboidrato',
            }),
            Object.freeze({
              id: 'pasta-id',
              foodName: 'Macarrão',
              quantity: '1 xícara',
              calories: 210,
              protein: 6,
              carbs: 42,
              fat: 2,
              substitutionGroup: 'carboidrato',
            }),
          ]),
        }),
      ]),
    };

    const result = new CanonicalNutritionPlanPresenterService().toPublic(plan);

    expect(result).toMatchObject({
      title: 'Plano brasileiro',
      energyTargetKcal: 1800,
      macroTargets: {
        proteinGrams: 120,
        carbohydrateGrams: 180,
        fatGrams: 55,
      },
      days: [
        {
          meals: [
            {
              name: 'Almoço',
              items: [
                { name: 'Arroz', quantity: '4 colheres' },
                { name: 'Macarrão', quantity: '1 xícara' },
              ],
            },
          ],
        },
      ],
      substitutions: [{ source: 'Arroz', alternative: 'Macarrão' }],
    });
  });
});
