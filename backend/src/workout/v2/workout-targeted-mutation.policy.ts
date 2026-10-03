import { BadGatewayException } from '@nestjs/common';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutPlanV2,
  WorkoutActivityV2,
} from './workout-plan-v2.contract';

export function applyWorkoutTargetedMutation(
  candidate: GeneratedWorkoutPlanV2Candidate,
  source: WorkoutPlanV2,
  activityKey: string,
): GeneratedWorkoutPlanV2Candidate {
  const activities = source.sessions.flatMap((session) =>
    session.blocks.flatMap((block) => block.activities),
  );
  const originals = activities.filter(
    (activity) => activity.activityKey === activityKey,
  );
  const link = candidate.substitutions.filter(
    (item) => item.sourceActivityKey === activityKey,
  );
  const replacementKey =
    link.length === 1 ? link[0].alternativeActivityKey : activityKey;
  const proposed = candidate.sessions
    .flatMap((session) => session.blocks.flatMap((block) => block.activities))
    .filter((activity) => activity.activityKey === replacementKey);
  if (
    originals.length !== 1 ||
    proposed.length !== 1 ||
    proposed[0].movementPattern !== originals[0].movementPattern ||
    proposed[0].kind !== originals[0].kind ||
    proposed[0].name === originals[0].name
  )
    throw new BadGatewayException(
      'Workout substitution does not preserve the target function',
    );
  const replacement = Object.freeze({
    ...preserveDose(originals[0], proposed[0]),
    activityKey,
  });
  return Object.freeze({
    ...candidate,
    artifactType: 'EXERCISE_SUBSTITUTION',
    title: source.title,
    modality: source.modality,
    objective: source.objective,
    secondaryObjectives: source.secondaryObjectives,
    sessions: Object.freeze(
      source.sessions.map((session) =>
        Object.freeze({
          ...session,
          blocks: Object.freeze(
            session.blocks.map((block) =>
              Object.freeze({
                ...block,
                activities: Object.freeze(
                  block.activities.map((activity) =>
                    activity.activityKey === activityKey
                      ? replacement
                      : activity,
                  ),
                ),
              }),
            ),
          ),
        }),
      ),
    ),
    progression: source.progression,
    substitutions: source.substitutions,
    adaptationRules: source.adaptationRules,
    safetyFlags: source.safetyFlags,
  });
}

/** Exercise identity can change without silently increasing the prescribed dose. */
function preserveDose(
  original: WorkoutActivityV2,
  proposal: WorkoutActivityV2,
): WorkoutActivityV2 {
  if (original.kind === 'STRENGTH' && proposal.kind === 'STRENGTH')
    return {
      ...proposal,
      sets: original.sets,
      repetitions: original.repetitions,
      restSeconds: original.restSeconds,
      intensity: original.intensity,
    };
  if (original.kind === 'TIMED' && proposal.kind === 'TIMED')
    return {
      ...proposal,
      durationSeconds: original.durationSeconds,
      workSeconds: original.workSeconds,
      recoverySeconds: original.recoverySeconds,
      rounds: original.rounds,
      intensity: original.intensity,
    };
  if (original.kind === 'ENDURANCE' && proposal.kind === 'ENDURANCE')
    return {
      ...proposal,
      durationMinutes: original.durationMinutes,
      distanceKm: original.distanceKm,
      intensity: original.intensity,
    };
  if (original.kind === 'MOBILITY' && proposal.kind === 'MOBILITY')
    return {
      ...proposal,
      repetitions: original.repetitions,
      holdSeconds: original.holdSeconds,
      durationSeconds: original.durationSeconds,
    };
  throw new BadGatewayException('Workout substitution kind mismatch');
}
