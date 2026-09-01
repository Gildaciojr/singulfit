import { Injectable } from '@nestjs/common';
import type { FitnessGoal } from '@prisma/client';
import type {
  CurrentNutritionPlan,
  LegacyCurrentNutritionPlan,
} from './current-nutrition-plan-reader.contract';
import { PublicNutritionResponseBuilder } from './v2/presentation/public-nutrition-response.builder';
import type {
  PublicNutritionResponse,
  PublicNutritionSubstitution,
} from './v2/presentation/public-nutrition-response.contract';
import { NutritionWhatsAppPresenter } from './v2/presentation/nutrition-whatsapp.presenter';

@Injectable()
export class CanonicalNutritionPlanPresenterService {
  private readonly v2Builder = new PublicNutritionResponseBuilder();
  private readonly whatsapp = new NutritionWhatsAppPresenter();

  toPublic(plan: CurrentNutritionPlan): PublicNutritionResponse {
    return plan.implementation === 'V2'
      ? this.v2Builder.build({ plan: plan.document })
      : this.legacy(plan);
  }

  present(plan: CurrentNutritionPlan): string {
    return this.whatsapp.present(this.toPublic(plan));
  }

  private legacy(plan: LegacyCurrentNutritionPlan): PublicNutritionResponse {
    return Object.freeze({
      title: plan.title,
      summary: `Organizei as refeições para apoiar seu objetivo de ${this.goal(plan.objective)}.`,
      goal: this.goal(plan.objective),
      energyTargetKcal: this.positive(plan.dailyCaloriesTarget),
      macroTargets: Object.freeze({
        proteinGrams: this.positive(plan.proteinTarget),
        carbohydrateGrams: this.positive(plan.carbsTarget),
        fatGrams: this.positive(plan.fatTarget),
      }),
      days: Object.freeze([
        Object.freeze({
          meals: Object.freeze(
            plan.meals.map((meal) =>
              Object.freeze({
                name: meal.name,
                items: Object.freeze(
                  meal.items.map((item) =>
                    Object.freeze({
                      name: item.foodName,
                      quantity: item.quantity,
                    }),
                  ),
                ),
              }),
            ),
          ),
        }),
      ]),
      substitutions: this.legacySubstitutions(plan),
      hydrationGuidance: Object.freeze([]),
      generalGuidance: Object.freeze(
        [...new Set(plan.meals.flatMap((meal) => meal.notes ?? []))].filter(
          (note) => note.trim(),
        ),
      ),
      adaptationGuidance: Object.freeze([]),
      safetyGuidance: Object.freeze([]),
    });
  }

  private legacySubstitutions(
    plan: LegacyCurrentNutritionPlan,
  ): readonly PublicNutritionSubstitution[] {
    const groups = new Map<string, string[]>();
    for (const item of plan.meals.flatMap((meal) => meal.items)) {
      const group = item.substitutionGroup?.trim();
      if (!group) continue;
      const foods = groups.get(group) ?? [];
      if (!foods.includes(item.foodName)) foods.push(item.foodName);
      groups.set(group, foods);
    }
    return Object.freeze(
      [...groups.values()].flatMap((foods) => {
        const source = foods[0];
        return source
          ? foods
              .slice(1)
              .map((alternative) => Object.freeze({ source, alternative }))
          : [];
      }),
    );
  }

  private goal(goal: FitnessGoal): string {
    switch (goal) {
      case 'WEIGHT_LOSS':
        return 'emagrecimento';
      case 'MUSCLE_GAIN':
        return 'ganho de massa muscular';
      case 'MAINTENANCE':
        return 'manutenção';
    }
  }

  private positive(value: number): number | undefined {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
}
