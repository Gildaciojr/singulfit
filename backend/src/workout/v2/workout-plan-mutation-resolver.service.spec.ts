import type { CurrentWorkoutPlanReaderService } from './current-workout-plan-reader.service';
import type { WorkoutPlanV2 } from './workout-plan-v2.contract';
import { WorkoutPlanMutationResolverService } from './workout-plan-mutation-resolver.service';
import type { WorkoutRecognizedContext } from './workout-planning-context.contract';
import type { ConversationPlanReferenceService } from '../../conversation/understanding/conversation-plan-reference.service';

function plan(): WorkoutPlanV2 {
  return {
    modality: 'GYM_STRENGTH',
    strategy: {
      objective: { status: 'CONFIRMED', value: 'GENERAL_HEALTH' },
      experience: { status: 'CONFIRMED', value: 'INTERMEDIATE' },
      sessionCount: 2,
      sessionDurationMinutes: { status: 'CONFIRMED', value: 50 },
      environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
      authorizedEquipment: ['BODYWEIGHT', 'MACHINE'],
      muscleFocus: ['LOWER_BODY'],
    },
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
  it.each([
    [
      'Pernas: Agachamento livre; Leg press',
      'Troque o primeiro exercício',
      'squat',
    ],
    ['Pernas: Agachamento livre; Leg press', 'Troque o segundo', 'leg-press'],
    [
      'Peito: Supino máquina',
      'Não tenho máquina para esse exercício',
      'chest-press',
    ],
    [
      'Peito: Supino máquina',
      'Troque esse exercício agachamento livre',
      'squat',
    ],
  ])(
    'resolves %s / %s in the presented session, giving named targets priority',
    async (recent, request, key) => {
      const read = jest.fn().mockResolvedValue({
        status: 'AVAILABLE',
        plan: {
          userId: 'user-id',
          aggregateId: 'active-plan',
          calendar: [],
          document: plan(),
        },
      });
      const references = {
        recentAssistant: jest.fn().mockResolvedValue(recent),
      };
      const resolver = new WorkoutPlanMutationResolverService(
        { read } as unknown as CurrentWorkoutPlanReaderService,
        references as unknown as ConversationPlanReferenceService,
      );
      await expect(
        resolver.resolve(
          'user-id',
          request,
          {},
          {
            userId: 'user-id',
            conversationId: 'conversation',
            messageId: 'message',
            referenceDate: new Date(),
          },
        ),
      ).resolves.toMatchObject({
        status: 'READY',
        recognizedContext: {
          mutation: { sourceActivityKey: key, sourcePlanId: 'active-plan' },
          ...(request.includes('máquina')
            ? { equipment: { value: ['BODYWEIGHT'] } }
            : {}),
        },
      });
    },
  );
  it.each([
    null,
    'Pernas: Agachamento livre; Peito: Supino máquina',
    'Uma explicação sobre proteína',
  ])(
    'clarifies an ordinal when no single session was presented: %s',
    async (recent) => {
      const resolver = new WorkoutPlanMutationResolverService(
        {
          read: jest.fn().mockResolvedValue({
            status: 'AVAILABLE',
            plan: { userId: 'user-id', document: plan() },
          }),
        } as unknown as CurrentWorkoutPlanReaderService,
        {
          recentAssistant: jest.fn().mockResolvedValue(recent),
        } as unknown as ConversationPlanReferenceService,
      );
      await expect(
        resolver.resolve(
          'user-id',
          'Troque o primeiro exercício',
          {},
          {
            userId: 'user-id',
            conversationId: 'conversation',
            messageId: 'message',
            referenceDate: new Date(),
          },
        ),
      ).resolves.toMatchObject({ status: 'CLARIFICATION' });
    },
  );
  it('rejects a foreign active plan even when a reader mock supplies it', async () => {
    const resolver = new WorkoutPlanMutationResolverService({
      read: jest.fn().mockResolvedValue({
        status: 'AVAILABLE',
        plan: { userId: 'other', document: plan() },
      }),
    } as unknown as CurrentWorkoutPlanReaderService);
    await expect(
      resolver.resolve('user-id', 'Troque agachamento livre', {}),
    ).resolves.toMatchObject({ status: 'NO_CURRENT_PLAN' });
  });
  function setup(current: WorkoutPlanV2 | null = plan()) {
    const read = jest.fn().mockResolvedValue(
      current
        ? {
            status: 'AVAILABLE',
            plan: { userId: 'user-id', document: current },
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
      'Quero mudar meu treino para 3 vezes por semana',
      { weeklyFrequency: { status: 'CONFIRMED', value: 3 } },
      'FREQUENCY',
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

  it.each(['Quero começar a correr 5 km', 'Quero começar a correr 10 km'])(
    'allows a first running plan without a current plan: %s',
    async (message) => {
      const subject = setup(null);
      await expect(
        subject.resolver.resolve('user-id', message, {}),
      ).resolves.toEqual({ status: 'NOT_A_MUTATION' });
    },
  );

  it('keeps a vague adaptation in clarification', async () => {
    const subject = setup();
    await expect(
      subject.resolver.resolve('user-id', 'Quero adaptar meu treino atual', {}),
    ).resolves.toMatchObject({ status: 'CLARIFICATION' });
  });

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

  it('routes a disguised full replacement away from maintenance semantics', async () => {
    const { resolver, read } = setup();

    await expect(
      resolver.resolve(
        'user-id',
        'Adapte meu treino, mas substitua todo o plano por um totalmente diferente',
        {},
      ),
    ).resolves.toEqual({ status: 'NOT_A_MUTATION' });
    expect(read).not.toHaveBeenCalled();
  });

  it('applies a declared modality change while preserving undeclared plan properties', async () => {
    const { resolver } = setup();

    await expect(
      resolver.resolve('user-id', 'Ajuste meu treino para incluir corrida', {
        modality: { status: 'CONFIRMED', value: 'RUNNING' },
      }),
    ).resolves.toMatchObject({
      status: 'READY',
      recognizedContext: {
        modality: { status: 'CONFIRMED', value: 'RUNNING' },
        objective: { status: 'CONFIRMED', value: 'GENERAL_HEALTH' },
        experience: { status: 'CONFIRMED', value: 'INTERMEDIATE' },
        weeklyFrequency: { status: 'CONFIRMED', value: 2 },
        sessionDurationMinutes: { status: 'CONFIRMED', value: 50 },
        environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
        equipment: {
          status: 'CONFIRMED',
          value: ['BODYWEIGHT', 'MACHINE'],
        },
      },
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
  it.each(['Substitua supino', 'Troque o supino por outro'])(
    'resolves a unique exact exercise name prefix: %s',
    async (request) => {
      await expect(
        setup().resolver.resolve('user-id', request, {}),
      ).resolves.toMatchObject({
        status: 'READY',
        recognizedContext: { mutation: { sourceActivityKey: 'chest-press' } },
      });
    },
  );
  it('clarifies an exercise name prefix that matches two activities', async () => {
    const current = plan();
    const duplicate = {
      ...current,
      sessions: [
        ...current.sessions,
        {
          ...current.sessions[1],
          sessionKey: 'another',
          sequence: 3,
          blocks: [
            {
              ...current.sessions[1].blocks[0],
              activities: [
                {
                  ...current.sessions[1].blocks[0].activities[0],
                  activityKey: 'bar-press',
                  name: 'Supino com barra',
                },
              ],
            },
          ],
        },
      ],
    };
    await expect(
      setup(duplicate).resolver.resolve('user-id', 'Troque supino', {}),
    ).resolves.toMatchObject({ status: 'CLARIFICATION' });
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

  it('resolves a named unavailable current exercise without inventing another source', async () => {
    const { resolver } = setup();

    await expect(
      resolver.resolve('user-id', 'Não tenho leg press', {}),
    ).resolves.toMatchObject({
      status: 'READY',
      recognizedContext: {
        equipment: { status: 'CONFIRMED', value: ['BODYWEIGHT'] },
        mutation: {
          sourceActivityKey: 'leg-press',
          sourceActivityName: 'Leg press',
          reason: 'EQUIPMENT',
        },
      },
    });

    await expect(
      resolver.resolve('user-id', 'Não tenho cadeira extensora', {}),
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
