import { Test, type TestingModule } from '@nestjs/testing';
import { ConversationModule } from '../../conversation/conversation.module';
import { ConversationUnderstandingService } from '../../conversation/understanding/conversation-understanding.service';
import { ConversationRoutingDecisionService } from '../../conversation/routing/conversation-routing-decision.service';
import {
  understandingInput,
  historyEntry,
} from '../../conversation/tests/conversation-understanding.fixtures';
import {
  goalPreparationInput,
  routingSnapshot,
  knownDatum,
} from '../../conversation/tests/conversation-routing.fixtures';
import { GenerateWorkoutPlanV2InputBuilder } from './generate-workout-plan-v2-input.builder';
import {
  WorkoutModalityResolutionService,
  runningTransitionPermission,
} from './workout-modality-resolution.service';
import type { WorkoutModality } from './workout-planning-artifact.contract';
import { OpenAIGateway } from '../../ai/openai.gateway';
import { WorkoutPlanningContextBuilder } from './workout-planning-context.builder';
import { WorkoutPlanningStrategyService } from './workout-planning-strategy.service';
import {
  qualityPlan,
  qualitySession,
  qualityCandidate,
  strength,
} from './workout-quality.fixtures';
import { WorkoutPlanV2Validator } from './workout-plan-v2.validator';
import { estimateWorkoutSession } from './workout-duration-estimator';

