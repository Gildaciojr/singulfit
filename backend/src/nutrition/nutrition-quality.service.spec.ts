import { FitnessGoal, MealCategory } from '@prisma/client';
import { NutritionQualityService } from './nutrition-quality.service';

describe('NutritionQualityService', () => {
  const service = new NutritionQualityService();

  it('calculates an explainable score between zero and one hundred', () => {
    const result = service.calculate({
      calories: 560,
      protein: 38,
      carbs: 58,
      fat: 18,
      fiber: 10,
      sugar: 7,
      ultraProcessedRatio: 0.1,
      vegetableGrams: 140,
      category: MealCategory.LUNCH,
      goal: FitnessGoal.MUSCLE_GAIN,
    });

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.proteinScore).toBe(100);
    expect(result.fiberScore).toBe(100);
    expect(result.ultraProcessedScore).toBe(90);
    expect(
      Object.values(result).every((value) => value >= 0 && value <= 100),
    ).toBe(true);
  });

  it('penalizes concentrated sugar and ultraprocessed meals', () => {
    const result = service.calculate({
      calories: 720,
      protein: 8,
      carbs: 110,
      fat: 28,
      fiber: 2,
      sugar: 45,
      ultraProcessedRatio: 0.9,
      vegetableGrams: 0,
      category: MealCategory.SNACK,
      goal: FitnessGoal.WEIGHT_LOSS,
    });

    expect(result.score).toBeLessThan(50);
    expect(result.sugarScore).toBe(0);
    expect(result.ultraProcessedScore).toBe(10);
    expect(result.goalAdherenceScore).toBeLessThan(40);
  });
});
