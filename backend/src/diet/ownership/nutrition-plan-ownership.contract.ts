import type {
  NutritionPlanImplementation,
  NutritionPlanOwnership,
} from '@prisma/client';

export interface NutritionPlanOwnershipTarget {
  readonly userId: string;
  readonly profileId: string;
  readonly implementation: NutritionPlanImplementation;
  readonly planId: string;
  readonly aiJobId: string;
}

export interface NutritionPlanOwnershipTransitionResult {
  readonly transition: 'CREATED' | 'CHANGED' | 'REUSED';
  readonly ownership: NutritionPlanOwnership;
}
