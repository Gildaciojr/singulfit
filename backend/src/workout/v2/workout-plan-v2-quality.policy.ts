import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutPlanValidationIssue,
  WorkoutActivityV2,
} from './workout-plan-v2.contract';
import type { WorkoutPlanningContext } from './workout-planning-context.contract';
import type { WorkoutPlanningStrategy } from './workout-planning-strategy.contract';

export function workoutStructuralActivityIssue(
  activity: WorkoutActivityV2,
  strategy?: WorkoutPlanningStrategy,
): WorkoutPlanValidationIssue | null {
  if (activity.kind === 'ENDURANCE') {
    const name = activity.name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim()
      .toLowerCase();
    const cycling =
      /^(?:(?:treino|passeio)\s+(?:de\s+)?)?(?:bicicleta|bike|ciclismo|pedalada)\b/u.test(
        name,
      );
    const foot =
      /^(?:(?:treino|passeio)\s+(?:de\s+)?)?(?:caminhada|corrida|caminhar|correr)\b/u.test(
        name,
      );
    const running = /\b(?:corrida|correr|trote|jogging|sprint|run)\b/u.test(
      name,
    );
    if (
      activity.mode === 'CYCLE'
        ? foot || activity.equipment.includes('TREADMILL')
        : cycling ||
          activity.equipment.includes('BIKE') ||
          (activity.mode === 'WALK' &&
            running &&
            strategy?.runningTransitionAuthorized !== true)
    )
      return {
        code: 'ENDURANCE_MODE_CONFLICT',
        severity: 'ERROR',
        path: activity.activityKey,
      };
  }
  if (activity.kind === 'TIMED') {
    const minimum =
      (activity.workSeconds ?? 0) * activity.rounds +
      (activity.recoverySeconds ?? 0) * Math.max(0, activity.rounds - 1);
    if (activity.workSeconds !== null && minimum > activity.durationSeconds)
      return {
        code: 'TIMED_DURATION_IMPOSSIBLE',
        severity: 'ERROR',
        path: activity.activityKey,
      };
    if (
      activity.workSeconds === null ||
      (activity.rounds > 1 && activity.recoverySeconds === null)
    )
      return {
        code: 'TIMED_DURATION_UNCERTAIN',
        severity: activity.rounds > 1 ? 'ERROR' : 'WARNING',
        path: activity.activityKey,
      };
  }
  return null;
}

/** Names identify executable activities; negative coaching instructions are untouched. */
export function hasInvalidWorkoutActivityName(name: string): boolean {
  const value = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
  return (
    /\b(?:nao disponivel|indisponivel|nao definido|nao informad[oa]|a definir|placeholder|pendente|ausente)\b/u.test(
      value,
    ) ||
    /^(?:sem|nenhum[ao]?)\s+(?:equipamento|exercicio|atividade|bicicleta)\b/u.test(
      value,
    ) ||
    /^(?:substituir|selecionar|escolher|inserir|definir|gerar)\b/u.test(
      value,
    ) ||
    /^(?:n\/a|null|undefined|tbd|[-?]+)$/u.test(value)
  );
}

export function workoutWeeklyRecoveryIssues(
  candidate: GeneratedWorkoutPlanV2Candidate,
  context: WorkoutPlanningContext,
): readonly WorkoutPlanValidationIssue[] {
  const available = context.training.availableTrainingDays;
  if (
    available.status !== 'CONFIRMED' ||
    available.value.length < candidate.sessions.length
  )
    return [];
  const order = [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ];
  const sessions = candidate.sessions.map((session, index) => ({
    session,
    day: order.indexOf(available.value[index]),
  }));
  const issues: WorkoutPlanValidationIssue[] = [];
  for (const current of sessions) {
    const next = sessions.find((item) => item.day === (current.day + 1) % 7);
    if (current.day < 0 || !next) continue;
    const loaded = (session: typeof current.session) =>
      session.blocks
        .flatMap((block) => block.activities)
        .filter(
          (activity) =>
            activity.kind === 'STRENGTH' && activity.intensity !== 'LIGHT',
        );
    for (const pattern of ['SQUAT', 'HINGE', 'PUSH', 'PULL'] as const) {
      const volume = (session: typeof current.session) =>
        loaded(session).reduce(
          (sum, activity) =>
            sum +
            (activity.kind === 'STRENGTH' &&
            activity.movementPattern === pattern
              ? activity.sets
              : 0),
          0,
        );
      const threshold =
        context.training.experience.status !== 'NOT_SET' &&
        context.training.experience.value === 'BEGINNER'
          ? 4
          : 6;
      if (
        volume(current.session) >= threshold &&
        volume(next.session) >= threshold
      )
        issues.push({
          code: 'WEEKLY_RECOVERY_OVERLAP',
          severity: 'WARNING',
          path: `${current.session.sessionKey}.${next.session.sessionKey}.${pattern}`,
        });
    }
  }
  return issues;
}
