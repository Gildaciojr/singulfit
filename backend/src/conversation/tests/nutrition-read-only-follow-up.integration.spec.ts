import { Test, type TestingModule } from '@nestjs/testing';
import { ConversationUnderstandingEngineService } from '../understanding/conversation-understanding-engine.service';
import { AIJobStatus } from '@prisma/client';
import { ConversationModule } from '../conversation.module';
import { ConversationUnderstandingService } from '../understanding/conversation-understanding.service';
import { ConversationRoutingDecisionService } from '../routing/conversation-routing-decision.service';
import { ConversationTurnContextBuilderService } from '../runtime/conversation-turn-context-builder.service';
import { ConversationQAFollowUpContextService } from '../runtime/conversation-qa-follow-up-context.service';
import { ConversationQAExecutorService } from '../runtime/conversation-qa-executor.service';
import { ConversationExecutionBridgeService } from '../runtime/conversation-execution-bridge.service';
import { ConversationResponsePayloadBuilder } from '../runtime/conversation-response-payload.builder';
import { ConversationLanguageRealizerService } from '../runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../runtime/conversation-response-formatter.service';
import { ConversationResponseValidatorService } from '../runtime/conversation-response-validator.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { ConversationContinuationService } from '../runtime/conversation-continuation.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import { ConversationSafetyDetectorService } from '../understanding/conversation-safety-detector.service';
import { ConversationEntityRecognizerService } from '../understanding/conversation-entity-recognizer.service';
import { CoachProfileSnapshotConversationAdapter } from '../adapters/coach-profile-snapshot.adapter';
import { ProfileAcquisitionDecisionConversationAdapter } from '../adapters/profile-acquisition-decision.adapter';
import { CoachConversationHumanContextBuilder } from '../../context/coach-conversation-human-context.builder';
import {
  readyAdaptiveDecision,
  routingSnapshot,
} from './conversation-routing.fixtures';

