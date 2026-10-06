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
