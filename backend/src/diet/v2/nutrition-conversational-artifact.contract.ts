import {
  NUTRITION_ARTIFACT_TYPE,
  type NutritionArtifactType,
} from './nutrition-planning-artifact.contract';

export type NutritionConversationalArtifactType =
  | typeof NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE
  | typeof NUTRITION_ARTIFACT_TYPE.MEAL_SUGGESTION
  | typeof NUTRITION_ARTIFACT_TYPE.PLAN_REVIEW;

export interface NutritionConversationalArtifactBaseV1 {
  readonly schemaVersion: '1.0';
  readonly artifactType: NutritionConversationalArtifactType;
  readonly title: string;
  readonly summary: string;
  readonly generatedAt: string;
}

export interface PointGuidanceArtifactV1 extends NutritionConversationalArtifactBaseV1 {
  readonly artifactType: typeof NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE;
  readonly guidance: {
    readonly answer: string;
    readonly rationale: readonly string[];
    readonly actionableSteps: readonly string[];
    readonly cautions: readonly string[];
  };
}

export interface MealSuggestionArtifactV1 extends NutritionConversationalArtifactBaseV1 {
  readonly artifactType: typeof NUTRITION_ARTIFACT_TYPE.MEAL_SUGGESTION;
  readonly meal: {
    readonly name: string;
    readonly mealType: string | null;
    readonly description: string;
    readonly items: readonly {
      readonly name: string;
      readonly quantity: number | null;
      readonly unit: string | null;
      readonly preparationNotes: string | null;
    }[];
    readonly estimatedNutrition: {
      readonly caloriesKcal: number | null;
      readonly proteinGrams: number | null;
      readonly carbohydrateGrams: number | null;
      readonly fatGrams: number | null;
    };
    readonly alternatives: readonly string[];
  };
}

export interface PlanReviewArtifactV1 extends NutritionConversationalArtifactBaseV1 {
  readonly artifactType: typeof NUTRITION_ARTIFACT_TYPE.PLAN_REVIEW;
  readonly reviewedPlanId: string;
  readonly review: {
    readonly overallAssessment: string;
    readonly strengths: readonly string[];
    readonly concerns: readonly string[];
    readonly recommendations: readonly string[];
  };
}

export type NutritionConversationalArtifactV1 =
  | PointGuidanceArtifactV1
  | MealSuggestionArtifactV1
  | PlanReviewArtifactV1;
export type NutritionConversationalCandidate =
  | Omit<PointGuidanceArtifactV1, 'schemaVersion' | 'generatedAt'>
  | Omit<MealSuggestionArtifactV1, 'schemaVersion' | 'generatedAt'>
  | Omit<
      PlanReviewArtifactV1,
      'schemaVersion' | 'generatedAt' | 'reviewedPlanId'
    >;

export function isNutritionConversationalArtifactType(
  value: NutritionArtifactType,
): value is NutritionConversationalArtifactType {
  return (
    value === NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE ||
    value === NUTRITION_ARTIFACT_TYPE.MEAL_SUGGESTION ||
    value === NUTRITION_ARTIFACT_TYPE.PLAN_REVIEW
  );
}

export function freezeNutritionConversationalArtifact(
  artifact: NutritionConversationalArtifactV1,
): NutritionConversationalArtifactV1 {
  if (artifact.artifactType === NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE) {
    return Object.freeze({
      ...artifact,
      guidance: Object.freeze({
        ...artifact.guidance,
        rationale: Object.freeze([...artifact.guidance.rationale]),
        actionableSteps: Object.freeze([...artifact.guidance.actionableSteps]),
        cautions: Object.freeze([...artifact.guidance.cautions]),
      }),
    });
  }
  if (artifact.artifactType === NUTRITION_ARTIFACT_TYPE.MEAL_SUGGESTION) {
    return Object.freeze({
      ...artifact,
      meal: Object.freeze({
        ...artifact.meal,
        items: Object.freeze(
          artifact.meal.items.map((item) => Object.freeze({ ...item })),
        ),
        estimatedNutrition: Object.freeze({
          ...artifact.meal.estimatedNutrition,
        }),
        alternatives: Object.freeze([...artifact.meal.alternatives]),
      }),
    });
  }
  return Object.freeze({
    ...artifact,
    review: Object.freeze({
      ...artifact.review,
      strengths: Object.freeze([...artifact.review.strengths]),
      concerns: Object.freeze([...artifact.review.concerns]),
      recommendations: Object.freeze([...artifact.review.recommendations]),
    }),
  });
}
