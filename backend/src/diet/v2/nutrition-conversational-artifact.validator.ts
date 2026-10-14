import { BadRequestException, Injectable } from '@nestjs/common';
import type { NutritionConversationalArtifactV1 } from './nutrition-conversational-artifact.contract';
import type { NutritionPlanningContext } from './nutrition-planning-context.contract';
import { nutritionAdviceFoodViolation } from '../../conversation/runtime/nutrition-advice.policy';

@Injectable()
export class NutritionConversationalArtifactValidator {
  validate(
    artifact: NutritionConversationalArtifactV1,
    context?: NutritionPlanningContext,
  ): void {
    if (
      context &&
      (context.constraints.some(
        (constraint) => constraint.status === 'REQUIRES_CONFIRMATION',
      ) ||
        nutritionAdviceFoodViolation(
          {
            safetyConstraints: context.constraints.map(
              (constraint) => constraint.code,
            ),
            excludedFoods: context.preferences
              .filter(
                (preference) =>
                  preference.disposition === 'AVOIDED' ||
                  preference.disposition === 'REJECTED',
              )
              .map((preference) => preference.foodName),
            temporarilyUnavailableFoods: [],
          },
          this.narrativeFields(artifact).join('\n'),
        ))
    )
      this.invalid();
    if (context && artifact.artifactType === 'MEAL_SUGGESTION') {
      // Food names are ingredients, not caution prose. A negative label must
      // never make a forbidden ingredient acceptable.
      for (const item of artifact.meal.items) {
        if (
          nutritionAdviceFoodViolation(
            {
              safetyConstraints: context.constraints.map(
                (constraint) => constraint.code,
              ),
              excludedFoods: context.preferences
                .filter(
                  (preference) =>
                    preference.disposition === 'AVOIDED' ||
                    preference.disposition === 'REJECTED',
                )
                .map((preference) => preference.foodName),
              temporarilyUnavailableFoods: [],
            },
            `Ingrediente: ${item.name}`,
          )
        )
          this.invalid();
      }
    }
    if (
      artifact.schemaVersion !== '1.0' ||
      !artifact.title.trim() ||
      !artifact.summary.trim() ||
      !Number.isFinite(new Date(artifact.generatedAt).getTime())
    )
      this.invalid();
    if (artifact.artifactType === 'POINT_GUIDANCE') {
      if (
        !artifact.guidance.answer.trim() ||
        artifact.guidance.actionableSteps.length === 0
      )
        this.invalid();
      return;
    }
    if (artifact.artifactType === 'MEAL_SUGGESTION') {
      if (!artifact.meal.name.trim() || artifact.meal.items.length === 0)
        this.invalid();
      const values = [
        artifact.meal.estimatedNutrition.caloriesKcal,
        artifact.meal.estimatedNutrition.proteinGrams,
        artifact.meal.estimatedNutrition.carbohydrateGrams,
        artifact.meal.estimatedNutrition.fatGrams,
        ...artifact.meal.items.map((item) => item.quantity),
      ];
      if (
        values.some(
          (value) => value !== null && (!Number.isFinite(value) || value < 0),
        )
      )
        this.invalid();
      return;
    }
    if (
      !artifact.reviewedPlanId.trim() ||
      !artifact.review.overallAssessment.trim() ||
      artifact.review.strengths.length +
        artifact.review.concerns.length +
        artifact.review.recommendations.length ===
        0
    )
      this.invalid();
  }
  private narrativeFields(
    artifact: NutritionConversationalArtifactV1,
  ): readonly string[] {
    const base = [artifact.title, artifact.summary];
    if (artifact.artifactType === 'POINT_GUIDANCE')
      return [
        ...base,
        artifact.guidance.answer,
        ...artifact.guidance.rationale,
        ...artifact.guidance.actionableSteps,
        ...artifact.guidance.cautions,
      ];
    if (artifact.artifactType === 'MEAL_SUGGESTION')
      return [
        ...base,
        artifact.meal.name,
        artifact.meal.mealType ?? '',
        artifact.meal.description,
        ...artifact.meal.items.flatMap((item) => [
          item.preparationNotes ?? '',
          item.unit ?? '',
        ]),
        ...artifact.meal.alternatives,
      ];
    return [
      ...base,
      artifact.review.overallAssessment,
      ...artifact.review.strengths,
      ...artifact.review.concerns,
      ...artifact.review.recommendations,
    ];
  }
  private invalid(): never {
    throw new BadRequestException(
      'Documento nutricional conversacional V1 inválido',
    );
  }
}
