import { ConversationExecutionRouterService } from '../routing/conversation-execution-router.service';
import { ConversationExecutionBridgeService } from '../runtime/conversation-execution-bridge.service';
import { ConversationLanguageRealizerService } from '../runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../runtime/conversation-response-formatter.service';
import { ConversationResponsePayloadBuilder } from '../runtime/conversation-response-payload.builder';
import { ConversationResponseValidatorService } from '../runtime/conversation-response-validator.service';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';
import type { ConversationRoutingDecision } from '../contracts/conversation-execution-route.contract';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import {
  goalDecision,
  planReference,
  understanding,
} from './conversation-routing.fixtures';

describe('ConversationExecutionBridgeService', () => {
  const router = new ConversationExecutionRouterService(
    new ConversationUnderstandingValidator(),
  );
  const service = new ConversationExecutionBridgeService(
    new ConversationResponsePayloadBuilder(),
    new ConversationLanguageRealizerService(),
    new ConversationResponseFormatterService(),
    new ConversationResponseValidatorService(),
  );

  function human(
    message: string,
    cue: CoachConversationHumanContext['turnCue'] = 'COMMON',
    recentConversation: CoachConversationHumanContext['recentConversation'] = Object.freeze(
      [],
    ),
  ): CoachConversationHumanContext {
    return {
      currentMessage: message,
      turnCue: cue,
      preferredName: null,
      goal: null,
      desiredOutcome: null,
      routine: {
        trainingTime: null,
        mealTimes: null,
        cookingAvailability: null,
        mealsAwayFromHome: null,
      },
      training: { modality: null, experience: null },
      nutrition: {
        dietaryPattern: null,
        preferredFoods: null,
        rejectedFoods: null,
      },
      restrictions: null,
      communication: {
        style: null,
        coachingStyle: null,
        tone: null,
        motivation: null,
        messagePreference: 'BALANCED',
        journeyStage: null,
      },
      memory: Object.freeze([]),
      recentConversation,
      continuity: null,
      progress: null,
      currentPlans: { diet: null, workout: null },
    };
  }

  function decision(
    result: ReturnType<typeof understanding>,
    goal: ReturnType<typeof goalDecision>,
  ): ConversationRoutingDecision {
    const executionRoute = router.route({
      understanding: result,
      goalDecision: goal,
    });
    return {
      decisionVersion: 'conversation-routing-decision:v1',
      understanding: result,
      plannerSummary: {
        recognizedIntent: goal.recognizedIntent,
        targetPlan: goal.targetPlan,
        profileCompletionState: goal.profileCompletionState,
        progressContextAvailable: false,
        confirmationRequired: false,
        currentLogicalTurn: 1,
      },
      goalDecision: goal,
      executionRoute,
      versions: {
        preparation: 'conversation-goal-preparation:v1',
        router: 'conversation-execution-router:v1',
        decision: 'conversation-routing-decision:v1',
      },
    };
  }

  it('realizes a conversational response without AI or external execution', async () => {
    const result = await service.execute(
      decision(
        understanding('COMMON_MESSAGE', 'ANSWER', 'GENERAL'),
        goalDecision('ANSWER_MESSAGE', 'COMMON_MESSAGE'),
      ),
    );

    expect(result).toEqual({
      status: 'COMPLETED',
      routeKind: 'ANSWER_MESSAGE',
      content:
        'Me conta um pouco mais do que aconteceu para eu te orientar de forma útil.',
    });
  });

  it('uses the Q&A executor only for a contextual common read-only route', async () => {
    const qa = {
      execute: jest.fn().mockResolvedValue({
        status: 'COMPLETED',
        content: 'Uma colher de sopa tem aproximadamente 15 mL.',
        observability: {
          answerSource: 'AI',
          disposition: 'ANSWER',
          domain: 'GENERAL',
          grounding: 'GENERAL_KNOWLEDGE',
          providerDurationMs: 20,
          promptTokens: 10,
          completionTokens: 8,
          totalTokens: 18,
          fallbackReason: null,
        },
      }),
    };
    const subject = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa as never,
    );

    await expect(
      subject.execute(
        decision(
          understanding(
            'GENERAL_GUIDANCE_REQUEST',
            'PROVIDE_GUIDANCE',
            'GENERAL',
          ),
          goalDecision('GENERAL_GUIDANCE', 'GENERAL_GUIDANCE_REQUEST'),
        ),
        human('Quanto mede uma colher de sopa?'),
        {
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
        },
      ),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Uma colher de sopa tem aproximadamente 15 mL.',
      observability: { answerSource: 'AI' },
    });
    expect(qa.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Obrigado!', 'THANKS'],
    ['Bom dia', 'GREETING'],
    ['Sim', 'AFFIRMATION'],
  ] as const)(
    'keeps %s deterministic without a Q&A call',
    async (message, cue) => {
      const qa = { execute: jest.fn() };
      const subject = new ConversationExecutionBridgeService(
        new ConversationResponsePayloadBuilder(),
        new ConversationLanguageRealizerService(),
        new ConversationResponseFormatterService(),
        new ConversationResponseValidatorService(),
        qa as never,
      );

      await expect(
        subject.execute(
          decision(
            understanding('COMMON_MESSAGE', 'ANSWER', 'GENERAL'),
            goalDecision('ANSWER_MESSAGE', 'COMMON_MESSAGE'),
          ),
          human(message, cue),
          {
            userId: 'user-id',
            conversationId: 'conversation-id',
            messageId: 'message-id',
          },
        ),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
      expect(qa.execute).not.toHaveBeenCalled();
    },
  );

  it('continues Q&A when a standalone affirmation answers the latest coach follow-up', async () => {
    const qa = {
      execute: jest.fn().mockResolvedValue({
        status: 'COMPLETED',
        content: 'Isso equivale aproximadamente a 480 g de arroz cozido.',
        observability: {
          answerSource: 'AI',
          disposition: 'ANSWER',
          domain: 'NUTRITION',
          grounding: 'RECENT_CONTEXT',
          providerDurationMs: 10,
          promptTokens: 5,
          completionTokens: 5,
          totalTokens: 10,
          fallbackReason: null,
        },
      }),
    };
    const qaFollowUp = {
      findPending: jest.fn().mockResolvedValue({
        sourceMessageId: 'previous-message-id',
        previousAnswer:
          '🍚 No almoço, seu plano tem *arroz branco cozido: 3 xícaras cozidas*.',
        previousFollowUpQuestion: 'Quer que eu converta isso para gramas?',
      }),
    };
    const subject = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa as never,
      qaFollowUp as never,
    );

    await expect(
      subject.execute(
        decision(
          understanding('COMMON_MESSAGE', 'ANSWER', 'GENERAL'),
          goalDecision('ANSWER_MESSAGE', 'COMMON_MESSAGE'),
        ),
        human(
          'Sim',
          'AFFIRMATION',
          Object.freeze([
            {
              direction: 'USER',
              text: 'Quanto de arroz eu tenho no almoço?',
            },
          ]),
        ),
        {
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
        },
      ),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Isso equivale aproximadamente a 480 g de arroz cozido.',
    });
    expect(qaFollowUp.findPending).toHaveBeenCalledTimes(1);
    expect(qa.execute).toHaveBeenCalledTimes(1);
    expect(qa.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        previousFollowUpQuestion: 'Quer que eu converta isso para gramas?',
        previousAnswer:
          '🍚 No almoço, seu plano tem *arroz branco cozido: 3 xícaras cozidas*.',
      }),
    );
  });

  it.each([
    ['Bom dia, o que tenho para comer hoje?', 'GREETING'],
    ['Obrigado, e quanto de água devo tomar?', 'THANKS'],
    ['Sim, mas quantos gramas seriam?', 'AFFIRMATION'],
    ['Não, eu queria saber quanto tem nessa porção.', 'NEGATION'],
    ['E se fossem 3 colheres?', 'CONTINUITY'],
    ['Por que você colocou isso?', 'CONTINUITY'],
  ] as const)(
    'uses Q&A for substantive/composite turn: %s',
    async (message, cue) => {
      const qa = {
        execute: jest.fn().mockResolvedValue({
          status: 'COMPLETED',
          content: 'Resposta contextual.',
          observability: {
            answerSource: 'AI',
            disposition: 'ANSWER',
            domain: 'GENERAL',
            grounding: 'RECENT_CONTEXT',
            providerDurationMs: 10,
            promptTokens: 5,
            completionTokens: 5,
            totalTokens: 10,
            fallbackReason: null,
          },
        }),
      };
      const subject = new ConversationExecutionBridgeService(
        new ConversationResponsePayloadBuilder(),
        new ConversationLanguageRealizerService(),
        new ConversationResponseFormatterService(),
        new ConversationResponseValidatorService(),
        qa as never,
      );

      await expect(
        subject.execute(
          decision(
            understanding(
              'GENERAL_GUIDANCE_REQUEST',
              'PROVIDE_GUIDANCE',
              'GENERAL',
            ),
            goalDecision('GENERAL_GUIDANCE', 'GENERAL_GUIDANCE_REQUEST'),
          ),
          human(message, cue),
          {
            userId: 'user-id',
            conversationId: 'conversation-id',
            messageId: 'message-id',
          },
        ),
      ).resolves.toMatchObject({
        status: 'COMPLETED',
        content: 'Resposta contextual.',
      });
      expect(qa.execute).toHaveBeenCalledTimes(1);
    },
  );

  it('realizes an explicit confirmation request', async () => {
    const qa = { execute: jest.fn() };
    const qaFollowUp = { findPending: jest.fn() };
    const subject = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa as never,
      qaFollowUp as never,
    );
    const result = await subject.execute(
      decision(
        understanding(
          'CONFIRMATION_REQUIRED',
          'REQUEST_CONFIRMATION',
          'NUTRITION',
        ),
        goalDecision('REQUEST_CONFIRMATION', 'CONFIRMATION_REQUIRED', {
          targetPlan: 'DIET',
        }),
      ),
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.status === 'COMPLETED' && result.content).toContain(
      'plano alimentar',
    );
    expect(qa.execute).not.toHaveBeenCalled();
    expect(qaFollowUp.findPending).not.toHaveBeenCalled();
  });

  it('gives safety precedence with no plan execution', async () => {
    const qa = { execute: jest.fn() };
    const subject = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa as never,
    );
    const result = await subject.execute(
      decision(
        understanding(
          'GENERAL_GUIDANCE_REQUEST',
          'PROVIDE_GUIDANCE',
          'SAFETY',
          {
            safety: {
              signals: [{ category: 'PAIN', severity: 'HIGH' }],
              requiresSafeResponse: true,
              requiresProfessionalGuidance: true,
              medicalAdviceProhibited: true,
            },
          },
        ),
        goalDecision('GENERAL_GUIDANCE', 'GENERAL_GUIDANCE_REQUEST'),
      ),
      human('Estou com dor forte no peito'),
      {
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
      },
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.status === 'COMPLETED' && result.content).toContain(
      'urgência',
    );
    expect(qa.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['GENERATE_DIET_PLAN', 'DIET_PLAN_REQUEST', 'GENERATE_PLAN', 'NUTRITION'],
    [
      'GENERATE_WORKOUT_PLAN',
      'WORKOUT_PLAN_REQUEST',
      'GENERATE_PLAN',
      'WORKOUT',
    ],
    [
      'GENERATE_COMBINED_PLANS',
      'COMBINED_PLAN_REQUEST',
      'GENERATE_PLAN',
      'COMBINED',
    ],
  ] as const)(
    'falls back instead of executing side effects for %s',
    async (goal, intent, operation, domain) => {
      const result = await service.execute(
        decision(
          understanding(intent, operation, domain),
          goalDecision(goal, intent),
        ),
      );

      expect(result).toMatchObject({
        status: 'FALLBACK_REQUIRED',
        reason: 'SIDE_EFFECT_ROUTE_REQUIRES_LEGACY_SINGLE_EXECUTION',
      });
    },
  );

  it('does not invoke Q&A for a persistent plan update route', async () => {
    const qa = { execute: jest.fn() };
    const subject = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa as never,
    );

    await expect(
      subject.execute(
        decision(
          understanding(
            'DIET_PLAN_UPDATE_REQUEST',
            'UPDATE_PLAN',
            'NUTRITION',
            {
              references: [planReference('NUTRITION')],
            },
          ),
          goalDecision('UPDATE_DIET_PLAN', 'DIET_PLAN_UPDATE_REQUEST', {
            targetPlan: 'DIET',
            currentPlanAvailable: 'DIET',
          }),
        ),
        human('Troque meu almoço no plano daqui para frente.'),
        {
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
        },
      ),
    ).resolves.toMatchObject({
      status: 'FALLBACK_REQUIRED',
      reason: 'SIDE_EFFECT_ROUTE_REQUIRES_LEGACY_SINGLE_EXECUTION',
    });
    expect(qa.execute).not.toHaveBeenCalled();
  });

  it('turns a Q&A failure into a specific safe answer', async () => {
    const qa = {
      execute: jest.fn().mockResolvedValue({
        status: 'FAILED',
        reason: 'PROVIDER_EXECUTION_FAILED',
        observability: {
          answerSource: 'DETERMINISTIC_FALLBACK',
          disposition: null,
          domain: null,
          grounding: null,
          providerDurationMs: 20,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          fallbackReason: 'PROVIDER_EXECUTION_FAILED',
        },
      }),
    };
    const subject = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa as never,
    );

    await expect(
      subject.execute(
        decision(
          understanding(
            'GENERAL_GUIDANCE_REQUEST',
            'PROVIDE_GUIDANCE',
            'GENERAL',
          ),
          goalDecision('GENERAL_GUIDANCE', 'GENERAL_GUIDANCE_REQUEST'),
        ),
        human('Pergunta aberta'),
        {
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
        },
      ),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content:
        'Não consegui responder isso com segurança agora. Pode tentar novamente em instantes?',
      observability: { fallbackReason: 'PROVIDER_EXECUTION_FAILED' },
    });
  });

  it('contains an unexpected Q&A exception as a completed safe fallback', async () => {
    const qa = {
      execute: jest.fn().mockRejectedValue(new Error('database join failed')),
    };
    const subject = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa as never,
    );

    await expect(
      subject.execute(
        decision(
          understanding(
            'GENERAL_GUIDANCE_REQUEST',
            'PROVIDE_GUIDANCE',
            'GENERAL',
          ),
          goalDecision('GENERAL_GUIDANCE', 'GENERAL_GUIDANCE_REQUEST'),
        ),
        human('Como posso ajustar meu almoço hoje?'),
        {
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
        },
      ),
    ).resolves.toEqual({
      status: 'COMPLETED',
      content:
        'Não consegui responder isso com segurança agora. Pode tentar novamente em instantes?',
      routeKind: 'ANSWER_MESSAGE',
      observability: {
        answerSource: 'DETERMINISTIC_FALLBACK',
        disposition: null,
        domain: null,
        grounding: null,
        providerDurationMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        fallbackReason: 'QA_EXECUTOR_UNEXPECTED_EXCEPTION',
      },
    });
  });

  it('turns AI defer into a clarification without entering legacy execution', async () => {
    const qa = {
      execute: jest.fn().mockResolvedValue({
        status: 'DEFERRED',
        reason: 'AI_REQUESTED_SIDE_EFFECT_PIPELINE',
        observability: {
          answerSource: 'AI',
          disposition: 'DEFER_TO_SIDE_EFFECT_PIPELINE',
          domain: 'NUTRITION',
          grounding: 'RECENT_CONTEXT',
          providerDurationMs: 10,
          promptTokens: 5,
          completionTokens: 5,
          totalTokens: 10,
          fallbackReason: null,
        },
      }),
    };
    const subject = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa as never,
    );

    await expect(
      subject.execute(
        decision(
          understanding(
            'GENERAL_GUIDANCE_REQUEST',
            'PROVIDE_GUIDANCE',
            'GENERAL',
          ),
          goalDecision('GENERAL_GUIDANCE', 'GENERAL_GUIDANCE_REQUEST'),
        ),
        human('Faça essa mudança para mim'),
        {
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
        },
      ),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: expect.stringContaining('altere isso de forma permanente'),
    });
  });

  it.each([
    [
      understanding('DIET_PLAN_REQUEST', 'GENERATE_PLAN', 'NUTRITION'),
      goalDecision('ASK_PROFILE_INFORMATION', 'DIET_PLAN_REQUEST', {
        targetPlan: 'DIET',
        selectedProfileField: 'MEAL_COUNT',
      }),
      'PROFILE_ACQUISITION',
    ],
    [
      understanding('DIET_PLAN_UPDATE_REQUEST', 'UPDATE_PLAN', 'NUTRITION', {
        references: [planReference('NUTRITION')],
      }),
      goalDecision('UPDATE_DIET_PLAN', 'DIET_PLAN_UPDATE_REQUEST', {
        targetPlan: 'DIET',
        currentPlanAvailable: 'DIET',
      }),
      'NUTRITION_PLAN_UPDATE',
    ],
    [
      understanding('WORKOUT_PLAN_UPDATE_REQUEST', 'UPDATE_PLAN', 'WORKOUT', {
        references: [planReference('WORKOUT')],
      }),
      goalDecision('UPDATE_WORKOUT_PLAN', 'WORKOUT_PLAN_UPDATE_REQUEST', {
        targetPlan: 'WORKOUT',
        currentPlanAvailable: 'WORKOUT',
      }),
      'WORKOUT_PLAN_UPDATE',
    ],
    [
      understanding(
        'CURRENT_PLAN_REQUEST',
        'PRESENT_CURRENT_PLAN',
        'NUTRITION',
      ),
      goalDecision('SHOW_CURRENT_PLAN', 'CURRENT_PLAN_REQUEST', {
        targetPlan: 'DIET',
      }),
      'CURRENT_PLAN_PRESENTATION',
    ],
    [
      understanding('PLAN_STATUS_REQUEST', 'PRESENT_PLAN_STATUS', 'WORKOUT'),
      goalDecision('SHOW_PLAN_STATUS', 'PLAN_STATUS_REQUEST', {
        targetPlan: 'WORKOUT',
      }),
      'PLAN_STATUS',
    ],
    [
      understanding('UNKNOWN', 'NONE', 'UNKNOWN'),
      goalDecision('UNKNOWN', 'UNKNOWN', { canExecute: false }),
      'LEGACY_FALLBACK',
    ],
  ] as const)(
    'returns an explicit fallback for unsupported route %s',
    async (understandingResult, goal, expectedKind) => {
      await expect(
        service.execute(decision(understandingResult, goal)),
      ).resolves.toMatchObject({
        status: 'FALLBACK_REQUIRED',
        routeKind: expectedKind,
      });
    },
  );

  it.each([
    [
      understanding('NUTRITION_QUESTION', 'PROVIDE_GUIDANCE', 'NUTRITION'),
      goalDecision('GENERAL_GUIDANCE', 'NUTRITION_QUESTION'),
      'NUTRITION_GUIDANCE',
    ],
    [
      understanding('PROGRESS_REVIEW_REQUEST', 'REVIEW_PROGRESS', 'PROGRESS'),
      goalDecision('REVIEW_PROGRESS', 'PROGRESS_REVIEW_REQUEST'),
      'PROGRESS_REVIEW',
    ],
  ] as const)(
    'realizes supported conversational route %s',
    async (understandingResult, goal, expectedKind) => {
      await expect(
        service.execute(decision(understandingResult, goal)),
      ).resolves.toMatchObject({
        status: 'COMPLETED',
        routeKind: expectedKind,
      });
    },
  );

  it('isolates invalid and failed response realization', async () => {
    const common = decision(
      understanding('COMMON_MESSAGE', 'ANSWER', 'GENERAL'),
      goalDecision('ANSWER_MESSAGE', 'COMMON_MESSAGE'),
    );
    const invalid = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      { isValid: jest.fn().mockReturnValue(false) } as never,
    );
    const failed = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      {
        realize: jest.fn().mockImplementation(() => {
          throw new Error('realizer failed');
        }),
      } as never,
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
    );

    await expect(invalid.execute(common)).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'INVALID_RESPONSE_CONTENT',
    });
    await expect(failed.execute(common)).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'RESPONSE_PIPELINE_FAILED',
    });
  });
});
