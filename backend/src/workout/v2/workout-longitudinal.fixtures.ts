import { FitnessGoal } from '@prisma/client';
import {
  knownDatum,
  routingSnapshot,
} from '../../conversation/tests/conversation-routing.fixtures';
import type { WorkoutPlanV2 } from './workout-plan-v2.contract';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import type { WorkoutRecognizedContext } from './workout-planning-context.contract';

export const historicalWorkoutContext: WorkoutRecognizedContext = {
  modality: { status: 'CONFIRMED', value: 'GYM_STRENGTH' },
  objective: { status: 'CONFIRMED', value: 'GENERAL_HEALTH' },
  experience: { status: 'CONFIRMED', value: 'INTERMEDIATE' },
  environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
  equipment: {
    status: 'CONFIRMED',
    value: ['BARBELL', 'DUMBBELL', 'BODYWEIGHT'],
  },
  weeklyFrequency: { status: 'CONFIRMED', value: 5 },
  sessionDurationMinutes: { status: 'CONFIRMED', value: 45 },
  availableTrainingDays: {
    status: 'CONFIRMED',
    value: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
  },
};

export function longitudinalWorkoutSnapshot() {
  const base = routingSnapshot({ workoutAvailable: true });
  return {
    ...base,
    nutrition: {
      ...base.nutrition,
      primaryGoal: knownDatum(FitnessGoal.MAINTENANCE),
    },
    training: {
      ...base.training,
      primaryGoal: knownDatum(FitnessGoal.MAINTENANCE),
      experienceLevel: knownDatum('INTERMEDIATE'),
      preferredModality: knownDatum('GYM'),
      weeklyFrequency: knownDatum(5),
      sessionDurationMinutes: knownDatum(45),
      environment: knownDatum('FULL_GYM'),
      availableEquipment: knownDatum(['BARBELL', 'DUMBBELL', 'BODYWEIGHT']),
    },
    routine: {
      ...base.routine,
      availableTrainingDays: knownDatum([
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
      ]),
    },
  };
}

export function historicalWorkoutPlan(aiJobId = 'previous-job'): WorkoutPlanV2 {
  const context = new WorkoutPlanningContextBuilder().build({
    snapshot: longitudinalWorkoutSnapshot(),
    artifactType: 'WEEKLY_PLAN',
    modality: 'GYM_STRENGTH',
    recognizedContext: historicalWorkoutContext,
    referenceDate: new Date('2026-06-01T12:00:00Z'),
  });
  const strategy = new WorkoutPlanningStrategyService().build(context);
  return {
    schemaVersion: 2,
    artifactType: 'WEEKLY_PLAN',
    modality: 'GYM_STRENGTH',
    objective: 'GENERAL_HEALTH',
    lifecycleReason: 'CREATION',
    replacesPlanReference: null,
    title: 'Academia 5x',
    referenceDate: context.referenceDate,
    strategy,
    sessions: Array.from({ length: 5 }, (_, index) => ({
      sessionKey: `session-${index + 1}`,
      sequence: index + 1,
      label: `Divisão antiga ${index + 1}`,
      estimatedDurationMinutes: 45,
      blocks: [
        {
          blockKey: `block-${index + 1}`,
          type: 'STRENGTH',
          title: 'Força',
          estimatedDurationMinutes: 30,
          activities: [
            {
              activityKey: `activity-${index + 1}`,
              name: index === 0 ? 'Supino' : `Exercício ${index + 1}`,
              source: 'MODEL_GENERATED',
              movementPattern: 'OTHER',
              equipment: ['BARBELL'],
              instruction: 'Execute com controle',
              alerts: [],
              appliedConstraintCodes: [],
              kind: 'STRENGTH',
              sets: 3,
              repetitions: '10',
              restSeconds: 60,
              intensity: 'MODERATE',
            },
          ],
        },
      ],
    })),
    progression: [],
    substitutions: [],
    adaptationRules: [],
    appliedConstraints: [],
    personalizationFactors: strategy.personalizationFactors,
    safetyFlags: [],
    generationMetadata: {
      engineVersion: 2,
      promptVersionId: 'prompt',
      aiJobId,
      operationKey: 'previous-operation',
      model: 'controlled',
      generatedAt: context.referenceDate,
      reused: false,
    },
    validation: { status: 'VALID', issues: [] },
  };
}
