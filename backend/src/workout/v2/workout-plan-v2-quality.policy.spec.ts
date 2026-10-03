import {
  hasInvalidWorkoutActivityName,
  workoutStructuralActivityIssue,
  workoutWeeklyRecoveryIssues,
} from './workout-plan-v2-quality.policy';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import {
  qualityCandidate,
  qualityContext,
  qualitySession,
  strength,
} from './workout-quality.fixtures';

describe('Workout quality before persistence', () => {
  it.each([
    ['Bicicleta ergométrica', 'WALK', 'BODYWEIGHT', true],
    ['Ciclismo', 'RUN', 'BODYWEIGHT', true],
    ['Caminhada', 'CYCLE', 'BIKE', true],
    ['Corrida', 'CYCLE', 'BIKE', true],
    ['Atividade aeróbica', 'CYCLE', 'TREADMILL', true],
    ['Atividade aeróbica', 'WALK', 'BIKE', true],
    ['Atividade aeróbica', 'RUN', 'BIKE', true],
    ['Caminhada na esteira', 'WALK', 'TREADMILL', false],
    ['Corrida na esteira', 'RUN', 'TREADMILL', false],
    ['Bicicleta ergométrica', 'CYCLE', 'BIKE', false],
    ['Bike', 'CYCLE', 'BIKE', false],
    ['Deslocamento aeróbico livre', 'WALK', 'BODYWEIGHT', false],
  ] as const)(
    'checks only unequivocal ENDURANCE conflict: %s/%s/%s',
    (name, mode, equipment, invalid) => {
      const activity = {
        ...strength(),
        kind: 'ENDURANCE' as const,
        name,
        mode,
        equipment: [equipment],
        durationMinutes: 10,
        distanceKm: null,
      };
      const issue = workoutStructuralActivityIssue(activity);
      if (invalid)
        expect(issue).toMatchObject({
          code: 'ENDURANCE_MODE_CONFLICT',
          severity: 'ERROR',
        });
      else expect(issue).toBeNull();
      const ctx = qualityContext(['MONDAY']);
      const strategy = new WorkoutPlanningStrategyService().build(ctx);
      const result = new WorkoutPlanV2Validator().validate(
        qualityCandidate([qualitySession('one', [activity])]),
        ctx,
        {
          ...strategy,
          authorizedEquipment: ['BODYWEIGHT', 'BIKE', 'TREADMILL'],
        },
      );
      expect(
        result.issues.some((item) => item.code === 'ENDURANCE_MODE_CONFLICT'),
      ).toBe(invalid);
    },
  );
  it('rejects mathematically impossible TIMED work and excludes final recovery', () => {
    const activity = {
      ...strength(),
      kind: 'TIMED' as const,
      rounds: 3,
      workSeconds: 40,
      recoverySeconds: 30,
      durationSeconds: 180,
    };
    expect(workoutStructuralActivityIssue(activity)).toBeNull();
    expect(
      workoutStructuralActivityIssue({ ...activity, durationSeconds: 119 }),
    ).toMatchObject({ code: 'TIMED_DURATION_IMPOSSIBLE', severity: 'ERROR' });
    expect(
      workoutStructuralActivityIssue({ ...activity, durationSeconds: 179 }),
    ).toMatchObject({ code: 'TIMED_DURATION_IMPOSSIBLE', severity: 'ERROR' });
    for (const optional of [{ workSeconds: null }, { recoverySeconds: null }])
      expect(
        workoutStructuralActivityIssue({ ...activity, ...optional }),
      ).toMatchObject({
        code: 'TIMED_DURATION_UNCERTAIN',
        severity: 'WARNING',
      });
  });
  it.each([300, 420])(
    'keeps the incident TIMED clock fail-closed at %s seconds',
    (durationSeconds) => {
      const timed = {
        ...strength('incident'),
        kind: 'TIMED' as const,
        rounds: 5,
        workSeconds: 60,
        recoverySeconds: 30,
        durationSeconds,
      };
      const ctx = qualityContext(['MONDAY']);
      const result = new WorkoutPlanV2Validator().validate(
        qualityCandidate([qualitySession('incident-session', [timed])]),
        ctx,
        new WorkoutPlanningStrategyService().build(ctx),
      );
      const issue = result.issues.find(
        (item) => item.code === 'TIMED_DURATION_IMPOSSIBLE',
      );
      if (durationSeconds === 300) {
        expect(issue).toEqual({
          code: 'TIMED_DURATION_IMPOSSIBLE',
          severity: 'ERROR',
          path: 'incident',
        });
        expect(result.status).toBe('INVALID');
      } else expect(issue).toBeUndefined();
    },
  );

  it('warns on loaded overlap across five consecutive days and adapts beginner tolerance', () => {
    const context = qualityContext();
    const sessions =
      context.training.availableTrainingDays.status === 'CONFIRMED'
        ? context.training.availableTrainingDays.value.map((_, index) =>
            qualitySession(`day-${index}`, [
              { ...strength(`lift-${index}`), sets: 6 },
            ]),
          )
        : [];
    expect(
      workoutWeeklyRecoveryIssues(qualityCandidate(sessions), context),
    ).toHaveLength(4);
    const repeated = qualityCandidate([
      qualitySession('one', [strength('one')]),
      qualitySession('two', [strength('two')]),
    ]);
    const twoDays = qualityContext(['MONDAY', 'TUESDAY']);
    expect(workoutWeeklyRecoveryIssues(repeated, twoDays)).toHaveLength(0);
    expect(
      workoutWeeklyRecoveryIssues(repeated, {
        ...twoDays,
        training: {
          ...twoDays.training,
          experience: { status: 'CONFIRMED', value: 'BEGINNER' },
        },
      }),
    ).toHaveLength(1);
  });
  it('reduces unavoidable consecutive overlap for weight loss without changing spaced-day distribution', () => {
    const strategy = new WorkoutPlanningStrategyService();
    const consecutive = strategy.build(
      qualityContext(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY']),
    );
    expect(
      consecutive.sessionFocuses.some((focus) =>
        focus.includes('esforço leve'),
      ),
    ).toBe(true);
    const spaced = strategy.build(
      qualityContext(['MONDAY', 'WEDNESDAY', 'FRIDAY', 'SUNDAY']),
    );
    expect(
      spaced.sessionFocuses.some((focus) => focus.includes('esforço leve')),
    ).toBe(false);
  });
  const context = qualityContext(['MONDAY']);
  const strategy = new WorkoutPlanningStrategyService().build(context);
  const validate = (session = qualitySession()) =>
    new WorkoutPlanV2Validator().validate(
      qualityCandidate([session]),
      context,
      strategy,
    );
  it.each([
    'Bicicleta não disponível',
    'equipamento indisponível',
    'substituir se necessário',
    'exercício não definido',
    'TBD',
  ])('rejects non-executable name %s', (name) => {
    expect(hasInvalidWorkoutActivityName(name)).toBe(true);
    expect(
      validate(qualitySession('session', [{ ...strength(), name }])).issues,
    ).toContainEqual({
      code: 'ACTIVITY_NAME_INVALID',
      severity: 'ERROR',
      path: 'strength',
    });
  });
  it('accepts names outside a fixed catalogue and legitimate negative instructions', () => {
    const result = validate(
      qualitySession('session', [
        {
          ...strength(),
          name: 'Remada unilateral em apoio livre',
          instruction: 'Não trave os joelhos; não force a amplitude.',
        },
      ]),
    );
    expect(
      result.issues.some((issue) => issue.code === 'ACTIVITY_NAME_INVALID'),
    ).toBe(false);
  });
  it('accepts a representative target and rejects material under/overfill', () => {
    expect(validate().status).not.toBe('INVALID');
    expect(
      validate(qualitySession('short', [strength()])).issues,
    ).toContainEqual({
      code: 'SESSION_CONTENT_TOO_SHORT',
      severity: 'ERROR',
      path: 'short',
    });
    expect(
      validate(
        qualitySession('long', [{ ...strength(), sets: 20, restSeconds: 600 }]),
      ).issues,
    ).toContainEqual({
      code: 'SESSION_CONTENT_TOO_LONG',
      severity: 'ERROR',
      path: 'long',
    });
  });
  it('warns on uncertain time and block declarations instead of falsely rejecting', () => {
    const result = validate(
      qualitySession('uncertain', [
        { ...strength(), repetitions: 'até esforço confortável' },
      ]),
    );
    expect(result.issues).toContainEqual({
      code: 'SESSION_DURATION_UNCERTAIN',
      severity: 'WARNING',
      path: 'uncertain',
    });
    expect(
      result.issues.find((issue) => issue.code === 'SESSION_CONTENT_TOO_SHORT')
        ?.severity,
    ).toBe('WARNING');
    expect(
      validate({
        ...qualitySession(),
        blocks: qualitySession().blocks.map((block) => ({
          ...block,
          estimatedDurationMinutes: 1,
        })),
      }).issues.some((issue) => issue.code === 'BLOCK_DURATION_INCOHERENT'),
    ).toBe(true);
  });
  it.each([
    ['MONDAY', 'TUESDAY'],
    ['SUNDAY', 'MONDAY'],
  ])(
    'warns on documented repeated loaded volume on %s -> %s',
    (first, second) => {
      const sessions = [
        qualitySession('one', [{ ...strength('one'), sets: 6 }]),
        qualitySession('two', [{ ...strength('two'), sets: 6 }]),
      ];
      expect(
        workoutWeeklyRecoveryIssues(
          qualityCandidate(sessions),
          qualityContext([first, second]),
        ),
      ).toHaveLength(1);
      expect(
        workoutWeeklyRecoveryIssues(
          qualityCandidate(sessions),
          qualityContext(['MONDAY', 'WEDNESDAY']),
        ),
      ).toHaveLength(0);
    },
  );
  it('does not classify light or modest repeated patterns as excessive recovery overlap', () => {
    const sessions = [
      qualitySession('one', [strength('one')]),
      qualitySession('two', [
        { ...strength('two'), intensity: 'LIGHT' as const },
      ]),
    ];
    expect(
      workoutWeeklyRecoveryIssues(
        qualityCandidate(sessions),
        qualityContext(['MONDAY', 'TUESDAY']),
      ),
    ).toEqual([]);
  });
});
