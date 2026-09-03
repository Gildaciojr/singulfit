import { FitnessGoal, WorkoutWeekday } from '@prisma/client';
import { CurrentWorkoutPlanReaderService } from './current-workout-plan-reader.service';
import { WorkoutPlanV2StoredDocumentParser } from './workout-plan-v2-stored-document.parser';
import { WORKOUT_PROMPT_BY_GOAL } from '../workout.constants';
import { WORKOUT_PLANNING_V2_PROMPT } from './workout-planning-v2.prompt.definition';

function activity(key: string, name: string) {
  return {
    activityKey: key,
    name,
    source: 'MODEL_GENERATED',
    movementPattern: 'SQUAT',
    equipment: ['BODYWEIGHT'],
    instruction: 'Execute com controle.',
    alerts: [],
    appliedConstraintCodes: [],
    kind: 'STRENGTH',
    sets: 3,
    repetitions: '10',
    restSeconds: 60,
    intensity: 'MODERATE',
  };
}

function session(sequence: number, label: string, exercise: string) {
  return {
    sessionKey: `session-${sequence}`,
    sequence,
    label,
    estimatedDurationMinutes: 45,
    blocks: [
      {
        blockKey: `block-${sequence}`,
        type: 'STRENGTH',
        title: 'Bloco principal',
        estimatedDurationMinutes: 30,
        activities: [activity(`activity-${sequence}`, exercise)],
      },
    ],
  };
}

function document(aiJobId = 'job-id') {
  return {
    schemaVersion: 2,
    artifactType: 'WEEKLY_PLAN',
    modality: 'GYM_STRENGTH',
    objective: 'STRENGTH',
    lifecycleReason: 'CREATION',
    replacesPlanReference: null,
    title: 'Plano V2 atual',
    referenceDate: '2026-08-17',
    strategy: {},
    sessions: [
      session(1, 'Pernas', 'Agachamento'),
      session(2, 'Peito', 'Supino'),
      session(3, 'Costas', 'Remada'),
    ],
    progression: [],
    substitutions: [],
    adaptationRules: [],
    appliedConstraints: [],
    personalizationFactors: [],
    safetyFlags: [],
    generationMetadata: {
      engineVersion: 2,
      promptVersionId: 'prompt-id',
      aiJobId,
      operationKey: 'operation-key',
      model: 'model',
      generatedAt: '2026-08-17T00:00:00.000Z',
      reused: false,
    },
    validation: { status: 'VALID', issues: [] },
  };
}

function record(options?: {
  calendar?: boolean;
  userId?: string;
  document?: unknown;
  timezone?: string;
  weekdays?: readonly WorkoutWeekday[];
}) {
  const weekdays = options?.weekdays ?? [
    WorkoutWeekday.MONDAY,
    WorkoutWeekday.WEDNESDAY,
    WorkoutWeekday.FRIDAY,
  ];
  return {
    id: 'plan-id',
    userId: options?.userId ?? 'user-id',
    aiJob: {
      id: 'job-id',
      userId: options?.userId ?? 'user-id',
      type: 'WORKOUT',
      status: 'COMPLETED',
      result: { acceptedOutput: options?.document ?? document() },
      promptVersion: { name: WORKOUT_PLANNING_V2_PROMPT.name },
    },
    user: {
      preferences: { timezone: options?.timezone ?? 'America/Sao_Paulo' },
    },
    title: 'Plano V2 atual',
    days: weekdays.map((weekday, index) => ({
      dayNumber: index + 1,
      weekday: options?.calendar === false ? null : weekdays[index],
      title: `Sessão ${index + 1}`,
      exercises: [],
    })),
  };
}

function legacyExercise(index: number) {
  return {
    exerciseName: `Exercício persistido ${index}`,
    sets: 3,
    reps: '10-12',
    restSeconds: 60,
    notes: index === 1 ? 'Executar com controle' : null,
  };
}

function legacyDays(
  counts: readonly number[] = [2, 2, 2],
  weekdays?: readonly (WorkoutWeekday | null)[],
) {
  let exerciseIndex = 0;
  return counts.map((count, dayIndex) => ({
    dayNumber: dayIndex + 1,
    weekday: weekdays?.[dayIndex] ?? null,
    title: `Treino legado ${dayIndex + 1}`,
    exercises: Array.from({ length: count }, () => {
      exerciseIndex += 1;
      return legacyExercise(exerciseIndex);
    }),
  }));
}

