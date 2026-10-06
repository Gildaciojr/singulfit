import {
  hasInvalidWorkoutActivityName,
  workoutStructuralActivityIssue,
  workoutWeeklyRecoveryIssues,
} from './workout-plan-v2-quality.policy';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import { estimateWorkoutSession } from './workout-duration-estimator';
import type {
  WorkoutActivityV2,
  WorkoutSessionV2,
} from './workout-plan-v2.contract';
import { commercialWorkoutPlan } from './workout-commercial-quality.fixtures';
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

  it.each([
    [3, null, null, 30, 'WARNING'],
    [3, 30, null, 210, 'WARNING'],
    [3, null, 60, 210, 'WARNING'],
    [1, null, null, 30, 'WARNING'],
    [1, 30, null, 30, null],
    [3, 30, 60, 210, null],
    [3, 30, 0, 90, null],
  ] as const)(
    'requires a complete multi-round clock: %s/%s/%s',
    (rounds, workSeconds, recoverySeconds, durationSeconds, severity) => {
      const activity = {
        ...strength('plank'),
        kind: 'TIMED' as const,
        name: 'Prancha frontal',
        rounds,
        workSeconds,
        recoverySeconds,
        durationSeconds,
      };
      const issue = workoutStructuralActivityIssue(activity);
      if (severity)
        expect(issue).toEqual({
          code: 'TIMED_DURATION_UNCERTAIN',
          severity,
          path: 'plank',
        });
      else expect(issue).toBeNull();
      const ctx = qualityContext(['MONDAY']);
      const result = new WorkoutPlanV2Validator().validate(
        qualityCandidate([qualitySession('plank-session', [activity])]),
        ctx,
        new WorkoutPlanningStrategyService().build(ctx),
      );
      expect(
        result.issues.some(
          (item) =>
            item.code === 'TIMED_DURATION_UNCERTAIN' &&
            item.severity === 'ERROR',
        ),
      ).toBe(false);
    },
  );

  it('warns about approximate three-movement duration without coaching rejection', () => {
    const ctx = qualityContext(['MONDAY']);
    const base = qualitySession('observed');
    const session = {
      ...base,
      blocks: base.blocks.map((block) =>
        block.type === 'STRENGTH'
          ? {
              ...block,
              activities: Array.from({ length: 3 }, (_, index) => ({
                ...strength(`main-${index}`),
                sets: 3,
                restSeconds: 60,
              })),
            }
          : block.type === 'COOLDOWN'
            ? {
                ...block,
                estimatedDurationMinutes: 10,
                activities: block.activities.map((activity) =>
                  activity.kind === 'ENDURANCE'
                    ? { ...activity, durationMinutes: 10 }
                    : activity,
                ),
              }
            : block,
      ),
    };
    const result = new WorkoutPlanV2Validator().validate(
      qualityCandidate([session]),
      ctx,
      new WorkoutPlanningStrategyService().build(ctx),
    );
    expect(result.status).not.toBe('INVALID');
    expect(result.issues).toContainEqual({
      code: 'SESSION_CONTENT_TOO_SHORT',
      severity: 'WARNING',
      path: 'observed',
    });
  });

  it.each([30, 45, 60])(
    'warns about approximate short content relative to %s minutes',
    (target) => {
      const ctx = qualityContext(['MONDAY']);
      const strategy = {
        ...new WorkoutPlanningStrategyService().build(ctx),
        sessionDurationMinutes: { status: 'CONFIRMED' as const, value: target },
      };
      const short = {
        ...qualitySession('short', [
          { ...strength(), sets: 3, restSeconds: 60 },
        ]),
        estimatedDurationMinutes: target,
      };
      const validator = new WorkoutPlanV2Validator();
      expect(
        validator.validate(qualityCandidate([short]), ctx, strategy).issues,
      ).toContainEqual({
        code: 'SESSION_CONTENT_TOO_SHORT',
        severity: 'WARNING',
        path: 'short',
      });
      const full = qualitySession('plausible');
      const plausible = {
        ...full,
        estimatedDurationMinutes: target,
        blocks: full.blocks.map((block) => ({
          ...block,
          estimatedDurationMinutes:
            (block.estimatedDurationMinutes * target) / 60,
          activities: block.activities.map((activity) =>
            activity.kind === 'ENDURANCE'
              ? {
                  ...activity,
                  durationMinutes: (activity.durationMinutes * target) / 60,
                }
              : activity.kind === 'STRENGTH'
                ? {
                    ...activity,
                    sets: target === 30 ? 2 : target === 45 ? 3 : 4,
                  }
                : activity,
          ),
        })),
      };
      expect(
        validator.validate(qualityCandidate([plausible]), ctx, strategy).status,
      ).not.toBe('INVALID');
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

  it.each([60, 45])(
    'checks duration boundaries relative to target %s using actual estimator bounds',
    (target) => {
      const context = qualityContext(['MONDAY']);
      const strategy = {
        ...new WorkoutPlanningStrategyService().build(context),
        sessionDurationMinutes: { status: 'CONFIRMED' as const, value: target },
      };
      const cases = [
        ['HIGH', 0.79, 'WARNING'],
        ['HIGH', 0.8, null],
        ['HIGH', 0.75, 'WARNING'],
        ['HIGH', 0.74, 'WARNING'],
        ['HIGH', 0.55, 'WARNING'],
        ['LOW', 0.79, 'WARNING'],
        ['LOW', 0.55, 'WARNING'],
        ['LOW', 0.54, 'WARNING'],
        ['LOW', 0.9, null],
      ] as const;
      for (const [confidence, ratio, severity] of cases) {
        const uncertain: WorkoutActivityV2 = {
          ...strength('mobility'),
          kind: 'MOBILITY',
          name: 'Mobilidade livre',
          movementPattern: 'MOBILITY',
          durationSeconds: null,
          holdSeconds: null,
          repetitions: null,
        };
        const activity: WorkoutActivityV2 = {
          ...strength('walk'),
          kind: 'ENDURANCE',
          name: 'Caminhada',
          mode: 'WALK',
          movementPattern: 'LOCOMOTION',
          durationMinutes: target * ratio - (confidence === 'LOW' ? 11.5 : 5),
          distanceKm: null,
        };
        const session: WorkoutSessionV2 = {
          ...qualitySession('boundary'),
          estimatedDurationMinutes: target,
          blocks: qualitySession().blocks.map((block, index) => ({
            ...block,
            estimatedDurationMinutes: index === 1 ? target - 2 : 1,
            activities:
              index === 1
                ? confidence === 'LOW'
                  ? [activity, uncertain]
                  : [activity]
                : [
                    {
                      ...activity,
                      activityKey: `support-${index}`,
                      durationMinutes: 1,
                    },
                  ],
          })),
        };
        const estimate = estimateWorkoutSession(session);
        expect(estimate.confidence).toBe(confidence);
        expect(estimate.maximumMinutes / target).toBeCloseTo(ratio, 8);
        const result = new WorkoutPlanV2Validator().validate(
          qualityCandidate([session]),
          context,
          strategy,
        );
        const issue = result.issues.find(
          (item) => item.code === 'SESSION_CONTENT_TOO_SHORT',
        );
        if (severity) expect(issue?.severity).toBe(severity);
        else expect(issue).toBeUndefined();
        if (confidence === 'LOW')
          expect(
            result.issues.filter((item) => item.severity === 'ERROR'),
          ).toEqual([]);
        expect(result.status).not.toBe('INVALID');
      }
    },
  );

  it('validates the realistic five-day fixture including equipment, duration and recovery', () => {
    const plan = commercialWorkoutPlan();
    const result = new WorkoutPlanV2Validator().validate(
      qualityCandidate(plan.sessions),
      qualityContext(),
      plan.strategy,
    );
    expect(result.issues.filter((issue) => issue.severity === 'ERROR')).toEqual(
      [],
    );
    expect(
      workoutWeeklyRecoveryIssues(
        qualityCandidate(plan.sessions),
        qualityContext(),
      ),
    ).toEqual([]);
    const activities = plan.sessions.flatMap((session) =>
      session.blocks.flatMap((block) => block.activities),
    );
    expect(
      plan.sessions[2].blocks.find((block) => block.type === 'ENDURANCE')
        ?.activities,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Bicicleta ergométrica leve',
          kind: 'ENDURANCE',
        }),
      ]),
    );
    expect(
      plan.sessions.every((session) =>
        session.blocks
          .filter((block) => block.type === 'STRENGTH')
          .every((block) =>
            block.activities.every(
              (activity) =>
                activity.kind === 'STRENGTH' || activity.kind === 'TIMED',
            ),
          ),
      ),
    ).toBe(true);
    const instructions = activities
      .filter(
        (activity) => activity.kind === 'STRENGTH' || activity.kind === 'TIMED',
      )
      .map((activity) => activity.instruction);
    expect(new Set(instructions).size).toBe(instructions.length);
    const prescriptions = activities
      .filter((activity) => activity.kind === 'STRENGTH')
      .map(
        (activity) =>
          `${activity.sets}/${activity.repetitions}/${activity.restSeconds}`,
      );
    expect(new Set(prescriptions).size).toBeGreaterThanOrEqual(5);
    expect(
      activities.every((activity) =>
        activity.equipment.every((equipment) =>
          plan.strategy.authorizedEquipment.includes(equipment),
        ),
      ),
    ).toBe(true);
    expect(
      activities.find((activity) => activity.name === 'Supino reto com barra'),
    ).toMatchObject({
      movementPattern: 'PUSH',
      equipment: ['BARBELL', 'BENCH'],
    });
    expect(
      activities.find((activity) => activity.name === 'Remada baixa na polia'),
    ).toMatchObject({ movementPattern: 'PULL', equipment: ['CABLE'] });
    expect(
      activities.find(
        (activity) => activity.name === 'Farmer walk com halteres',
      ),
    ).toMatchObject({
      kind: 'TIMED',
      movementPattern: 'CARRY',
      durationSeconds: 340,
    });
    expect(
      plan.sessions[2].blocks
        .flatMap((block) => block.activities)
        .filter((activity) => 'intensity' in activity)
        .every((activity) => activity.intensity === 'LIGHT'),
    ).toBe(true);
  });

  it('leaves recovery distribution to AI while preserving scheduling facts', () => {
    for (const days of [
      ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'],
      ['MONDAY', 'WEDNESDAY', 'FRIDAY', 'SUNDAY'],
    ]) {
      const context = qualityContext(days);
      const envelope = new WorkoutPlanningStrategyService().build(context);
      expect(context.training.availableTrainingDays).toMatchObject({
        value: days,
      });
      expect(envelope.sessionFocuses).toEqual([]);
      expect(envelope.requiredBlocks).toEqual([]);
    }
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
  it('warns about approximate underfill and rejects objectively excessive rest', () => {
    expect(validate().status).not.toBe('INVALID');
    expect(
      validate(qualitySession('short', [strength()])).issues,
    ).toContainEqual({
      code: 'SESSION_CONTENT_TOO_SHORT',
      severity: 'WARNING',
      path: 'short',
    });
    expect(
      validate(
        qualitySession('long', [{ ...strength(), sets: 20, restSeconds: 600 }]),
      ).issues,
    ).toContainEqual({
      code: 'SESSION_DURATION_EXCEEDED',
      severity: 'ERROR',
      path: 'long',
    });
  });
  it('warns on uncertain time and block declarations instead of falsely rejecting', () => {
    const result = validate(
      qualitySession('uncertain', [
        ...Array.from({ length: 4 }, (_, index) => ({
          ...strength(`uncertain-${index}`),
          repetitions: 'até esforço confortável',
        })),
      ]),
    );
    expect(result.issues).toContainEqual({
      code: 'SESSION_DURATION_UNCERTAIN',
      severity: 'WARNING',
      path: 'uncertain',
    });
    expect(
      result.issues.some((issue) => issue.code === 'SESSION_CONTENT_TOO_SHORT'),
    ).toBe(false);
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
  it('rejects 95 explicit minutes inside a declared 60 minute session', () => {
    const activity: WorkoutActivityV2 = {
      ...strength('clock'),
      kind: 'ENDURANCE',
      name: 'Caminhada',
      mode: 'WALK',
      durationMinutes: 95,
      distanceKm: null,
      intensity: 'CONVERSATIONAL',
    };
    const result = validate(qualitySession('explicit-clock', [activity]));
    expect(result.issues).toContainEqual({
      code: 'SESSION_DURATION_EXCEEDED',
      severity: 'ERROR',
      path: 'explicit-clock',
    });
    expect(result.status).toBe('INVALID');
  });
  it('rejects an explicit activity clock exceeding its own block budget', () => {
    const activity: WorkoutActivityV2 = {
      ...strength('clock'),
      kind: 'ENDURANCE',
      name: 'Caminhada',
      mode: 'WALK',
      durationMinutes: 30,
      distanceKm: null,
      intensity: 'CONVERSATIONAL',
    };
    const base = qualitySession('block-clock', [activity]);
    const result = validate({
      ...base,
      blocks: base.blocks.map((block) => ({
        ...block,
        estimatedDurationMinutes: 20,
      })),
    });
    expect(result.issues).toContainEqual({
      code: 'SESSION_DURATION_EXCEEDED',
      severity: 'ERROR',
      path: 'block-clock-main',
    });
  });
});
