import type {
  WorkoutPlanningStrategy,
  WorkoutBlockType,
} from './workout-planning-strategy.contract';
import type {
  WorkoutActivityV2,
  GeneratedWorkoutPlanV2Candidate,
  WorkoutPlanValidationIssue,
} from './workout-plan-v2.contract';

function positiveExecutionText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[.;!\n]/u)
    .filter((part) => !/^\s*(?:nao|evite|sem)\b/u.test(part))
    .join(' ');
}

export function workoutModalityActivityIssue(
  activity: WorkoutActivityV2,
  block: WorkoutBlockType,
  strategy: WorkoutPlanningStrategy,
): WorkoutPlanValidationIssue | null {
  const walking =
    strategy.modality === 'WALKING' &&
    strategy.runningTransitionAuthorized !== true;
  const text = positiveExecutionText(
    `${activity.name}. ${activity.instruction}`,
  );
  const runningText =
    /\b(?:corrida|correr|corra|trote|trotes|jogging|jog|sprints?|run(?:\s*\/\s*walk)?|fartlek)\b/u.test(
      text,
    );
  let invalid = false;
  if (walking)
    invalid =
      (activity.kind === 'ENDURANCE' && activity.mode !== 'WALK') ||
      runningText;
  if (strategy.modality === 'ACTIVE_RECOVERY')
    invalid = 'intensity' in activity && activity.intensity === 'HIGH';
  if (
    strategy.modality === 'CYCLING' &&
    block === 'ENDURANCE' &&
    activity.kind === 'ENDURANCE'
  )
    invalid = activity.mode !== 'CYCLE';
  return invalid
    ? {
        code: 'MODALITY_ACTIVITY_CONFLICT',
        severity: 'ERROR',
        path: activity.activityKey,
      }
    : null;
}

export function workoutModalityPlanIssues(
  candidate: GeneratedWorkoutPlanV2Candidate,
  strategy: WorkoutPlanningStrategy,
): readonly WorkoutPlanValidationIssue[] {
  const issues = candidate.sessions.flatMap((session) =>
    session.blocks.flatMap((block) =>
      block.activities.flatMap((activity) => {
        const issue = workoutModalityActivityIssue(
          activity,
          block.type,
          strategy,
        );
        return issue ? [issue] : [];
      }),
    ),
  );
  if (
    strategy.modality === 'WALKING' &&
    strategy.runningTransitionAuthorized !== true
  ) {
    const publicTexts = [
      candidate.title,
      ...candidate.adaptationRules,
      ...candidate.sessions.flatMap((session) => [
        session.label,
        ...session.blocks.flatMap((block) => [
          block.title,
          ...block.activities.flatMap((activity) => activity.alerts),
        ]),
      ]),
    ];
    if (
      publicTexts.some((text) =>
        /\b(?:corrida|correr|trote|trotes|jogging|sprints?|run|fartlek)\b/u.test(
          positiveExecutionText(text),
        ),
      )
    )
      issues.push({
        code: 'MODALITY_ACTIVITY_CONFLICT',
        severity: 'ERROR',
        path: 'modality.publicText',
      });
  }
  // Running plans may legitimately use WALK for warm-up, recovery and beginner run/walk.
  // CrossFit legitimately mixes locomotion, lifting and gymnastics within its WOD roles.
  return issues;
}
