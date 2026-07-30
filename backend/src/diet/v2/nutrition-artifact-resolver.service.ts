import { Injectable } from '@nestjs/common';
import { CONVERSATION_GOAL } from '../../context/conversation-goal-planner.contract';
import {
  NUTRITION_ARTIFACT_TYPE,
  type NutritionArtifactResolution,
  type NutritionArtifactResolverInput,
  type NutritionArtifactType,
} from './nutrition-planning-artifact.contract';

const PLAN_CREATION_ARTIFACTS = new Set<NutritionArtifactType>([
  NUTRITION_ARTIFACT_TYPE.MEAL_SUGGESTION,
  NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE,
  NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
]);

const PLAN_UPDATE_ARTIFACTS = new Set<NutritionArtifactType>([
  NUTRITION_ARTIFACT_TYPE.PLAN_REVIEW,
  NUTRITION_ARTIFACT_TYPE.PLAN_ADAPTATION,
  NUTRITION_ARTIFACT_TYPE.FOOD_SUBSTITUTION,
]);

@Injectable()
export class NutritionArtifactResolverService {
  resolve(input: NutritionArtifactResolverInput): NutritionArtifactResolution {
    const explicit = input.explicitArtifactType;

    if (
      input.decision.goal === CONVERSATION_GOAL.GENERATE_DIET_PLAN ||
      input.decision.goal === CONVERSATION_GOAL.GENERATE_COMBINED_PLANS
    ) {
      return explicit && PLAN_CREATION_ARTIFACTS.has(explicit)
        ? this.resolved(explicit, 'EXPLICIT_ARTIFACT')
        : this.unresolved('ARTIFACT_GRANULARITY_REQUIRED');
    }

    if (input.decision.goal === CONVERSATION_GOAL.UPDATE_DIET_PLAN) {
      return explicit && PLAN_UPDATE_ARTIFACTS.has(explicit)
        ? this.resolved(explicit, 'EXPLICIT_ARTIFACT')
        : this.resolved(
            NUTRITION_ARTIFACT_TYPE.PLAN_REVIEW,
            'PLAN_REVIEW_GOAL',
          );
    }

    if (input.decision.goal === CONVERSATION_GOAL.SHOW_CURRENT_PLAN) {
      return this.resolved(
        NUTRITION_ARTIFACT_TYPE.CURRENT_PLAN_PRESENTATION,
        'CURRENT_PLAN_GOAL',
      );
    }

    if (
      input.decision.goal === CONVERSATION_GOAL.GENERAL_GUIDANCE ||
      (input.decision.goal === CONVERSATION_GOAL.ANSWER_MESSAGE &&
        input.decision.recognizedIntent === 'NUTRITION_QUESTION')
    ) {
      return this.resolved(
        NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE,
        'POINT_GUIDANCE_GOAL',
      );
    }

    return Object.freeze({
      status: 'UNSUPPORTED',
      artifactType: null,
      reason:
        input.decision.goal === CONVERSATION_GOAL.UNKNOWN
          ? 'UNKNOWN_GOAL'
          : 'NON_NUTRITION_GOAL',
    });
  }

  private resolved(
    artifactType: NutritionArtifactType,
    reason: NutritionArtifactResolution['reason'],
  ): NutritionArtifactResolution {
    return Object.freeze({ status: 'RESOLVED', artifactType, reason });
  }

  private unresolved(
    reason: NutritionArtifactResolution['reason'],
  ): NutritionArtifactResolution {
    return Object.freeze({
      status: 'REQUIRES_CLARIFICATION',
      artifactType: null,
      reason,
    });
  }
}
