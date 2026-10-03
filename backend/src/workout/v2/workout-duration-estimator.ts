import type {
  WorkoutActivityV2,
  WorkoutSessionV2,
} from './workout-plan-v2.contract';

export interface WorkoutDurationEstimate {
  readonly minimumMinutes: number;
  readonly maximumMinutes: number;
  readonly confidence: 'HIGH' | 'LOW';
}

function range(
  min: number,
  max: number,
  confidence: WorkoutDurationEstimate['confidence'] = 'HIGH',
): WorkoutDurationEstimate {
  return { minimumMinutes: min, maximumMinutes: max, confidence };
}

function repetitionRange(text: string): readonly [number, number] | null {
  const match = text
    .trim()
    .match(/^(\d+)(?:\s*[-–a]\s*(\d+))?(?:\s*(?:repetições|reps))?$/iu);
  if (!match) return null;
  const lower = Number(match[1]);
  const upper = Number(match[2] ?? match[1]);
  return lower > 0 && upper >= lower ? [lower, upper] : null;
}

export function estimateWorkoutActivity(
  activity: WorkoutActivityV2,
): WorkoutDurationEstimate {
  if (activity.kind === 'ENDURANCE')
    return range(activity.durationMinutes, activity.durationMinutes);
  // durationSeconds is the total clock; rounds/work/recovery describe its contents.
  if (activity.kind === 'TIMED') {
    const cycle =
      (activity.workSeconds ?? 0) * activity.rounds +
      (activity.recoverySeconds ?? 0) * Math.max(0, activity.rounds - 1);
    return range(
      activity.durationSeconds / 60,
      activity.durationSeconds / 60,
      cycle > activity.durationSeconds ||
        activity.workSeconds === null ||
        (activity.rounds > 1 && activity.recoverySeconds === null)
        ? 'LOW'
        : 'HIGH',
    );
  }
  if (activity.kind === 'MOBILITY') {
    if (activity.durationSeconds !== null)
      return range(
        activity.durationSeconds / 60,
        activity.durationSeconds / 60,
      );
    const repetitions = activity.repetitions
      ? repetitionRange(activity.repetitions)
      : null;
    if (activity.holdSeconds !== null && repetitions)
      return range(
        (repetitions[0] * activity.holdSeconds) / 60,
        (repetitions[1] * activity.holdSeconds) / 60,
        'LOW',
      );
    if (activity.holdSeconds !== null)
      return range(
        activity.holdSeconds / 60,
        (activity.holdSeconds * 4) / 60,
        'LOW',
      );
    return range(0.5, 5, 'LOW');
  }
  const rest = (Math.max(0, activity.sets - 1) * activity.restSeconds) / 60;
  const repetitions = repetitionRange(activity.repetitions);
  // Deliberately broad execution bounds; unilateral/open prescriptions are uncertain.
  return repetitions
    ? range(
        rest + (activity.sets * repetitions[0] * 2) / 60,
        rest + (activity.sets * repetitions[1] * 6) / 60,
        /unilateral|por lado|cada lado/iu.test(
          `${activity.name} ${activity.instruction}`,
        )
          ? 'LOW'
          : 'HIGH',
      )
    : range(rest + activity.sets * 0.25, rest + activity.sets * 2, 'LOW');
}

export function estimateWorkoutSession(
  session: WorkoutSessionV2,
): WorkoutDurationEstimate {
  const activities = session.blocks.flatMap((block) => block.activities);
  const estimates = activities.map(estimateWorkoutActivity);
  // All blocks, including warm-up/cooldown, are included once. Transitions are a range.
  const transitions = Math.max(0, activities.length - 1);
  return range(
    estimates.reduce((sum, item) => sum + item.minimumMinutes, 0) +
      transitions * 0.25,
    estimates.reduce((sum, item) => sum + item.maximumMinutes, 0) +
      transitions * 1.5,
    estimates.every((item) => item.confidence === 'HIGH') ? 'HIGH' : 'LOW',
  );
}
