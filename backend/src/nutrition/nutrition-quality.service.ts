import { Injectable } from '@nestjs/common';
import { FitnessGoal, MealCategory } from '@prisma/client';

export interface NutritionQualityInput {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  ultraProcessedRatio: number;
  vegetableGrams: number;
  category: MealCategory;
  goal: FitnessGoal | null;
}

export interface NutritionQualityResult {
  score: number;
  proteinScore: number;
  fiberScore: number;
  ultraProcessedScore: number;
  sugarScore: number;
  fatScore: number;
  balanceScore: number;
  goalAdherenceScore: number;
}

@Injectable()
export class NutritionQualityService {
  calculate(input: NutritionQualityInput): NutritionQualityResult {
    const proteinTarget = this.proteinTarget(input.category, input.goal);
    const fiberTarget = input.category === MealCategory.SNACK ? 5 : 8;
    const proteinScore = this.ratioScore(input.protein, proteinTarget);
    const fiberScore = this.ratioScore(input.fiber, fiberTarget);
    const ultraProcessedScore = this.clamp(
      Math.round(100 - input.ultraProcessedRatio * 100),
    );
    const sugarScore = this.sugarScore(input.sugar);
    const fatScore = this.fatScore(input.fat, input.calories);
    const balanceScore = this.balanceScore(input);
    const goalAdherenceScore = this.goalScore(input.goal, {
      proteinScore,
      fiberScore,
      ultraProcessedScore,
      sugarScore,
      balanceScore,
    });
    const score = this.clamp(
      Math.round(
        proteinScore * 0.2 +
          fiberScore * 0.15 +
          ultraProcessedScore * 0.15 +
          sugarScore * 0.1 +
          fatScore * 0.1 +
          balanceScore * 0.15 +
          goalAdherenceScore * 0.15,
      ),
    );

    return {
      score,
      proteinScore,
      fiberScore,
      ultraProcessedScore,
      sugarScore,
      fatScore,
      balanceScore,
      goalAdherenceScore,
    };
  }

  private proteinTarget(
    category: MealCategory,
    goal: FitnessGoal | null,
  ): number {
    if (category === MealCategory.SNACK) {
      return goal === FitnessGoal.MUSCLE_GAIN ? 15 : 10;
    }

    return goal === FitnessGoal.MUSCLE_GAIN ? 30 : 25;
  }

  private ratioScore(value: number, target: number): number {
    return this.clamp(Math.round((value / target) * 100));
  }

  private sugarScore(sugar: number): number {
    if (sugar <= 10) {
      return 100;
    }

    return this.clamp(Math.round(100 - (sugar - 10) * 4));
  }

  private fatScore(fat: number, calories: number): number {
    if (calories <= 0) {
      return 50;
    }

    const ratio = (fat * 9) / calories;

    if (ratio >= 0.2 && ratio <= 0.35) {
      return 100;
    }

    const distance = ratio < 0.2 ? 0.2 - ratio : ratio - 0.35;
    return this.clamp(Math.round(100 - distance * 250));
  }

  private balanceScore(input: NutritionQualityInput): number {
    if (input.calories <= 0) {
      return 30;
    }

    const proteinRatio = (input.protein * 4) / input.calories;
    const carbsRatio = (input.carbs * 4) / input.calories;
    const fatRatio = (input.fat * 9) / input.calories;
    const macroScore = this.average([
      this.rangeScore(proteinRatio, 0.15, 0.35),
      this.rangeScore(carbsRatio, 0.35, 0.65),
      this.rangeScore(fatRatio, 0.15, 0.4),
    ]);
    const vegetableScore = this.ratioScore(input.vegetableGrams, 100);

    return this.clamp(Math.round(macroScore * 0.75 + vegetableScore * 0.25));
  }

  private rangeScore(value: number, minimum: number, maximum: number): number {
    if (value >= minimum && value <= maximum) {
      return 100;
    }

    const distance = value < minimum ? minimum - value : value - maximum;
    return this.clamp(Math.round(100 - distance * 250));
  }

  private goalScore(
    goal: FitnessGoal | null,
    scores: Omit<
      NutritionQualityResult,
      'score' | 'fatScore' | 'goalAdherenceScore'
    >,
  ): number {
    if (goal === FitnessGoal.WEIGHT_LOSS) {
      return this.average([
        scores.fiberScore,
        scores.ultraProcessedScore,
        scores.sugarScore,
        scores.balanceScore,
      ]);
    }

    if (goal === FitnessGoal.MUSCLE_GAIN) {
      return this.average([
        scores.proteinScore,
        scores.balanceScore,
        scores.fiberScore,
      ]);
    }

    return this.average(Object.values(scores));
  }

  private average(values: number[]): number {
    return this.clamp(
      Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    );
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, value));
  }
}
