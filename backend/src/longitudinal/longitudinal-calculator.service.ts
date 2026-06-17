import { Injectable } from '@nestjs/common';
import {
  CoachAdaptationMode,
  GoalProgressionState,
  LongitudinalDirection,
  NutritionRelapseSeverity,
  UserGoalType,
} from '@prisma/client';
import {
  LongitudinalDimensionScores,
  LongitudinalEvolutionResult,
  LongitudinalMealSignal,
} from './interfaces/longitudinal.interface';

@Injectable()
export class LongitudinalCalculatorService {
  evolution(
    currentMeals: LongitudinalMealSignal[],
    previousMeals: LongitudinalMealSignal[],
  ): LongitudinalEvolutionResult {
    const current = this.dimensionScores(currentMeals);
    const previous = this.dimensionScores(previousMeals);
    const directions = {
      quality: this.direction(current.quality, previous.quality),
      hydration: this.direction(current.hydration, previous.hydration),
      vegetables: this.direction(current.vegetables, previous.vegetables),
      ultraProcessed: this.direction(
        current.ultraProcessed,
        previous.ultraProcessed,
      ),
      sugar: this.direction(current.sugar, previous.sugar),
      protein: this.direction(current.protein, previous.protein),
    };
    const improving = Object.values(directions).filter(
      (value) => value === LongitudinalDirection.IMPROVING,
    ).length;
    const declining = Object.values(directions).filter(
      (value) => value === LongitudinalDirection.DECLINING,
    ).length;

    return {
      current,
      previous,
      directions,
      overallDirection:
        improving >= declining + 2
          ? LongitudinalDirection.IMPROVING
          : declining >= improving + 2
            ? LongitudinalDirection.DECLINING
            : LongitudinalDirection.STABLE,
    };
  }

  relapse(evolution: LongitudinalEvolutionResult, consistencyScore: number) {
    const reasons = Object.entries(evolution.directions)
      .filter(([, direction]) => direction === LongitudinalDirection.DECLINING)
      .map(([dimension]) => dimension);
    const decline = reasons.length;

    if (consistencyScore < 40 && !reasons.includes('consistency')) {
      reasons.push('consistency');
    }

    if (decline === 0 && consistencyScore >= 40) {
      return null;
    }

    return {
      severity:
        decline >= 4 || consistencyScore < 25
          ? NutritionRelapseSeverity.HIGH
          : decline >= 2 || consistencyScore < 40
            ? NutritionRelapseSeverity.MEDIUM
            : NutritionRelapseSeverity.LOW,
      reasons,
    };
  }

  goalProgression(input: {
    goal: UserGoalType;
    evolution: LongitudinalEvolutionResult;
    consistencyScore: number;
    adherenceScore: number;
    behaviorScore: number;
  }) {
    const nutritionScore = this.goalNutritionScore(
      input.goal,
      input.evolution.current,
    );
    const score = this.clamp(
      Math.round(
        nutritionScore * 0.35 +
          input.consistencyScore * 0.25 +
          input.adherenceScore * 0.25 +
          input.behaviorScore * 0.15,
      ),
    );
    const previousNutrition = this.goalNutritionScore(
      input.goal,
      input.evolution.previous,
    );
    const delta = nutritionScore - previousNutrition;
    const state =
      delta >= 7 && score >= 60
        ? GoalProgressionState.IMPROVING
        : delta <= -7 || score < 40
          ? GoalProgressionState.DECLINING
          : GoalProgressionState.STABLE;

    return { score, nutritionScore, state };
  }

  coachAdaptation(input: {
    historySize: number;
    consistencyScore: number;
    adherenceScore: number;
    relapseSeverity: NutritionRelapseSeverity | null;
    analytical: boolean;
  }) {
    if (
      input.relapseSeverity === NutritionRelapseSeverity.HIGH ||
      input.relapseSeverity === NutritionRelapseSeverity.MEDIUM
    ) {
      return {
        mode: CoachAdaptationMode.RECOVERY,
        technicalLevel: 35,
        encouragementLevel: 90,
        recoveryLevel: 100,
        performanceLevel: 20,
        reason: 'Recaída recente exige retomada simples e sem julgamento.',
      };
    }

    if (input.consistencyScore >= 80 && input.adherenceScore >= 75) {
      return {
        mode: CoachAdaptationMode.PERFORMANCE,
        technicalLevel: 80,
        encouragementLevel: 55,
        recoveryLevel: 20,
        performanceLevel: 100,
        reason: 'Alta consistência permite foco em precisão e performance.',
      };
    }

    if (input.analytical || input.historySize >= 12) {
      return {
        mode: CoachAdaptationMode.TECHNICAL,
        technicalLevel: 100,
        encouragementLevel: 45,
        recoveryLevel: 25,
        performanceLevel: 70,
        reason: 'Histórico suficiente permite orientação mais técnica.',
      };
    }

    return {
      mode: CoachAdaptationMode.ENCOURAGING,
      technicalLevel: 40,
      encouragementLevel: 100,
      recoveryLevel: 55,
      performanceLevel: 35,
      reason: 'Consistência em formação pede incentivo e ações pequenas.',
    };
  }

  direction(current: number, previous: number): LongitudinalDirection {
    if (previous === 0) {
      return LongitudinalDirection.STABLE;
    }

    const delta = current - previous;
    return delta >= 5
      ? LongitudinalDirection.IMPROVING
      : delta <= -5
        ? LongitudinalDirection.DECLINING
        : LongitudinalDirection.STABLE;
  }

  private dimensionScores(
    meals: LongitudinalMealSignal[],
  ): LongitudinalDimensionScores {
    if (meals.length === 0) {
      return {
        quality: 0,
        hydration: 0,
        vegetables: 0,
        ultraProcessed: 0,
        sugar: 0,
        protein: 0,
      };
    }

    return {
      quality: this.average(meals.map((meal) => meal.score)),
      hydration: this.average(
        meals.map((meal) =>
          this.clamp(
            ((meal.mealAnalysis.hydrationMl?.toNumber() ?? 0) / 500) * 100,
          ),
        ),
      ),
      vegetables: this.average(
        meals.map((meal) =>
          this.clamp(
            ((meal.mealAnalysis.vegetableGrams?.toNumber() ?? 0) / 150) * 100,
          ),
        ),
      ),
      ultraProcessed: this.average(
        meals.map((meal) => meal.ultraProcessedScore),
      ),
      sugar: this.average(meals.map((meal) => meal.sugarScore)),
      protein: this.average(meals.map((meal) => meal.proteinScore)),
    };
  }

  private goalNutritionScore(
    goal: UserGoalType,
    dimensions: LongitudinalDimensionScores,
  ): number {
    switch (goal) {
      case UserGoalType.HYPERTROPHY:
        return this.average([
          dimensions.protein,
          dimensions.quality,
          dimensions.hydration,
        ]);
      case UserGoalType.WEIGHT_LOSS:
        return this.average([
          dimensions.quality,
          dimensions.vegetables,
          dimensions.ultraProcessed,
          dimensions.sugar,
        ]);
      case UserGoalType.MAINTENANCE:
        return this.average([
          dimensions.quality,
          dimensions.protein,
          dimensions.vegetables,
        ]);
      case UserGoalType.HEALTH:
        return this.average(Object.values(dimensions));
    }
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return this.clamp(
      Math.round(
        values.reduce((total, value) => total + value, 0) / values.length,
      ),
    );
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
}
