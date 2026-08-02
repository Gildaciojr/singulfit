import { CONVERSATION_RECOGNIZED_INTENT } from '../../context/conversation-goal-planner.contract';
import { ConversationUnderstandingToGoalPlannerAdapter } from '../adapters/conversation-understanding-to-goal-planner.adapter';
import {
  ConversationGoalPreparationError,
  type ConversationGoalPreparationInput,
} from '../contracts/conversation-goal-preparation.contract';
import type { ConversationUnderstandingResult } from '../contracts/conversation-understanding.contract';
import { ConversationGoalPreparationService } from '../understanding/conversation-goal-preparation.service';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';
import {
  REFERENCE_DATE,
  planReference,
  readyAdaptiveDecision,
  routingSnapshot,
  understanding,
} from './conversation-routing.fixtures';

describe('ConversationGoalPreparationService', () => {
  const service = new ConversationGoalPreparationService(
    new ConversationUnderstandingValidator(),
    new ConversationUnderstandingToGoalPlannerAdapter(),
  );

  function input(
    result: ConversationUnderstandingResult,
    overrides: Partial<ConversationGoalPreparationInput> = {},
  ): ConversationGoalPreparationInput {
    return {
      understanding: result,
      snapshot: routingSnapshot(),
      adaptiveDecision: readyAdaptiveDecision(),
      progressContextAvailable: false,
      confirmationPending: false,
      recentHistory: { currentLogicalTurn: 2, entries: [] },
      continuity: {
        currentLogicalTurn: 2,
        activeProfileField: null,
        pendingConfirmation: false,
        targetPlan: null,
      },
      referenceDate: REFERENCE_DATE,
      ...overrides,
    };
  }

  it.each([
    [CONVERSATION_RECOGNIZED_INTENT.COMMON_MESSAGE, 'ANSWER', 'GENERAL', null],
    [
      CONVERSATION_RECOGNIZED_INTENT.NUTRITION_QUESTION,
      'PROVIDE_GUIDANCE',
      'NUTRITION',
      null,
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
      'GENERATE_PLAN',
      'NUTRITION',
      'DIET',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
      'GENERATE_PLAN',
      'WORKOUT',
      'WORKOUT',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST,
      'GENERATE_PLAN',
      'COMBINED',
      'BOTH',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST,
      'UPDATE_PLAN',
      'NUTRITION',
      'DIET',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST,
      'UPDATE_PLAN',
      'WORKOUT',
      'WORKOUT',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.PROGRESS_REVIEW_REQUEST,
      'REVIEW_PROGRESS',
      'PROGRESS',
      null,
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST,
      'PROVIDE_GUIDANCE',
      'GENERAL',
      null,
    ],
    [CONVERSATION_RECOGNIZED_INTENT.UNKNOWN, 'NONE', 'UNKNOWN', null],
  ] as const)(
    'maps %s to the exact planner contract',
    (intent, operation, domain, targetPlan) => {
      const adaptiveDecision = readyAdaptiveDecision();
      const prepared = service.prepare(
        input(understanding(intent, operation, domain), {
          adaptiveDecision,
          progressContextAvailable: true,
          confirmationPending: true,
          recentHistory: {
            currentLogicalTurn: 2,
            entries: [
              { goal: 'ANSWER_MESSAGE', status: 'COMPLETED', logicalTurn: 1 },
            ],
          },
        }),
      );

      expect(prepared.recognizedIntent).toBe(intent);
      expect(prepared.conversationContext).toEqual({
        ...(targetPlan ? { planTarget: targetPlan } : {}),
        progressContextAvailable: true,
        confirmationRequired: true,
      });
      expect(prepared.adaptiveDecision).toBe(adaptiveDecision);
      expect(Object.isFrozen(prepared.recentHistory.entries)).toBe(true);
    },
  );

  it('resolves current plan and confirmation targets only from explicit context', () => {
    const current = service.prepare(
      input(
        understanding(
          'CURRENT_PLAN_REQUEST',
          'PRESENT_CURRENT_PLAN',
          'NUTRITION',
          {
            references: [planReference('NUTRITION')],
          },
        ),
      ),
    );
    const confirmation = service.prepare(
      input(
        understanding(
          'CONFIRMATION_REQUIRED',
          'REQUEST_CONFIRMATION',
          'GENERAL',
        ),
        {
          confirmationPending: true,
          continuity: {
            currentLogicalTurn: 2,
            activeProfileField: null,
            pendingConfirmation: true,
            targetPlan: 'WORKOUT',
          },
        },
      ),
    );

    expect(current.conversationContext.planTarget).toBe('DIET');
    expect(confirmation.conversationContext.planTarget).toBe('WORKOUT');
    expect(confirmation.conversationContext.confirmationRequired).toBe(true);
  });

  it('uses a compatible entity to refine a broad current-plan domain', () => {
    const withEntity: ConversationUnderstandingResult = {
      ...understanding(
        'CURRENT_PLAN_REQUEST',
        'PRESENT_CURRENT_PLAN',
        'COMBINED',
      ),
      entities: [
        { kind: 'PLAN_COMPONENT', domain: 'NUTRITION', component: 'MEAL' },
      ],
    };

    expect(
      service.prepare(input(withEntity)).conversationContext.planTarget,
    ).toBe('DIET');
  });

  it('preserves unavailable progress and absent confirmation', () => {
    const prepared = service.prepare(
      input(understanding('COMMON_MESSAGE', 'ANSWER', 'GENERAL')),
    );
    expect(prepared.conversationContext).toEqual({
      progressContextAvailable: false,
      confirmationRequired: false,
    });
  });

  it('permits an ambiguity only when the intent explicitly requests confirmation', () => {
    const ambiguity = {
      present: true as const,
      codes: ['MISSING_REFERENCE' as const],
      clarificationRequired: true as const,
    };
    expect(() =>
      service.prepare(
        input(
          understanding(
            'CONFIRMATION_REQUIRED',
            'REQUEST_CONFIRMATION',
            'GENERAL',
            { ambiguity },
          ),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      service.prepare(
        input(
          understanding('COMMON_MESSAGE', 'ANSWER', 'GENERAL', { ambiguity }),
        ),
      ),
    ).toThrow(ConversationGoalPreparationError);
  });

  it.each([
    [
      'missing current-plan target',
      input(
        understanding(
          'CURRENT_PLAN_REQUEST',
          'PRESENT_CURRENT_PLAN',
          'GENERAL',
        ),
      ),
      'TARGET_PLAN_REQUIRED',
    ],
    [
      'conflicting fixed target',
      input(
        understanding('DIET_PLAN_REQUEST', 'GENERATE_PLAN', 'NUTRITION', {
          references: [planReference('WORKOUT')],
        }),
      ),
      'TARGET_PLAN_CONFLICT',
    ],
    [
      'invalid reference date',
      input(understanding('COMMON_MESSAGE', 'ANSWER', 'GENERAL'), {
        referenceDate: 'invalid',
      }),
      'INVALID_REFERENCE_DATE',
    ],
    [
      'invalid history',
      input(understanding('COMMON_MESSAGE', 'ANSWER', 'GENERAL'), {
        recentHistory: {
          currentLogicalTurn: 1,
          entries: [
            { goal: 'ANSWER_MESSAGE', status: 'PLANNED', logicalTurn: 2 },
          ],
        },
      }),
      'INVALID_GOAL_HISTORY',
    ],
  ] as const)('rejects %s with a typed error', (_name, invalidInput, code) => {
    expect.assertions(1);
    try {
      service.prepare(invalidInput);
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });

  it('rejects a failed understanding before planning', () => {
    const failed: ConversationUnderstandingResult = {
      ...understanding('UNKNOWN', 'NONE', 'UNKNOWN'),
      status: 'FAILED',
      failure: 'UNSUPPORTED_CONTENT',
    };

    expect(() => service.prepare(input(failed))).toThrow(
      'Understanding com falha não pode ser enviado ao Planner',
    );
  });

  it('validates understanding consistency at the boundary', () => {
    const invalid: ConversationUnderstandingResult = {
      ...understanding('DIET_PLAN_REQUEST', 'GENERATE_PLAN', 'NUTRITION'),
      operation: 'ANSWER',
    };
    expect(() => service.prepare(input(invalid))).toThrow(
      'Conversation Understanding inválido: INVALID_OPERATION',
    );
  });
});
