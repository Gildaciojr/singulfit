import { routingSnapshot } from '../../conversation/tests/conversation-routing.fixtures';
import type {
  GeneratedWorkoutPlanV2Candidate,
  StrengthActivity,
  WorkoutActivityV2,
  WorkoutPlanV2,
  WorkoutSessionV2,
} from './workout-plan-v2.contract';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';

export function qualityContext(
  days: readonly string[] = [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
  ],
) {
  const context = new WorkoutPlanningContextBuilder().build({
    snapshot: routingSnapshot(),
    artifactType: 'WEEKLY_PLAN',
    modality: 'GYM_STRENGTH',
    referenceDate: new Date('2026-10-03T12:00:00Z'),
    recognizedContext: {
      objective: { status: 'CONFIRMED', value: 'WEIGHT_LOSS' },
      experience: { status: 'CONFIRMED', value: 'INTERMEDIATE' },
      weeklyFrequency: { status: 'CONFIRMED', value: days.length },
      sessionDurationMinutes: { status: 'CONFIRMED', value: 60 },
      equipment: { status: 'CONFIRMED', value: ['BODYWEIGHT'] },
    },
  });
  return {
    ...context,
    training: {
      ...context.training,
      availableTrainingDays: { status: 'CONFIRMED' as const, value: days },
    },
  };
}

export function strength(key = 'strength'): StrengthActivity {
  return {
    activityKey: key,
    name: 'Agachamento controlado',
    source: 'MODEL_GENERATED',
    movementPattern: 'SQUAT',
    publicIdentity: {
      plane: 'SAGITTAL',
      targetRegion: 'HIPS',
      bodyPosition: 'STANDING',
      jointAction: null,
    },
    equipment: ['BODYWEIGHT'],
    instruction: 'Não force a amplitude.',
    alerts: [],
    appliedConstraintCodes: [],
    kind: 'STRENGTH',
    sets: 4,
    repetitions: '8–12',
    restSeconds: 90,
    intensity: 'MODERATE',
  };
}

export function qualitySession(
  key = 'session',
  activities?: readonly WorkoutActivityV2[],
): WorkoutSessionV2 {
  const base = strength(key);
  const endurance = (
    activityKey: string,
    durationMinutes: number,
  ): WorkoutActivityV2 => ({
    ...base,
    activityKey,
    name: 'Caminhada',
    kind: 'ENDURANCE',
    mode: 'WALK',
    durationMinutes,
    distanceKm: null,
    intensity: 'CONVERSATIONAL',
  });
  return {
    sessionKey: key,
    sequence: 1,
    label: 'Corpo inteiro',
    estimatedDurationMinutes: 60,
    blocks: activities
      ? [
          {
            blockKey: `${key}-main`,
            type: 'STRENGTH',
            title: 'Principal',
            estimatedDurationMinutes: 60,
            activities,
          },
        ]
      : [
          {
            blockKey: `${key}-warm`,
            type: 'WARM_UP',
            title: 'Aquecimento',
            estimatedDurationMinutes: 10,
            activities: [endurance(`${key}-warmup`, 10)],
          },
          {
            blockKey: `${key}-main`,
            type: 'STRENGTH',
            title: 'Principal',
            estimatedDurationMinutes: 45,
            activities: Array.from({ length: 5 }, (_, index) => ({
              ...strength(`${key}-${index}`),
              movementPattern: (
                ['SQUAT', 'HINGE', 'PUSH', 'PULL', 'CORE'] as const
              )[index],
            })),
          },
          {
            blockKey: `${key}-cool`,
            type: 'COOLDOWN',
            title: 'Desaceleração',
            estimatedDurationMinutes: 5,
            activities: [endurance(`${key}-cooldown`, 5)],
          },
        ],
  };
}

export function qualityCandidate(
  sessions = [qualitySession()],
): GeneratedWorkoutPlanV2Candidate {
  return {
    artifactType: 'WEEKLY_PLAN',
    modality: 'GYM_STRENGTH',
    objective: 'WEIGHT_LOSS',
    secondaryObjectives: [],
    title: 'Sua semana de treino',
    sessions,
    progression: [],
    substitutions: [],
    adaptationRules: [],
    safetyFlags: [],
  };
}

export function qualityPlan(): WorkoutPlanV2 {
  const context = qualityContext();
  return {
    ...qualityCandidate(
      Array.from({ length: 5 }, (_, index) => ({
        ...qualitySession(`session-${index}`),
        sequence: index + 1,
      })),
    ),
    schemaVersion: 2,
    lifecycleReason: 'CREATION',
    replacesPlanReference: null,
    referenceDate: context.referenceDate,
    strategy: new WorkoutPlanningStrategyService().build(context),
    appliedConstraints: [],
    personalizationFactors: [],
    generationMetadata: {
      engineVersion: 2,
      aiJobId: 'job',
      promptVersionId: 'prompt',
      operationKey: 'operation',
      model: 'model',
      generatedAt: context.referenceDate,
      reused: false,
    },
    validation: { status: 'VALID', issues: [] },
  };
}