describe('Nutrition read-only follow-up: real semantic pipeline', () => {
  let module: TestingModule;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConversationModule],
    }).compile();
  });
  afterAll(() => module.close());
  function subject(
    text: string,
    question: string | null = null,
    priorDomain: 'NUTRITION' | 'WORKOUT' = 'NUTRITION',
  ) {
    const receivedAt = '2026-08-01T12:00:00.000Z';
    const dinnerAnswer =
      priorDomain === 'WORKOUT'
        ? 'Uma caminhada leve é uma alternativa.'
        : 'Uma ideia de jantar é sopa de lentilhas com legumes.';
    const current = {
      id: 'message-id',
      content: text,
      timestamp: new Date(receivedAt),
      replyToExternalMessageId: null,
      conversationId: 'conversation-id',
      conversation: { userId: 'user-id' },
    };
    const earlier = [
      {
        id: 'snack',
        content: 'Me dá uma ideia de lanche',
        timestamp: new Date('2026-08-01T11:40:00Z'),
      },
      {
        id: 'dinner',
        content:
          priorDomain === 'WORKOUT'
            ? 'Qual meu treino de amanhã?'
            : 'Me da uma ideia de jantar',
        timestamp: new Date('2026-08-01T11:50:00Z'),
      },
    ];
    const sent = [
      {
        id: 'snack-sent',
        userId: 'user-id',
        conversationId: 'conversation-id',
        content: 'Uma opção de lanche é pão com ovos.',
        context: { source: 'WHATSAPP_COACH_COMMAND', sourceMessageId: 'snack' },
        sentAt: new Date('2026-08-01T11:41:00Z'),
        scheduledFor: new Date('2026-08-01T11:41:00Z'),
        coachMessage: null,
        automationRule: null,
        externalMessageId: 'snack-external',
      },
      {
        id: 'dinner-sent',
        userId: 'user-id',
        conversationId: 'conversation-id',
        content: question ? `${dinnerAnswer}\n\n${question}` : dinnerAnswer,
        context: {
          source: 'WHATSAPP_COACH_COMMAND',
          sourceMessageId: 'dinner',
        },
        sentAt: new Date('2026-08-01T11:51:00Z'),
        scheduledFor: new Date('2026-08-01T11:51:00Z'),
        coachMessage: null,
        automationRule: null,
        externalMessageId: 'dinner-external',
      },
    ];
    const prisma = {
      message: {
        findFirst: jest.fn((query: { where: { id: string } }) =>
          Promise.resolve(
            query.where.id === 'message-id'
              ? current
              : (earlier.find((row) => row.id === query.where.id) ?? null),
          ),
        ),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conversation-id',
          userId: 'user-id',
          messages: earlier.map((row) => ({
            ...row,
            direction: 'INBOUND',
            conversationId: 'conversation-id',
            conversation: { userId: 'user-id' },
          })),
        }),
      },
      scheduledMessage: {
        findFirst: jest.fn((query: { where: { sentAt: { lt: Date } } }) =>
          Promise.resolve(
            sent.filter((row) => row.sentAt < query.where.sentAt.lt).at(-1) ??
              null,
          ),
        ),
        findMany: jest.fn().mockResolvedValue(sent),
      },
      aIJob: {
        findFirst: jest.fn((query: { where: { messageId: string } }) =>
          Promise.resolve({
            result: {
              disposition: 'ANSWER',
              domain:
                query.where.messageId === 'dinner' ? priorDomain : 'NUTRITION',
              answer:
                query.where.messageId === 'dinner'
                  ? dinnerAnswer
                  : 'Uma opção de lanche é pão com ovos.',
              followUpQuestion:
                query.where.messageId === 'dinner' ? question : null,
              grounding: 'MIXED',
              confidence: 'HIGH',
            },
          }),
        ),
      },
      pendingConversationAction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      coachProfileAcquisitionCycle: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (execute: (tx: object) => Promise<unknown>) =>
        execute({}),
      ),
    };
    const boundary = new ConversationPublicAnswerBoundaryService();
    const followUp = new ConversationQAFollowUpContextService(
      prisma as never,
      boundary,
    );
    const builder = new ConversationTurnContextBuilderService(
      prisma as never,
      { build: jest.fn().mockResolvedValue(routingSnapshot()) } as never,
      { decide: jest.fn().mockReturnValue(readyAdaptiveDecision()) } as never,
      new CoachProfileSnapshotConversationAdapter(),
      new ProfileAcquisitionDecisionConversationAdapter(),
      { toCollectorField: jest.fn().mockReturnValue(null) } as never,
      new CoachConversationHumanContextBuilder(),
      new ConversationMessageNormalizerService(),
      new ConversationEntityRecognizerService(),
      followUp,
    );
    const semantics = {
      interpret: jest
        .fn()
        .mockResolvedValue({ action: 'UNRESOLVED', reference: 'UNRESOLVED' }),
    };
    const gate = new ConversationContinuationService(
      prisma as never,
      semantics as never,
      {} as never,
      {} as never,
      boundary,
      new ConversationSafetyDetectorService(),
      new ConversationMessageNormalizerService(),
      followUp,
      {
        enabled: () => true,
        pending: jest.fn().mockResolvedValue(null),
        source: jest.fn().mockResolvedValue(current),
        resolveOnce: (
          _user: string,
          _message: string,
          _type: string,
          execute: () => Promise<unknown>,
        ) => execute(),
      } as never,
    );
    const ai = {
      createJob: jest.fn().mockResolvedValue({
        id: 'job',
        userId: 'user-id',
        status: AIJobStatus.PENDING,
        promptVersion: { prompt: 'Existing QA instructions' },
      }),
      runTextJob: jest.fn().mockResolvedValue({
        outputText: JSON.stringify({
          disposition: 'ANSWER',
          domain: 'NUTRITION',
          answer: 'Uma alternativa de jantar é frango com batata e salada.',
          followUpQuestion: null,
          grounding: 'MIXED',
          confidence: 'HIGH',
        }),
        responseId: 'response',
        model: 'model',
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      }),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };
    const personal = {
      build: jest.fn().mockResolvedValue({
        recentConversation: [
          { direction: 'USER', text: 'Me dá uma ideia de lanche' },
        ],
      }),
      answer: jest.fn().mockReturnValue(null),
      validatesAnswer: jest.fn().mockReturnValue(true),
    };
    const nutrition = {
      read: jest.fn().mockResolvedValue({ status: 'ABSENT', plan: null }),
    };
    const gateway = { createTextResponse: jest.fn() };
    const qa = new ConversationQAExecutorService(
      ai as never,
      prisma as never,
      nutrition as never,
      boundary,
      undefined,
      personal as never,
      gateway as never,
    );
    const bridge = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa,
      followUp,
    );
    return {
      builder,
      gate,
      bridge,
      ai,
      prisma,
      semantics,
      nutrition,
      gateway,
      input: {
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        text,
        receivedAt,
        legacyIntent: 'UNKNOWN' as const,
      },
    };
  }
  it.each([
    ['Uma alternativa de jantar é frango com batata e salada.', 'RECOVERED'],
    ['Legumes com sopa de lentilha são uma opção para jantar.', 'FAILED'],
  ] as const)(
    'limits materially repeated dinner recovery to one retry: %s',
    async (answer, outcome) => {
      const s = subject('Outra opção');
      s.ai.runTextJob.mockResolvedValue({
        outputText: JSON.stringify({
          disposition: 'ANSWER',
          domain: 'NUTRITION',
          answer: 'Legumes com sopa de lentilha são uma opção para jantar.',
          followUpQuestion: null,
          grounding: 'MIXED',
          confidence: 'HIGH',
        }),
        responseId: 'first',
        model: 'model',
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      });
      s.gateway.createTextResponse.mockResolvedValue({
        outputText: JSON.stringify({
          disposition: 'ANSWER',
          domain: 'NUTRITION',
          answer,
          followUpQuestion: null,
          grounding: 'MIXED',
          confidence: 'HIGH',
        }),
        responseId: 'corrected',
        model: 'model',
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      });
      const turn = await s.builder.build(s.input);
      const understanding = await module
        .get(ConversationUnderstandingService)
        .understand(turn.understandingInput);
      const decision = module
        .get(ConversationRoutingDecisionService)
        .decide({ ...turn.preparationBase, understanding });
      const result = await s.bridge.execute(decision, turn.humanContext, {
        ...s.input,
        referenceDate: new Date(s.input.receivedAt),
      });
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: {
          nutritionAdviceInitialViolation:
            'NUTRITION_ADVICE_REPEATS_PREVIOUS_SUGGESTION',
          nutritionAdviceRetryOutcome: outcome,
          effectiveReferentMeal: 'jantar',
        },
      });
      expect(result.content).not.toContain('sopa de lentilhas');
      expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
      expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
      if (outcome === 'FAILED') {
        expect(s.ai.failJob).toHaveBeenCalledTimes(1);
        expect(s.ai.completeJobInTransaction).not.toHaveBeenCalled();
        expect(result.content).not.toContain('sopa de lentilha');
      } else {
        expect(s.ai.failJob).not.toHaveBeenCalled();
        expect(s.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
      }
    },
  );
  it('uses one provider call for a materially different first suggestion', async () => {
    const s = subject('Outra opção');
    const turn = await s.builder.build(s.input);
    const understanding = await module
      .get(ConversationUnderstandingService)
      .understand(turn.understandingInput);
    const decision = module
      .get(ConversationRoutingDecisionService)
      .decide({ ...turn.preparationBase, understanding });
    const result = await s.bridge.execute(decision, turn.humanContext, s.input);
    expect(result.content).toContain('frango com batata e salada');
    expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
    expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
    expect(s.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
    expect(s.ai.failJob).not.toHaveBeenCalled();
  });
  it('checks semantic Workout aliases before inheriting the delivered Nutrition referent', async () => {
    const text = 'Me dá outra opção de cross';
    const s = subject(text, null, 'NUTRITION');
    expect(await s.gate.resolve('user-id', 'message-id')).toBeNull();
    const turn = await s.builder.build(s.input);
    expect(turn.humanContext.effectiveNutritionRequest).toBeUndefined();
    expect(turn.humanContext.currentReadOnlyReferent).toBeUndefined();
    expect(turn.understandingInput.text).toBe(text);
    const service = new ConversationUnderstandingService(
      module.get(ConversationUnderstandingEngineService),
    );
    expect(await service.understand(turn.understandingInput)).toMatchObject({
      domain: 'WORKOUT',
      intent: 'COMMON_MESSAGE',
    });
    expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
  });
  it('executes A through E in the same conversation with one recovery and an explicit domain switch', async () => {
    const texts = [
      'Me dê uma dica de lanche da tarde',
      'Me da uma ideia de jantar',
      'Outra opcao',
      'Sim, eu quero',
      'Me dá outra opção de caminhada',
    ];
    const s = subject(texts[0]);
    const answer = (
      text: string,
      question: string | null = null,
      domain: 'NUTRITION' | 'WORKOUT' = 'NUTRITION',
    ) => ({
      disposition: 'ANSWER',
      domain,
      answer: text,
      followUpQuestion: question,
      grounding: 'MIXED',
      confidence: 'HIGH',
    });
    const candidates = [
      answer('Iogurte natural com banana e aveia.'),
      answer('Uma ideia de jantar é sopa de lentilhas com legumes.'),
      answer(
        'Outra opção de jantar é arroz com frango e legumes.',
        'Quer mais duas opções de jantar?',
      ),
      answer(
        'Mais duas opções de jantar: peixe com batata e salada, ou omelete com tomate e pão integral.',
      ),
      answer('Uma opção de atividade é caminhada leve.', null, 'WORKOUT'),
    ];
    const messages: {
      id: string;
      content: string;
      timestamp: Date;
      conversationId: string;
      conversation: { userId: string };
      replyToExternalMessageId: null;
    }[] = [];
    const delivered: {
      id: string;
      userId: string;
      conversationId: string;
      content: string;
      context: { source: string; sourceMessageId: string };
      sentAt: Date;
      scheduledFor: Date;
      coachMessage: null;
      automationRule: null;
      externalMessageId: string;
    }[] = [];
    const jobs = new Map<string, { result: ReturnType<typeof answer> }>();
    s.prisma.message.findFirst.mockImplementation((query) =>
      Promise.resolve(
        messages.find((row) => row.id === query.where.id) ?? null,
      ),
    );
    s.prisma.conversation.findFirst.mockImplementation(() =>
      Promise.resolve({
        id: 'conversation-id',
        userId: 'user-id',
        messages: messages.map((row) => ({ ...row, direction: 'INBOUND' })),
      }),
    );
    s.prisma.scheduledMessage.findFirst.mockImplementation((query) =>
      Promise.resolve(
        delivered.filter((row) => row.sentAt < query.where.sentAt.lt).at(-1) ??
          null,
      ),
    );
    s.prisma.scheduledMessage.findMany.mockImplementation(() =>
      Promise.resolve(delivered),
    );
    s.prisma.aIJob.findFirst.mockImplementation((query) =>
      Promise.resolve(jobs.get(query.where.messageId)!),
    );
    s.nutrition.read.mockResolvedValue({
      status: 'AVAILABLE',
      plan: {
        title: 'Plano atual',
        summary: 'Plano',
        goal: 'emagrecimento',
        days: [
          {
            meals: [
              {
                name: 'Lanche da tarde',
                time: '16:00',
                items: [
                  { name: 'Iogurte natural', quantity: '1 pote' },
                  { name: 'Banana', quantity: '1 unidade' },
                  { name: 'Aveia', quantity: '1 colher' },
                ],
              },
            ],
          },
        ],
        substitutions: [],
        hydrationGuidance: [],
        generalGuidance: [],
        adaptationGuidance: [],
        safetyGuidance: [],
      },
    });
    s.gateway.createTextResponse.mockResolvedValue({
      outputText: JSON.stringify(
        answer(
          'Uma opção diferente é pão integral com frango desfiado e tomate.',
        ),
      ),
      responseId: 'correction',
      model: 'model',
      promptTokens: 25,
      completionTokens: 15,
      totalTokens: 40,
    });
    for (let i = 0; i < texts.length; i++) {
      const current = {
        id: `m${i}`,
        content: texts[i],
        timestamp: new Date(Date.UTC(2026, 7, 1, 12, i)),
        conversationId: 'conversation-id',
        conversation: { userId: 'user-id', user: { preferences: null } },
        replyToExternalMessageId: null,
      };
      messages.push(current);
      jest.spyOn(s.gate, 'source').mockResolvedValue(current);
      const input = {
        ...s.input,
        messageId: current.id,
        text: current.content,
        receivedAt: current.timestamp.toISOString(),
      };
      s.ai.runTextJob.mockResolvedValue({
        outputText: JSON.stringify(candidates[i]),
        responseId: `response${i}`,
        model: 'model',
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      });
      const continuation = await s.gate.resolve('user-id', current.id);
      if (i === 2 || i === 3)
        expect(continuation).toMatchObject({
          evidence: { delegateRuntime: true },
        });
      else expect(continuation).toBeNull();
      const turn = await s.builder.build(input);
      const understanding = await module
        .get(ConversationUnderstandingService)
        .understand(turn.understandingInput);
      expect(understanding.domain).toBe(i === 4 ? 'WORKOUT' : 'NUTRITION');
      expect(JSON.stringify(understanding)).not.toContain(
        'INCOMPATIBLE_ENTITY',
      );
      if (i === 2 || i === 3)
        expect(turn.humanContext.effectiveNutritionRequest?.meal).toBe(
          'jantar',
        );
      if (i === 4) {
        expect(turn.humanContext.effectiveNutritionRequest).toBeUndefined();
        expect(turn.humanContext.currentReadOnlyReferent).toBeUndefined();
      }
      const decision = module
        .get(ConversationRoutingDecisionService)
        .decide({ ...turn.preparationBase, understanding });
      const result = await s.bridge.execute(decision, turn.humanContext, {
        ...input,
        referenceDate: current.timestamp,
      });
      expect(result.status).toBe('COMPLETED');
      if (i === 0)
        expect(result.observability).toMatchObject({
          nutritionAdviceRetryOutcome: 'RECOVERED',
          totalTokens: 70,
        });
      if (i === 3) {
        const payload: unknown = JSON.parse(
          s.ai.runTextJob.mock.calls.at(-1)![1].input as string,
        );
        expect(payload).toMatchObject({
          previousFollowUpQuestion: 'Quer mais duas opções de jantar?',
        });
      }
      const completed =
        s.ai.completeJobInTransaction.mock.calls.at(-1)![1].result;
      jobs.set(current.id, { result: completed });
      delivered.push({
        id: `s${i}`,
        userId: 'user-id',
        conversationId: 'conversation-id',
        content: result.content!,
        context: {
          source: 'WHATSAPP_COACH_COMMAND',
          sourceMessageId: current.id,
        },
        sentAt: new Date(current.timestamp.getTime() + 1000),
        scheduledFor: new Date(current.timestamp.getTime() + 1000),
        coachMessage: null,
        automationRule: null,
        externalMessageId: `external${i}`,
      });
    }
    expect(s.ai.runTextJob).toHaveBeenCalledTimes(5);
    expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
    expect(s.ai.completeJobInTransaction).toHaveBeenCalledTimes(5);
    expect(s.ai.failJob).not.toHaveBeenCalled();
  });
  it('does not resurrect older Nutrition after a delivered Workout answer', async () => {
    const s = subject('Outra opção', null, 'WORKOUT');
    const turn = await s.builder.build(s.input);
    expect(turn.humanContext.effectiveNutritionRequest).toBeNull();
    expect(turn.humanContext.currentReadOnlyReferent).toMatchObject({
      sourceMessageId: 'dinner',
      domain: 'WORKOUT',
      nutrition: null,
    });
  });
  it.each(['Me dá outra opção de caminhada', 'Me dá outra opção de treino'])(
    'keeps current Workout semantics for %s after dinner',
    async (text) => {
      const s = subject(text);
      expect(await s.gate.resolve('user-id', 'message-id')).toBeNull();
      const turn = await s.builder.build(s.input);
      expect(turn.understandingInput.text).toBe(text);
      expect(turn.humanContext.effectiveNutritionRequest).toBeUndefined();
      expect(turn.humanContext.currentReadOnlyReferent).toBeUndefined();
      const understanding = await module
        .get(ConversationUnderstandingService)
        .understand(turn.understandingInput);
      expect(understanding).toMatchObject({
        status: 'UNDERSTOOD',
        domain: 'WORKOUT',
      });
      expect(JSON.stringify(understanding)).not.toContain(
        'INCOMPATIBLE_ENTITY',
      );
    },
  );
  it.each(['Me dá outra opção de jantar', 'Quero uma ideia de lanche'])(
    'keeps explicit Nutrition for %s after Workout',
    async (text) => {
      const s = subject(text, null, 'WORKOUT');
      expect(await s.gate.resolve('user-id', 'message-id')).toBeNull();
      const turn = await s.builder.build(s.input);
      expect(turn.humanContext.effectiveNutritionRequest).toBeUndefined();
      expect(turn.humanContext.currentReadOnlyReferent).toBeUndefined();
      const understanding = await module
        .get(ConversationUnderstandingService)
        .understand(turn.understandingInput);
      expect(understanding.domain).toBe('NUTRITION');
      expect(JSON.stringify(understanding)).not.toContain(
        'INCOMPATIBLE_ENTITY',
      );
    },
  );
  it.each([
    ['Outra opcao', [], null],
    ['sem lactose', ['LACTOSE'], null],
    ['mais barato', ['LOW_COST'], null],
    ['rápido e proteico', ['QUICK', 'HIGH_PROTEIN'], null],
    ['sim, eu quero', [], 'Quer mais duas opções de jantar?'],
  ] as const)(
    'routes %s to effective dinner advice, ahead of the old snack',
    async (text, constraints, question) => {
      const s = subject(text, question);
      expect(await s.gate.resolve('user-id', 'message-id')).toMatchObject({
        pending: null,
        next: null,
        evidence: { delegateRuntime: true },
      });
      expect(s.semantics.interpret).not.toHaveBeenCalled();
      const turn = await s.builder.build(s.input);
      expect(turn.humanContext.currentMessage).toBe(text);
      expect(turn.humanContext.effectiveNutritionRequest).toMatchObject({
        meal: 'jantar',
        constraints,
      });
      const understanding = await module
        .get(ConversationUnderstandingService)
        .understand(turn.understandingInput);
      expect(understanding).toMatchObject({
        status: 'UNDERSTOOD',
        domain: 'NUTRITION',
        operation: 'PROVIDE_GUIDANCE',
        intent: 'NUTRITION_QUESTION',
      });
      const decision = module
        .get(ConversationRoutingDecisionService)
        .decide({ ...turn.preparationBase, understanding });
      expect(decision.executionRoute.kind).toBe('NUTRITION_GUIDANCE');
      const result = await s.bridge.execute(decision, turn.humanContext, {
        ...s.input,
        referenceDate: new Date(s.input.receivedAt),
      });
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: {
          effectiveReferentMessageId: 'dinner',
          effectiveReferentMeal: 'jantar',
          effectiveReferentDomain: 'NUTRITION',
        },
      });
      expect(result.content).not.toContain('lanche');
      const payload: unknown = JSON.parse(
        s.ai.runTextJob.mock.calls[0][1].input as string,
      );
      expect(payload).toMatchObject({
        request: text,
        previousAnswer: 'Uma ideia de jantar é sopa de lentilhas com legumes.',
        previousFollowUpQuestion: question,
        nutritionGuidance: {
          meal: 'jantar',
          immediateConstraints: constraints,
        },
        trustedContext: { recentConversation: [] },
        recentConversation: expect.arrayContaining([
          expect.objectContaining({
            text: question
              ? `Uma ideia de jantar é sopa de lentilhas com legumes.\n\n${question}`
              : 'Uma ideia de jantar é sopa de lentilhas com legumes.',
          }),
        ]),
      });
    },
  );
  it.each(['Outra opção', 'sem lactose', 'sim'])(
    'clarifies %s without an eligible delivered referent',
    async (text) => {
      const s = subject(text);
      s.prisma.scheduledMessage.findFirst.mockResolvedValue(null);
      expect(await s.gate.resolve('user-id', 'message-id')).toMatchObject({
        pending: null,
        next: null,
        evidence: {},
      });
      const turn = await s.builder.build(s.input);
      expect(turn.humanContext.effectiveNutritionRequest).toBeUndefined();
      expect(s.ai.runTextJob).not.toHaveBeenCalled();
    },
  );
  it('keeps urgent safety ahead of an available dinner referent', async () => {
    const s = subject('Outra opção, estou com dor no peito e falta de ar');
    expect(await s.gate.resolve('user-id', 'message-id')).toMatchObject({
      evidence: { safetyAction: 'URGENT_GUIDANCE' },
    });
    expect(s.prisma.scheduledMessage.findFirst).not.toHaveBeenCalled();
  });
  it('delegates an active mutation lifecycle without consuming the old reminder', async () => {
    const s = subject('sim');
    s.prisma.pendingConversationAction.findFirst.mockResolvedValue({
      id: 'mutation',
    });
    expect(await s.gate.resolve('user-id', 'message-id')).toBeNull();
    expect(s.prisma.scheduledMessage.findFirst).not.toHaveBeenCalled();
    expect(s.semantics.interpret).not.toHaveBeenCalled();
  });
});
