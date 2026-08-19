import type { CurrentWorkoutPlanReaderService } from './current-workout-plan-reader.service';
import type { WorkoutPlanV2 } from './workout-plan-v2.contract';
import { WorkoutPlanMutationResolverService } from './workout-plan-mutation-resolver.service';
import type { WorkoutRecognizedContext } from './workout-planning-context.contract';

function plan(): WorkoutPlanV2 {
  return {
    modality: 'GYM_STRENGTH',
    strategy: { authorizedEquipment: ['BODYWEIGHT', 'MACHINE'] },
    sessions: [
      {
        sessionKey: 'session-1',
        sequence: 1,
        label: 'Pernas',
        blocks: [
          {
            activities: [
              {
                activityKey: 'squat',
                name: 'Agachamento livre',
                equipment: ['BODYWEIGHT'],
              },
              {
                activityKey: 'leg-press',
                name: 'Leg press',
                equipment: ['MACHINE'],
              },
            ],
          },
        ],
      },
      {
        sessionKey: 'session-2',
        sequence: 2,
        label: 'Peito',
        blocks: [
          {
            activities: [
              {
                activityKey: 'chest-press',
                name: 'Supino máquina',
                equipment: ['MACHINE'],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as WorkoutPlanV2;
}

describe('WorkoutPlanMutationResolverService', () => {
  function setup(current: WorkoutPlanV2 | null = plan()) {
    const read = jest.fn().mockResolvedValue(
      current
        ? {
            status: 'AVAILABLE',
            plan: { document: current },
          }
        : { status: 'NO_PLAN', plan: null },
    );
    return {
      read,
      resolver: new WorkoutPlanMutationResolverService({
        read,
      } as unknown as CurrentWorkoutPlanReaderService),
    };
  }

  it.each([
    [
      'Agora só tenho 40 minutos',
      { sessionDurationMinutes: { status: 'CONFIRMED', value: 40 } },
      'DURATION',
    ],
    [
      'Vou treinar só 3 vezes esta semana',
      { weeklyFrequency: { status: 'CONFIRMED', value: 3 } },
      'FREQUENCY',
    ],
    [
      'Quero focar mais em peito',
      { muscleFocus: { status: 'CONFIRMED', value: ['CHEST'] } },
      'MUSCLE_FOCUS',
    ],
    [
      'Ajuste meu treino para incluir corrida',
      { modality: { status: 'CONFIRMED', value: 'RUNNING' } },
      'MODALITY',
    ],
  ] as const)(
    'prepares a real previous plan for %s adaptation',
    async (message, declared, reason) => {
      const { resolver } = setup();
      await expect(
        resolver.resolve(
          'user-id',
          message,
          declared as WorkoutRecognizedContext,
        ),
      ).resolves.toMatchObject({
        status: 'READY',
        previousPlan: plan(),
        recognizedContext: {
          artifactType: 'PLAN_ADAPTATION',
          purpose: 'ADAPTATION',
          mutation: { kind: 'PLAN_ADAPTATION', reason },
        },
      });
    },
  );

  it('distinguishes an ambiguous running statement from an explicit adaptation', async () => {
    const { resolver } = setup();
    await expect(
      resolver.resolve('user-id', 'Vou começar a correr', {
        modality: { status: 'CONFIRMED', value: 'RUNNING' },
      }),
    ).resolves.toMatchObject({
      status: 'CLARIFICATION',
      message: expect.stringContaining('adaptar o plano atual'),
    });
  });

  it('resolves an exercise substitution by the current plan activity', async () => {
    const { resolver } = setup();
    await expect(
      resolver.resolve('user-id', 'Troque o agachamento livre', {}),
    ).resolves.toMatchObject({
      status: 'READY',
      recognizedContext: {
        artifactType: 'EXERCISE_SUBSTITUTION',
        mutation: {
          sourceActivityKey: 'squat',
          sourceActivityName: 'Agachamento livre',
          reason: 'PREFERENCE',
        },
      },
    });
  });

  it('carries safety signals for painful substitutions so the engine can block before provider', async () => {
    const { resolver } = setup();
    await expect(
      resolver.resolve('user-id', 'Não posso fazer agachamento livre por dor', {
        safetySignals: ['ACUTE_PAIN'],
      }),
    ).resolves.toMatchObject({
      status: 'READY',
      recognizedContext: {
        safetySignals: ['ACUTE_PAIN'],
        mutation: { sourceActivityKey: 'squat', reason: 'LIMITATION' },
      },
    });
  });

  it('clarifies unavailable equipment when more than one machine exercise exists', async () => {
    const { resolver } = setup();
    await expect(
      resolver.resolve('user-id', 'Não tenho essa máquina', {}),
    ).resolves.toMatchObject({ status: 'CLARIFICATION' });
  });

  it('resolves unavailable equipment when exactly one current activity uses it', async () => {
    const current = plan();
    const singleMachinePlan = {
      ...current,
      sessions: current.sessions.slice(0, 1),
    } as WorkoutPlanV2;
    const { resolver } = setup(singleMachinePlan);

    await expect(
      resolver.resolve('user-id', 'Não tenho essa máquina', {}),
    ).resolves.toMatchObject({
      status: 'READY',
      recognizedContext: {
        equipment: { status: 'CONFIRMED', value: ['BODYWEIGHT'] },
        mutation: {
          sourceActivityKey: 'leg-press',
          reason: 'EQUIPMENT',
        },
      },
    });
  });

  it('clarifies an unresolved conversational exercise reference', async () => {
    const { resolver } = setup();
    await expect(
      resolver.resolve('user-id', 'Troque esse exercício', {}),
    ).resolves.toMatchObject({ status: 'CLARIFICATION' });
  });

  it('does not invent an exercise absent from the current plan', async () => {
    const { resolver } = setup();
    await expect(
      resolver.resolve('user-id', 'Troque o levantamento terra', {}),
    ).resolves.toMatchObject({ status: 'CLARIFICATION' });
  });

  it('fails closed when the user has no current Workout V2 plan', async () => {
    const { resolver, read } = setup(null);
    await expect(
      resolver.resolve('user-id', 'Agora só tenho 40 minutos', {
        sessionDurationMinutes: { status: 'CONFIRMED', value: 40 },
      }),
    ).resolves.toMatchObject({ status: 'NO_CURRENT_PLAN' });
    expect(read).toHaveBeenCalledWith('user-id');
  });
});
