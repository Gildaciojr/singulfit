import { Injectable } from '@nestjs/common';
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
} from './workout-planning-artifact.contract';
import type { WorkoutPlanningContext } from './workout-planning-context.contract';
import type {
  WorkoutBlockType,
  WorkoutPersonalizationFactor,
  WorkoutPlanningStrategy,
} from './workout-planning-strategy.contract';

@Injectable()
export class WorkoutPlanningStrategyService {
  build(context: WorkoutPlanningContext): WorkoutPlanningStrategy {
    const factors: WorkoutPersonalizationFactor[] = ['MODALITY'];
    if (context.training.objective.status !== 'NOT_SET')
      factors.push('OBJECTIVE');
    if (context.training.experience.status !== 'NOT_SET')
      factors.push('EXPERIENCE');
    if (context.training.weeklyFrequency.status !== 'NOT_SET')
      factors.push('FREQUENCY');
    if (context.training.sessionDurationMinutes.status !== 'NOT_SET')
      factors.push('DURATION');
    if (context.training.environment.status !== 'NOT_SET')
      factors.push('ENVIRONMENT');
    if (context.training.equipment.status !== 'NOT_SET')
      factors.push('EQUIPMENT');
    if (context.movementConstraints.length > 0) factors.push('LIMITATIONS');
    if (context.training.perceivedConditioning.status !== 'NOT_SET')
      factors.push('CONDITIONING');
    if (context.training.intensityPreference.status !== 'NOT_SET')
      factors.push('INTENSITY_PREFERENCE');
    if (context.progressEvidence.length > 0) factors.push('PROGRESS_EVIDENCE');
    if (context.previousPlan) factors.push('PREVIOUS_PLAN');

    const experience = context.training.experience;
    const level =
      experience.status === 'NOT_SET' ? 'BEGINNER' : experience.value;
    const intensityLevel =
      context.training.intensityPreference.status === 'CONFIRMED'
        ? context.training.intensityPreference.value
        : level === 'ADVANCED'
          ? 'HIGH'
          : 'MODERATE';
    const [minimum, maximum] =
      intensityLevel === 'LIGHT'
        ? [3, 5]
        : intensityLevel === 'HIGH' && level !== 'BEGINNER'
          ? [6, 8]
          : [4, 7];
    const blocks = this.blocks(
      context.modality.status === 'NOT_SET'
        ? 'GENERAL_FITNESS'
        : context.modality.value,
      context.training.objective.status === 'NOT_SET'
        ? null
        : context.training.objective.value,
    );
    const technicalMovementsAllowed =
      level !== 'BEGINNER' &&
      context.training.experience.status === 'CONFIRMED';

    return Object.freeze({
      schemaVersion: 2,
      artifactType: context.artifactType,
      modality:
        context.modality.status === 'NOT_SET'
          ? WORKOUT_MODALITY.GENERAL_FITNESS
          : context.modality.value,
      objective: Object.freeze({ ...context.training.objective }),
      experience: Object.freeze({ ...context.training.experience }),
      sessionCount: this.sessionCount(context),
      sessionDurationMinutes: Object.freeze({
        ...context.training.sessionDurationMinutes,
      }),
      environment: Object.freeze({ ...context.training.environment }),
      authorizedEquipment:
        context.training.equipment.status === 'NOT_SET'
          ? Object.freeze([])
          : Object.freeze([...context.training.equipment.value]),
      requiredBlocks: Object.freeze(blocks.required),
      optionalBlocks: Object.freeze(blocks.optional),
      maximumActivitiesPerSession:
        level === 'BEGINNER' ? 8 : level === 'INTERMEDIATE' ? 10 : 12,
      technicalMovementsAllowed,
      intensityPolicy: Object.freeze({
        scale: this.intensityScale(context),
        minimum,
        maximum,
        qualitativeLevel:
          intensityLevel === 'HIGH' && level === 'BEGINNER'
            ? 'MODERATE'
            : intensityLevel,
        exactLoadAllowed: false,
        exactPaceAllowed: false,
        exactPowerAllowed: false,
      }),
      progressionPolicy: Object.freeze({
        initialState:
          context.safetySignals.length > 0 ? 'REASSESS' : 'MAINTAIN',
        maximumWeeklyIncreasePercent: level === 'BEGINNER' ? 5 : 10,
        simultaneousVariablesAllowed: 1,
        requiresCompletedSessions: true,
        blocksOnSafetyFlag: true,
      }),
      appliedConstraints: Object.freeze(
        context.movementConstraints.map((constraint) =>
          Object.freeze({ ...constraint }),
        ),
      ),
      personalizationFactors: Object.freeze(factors),
    });
  }

  private sessionCount(context: WorkoutPlanningContext): number {
    if (
      context.artifactType === WORKOUT_ARTIFACT_TYPE.POINT_GUIDANCE ||
      context.artifactType === WORKOUT_ARTIFACT_TYPE.PLAN_REVIEW ||
      context.artifactType === WORKOUT_ARTIFACT_TYPE.CURRENT_PLAN_PRESENTATION
    )
      return 0;
    if (
      context.artifactType === WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN &&
      context.training.weeklyFrequency.status !== 'NOT_SET'
    )
      return Math.min(7, context.training.weeklyFrequency.value);
    return 1;
  }

  private blocks(
    modality: WorkoutPlanningStrategy['modality'],
    objective: string | null,
  ): { required: WorkoutBlockType[]; optional: WorkoutBlockType[] } {
    if (
      modality === WORKOUT_MODALITY.RUNNING ||
      modality === WORKOUT_MODALITY.WALKING ||
      modality === WORKOUT_MODALITY.CYCLING
    ) {
      return {
        required: ['WARM_UP', 'ENDURANCE', 'COOLDOWN'],
        optional: ['INTERVAL', 'MOBILITY'],
      };
    }
    if (modality === WORKOUT_MODALITY.CROSSFIT) {
      return {
        required: ['WARM_UP', 'TECHNIQUE', 'CONDITIONING', 'COOLDOWN'],
        optional: ['STRENGTH', 'MOBILITY'],
      };
    }
    if (modality === WORKOUT_MODALITY.MOBILITY) {
      return { required: ['MOBILITY', 'RECOVERY'], optional: ['WARM_UP'] };
    }
    if (modality === WORKOUT_MODALITY.ACTIVE_RECOVERY) {
      return { required: ['RECOVERY', 'MOBILITY'], optional: ['COOLDOWN'] };
    }
    return {
      required: [
        'WARM_UP',
        objective === 'HYPERTROPHY' ? 'HYPERTROPHY' : 'STRENGTH',
        'COOLDOWN',
      ],
      optional: ['CORE', 'CONDITIONING', 'MOBILITY'],
    };
  }

  private intensityScale(
    context: WorkoutPlanningContext,
  ): WorkoutPlanningStrategy['intensityPolicy']['scale'] {
    const modality =
      context.modality.status === 'NOT_SET'
        ? WORKOUT_MODALITY.GENERAL_FITNESS
        : context.modality.value;
    if (
      modality === WORKOUT_MODALITY.RUNNING ||
      modality === WORKOUT_MODALITY.WALKING
    )
      return 'CONVERSATIONAL_PACE';
    if (
      modality === WORKOUT_MODALITY.CYCLING ||
      modality === WORKOUT_MODALITY.CARDIO_CONDITIONING
    )
      return 'RPE';
    return 'RPE';
  }
}