describe('Current-turn Understanding is the Workout modality source of truth', () => {
  let module: TestingModule;
  const provider = jest
    .spyOn(OpenAIGateway.prototype, 'createTextResponse')
    .mockRejectedValue(new Error('Modality must not call provider'));
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConversationModule],
    }).compile();
  });
  afterAll(async () => {
    await module.close();
    provider.mockRestore();
  });
  beforeEach(() => provider.mockClear());
  it.each([
    ['CrossFit', 'CROSSFIT'],
    ['corrida', 'RUNNING'],
    ['treino em casa', 'HOME_WORKOUT'],
    ['caminhada', 'WALKING'],
    ['ciclismo', 'CYCLING'],
    ['treino funcional', 'FUNCTIONAL'],
    ['treino cardio', 'CARDIO_CONDITIONING'],
    ['musculação', 'GYM_STRENGTH'],
  ] as const)(
    'preserves undeclared facts while overriding frequency/duration for %s',
    async (request, modality) => {
      for (const [suffix, count, duration, frequencySource, durationSource] of [
        ['2 vezes por semana', 2, 60, 'CURRENT_EXPLICIT', 'CONFIRMED_PROFILE'],
        [
          '30 minutos por treino',
          5,
          30,
          'CONFIRMED_PROFILE',
          'CURRENT_EXPLICIT',
        ],
      ] as const) {
        const text = `Monte um ${request} para mim, ${suffix}.`;
        const original = routingSnapshot();
        const snapshot = {
          ...original,
          training: {
            ...original.training,
            weeklyFrequency: knownDatum(5),
            sessionDurationMinutes: knownDatum(60),
            preferredModality: knownDatum('RUNNING'),
          },
        };
        const understanding = await module
          .get(ConversationUnderstandingService)
          .understand(
            understandingInput(text, {
              recentHistory: [
                historyEntry(
                  'Seu treino anterior: corrida 5 vezes por semana, 60 minutos.',
                ),
              ],
            }),
          );
        const decision = module
          .get(ConversationRoutingDecisionService)
          .decide(
            goalPreparationInput(understanding, { snapshot }),
          ).goalDecision;
        const built = await new GenerateWorkoutPlanV2InputBuilder(
          {} as never,
          { fitnessCheckIn: { findMany: () => Promise.resolve([]) } } as never,
        ).build({
          userId: 'user-id',
          profileId: 'profile-id',
          snapshot,
          decision,
          currentMessage: text,
          referenceDate: new Date(snapshot.referenceDate),
        });
        expect(built.generationInput.recognizedContext?.modality).toEqual({
          status: 'CONFIRMED',
          value: modality,
        });
        const context = new WorkoutPlanningContextBuilder().build({
          ...built.generationInput,
          artifactType: 'WEEKLY_PLAN',
          modality,
        });
        const strategy = new WorkoutPlanningStrategyService().build(context);
        expect(strategy.sessionCount).toBe(count);
        expect(strategy.sessionDurationMinutes).toEqual({
          status: 'CONFIRMED',
          value: duration,
        });
        expect(context.resolvedFacts?.weeklyFrequency.source).toBe(
          frequencySource,
        );
        expect(context.resolvedFacts?.sessionDurationMinutes.source).toBe(
          durationSource,
        );
        expect(provider).not.toHaveBeenCalled();
      }
    },
  );
  it.each([
    [
      'Monte um treino de musculação para mim, 2 vezes por semana, com 30 minutos por treino.',
      2,
      30,
      true,
      true,
      false,
    ],
    [
      'Monte um treino de musculação para mim, 3 vezes por semana, 45 minutos.',
      3,
      45,
      true,
      true,
      false,
    ],
    [
      'Monte um treino de musculação para mim, 2 vezes por semana.',
      2,
      60,
      true,
      false,
      false,
    ],
    [
      'Monte um treino de musculação para mim, 30 minutos por treino.',
      5,
      30,
      false,
      true,
      false,
    ],
    ['Monte um treino de musculação para mim.', 5, 60, false, false, false],
    [
      'Monte um treino de musculação para mim, 4 vezes por semana, 30 minutos por treino.',
      4,
      30,
      true,
      true,
      true,
    ],
  ] as const)(
    'resolves current frequency/duration over conflicting history and profile: %s',
    async (
      text,
      frequency,
      minutes,
      explicitFrequency,
      explicitDuration,
      previous,
    ) => {
      const understanding = await module
        .get(ConversationUnderstandingService)
        .understand(
          understandingInput(text, {
            recentHistory: [
              historyEntry(
                'Seu treino anterior é 5 vezes por semana com 60 minutos por treino.',
              ),
            ],
          }),
        );
      const decision = module
        .get(ConversationRoutingDecisionService)
        .decide(goalPreparationInput(understanding)).goalDecision;
      const original = routingSnapshot();
      const snapshot = {
        ...original,
        training: {
          ...original.training,
          weeklyFrequency: knownDatum(5),
          sessionDurationMinutes: knownDatum(60),
        },
      };
      const oldPlan = qualityPlan();
      const previousPlan = {
        ...oldPlan,
        sessions: oldPlan.sessions.slice(0, 3),
        strategy: {
          ...oldPlan.strategy,
          sessionCount: 3,
          sessionDurationMinutes: { status: 'CONFIRMED' as const, value: 45 },
        },
      };
      const built = await new GenerateWorkoutPlanV2InputBuilder(
        {} as never,
        { fitnessCheckIn: { findMany: () => Promise.resolve([]) } } as never,
        previous
          ? ({
              readPrevious: () =>
                Promise.resolve({ userId: 'user-id', document: previousPlan }),
            } as never)
          : undefined,
      ).build({
        userId: 'user-id',
        profileId: 'profile-id',
        snapshot,
        decision,
        currentMessage: text,
        referenceDate: new Date(snapshot.referenceDate),
        ...(previous ? { previousPlan } : {}),
      });
      const context = new WorkoutPlanningContextBuilder().build({
        ...built.generationInput,
        artifactType: 'WEEKLY_PLAN',
        modality: 'GYM_STRENGTH',
      });
      const strategy = new WorkoutPlanningStrategyService().build(context);
      expect(context.modality).toEqual({
        status: 'CONFIRMED',
        value: 'GYM_STRENGTH',
      });
      expect(context.training.weeklyFrequency).toEqual({
        status: 'CONFIRMED',
        value: frequency,
      });
      expect(context.training.sessionDurationMinutes).toEqual({
        status: 'CONFIRMED',
        value: minutes,
      });
      expect(context.resolvedFacts?.weeklyFrequency.source).toBe(
        explicitFrequency ? 'CURRENT_EXPLICIT' : 'CONFIRMED_PROFILE',
      );
      expect(context.resolvedFacts?.sessionDurationMinutes.source).toBe(
        explicitDuration ? 'CURRENT_EXPLICIT' : 'CONFIRMED_PROFILE',
      );
      expect(strategy.sessionCount).toBe(frequency);
      if (previous) {
        expect(built.generationInput.previousPlan?.strategy.sessionCount).toBe(
          3,
        );
        expect(
          built.generationInput.previousPlan?.strategy.sessionDurationMinutes,
        ).toEqual({ status: 'CONFIRMED', value: 45 });
      }
      expect(strategy.sessionDurationMinutes).toEqual({
        status: 'CONFIRMED',
        value: minutes,
      });
      expect(provider).not.toHaveBeenCalled();
      if (frequency === 2 && minutes === 30) {
        const sessions = (['MONDAY', 'THURSDAY'] as const).map(
          (weekday, index) => ({
            ...qualitySession(
              `short-${index}`,
              Array.from({ length: 4 }, (_, i) => ({
                ...strength(`short-${index}-${i}`),
                sets: 3,
                repetitions: '10',
                restSeconds: 60,
              })),
            ),
            weekday,
            sequence: index + 1,
            estimatedDurationMinutes: 30,
            blocks: [
              {
                blockKey: `short-${index}-main`,
                title: 'Principal',
                type: 'STRENGTH' as const,
                estimatedDurationMinutes: 30,
                activities: Array.from({ length: 4 }, (_, i) => ({
                  ...strength(`short-${index}-${i}`),
                  sets: 3,
                  repetitions: '10',
                  restSeconds: 60,
                })),
              },
            ],
          }),
        );
        const validator = new WorkoutPlanV2Validator();
        expect(
          validator
            .validate(qualityCandidate(sessions), context, strategy, true)
            .issues.filter((issue) => issue.severity === 'ERROR'),
        ).toEqual([]);
        for (const session of sessions) {
          expect(session.estimatedDurationMinutes).toBeLessThanOrEqual(30);
          expect(
            estimateWorkoutSession(session).minimumMinutes,
          ).toBeLessThanOrEqual(30);
          expect(
            estimateWorkoutSession(session).maximumMinutes,
          ).toBeGreaterThanOrEqual(24);
        }
        const copied = sessions.map((session, index) => ({
          ...qualitySession(`copy-${index}`),
          weekday: session.weekday,
          sequence: index + 1,
          estimatedDurationMinutes: 30,
          blocks: qualitySession(`copy-${index}`).blocks.map((block) => ({
            ...block,
            estimatedDurationMinutes:
              block.type === 'STRENGTH' ? 15 : block.estimatedDurationMinutes,
          })),
        }));
        expect(
          validator.validate(qualityCandidate(copied), context, strategy, true)
            .issues,
        ).toContainEqual(
          expect.objectContaining({
            code: 'SESSION_DURATION_EXCEEDED',
            severity: 'ERROR',
          }),
        );
        expect(
          validator.validate(
            qualityCandidate([
              { ...sessions[0], estimatedDurationMinutes: 31 },
              sessions[1],
            ]),
            context,
            strategy,
            true,
          ).issues,
        ).toContainEqual(
          expect.objectContaining({
            code: 'SESSION_DURATION_EXCEEDED',
            severity: 'ERROR',
          }),
        );
        expect(
          validator.validate(
            qualityCandidate([
              ...sessions,
              { ...sessions[0], sessionKey: 'extra' },
            ]),
            context,
            strategy,
            true,
          ).issues,
        ).toContainEqual(
          expect.objectContaining({
            code: 'SESSION_COUNT_MISMATCH',
            severity: 'ERROR',
          }),
        );
      }
    },
  );
  const matrix: readonly [string, WorkoutModality][] = [
    [
      'Quero CrossFit 4x, estou voltando agora e quero algo mais técnico',
      'CROSSFIT',
    ],
    ['Quero corrida 4x, agora quero esforço mais leve', 'RUNNING'],
    ['Quero CrossFit, agora não quero corrida', 'CROSSFIT'],
    ['Quero CrossFit, agora quero caminhada', 'WALKING'],
    ['monte um treino de caminhada para mim, 5 vezes por semana', 'WALKING'],
    ['monte um treino de caminhada para mim 5x', 'WALKING'],
    ['quero caminhar 4x por semana', 'WALKING'],
    ['faz um programa só de caminhada', 'WALKING'],
    ['treino pra caminhar na esteira', 'WALKING'],
    ['treino d caminhada', 'WALKING'],
    ['quero um treino só caminhando', 'WALKING'],
    ['quero andar 5 dias por semana', 'WALKING'],
    ['quero começar fazendo caminhadas', 'WALKING'],
    ['quero caminhada na academia', 'WALKING'],
    ['monte treino de corrida na rua', 'RUNNING'],
    ['quero começar a correr', 'RUNNING'],
    ['quero correr meus primeiros 5km', 'RUNNING'],
    ['treino pra 10k', 'RUNNING'],
    ['treino pra primeiros 5km', 'RUNNING'],
    ['qro corre na rua 3x', 'RUNNING'],
    ['preparação para uma prova de rua', 'RUNNING'],
    ['monte um treino de crossfit', 'CROSSFIT'],
    ['faço crossfit 4 vezes por semana', 'CROSSFIT'],
    ['quero começar no cross', 'CROSSFIT'],
    ['monta uns WODs pra mim', 'CROSSFIT'],
    ['qro fazer crossfit 4x', 'CROSSFIT'],
    ['qro comecar no cross', 'CROSSFIT'],
    ['treino pra fazer no box', 'CROSSFIT'],
    ['monte um treino na academia para fazer cross', 'CROSSFIT'],
    ['quero crossfit em uma academia comum', 'CROSSFIT'],
    ['quero musculação para melhorar meu crossfit', 'GYM_STRENGTH'],
    ['para melhorar meu crossfit, quero musculação', 'GYM_STRENGTH'],
    ['quero musculação para hipertrofia', 'GYM_STRENGTH'],
    ['quero ganhar massa treinando com pesos', 'GYM_STRENGTH'],
    ['quero treinar em casa sem equipamento', 'HOME_WORKOUT'],
    ['quero treino em casa sem equipamento', 'HOME_WORKOUT'],
    ['quero evoluir barra e paralela usando peso corporal', 'CALISTHENICS'],
    ['quero bike', 'CYCLING'],
    ['quero calistenia', 'CALISTHENICS'],
    ['quero treino funcional', 'FUNCTIONAL'],
  ];
  it.each(matrix)(
    'propagates %s as %s without a provider or builder reclassification',
    async (text, modality) => {
      const result = await module
        .get(ConversationUnderstandingService)
        .understand(understandingInput(text));
      expect(result).toMatchObject({
        status: 'UNDERSTOOD',
        intent: 'WORKOUT_PLAN_REQUEST',
        domain: 'WORKOUT',
        operation: 'GENERATE_PLAN',
      });
      expect(result.entities).toContainEqual({
        kind: 'WORKOUT_MODALITY',
        value: modality,
      });
      const decision = module
        .get(ConversationRoutingDecisionService)
        .decide(goalPreparationInput(result));
      expect(decision.goalDecision.workoutModalityResolution).toBe(
        result.metadata.workoutModalityResolution,
      );
      const original = routingSnapshot();
      const snapshot = {
        ...original,
        training: {
          ...original.training,
          preferredModality: knownDatum(
            modality === 'WALKING' ? 'RUNNING' : 'GYM_STRENGTH',
          ),
        },
      };
      const builder = new GenerateWorkoutPlanV2InputBuilder(
        {} as never,
        {} as never,
      );
      const built = await builder.build({
        userId: 'user-id',
        profileId: 'profile-id',
        snapshot,
        decision: decision.goalDecision,
        // Deliberately conflicting downstream text proves the typed decision is authoritative.
        currentMessage: 'quero musculação na academia',
        referenceDate: new Date(original.referenceDate),
      });
      expect(built.generationInput.recognizedContext.modality).toEqual({
        status: 'CONFIRMED',
        value: modality,
      });
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it.each(['sim', 'quero', 'ok', 'pode ser', 'outra opção'])(
    'never makes a modality-provider call for %s',
    async (text) => {
      const resolver = module.get(WorkoutModalityResolutionService);
      expect(await resolver.resolve(text, true)).toMatchObject({
        modality: null,
        action: 'OTHER',
      });
      await module
        .get(ConversationUnderstandingService)
        .understand(understandingInput(text));
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['pode incluir trotes', 'ALLOW'],
    ['quero começar caminhando e depois correr', 'ALLOW'],
    ['quero evoluir da caminhada para corrida', 'ALLOW'],
    ['sem incluir trotes', 'DENY'],
    ['sem trote', 'DENY'],
    ['não quero correr', 'DENY'],
    ['só caminhada', 'DENY'],
    ['quero caminhada, nada de corrida', 'DENY'],
    ['prefiro não correr', 'DENY'],
    ['caminhada', 'UNSPECIFIED'],
  ])('resolves transition polarity %s as %s', (text, permission) => {
    expect(runningTransitionPermission(text)).toBe(permission);
  });
  it('leaves an unresolved Workout request unresolved without a modality-provider call', async () => {
    const text = 'quero um treino diferente';
    expect(
      await module.get(WorkoutModalityResolutionService).resolve(text, true),
    ).toMatchObject({ modality: null });
    const result = await module
      .get(ConversationUnderstandingService)
      .understand(understandingInput(text));
    expect(
      result.entities.some((entity) => entity.kind === 'WORKOUT_MODALITY'),
    ).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });
  it('current DENY supersedes yesterday ALLOW, independently of history', async () => {
    const result = await module
      .get(ConversationUnderstandingService)
      .understand(
        understandingInput('agora quero só caminhada', {
          recentHistory: [historyEntry('pode incluir trote')],
          workoutAvailable: true,
        }),
      );
    expect(result.metadata.workoutModalityResolution).toMatchObject({
      modality: 'WALKING',
      runningTransitionPermission: 'DENY',
      runningTransitionAuthorized: false,
    });
    const snapshot = routingSnapshot();
    const decision = module
      .get(ConversationRoutingDecisionService)
      .decide(goalPreparationInput(result));
    const built = await new GenerateWorkoutPlanV2InputBuilder(
      {} as never,
      {} as never,
    ).build({
      userId: 'user-id',
      profileId: 'profile-id',
      snapshot,
      decision: decision.goalDecision,
      currentMessage: 'agora quero só caminhada',
      referenceDate: new Date(snapshot.referenceDate),
      recognizedContext: {
        runningTransitionPermission: 'ALLOW',
        runningTransitionAuthorized: true,
      },
    });
    const context = new WorkoutPlanningContextBuilder().build({
      ...built.generationInput,
      artifactType: 'WEEKLY_PLAN',
      modality: 'WALKING',
    });
    const strategy = new WorkoutPlanningStrategyService().build(context);
    expect(strategy.runningTransitionPermission).toBe('DENY');
    expect(strategy.runningTransitionAuthorized).toBe(false);
  });
  it('preserves safety before current Workout semantics', async () => {
    expect(
      await module
        .get(ConversationUnderstandingService)
        .understand(
          understandingInput(
            'quero crossfit mas estou com dor no peito e falta de ar',
          ),
        ),
    ).toMatchObject({ domain: 'SAFETY' });
  });
  it('preserves canonical reads and mutations', async () => {
    const service = module.get(ConversationUnderstandingService);
    expect(
      (
        await service.understand(
          understandingInput('Qual meu treino de caminhada de amanhã?', {
            workoutAvailable: true,
          }),
        )
      ).operation,
    ).not.toBe('GENERATE_PLAN');
    expect(
      (
        await service.understand(
          understandingInput('troque esse exercício de crossfit', {
            workoutAvailable: true,
          }),
        )
      ).operation,
    ).not.toBe('GENERATE_PLAN');
  });
});
