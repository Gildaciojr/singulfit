import { ConversationExecutionRouterService } from '../routing/conversation-execution-router.service';
import { ConversationExecutionBridgeService } from '../runtime/conversation-execution-bridge.service';
import { ConversationLanguageRealizerService } from '../runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../runtime/conversation-response-formatter.service';
import { ConversationResponsePayloadBuilder } from '../runtime/conversation-response-payload.builder';
import { ConversationResponseValidatorService } from '../runtime/conversation-response-validator.service';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';
import type { ConversationRoutingDecision } from '../contracts/conversation-execution-route.contract';
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

  it('realizes an explicit confirmation request', async () => {
    const result = await service.execute(
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
  });

  it('gives safety precedence with no plan execution', async () => {
    const result = await service.execute(
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
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.status === 'COMPLETED' && result.content).toContain(
      'urgência',
    );
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