function legacyRecord(options?: {
  promptName?: string;
  userId?: string;
  result?: unknown;
  days?: ReturnType<typeof legacyDays>;
  title?: string;
}) {
  const base = record();
  return {
    ...base,
    userId: options?.userId ?? 'user-id',
    title: options?.title ?? 'Plano legado relacional',
    aiJob: {
      ...base.aiJob,
      userId: options?.userId ?? 'user-id',
      result: options && 'result' in options ? options.result : null,
      promptVersion: {
        name:
          options?.promptName ??
          WORKOUT_PROMPT_BY_GOAL[FitnessGoal.MAINTENANCE],
      },
    },
    days: options?.days ?? legacyDays(),
  };
}

describe('CurrentWorkoutPlanReaderService', () => {
  function setup(value: ReturnType<typeof record> | null = record()) {
    const findFirst = jest.fn().mockResolvedValue(value);
    const mutations = {
      workoutPlanCreate: jest.fn(),
      workoutPlanUpdate: jest.fn(),
      workoutPlanUpdateMany: jest.fn(),
      usageBucketUpsert: jest.fn(),
      usageEventCreate: jest.fn(),
      aiJobCreate: jest.fn(),
      aiJobUpdate: jest.fn(),
      aiUsageCreate: jest.fn(),
      workoutDayCreate: jest.fn(),
      workoutDayUpdate: jest.fn(),
      workoutExerciseCreate: jest.fn(),
      workoutExerciseUpdate: jest.fn(),
    };
    const prisma = {
      workoutPlan: {
        findFirst,
        create: mutations.workoutPlanCreate,
        update: mutations.workoutPlanUpdate,
        updateMany: mutations.workoutPlanUpdateMany,
      },
      usageBucket: { upsert: mutations.usageBucketUpsert },
      usageEvent: { create: mutations.usageEventCreate },
      aIJob: {
        create: mutations.aiJobCreate,
        update: mutations.aiJobUpdate,
      },
      aIUsage: { create: mutations.aiUsageCreate },
      workoutDay: {
        create: mutations.workoutDayCreate,
        update: mutations.workoutDayUpdate,
      },
      workoutExercise: {
        create: mutations.workoutExerciseCreate,
        update: mutations.workoutExerciseUpdate,
      },
    };
    const service = new CurrentWorkoutPlanReaderService(
      prisma as never,
      new WorkoutPlanV2StoredDocumentParser(),
    );
    return { service, findFirst, mutations };
  }

  it('reads only the active plan owned by the requested user', async () => {
    const { service, findFirst } = setup();
    await expect(service.read('user-id')).resolves.toMatchObject({
      status: 'AVAILABLE',
      plan: { aggregateId: 'plan-id', userId: 'user-id' },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-id', status: 'ACTIVE' },
      }),
    );
  });

  it('fails closed for an invalid acceptedOutput discriminator', async () => {
    const { service } = setup(record({ document: { schemaVersion: 1 } }));
    await expect(service.read('user-id')).resolves.toEqual({
      status: 'INVALID_V2_PLAN',
      plan: null,
    });
  });

  it('fails closed instead of selecting a day with an invalid timezone', async () => {
    const { service } = setup(record({ timezone: 'Invalid/Timezone' }));
    await expect(service.read('user-id')).resolves.toEqual({
      status: 'INVALID_V2_PLAN',
      plan: null,
    });
  });

  it('returns a human no-plan response without generating anything', async () => {
    const { service, mutations } = setup(null);
    await expect(
      service.present('user-id', 'Qual meu treino?', new Date()),
    ).resolves.toContain('ainda não tem um plano');
    Object.values(mutations).forEach((mutation) => {
      expect(mutation).not.toHaveBeenCalled();
    });
  });

  it('presents the current V2 plan', async () => {
    const { service, mutations } = setup();
    const content = await service.present(
      'user-id',
      'Qual meu treino?',
      new Date('2026-08-17T12:00:00.000Z'),
    );
    expect(content).toContain('Plano V2 atual');
    expect(content).toContain('Sessão 1 — segunda-feira');
    Object.values(mutations).forEach((mutation) => {
      expect(mutation).not.toHaveBeenCalled();
    });
  });

  it('reads and presents a positively identified legacy relational plan', async () => {
    const { service, mutations } = setup(legacyRecord());

    await expect(service.read('user-id')).resolves.toMatchObject({
      status: 'LEGACY_RELATIONAL',
      plan: {
        implementation: 'LEGACY_RELATIONAL',
        title: 'Plano legado relacional',
      },
    });
    await expect(
      service.present(
        'user-id',
        'Qual o meu treino atual?',
        new Date('2026-09-02T12:00:00.000Z'),
      ),
    ).resolves.toContain('Sessão 1: Treino legado 1');
    Object.values(mutations).forEach((mutation) => {
      expect(mutation).not.toHaveBeenCalled();
    });
  });

  it.each(Object.values(WORKOUT_PROMPT_BY_GOAL))(
    'accepts only a known legacy origin marker: %s',
    async (promptName) => {
      const { service } = setup(legacyRecord({ promptName }));
      await expect(service.read('user-id')).resolves.toMatchObject({
        status: 'LEGACY_RELATIONAL',
      });
    },
  );

  it('keeps future legacy stored results separate from V2 documents', async () => {
    const { service } = setup(
      legacyRecord({
        result: {
          candidateOutput: '{"title":"Plano legado relacional"}',
          model: 'legacy-model',
        },
      }),
    );

    await expect(service.read('user-id')).resolves.toMatchObject({
      status: 'LEGACY_RELATIONAL',
    });
  });

  it('reads the production-equivalent legacy shape with 7 days and 30 exercises', async () => {
    const { service } = setup(
      legacyRecord({ days: legacyDays([5, 5, 4, 4, 4, 4, 4]) }),
    );

    const result = await service.read('user-id');

    expect(result.status).toBe('LEGACY_RELATIONAL');
    if (result.status !== 'LEGACY_RELATIONAL') return;
    expect(result.plan.sessions).toHaveLength(7);
    expect(
      result.plan.sessions.reduce(
        (total, current) => total + current.exercises.length,
        0,
      ),
    ).toBe(30);
  });

  it('does not invent a weekday for a legacy plan without a complete calendar', async () => {
    const { service } = setup(legacyRecord());

    await expect(
      service.present(
        'user-id',
        'Qual é meu treino de hoje?',
        new Date('2026-09-02T12:00:00.000Z'),
      ),
    ).resolves.toBe(
      'Seu plano atual não possui um calendário confirmado. Posso mostrar as sessões por número, sem inventar um dia da semana.',
    );
  });

  it('uses only the persisted weekday from a complete legacy calendar', async () => {
    const { service } = setup(
      legacyRecord({
        days: legacyDays(
          [1, 1, 1],
          [
            WorkoutWeekday.MONDAY,
            WorkoutWeekday.WEDNESDAY,
            WorkoutWeekday.FRIDAY,
          ],
        ),
      }),
    );

    await expect(
      service.present('user-id', 'Treino de quarta-feira', new Date()),
    ).resolves.toContain('Sessão 2: Treino legado 2');
    await expect(
      service.present('user-id', 'Treino de terça-feira', new Date()),
    ).resolves.toContain('dia de descanso');
  });

  it('shows exactly the persisted exercises for a numbered legacy session', async () => {
    const { service } = setup(legacyRecord());

    const content = await service.present(
      'user-id',
      'Mostre a sessão 2',
      new Date(),
    );

    expect(content).toContain('Sessão 2: Treino legado 2');
    expect(content).toContain('Exercício persistido 3');
    expect(content).toContain('Exercício persistido 4');
    expect(content).not.toContain('Exercício persistido 1');
  });

  it('never downgrades an identified but corrupted V2 plan to relational legacy', async () => {
    const { service } = setup(
      legacyRecord({
        promptName: WORKOUT_PLANNING_V2_PROMPT.name,
        result: { acceptedOutput: { schemaVersion: 1 } },
      }),
    );

    await expect(service.read('user-id')).resolves.toEqual({
      status: 'INVALID_V2_PLAN',
      plan: null,
    });
  });

  it.each([
    { ...document(), generationMetadata: { engineVersion: 2 } },
    document('different-ai-job-id'),
  ])(
    'rejects malformed V2 metadata without relational downgrade',
    async (acceptedOutput) => {
      const { service } = setup(
        legacyRecord({
          promptName: WORKOUT_PLANNING_V2_PROMPT.name,
          result: { acceptedOutput },
        }),
      );

      await expect(service.read('user-id')).resolves.toEqual({
        status: 'INVALID_V2_PLAN',
        plan: null,
      });
    },
  );

  it('rejects result-less jobs whose prompt is not positively legacy', async () => {
    const { service } = setup(
      legacyRecord({ promptName: 'unknown_workout_prompt' }),
    );

    await expect(service.read('user-id')).resolves.toEqual({
      status: 'INVALID_V2_PLAN',
      plan: null,
    });
  });

  it('rejects an active plan whose AIJob ownership is inconsistent', async () => {
    const value = legacyRecord();
    const { service } = setup({
      ...value,
      aiJob: { ...value.aiJob, userId: 'other-user' },
    });

    await expect(service.read('user-id')).resolves.toEqual({
      status: 'INVALID_V2_PLAN',
      plan: null,
    });
  });

  it.each([
    legacyRecord({ days: [] }),
    legacyRecord({ days: [{ ...legacyDays([1])[0], dayNumber: 0 }] }),
    legacyRecord({
      days: [legacyDays([1])[0], { ...legacyDays([1])[0] }],
    }),
    legacyRecord({ days: [{ ...legacyDays([1])[0], title: ' ' }] }),
    legacyRecord({ days: [{ ...legacyDays([1])[0], exercises: [] }] }),
    legacyRecord({
      days: [
        {
          ...legacyDays([1])[0],
          exercises: [{ ...legacyExercise(1), sets: 0 }],
        },
      ],
    }),
    legacyRecord({
      days: [
        {
          ...legacyDays([1])[0],
          exercises: [{ ...legacyExercise(1), reps: ' ' }],
        },
      ],
    }),
  ])('rejects an inconsistent relational legacy plan', async (value) => {
    const { service } = setup(value);
    await expect(service.read('user-id')).resolves.toEqual({
      status: 'INVALID_V2_PLAN',
      plan: null,
    });
  });

  it('resolves today using the user timezone at a UTC boundary', async () => {
    const { service } = setup();
    const content = await service.present(
      'user-id',
      'O que treino hoje?',
      new Date('2026-08-17T02:30:00.000Z'),
    );
    expect(content).toContain('dia de descanso');
    expect(content).toContain('domingo');
  });

  it('resolves tomorrow from the local weekday', async () => {
    const { service } = setup();
    const content = await service.present(
      'user-id',
      'O que treino amanhã?',
      new Date('2026-08-17T02:30:00.000Z'),
    );
    expect(content).toContain('Sessão 1: Pernas');
  });

  it('resolves an explicit weekday and a rest day', async () => {
    const { service } = setup();
    await expect(
      service.present('user-id', 'Treino de quarta', new Date()),
    ).resolves.toContain('Sessão 2: Peito');
    await expect(
      service.present('user-id', 'Treino de terça', new Date()),
    ).resolves.toContain('dia de descanso');
  });

  it('keeps session order separate from the explicit four-day calendar', async () => {
    const fourSessions = {
      ...document(),
      sessions: [
        session(1, 'Pernas', 'Agachamento'),
        session(2, 'Peito', 'Supino'),
        session(3, 'Costas', 'Remada'),
        session(4, 'Ombros', 'Desenvolvimento'),
      ],
    };
    const { service } = setup(
      record({
        document: fourSessions,
        weekdays: [
          WorkoutWeekday.MONDAY,
          WorkoutWeekday.TUESDAY,
          WorkoutWeekday.THURSDAY,
          WorkoutWeekday.SATURDAY,
        ],
      }),
    );

    await expect(
      service.present('user-id', 'Treino de quinta', new Date()),
    ).resolves.toContain('Sessão 3: Costas');
    await expect(
      service.present('user-id', 'Treino de quarta', new Date()),
    ).resolves.toContain('dia de descanso');
  });

  it('resolves a session ordinal and unique muscle focus', async () => {
    const { service } = setup();
    await expect(
      service.present('user-id', 'Me mostra o treino 3', new Date()),
    ).resolves.toContain('Sessão 3: Costas');
    await expect(
      service.present('user-id', 'Qual meu treino de peito?', new Date()),
    ).resolves.toContain('Sessão 2: Peito');
  });

  it('fails safe for temporal reads of a historical plan without calendar', async () => {
    const { service } = setup(record({ calendar: false }));
    await expect(
      service.present('user-id', 'O que treino hoje?', new Date()),
    ).resolves.toContain('não possui um calendário confirmado');
    await expect(
      service.present('user-id', 'Me mostra o treino 2', new Date()),
    ).resolves.toContain('Sessão 2: Peito');
  });
});
