import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutPlanValidationIssue,
  WorkoutActivityV2,
} from './workout-plan-v2.contract';
import type { WorkoutPlanningContext } from './workout-planning-context.contract';
import { ConversationPublicAnswerBoundaryService } from '../../conversation/runtime/conversation-public-answer-boundary.service';
import { workoutPublicTextIssues } from './workout-public-text.policy';
import { workoutPrescriptionTextConstraints } from './workout-prescription.policy';

const publicBoundary = new ConversationPublicAnswerBoundaryService();

/** Executable timed locomotion needs no anatomical identity or exercise-name catalog. */
export function isExecutableWorkoutTimedLocomotion(
  activity: WorkoutActivityV2,
): boolean {
  if (
    activity.kind !== 'TIMED' ||
    activity.movementPattern !== 'LOCOMOTION' ||
    !Number.isSafeInteger(activity.durationSeconds) ||
    activity.durationSeconds <= 0 ||
    activity.durationSeconds > 7200 ||
    workoutStructuralActivityIssue(activity)?.severity === 'ERROR' ||
    hasInvalidWorkoutActivityName(activity.name)
  )
    return false;
  const text = [activity.name, activity.instruction, ...activity.alerts].join(
    '\n',
  );
  if (
    [activity.name, activity.instruction, ...activity.alerts].some(
      (value) => publicBoundary.projectStructuredText(value) === null,
    ) ||
    workoutPublicTextIssues(
      text,
      workoutPrescriptionTextConstraints(activity),
      activity.activityKey,
    ).length
  )
    return false;
  return (
    activity.name.trim().length > 0 && activity.instruction.trim().length > 0
  );
}

export function workoutStructuralActivityIssue(
  activity: WorkoutActivityV2,
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
          // Representation consistency, independent of transition authorization.
          // Walking's prohibition is checked only by the WALKING modality guard.
          (activity.mode === 'WALK' && running)
    )
      return {
        code: 'ENDURANCE_MODE_CONFLICT',
        severity: 'ERROR',
        path: activity.activityKey,
      };
  }
  if (activity.kind === 'TIMED') {
    if (activity.movementPattern === 'LOCOMOTION') {
      const name = activity.name
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
      // Detect contradictory representations; these terms are not an acceptance vocabulary.
      const foot =
        /\b(?:caminhada|caminhar|walking|walk|corrida|correr|trote|jogging|run)\b/u.test(
          name,
        );
      const cycling = /\b(?:ciclismo|pedalada|bike|bicicleta|cycling)\b/u.test(
        name,
      );
      if (
        (foot && (cycling || activity.equipment.includes('BIKE'))) ||
        (cycling && activity.equipment.includes('TREADMILL'))
      )
        return {
          code: 'ENDURANCE_MODE_CONFLICT',
          severity: 'ERROR',
          path: activity.activityKey,
        };
    }
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
        severity: 'WARNING',
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
    !candidate.sessions.every((session) => session.weekday) &&
    (available.status !== 'CONFIRMED' ||
      available.value.length < candidate.sessions.length)
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
    day: order.indexOf(
      session.weekday ??
        (available.status === 'CONFIRMED' ? available.value[index] : ''),
    ),
  }));
  const issues: WorkoutPlanValidationIssue[] = [];
  // Quality signal only: keep AI-owned weekdays and never reject or repair on it.
  if (
    candidate.modality === 'GYM_STRENGTH' &&
    available.status === 'CONFIRMED' &&
    available.value.length >= 5 &&
    sessions.length === 4 &&
    sessions.every(
      ({ session, day }) =>
        day >= 0 &&
        session.blocks.some((block) =>
          block.activities.some(
            (activity) =>
              activity.kind === 'STRENGTH' && activity.intensity !== 'LIGHT',
          ),
        ),
    ) &&
    sessions.some(({ day }) =>
      [1, 2, 3].every((offset) =>
        sessions.some((item) => item.day === (day + offset) % 7),
      ),
    )
  )
    issues.push({
      code: 'CONSECUTIVE_STRENGTH_DAYS',
      severity: 'WARNING',
      path: 'sessions',
    });
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
