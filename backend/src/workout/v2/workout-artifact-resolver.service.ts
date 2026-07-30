import { Injectable } from '@nestjs/common';
import { CONVERSATION_GOAL } from '../../context/conversation-goal-planner.contract';
import {
  WORKOUT_ARTIFACT_TYPE,
  type WorkoutArtifactResolution,
  type WorkoutArtifactResolverInput,
} from './workout-planning-artifact.contract';

@Injectable()
export class WorkoutArtifactResolverService {
  resolve(input: WorkoutArtifactResolverInput): WorkoutArtifactResolution {
    const goal = input.decision.goal;
    if (
      goal === CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN ||
      goal === CONVERSATION_GOAL.GENERATE_COMBINED_PLANS
    ) {
      if (!input.explicitArtifactType) return this.clarify('ARTIFACT_REQUIRED');
      if (!input.explicitModality) return this.clarify('MODALITY_REQUIRED');
      return this.resolved(input.explicitArtifactType, input.explicitModality);
    }
    if (goal === CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN) {
      if (!input.explicitModality) return this.clarify('MODALITY_REQUIRED');
      return this.resolved(
        input.explicitArtifactType ?? WORKOUT_ARTIFACT_TYPE.PLAN_REVIEW,
        input.explicitModality,
        input.explicitArtifactType ? 'EXPLICIT_REQUEST' : 'PLAN_REVIEW_GOAL',
      );
    }
    if (goal === CONVERSATION_GOAL.SHOW_CURRENT_PLAN) {
      if (!input.explicitModality) return this.clarify('MODALITY_REQUIRED');
      return this.resolved(
        WORKOUT_ARTIFACT_TYPE.CURRENT_PLAN_PRESENTATION,
        input.explicitModality,
        'CURRENT_PLAN_GOAL',
      );
    }
    if (goal === CONVERSATION_GOAL.GENERAL_GUIDANCE) {
      if (!input.explicitModality) return this.clarify('MODALITY_REQUIRED');
      return this.resolved(
        WORKOUT_ARTIFACT_TYPE.POINT_GUIDANCE,
        input.explicitModality,
        'POINT_GUIDANCE_GOAL',
      );
    }
    return Object.freeze({
      status: 'UNSUPPORTED',
      artifactType: null,
      modality: null,
      reason:
        goal === CONVERSATION_GOAL.UNKNOWN
          ? 'UNKNOWN_GOAL'
          : 'NON_WORKOUT_GOAL',
    });
  }

  private resolved(
    artifactType: NonNullable<WorkoutArtifactResolution['artifactType']>,
    modality: NonNullable<WorkoutArtifactResolution['modality']>,
    reason: WorkoutArtifactResolution['reason'] = 'EXPLICIT_REQUEST',
  ): WorkoutArtifactResolution {
    return Object.freeze({
      status: 'RESOLVED',
      artifactType,
      modality,
      reason,
    });
  }

  private clarify(
    reason: WorkoutArtifactResolution['reason'],
  ): WorkoutArtifactResolution {
    return Object.freeze({
      status: 'REQUIRES_CLARIFICATION',
      artifactType: null,
      modality: null,
      reason,
    });
  }
}
