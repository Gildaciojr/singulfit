import { Injectable } from '@nestjs/common';
import { WORKOUT_ARTIFACT_TYPE } from './workout-planning-artifact.contract';
import type { WorkoutPlanningContext } from './workout-planning-context.contract';
import type {
  WorkoutPersonalizationFactor,
  WorkoutPlanningStrategy,
} from './workout-planning-strategy.contract';

/** Compatibility document and hard constraints; the model chooses training content. */
@Injectable()
export class WorkoutPlanningStrategyService {
  build(context: WorkoutPlanningContext): WorkoutPlanningStrategy {
    const factors: WorkoutPersonalizationFactor[] = ['MODALITY'];
    if (context.training.objective.status !== 'NOT_SET')
      factors.push('OBJECTIVE');
    if (
      context.training.secondaryObjectives.status !== 'NOT_SET' &&
      !factors.includes('OBJECTIVE')
    )
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
    if (context.profile.sex.status !== 'NOT_SET') factors.push('SEX');
    if (context.training.muscleFocus.status !== 'NOT_SET')
      factors.push('MUSCLE_FOCUS');
    if (context.training.formatPreference.status !== 'NOT_SET')
      factors.push('FORMAT_PREFERENCE');
    if (context.training.availableTrainingDays.status !== 'NOT_SET')
      factors.push('AVAILABLE_TRAINING_DAYS');
    if (context.training.dailyTrainingWindows.status !== 'NOT_SET')
      factors.push('DAILY_TRAINING_WINDOWS');
    if (context.training.targetDistanceKm.status !== 'NOT_SET')
      factors.push('TARGET_DISTANCE');
    if (context.training.currentRunningDistanceKm.status !== 'NOT_SET')
      factors.push('CURRENT_RUNNING_DISTANCE');
    if (context.training.targetEventDate.status !== 'NOT_SET')
      factors.push('TARGET_EVENT_DATE');
    if (context.progressEvidence.length > 0) factors.push('PROGRESS_EVIDENCE');
    if (context.previousPlan) factors.push('PREVIOUS_PLAN');

    const limited =
      context.safetySignals.length > 0 ||
      context.movementConstraints.length > 0;
    const experience = context.training.experience;
    const modality =
      context.modality.status === 'NOT_SET'
        ? 'GENERAL_FITNESS'
        : context.modality.value;
    return Object.freeze({
      schemaVersion: 2,
      artifactType: context.artifactType,
      modality,
      runningTransitionPermission:
        context.runningTransitionPermission ?? 'UNSPECIFIED',
      runningTransitionAuthorized:
        modality === 'WALKING' &&
        context.runningTransitionPermission === 'ALLOW',
      objective: context.training.objective,
      secondaryObjectives:
        context.training.secondaryObjectives.status === 'NOT_SET'
          ? []
          : context.training.secondaryObjectives.value,
      experience,
      sessionCount: this.sessionCount(context),
      // Legacy document fields remain compatible; none dictates the AI's composition.
      sessionFocuses: Object.freeze([]),
      recoveryGuidance: '',
      sessionDurationMinutes: context.training.sessionDurationMinutes,
      environment: context.training.environment,
      authorizedEquipment: Object.freeze([
        ...new Set([
          ...(context.training.equipment.status === 'NOT_SET'
            ? []
            : context.training.equipment.value),
          'BODYWEIGHT' as const,
        ]),
      ]),
      muscleFocus:
        context.training.muscleFocus.status === 'NOT_SET'
          ? []
          : context.training.muscleFocus.value,
      requiredBlocks: Object.freeze([]),
      optionalBlocks: Object.freeze([]),
      maximumActivitiesPerSession: 100,
      technicalMovementsAllowed:
        !limited &&
        experience.status === 'CONFIRMED' &&
        experience.value !== 'BEGINNER',
      intensityPolicy: Object.freeze({
        scale: 'QUALITATIVE' as const,
        minimum: null,
        maximum: null,
        qualitativeLevel: limited
          ? ('LIGHT' as const)
          : context.training.intensityPreference.status === 'NOT_SET'
            ? ('MODERATE' as const)
            : context.training.intensityPreference.value,
        // Capability is not permission to invent a confirmed metric. Each typed
        // prescription still requires contextual validation and provenance.
        exactLoadAllowed: context.safetySignals.length === 0,
        exactPaceAllowed: context.safetySignals.length === 0,
        exactPowerAllowed: context.safetySignals.length === 0,
        exactHeartRateAllowed: context.safetySignals.length === 0,
      }),
      progressionPolicy: Object.freeze({
        initialState: limited ? ('REASSESS' as const) : ('MAINTAIN' as const),
        maximumWeeklyIncreasePercent: 100,
        simultaneousVariablesAllowed: 1 as const,
        requiresCompletedSessions: true,
        blocksOnSafetyFlag: true as const,
      }),
      appliedConstraints: context.movementConstraints,
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
      (context.artifactType === WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN ||
        context.artifactType === WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION) &&
      context.training.weeklyFrequency.status !== 'NOT_SET'
    )
      return Math.min(7, context.training.weeklyFrequency.value);
    if (
      (context.artifactType === WORKOUT_ARTIFACT_TYPE.PLAN_ADAPTATION ||
        context.artifactType === WORKOUT_ARTIFACT_TYPE.EXERCISE_SUBSTITUTION) &&
      context.previousPlan
    ) {
      return context.previousPlan.sessionCount;
    }
    return 1;
  }
}
