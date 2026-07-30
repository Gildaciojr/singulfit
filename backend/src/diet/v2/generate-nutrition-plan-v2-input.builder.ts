import { Injectable } from '@nestjs/common';
import { CONVERSATION_GOAL } from '../../context/conversation-goal-planner.contract';
import { NutritionArtifactResolverService } from './nutrition-artifact-resolver.service';
import {
  NUTRITION_ARTIFACT_TYPE,
  type NutritionArtifactType,
} from './nutrition-planning-artifact.contract';
import type { GenerateNutritionPlanV2Input } from './nutrition-planning-generation.contract';

export type GenerateNutritionPlanV2InputSource = Readonly<
  Omit<GenerateNutritionPlanV2Input, 'explicitArtifactType'> & {
    readonly explicitArtifactType?: NutritionArtifactType;
  }
>;

export const NUTRITION_V2_INITIAL_PLAN_ARTIFACT_TYPE =
  NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE;

@Injectable()
export class GenerateNutritionPlanV2InputBuilder {
  constructor(
    private readonly artifactResolver: NutritionArtifactResolverService,
  ) {}

  build(
    source: GenerateNutritionPlanV2InputSource,
  ): GenerateNutritionPlanV2Input {
    const resolution = this.artifactResolver.resolve({
      decision: source.decision,
      explicitArtifactType:
        source.explicitArtifactType ?? this.initialPlanArtifact(source),
    });

    return Object.freeze({
      userId: source.userId,
      decision: source.decision,
      snapshot: source.snapshot,
      referenceDate: source.referenceDate,
      explicitArtifactType: resolution.artifactType ?? undefined,
      nutritionEvidence: source.nutritionEvidence,
      previousPlan: source.previousPlan,
      reviewedPlan: source.reviewedPlan,
      requestedChangeReason: source.requestedChangeReason,
    });
  }

  private initialPlanArtifact(
    source: GenerateNutritionPlanV2InputSource,
  ): NutritionArtifactType | undefined {
    return source.decision.goal === CONVERSATION_GOAL.GENERATE_DIET_PLAN ||
      source.decision.goal === CONVERSATION_GOAL.GENERATE_COMBINED_PLANS
      ? NUTRITION_V2_INITIAL_PLAN_ARTIFACT_TYPE
      : undefined;
  }
}
