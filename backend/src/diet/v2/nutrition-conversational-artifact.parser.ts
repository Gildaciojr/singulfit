import { BadGatewayException } from '@nestjs/common';
import type {
  NutritionConversationalArtifactType,
  NutritionConversationalCandidate,
} from './nutrition-conversational-artifact.contract';

export class NutritionConversationalArtifactParser {
  parse(
    outputText: string,
    expected: NutritionConversationalArtifactType,
  ): NutritionConversationalCandidate {
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new BadGatewayException(
        'Artifact nutricional conversacional retornou JSON inválido',
      );
    }
    const root = this.record(parsed, 'artifact');
    if (root.artifactType !== expected) this.invalid('artifactType');
    const base = {
      artifactType: expected,
      title: this.text(root.title, 'title'),
      summary: this.text(root.summary, 'summary'),
    };
    if (expected === 'POINT_GUIDANCE') {
      this.exactKeys(
        root,
        ['artifactType', 'title', 'summary', 'guidance'],
        'artifact',
      );
      const guidance = this.record(root.guidance, 'guidance');
      this.exactKeys(
        guidance,
        ['answer', 'rationale', 'actionableSteps', 'cautions'],
        'guidance',
      );
      const actionableSteps = this.texts(
        guidance.actionableSteps,
        'guidance.actionableSteps',
      );
      if (actionableSteps.length === 0)
        this.invalid('guidance.actionableSteps');
      return Object.freeze({
        ...base,
        artifactType: 'POINT_GUIDANCE',
        guidance: Object.freeze({
          answer: this.text(guidance.answer, 'guidance.answer'),
          rationale: this.texts(guidance.rationale, 'guidance.rationale'),
          actionableSteps,
          cautions: this.texts(guidance.cautions, 'guidance.cautions'),
        }),
      });
    }
    if (expected === 'MEAL_SUGGESTION') {
      this.exactKeys(
        root,
        ['artifactType', 'title', 'summary', 'meal'],
        'artifact',
      );
      const meal = this.record(root.meal, 'meal');
      this.exactKeys(
        meal,
        [
          'name',
          'mealType',
          'description',
          'items',
          'estimatedNutrition',
          'alternatives',
        ],
        'meal',
      );
      const items = this.array(meal.items, 'meal.items').map((value, index) => {
        const item = this.record(value, `meal.items.${index}`);
        this.exactKeys(
          item,
          ['name', 'quantity', 'unit', 'preparationNotes'],
          `meal.items.${index}`,
        );
        return Object.freeze({
          name: this.text(item.name, `meal.items.${index}.name`),
          quantity: this.nullableNumber(
            item.quantity,
            `meal.items.${index}.quantity`,
          ),
          unit: this.nullableText(item.unit, `meal.items.${index}.unit`),
          preparationNotes: this.nullableText(
            item.preparationNotes,
            `meal.items.${index}.preparationNotes`,
          ),
        });
      });
      if (items.length === 0) this.invalid('meal.items');
      const nutrition = this.record(
        meal.estimatedNutrition,
        'meal.estimatedNutrition',
      );
      this.exactKeys(
        nutrition,
        ['caloriesKcal', 'proteinGrams', 'carbohydrateGrams', 'fatGrams'],
        'meal.estimatedNutrition',
      );
      return Object.freeze({
        ...base,
        artifactType: 'MEAL_SUGGESTION',
        meal: Object.freeze({
          name: this.text(meal.name, 'meal.name'),
          mealType: this.nullableText(meal.mealType, 'meal.mealType'),
          description: this.text(meal.description, 'meal.description'),
          items: Object.freeze(items),
          estimatedNutrition: Object.freeze({
            caloriesKcal: this.nullableNumber(
              nutrition.caloriesKcal,
              'meal.estimatedNutrition.caloriesKcal',
            ),
            proteinGrams: this.nullableNumber(
              nutrition.proteinGrams,
              'meal.estimatedNutrition.proteinGrams',
            ),
            carbohydrateGrams: this.nullableNumber(
              nutrition.carbohydrateGrams,
              'meal.estimatedNutrition.carbohydrateGrams',
            ),
            fatGrams: this.nullableNumber(
              nutrition.fatGrams,
              'meal.estimatedNutrition.fatGrams',
            ),
          }),
          alternatives: this.texts(meal.alternatives, 'meal.alternatives'),
        }),
      });
    }
    this.exactKeys(
      root,
      ['artifactType', 'title', 'summary', 'review'],
      'artifact',
    );
    const review = this.record(root.review, 'review');
    this.exactKeys(
      review,
      ['overallAssessment', 'strengths', 'concerns', 'recommendations'],
      'review',
    );
    const strengths = this.texts(review.strengths, 'review.strengths');
    const concerns = this.texts(review.concerns, 'review.concerns');
    const recommendations = this.texts(
      review.recommendations,
      'review.recommendations',
    );
    if (strengths.length + concerns.length + recommendations.length === 0)
      this.invalid('review');
    return Object.freeze({
      ...base,
      artifactType: 'PLAN_REVIEW',
      review: Object.freeze({
        overallAssessment: this.text(
          review.overallAssessment,
          'review.overallAssessment',
        ),
        strengths,
        concerns,
        recommendations,
      }),
    });
  }

  private exactKeys(
    value: Record<string, unknown>,
    keys: readonly string[],
    path: string,
  ): void {
    if (
      Object.keys(value).length !== keys.length ||
      Object.keys(value).some((key) => !keys.includes(key))
    )
      this.invalid(path);
  }
  private record(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      this.invalid(path);
    return value as Record<string, unknown>;
  }
  private array(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) this.invalid(path);
    return value;
  }
  private text(value: unknown, path: string): string {
    if (typeof value !== 'string' || !value.trim()) this.invalid(path);
    return value.trim();
  }
  private nullableText(value: unknown, path: string): string | null {
    return value === null ? null : this.text(value, path);
  }
  private nullableNumber(value: unknown, path: string): number | null {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      this.invalid(path);
    return value;
  }
  private texts(value: unknown, path: string): readonly string[] {
    return Object.freeze(
      this.array(value, path).map((item, index) =>
        this.text(item, `${path}.${index}`),
      ),
    );
  }
  private invalid(path: string): never {
    throw new BadGatewayException(
      `Artifact nutricional conversacional inválido em ${path}`,
    );
  }
}
