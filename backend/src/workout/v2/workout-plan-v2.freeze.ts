import type {
  WorkoutActivityV2,
  WorkoutPlanV2,
} from './workout-plan-v2.contract';

function activity(item: WorkoutActivityV2): WorkoutActivityV2 {
  return Object.freeze({
    ...item,
    equipment: Object.freeze([...item.equipment]),
    alerts: Object.freeze([...item.alerts]),
    appliedConstraintCodes: Object.freeze([...item.appliedConstraintCodes]),
  });
}
export function freezeWorkoutPlanV2(plan: WorkoutPlanV2): WorkoutPlanV2 {
  return Object.freeze({
    ...plan,
    strategy: Object.freeze({
      ...plan.strategy,
      objective: Object.freeze({ ...plan.strategy.objective }),
      experience: Object.freeze({ ...plan.strategy.experience }),
      sessionDurationMinutes: Object.freeze({
        ...plan.strategy.sessionDurationMinutes,
      }),
      environment: Object.freeze({ ...plan.strategy.environment }),
      authorizedEquipment: Object.freeze([
        ...plan.strategy.authorizedEquipment,
      ]),
      requiredBlocks: Object.freeze([...plan.strategy.requiredBlocks]),
      optionalBlocks: Object.freeze([...plan.strategy.optionalBlocks]),
      intensityPolicy: Object.freeze({ ...plan.strategy.intensityPolicy }),
      progressionPolicy: Object.freeze({ ...plan.strategy.progressionPolicy }),
      appliedConstraints: Object.freeze(
        plan.strategy.appliedConstraints.map((item) =>
          Object.freeze({ ...item }),
        ),
      ),
      personalizationFactors: Object.freeze([
        ...plan.strategy.personalizationFactors,
      ]),
    }),
    sessions: Object.freeze(
      plan.sessions.map((session) =>
        Object.freeze({
          ...session,
          blocks: Object.freeze(
            session.blocks.map((block) =>
              Object.freeze({
                ...block,
                activities: Object.freeze(block.activities.map(activity)),
              }),
            ),
          ),
        }),
      ),
    ),
    progression: Object.freeze(
      plan.progression.map((item) => Object.freeze({ ...item })),
    ),
    substitutions: Object.freeze(
      plan.substitutions.map((item) => Object.freeze({ ...item })),
    ),
    adaptationRules: Object.freeze([...plan.adaptationRules]),
    appliedConstraints: Object.freeze(
      plan.appliedConstraints.map((item) => Object.freeze({ ...item })),
    ),
    personalizationFactors: Object.freeze([...plan.personalizationFactors]),
    safetyFlags: Object.freeze([...plan.safetyFlags]),
    generationMetadata: Object.freeze({ ...plan.generationMetadata }),
    validation: Object.freeze({
      ...plan.validation,
      issues: Object.freeze(
        plan.validation.issues.map((item) => Object.freeze({ ...item })),
      ),
    }),
  });
}
