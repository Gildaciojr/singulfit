import { BadRequestException, Injectable } from '@nestjs/common';
import type { NutritionConversationalArtifactV1 } from './nutrition-conversational-artifact.contract';

@Injectable()
export class NutritionConversationalArtifactValidator {
  validate(artifact: NutritionConversationalArtifactV1): void {
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
  private invalid(): never {
    throw new BadRequestException(
      'Documento nutricional conversacional V1 inválido',
    );
  }
}
