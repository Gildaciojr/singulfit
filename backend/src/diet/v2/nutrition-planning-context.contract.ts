import type { ActivityLevel, FitnessGoal, Gender } from '@prisma/client';
import type { NutritionArtifactType } from './nutrition-planning-artifact.contract';
import type { NutritionPlanV2 } from './nutrition-plan-v2.contract';

export type NutritionPlanningValueStatus =
  | 'CONFIRMED'
  | 'INFERRED'
  | 'ESTIMATED'
  | 'REQUIRES_CONFIRMATION'
  | 'NOT_SET';

export type NutritionPlanningValue<T> =
  | {
      readonly status:
        | 'CONFIRMED'
        | 'INFERRED'
        | 'ESTIMATED'
        | 'REQUIRES_CONFIRMATION';
      readonly value: T;
    }
  | {
      readonly status: 'NOT_SET';
    };

export const NUTRITION_CONSTRAINT_CODE = {
  LACTOSE: 'LACTOSE',
  MILK: 'MILK',
  GLUTEN: 'GLUTEN',
  PEANUT: 'PEANUT',
  TREE_NUT: 'TREE_NUT',
  EGG: 'EGG',
  SOY: 'SOY',
  FISH: 'FISH',
  SHELLFISH: 'SHELLFISH',
  VEGETARIAN: 'VEGETARIAN',
  VEGAN: 'VEGAN',
  CUSTOM: 'CUSTOM',
} as const;

export type NutritionConstraintCode =
  (typeof NUTRITION_CONSTRAINT_CODE)[keyof typeof NUTRITION_CONSTRAINT_CODE];

export interface NutritionConstraintFact {
  readonly code: NutritionConstraintCode;
  readonly label: string;
  readonly kind: 'ALLERGY' | 'RESTRICTION' | 'DIETARY_PATTERN';
  readonly status: 'CONFIRMED' | 'INFERRED' | 'REQUIRES_CONFIRMATION';
}

export interface NutritionFoodPreferenceFact {
  readonly foodName: string;
  readonly disposition: 'PREFERRED' | 'FREQUENT' | 'AVOIDED' | 'REJECTED';
  readonly confidence: number;
}

export interface NutritionEvidenceSummary {
  readonly category: 'MEAL' | 'PROGRESS' | 'LONGITUDINAL';
  readonly observedAt: string;
  readonly summaryCode: string;
  readonly values: Readonly<Record<string, string | number | boolean>>;
}

export interface NutritionPreviousPlanSummary {
  readonly artifactType: NutritionArtifactType;
  readonly title: string;
  readonly objectiveSummary: string;
  readonly days: readonly {
    readonly dayNumber: number;
    readonly label: string;
    readonly trainingDay: boolean;
    readonly meals: readonly {
      readonly name: string;
      readonly period: string;
      readonly suggestedTime: string | null;
      readonly items: readonly {
        readonly foodName: string;
        readonly role: string;
        readonly quantity: string;
      }[];
    }[];
  }[];
  readonly validationStatus: NutritionPlanV2['validation']['status'];
}

export interface NutritionPlanningContext {
  readonly schemaVersion: 2;
  readonly artifactType: NutritionArtifactType;
  readonly referenceDate: string;
  readonly profile: {
    readonly sex: NutritionPlanningValue<Gender>;
    readonly ageYears: NutritionPlanningValue<number>;
    readonly heightCm: NutritionPlanningValue<number>;
    readonly currentWeightKg: NutritionPlanningValue<number>;
    readonly targetWeightKg: NutritionPlanningValue<number>;
    readonly activityLevel: NutritionPlanningValue<ActivityLevel>;
    readonly primaryGoal: NutritionPlanningValue<FitnessGoal>;
  };
  readonly routine: {
    readonly desiredMealCount: NutritionPlanningValue<number>;
    readonly mealTimes: NutritionPlanningValue<readonly string[]>;
    readonly trainingTime: NutritionPlanningValue<string>;
    readonly cookingAvailability: NutritionPlanningValue<string>;
    readonly mealsAwayFromHome: NutritionPlanningValue<boolean>;
    readonly foodBudget: NutritionPlanningValue<string>;
    readonly eatingPattern: NutritionPlanningValue<string>;
    readonly eatingOutFrequency: NutritionPlanningValue<string>;
    readonly hydration: NutritionPlanningValue<string>;
    readonly supplementation: NutritionPlanningValue<readonly string[]>;
  };
  readonly constraints: readonly NutritionConstraintFact[];
  readonly preferences: readonly NutritionFoodPreferenceFact[];
  readonly nutritionEvidence: readonly NutritionEvidenceSummary[];
  readonly currentWorkoutAvailable: boolean;
  readonly currentDietAvailable: boolean;
  readonly previousPlan: NutritionPreviousPlanSummary | null;
  readonly requestedChangeReason:
    | 'USER_REQUEST'
    | 'ADHERENCE'
    | 'PROGRESS'
    | 'ROUTINE_CHANGE'
    | 'SAFETY_REVIEW'
    | null;
}

export interface NutritionPlanningContextBuilderInput {
  readonly snapshot: import('../../context/coach-profile-snapshot.contract').CoachProfileSnapshot;
  readonly artifactType: NutritionArtifactType;
  readonly referenceDate: Date;
  readonly nutritionEvidence?: readonly NutritionEvidenceSummary[];
  readonly previousPlan?: NutritionPlanV2;
  readonly requestedChangeReason?: NutritionPlanningContext['requestedChangeReason'];
}
