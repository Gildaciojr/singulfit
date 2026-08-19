import { WorkoutWeekday } from '@prisma/client';
import { CurrentWorkoutPlanReaderService } from './current-workout-plan-reader.service';
import { WorkoutPlanV2StoredDocumentParser } from './workout-plan-v2-stored-document.parser';

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
    },
    user: {
      preferences: { timezone: options?.timezone ?? 'America/Sao_Paulo' },
    },
    days: weekdays.map((weekday, index) => ({
      dayNumber: index + 1,
      weekday: options?.calendar === false ? null : weekdays[index],
    })),
  };
}

describe('CurrentWorkoutPlanReaderService', () => {
  function setup(value: ReturnType<typeof record> | null = record()) {
    const findFirst = jest.fn().mockResolvedValue(value);
    const prisma = { workoutPlan: { findFirst } };
    const service = new CurrentWorkoutPlanReaderService(
      prisma as never,
      new WorkoutPlanV2StoredDocumentParser(),
    );
    return { service, findFirst };
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
    const { service } = setup(null);
    await expect(
      service.present('user-id', 'Qual meu treino?', new Date()),
    ).resolves.toContain('ainda não tem um plano');
  });

  it('presents the current V2 plan', async () => {
    const { service } = setup();
    const content = await service.present(
      'user-id',
      'Qual meu treino?',
      new Date('2026-08-17T12:00:00.000Z'),
    );
    expect(content).toContain('Plano V2 atual');
    expect(content).toContain('Sessão 1 — segunda-feira');
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
