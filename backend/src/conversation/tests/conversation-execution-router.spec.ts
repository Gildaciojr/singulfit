import { PROFILE_ACQUISITION_FIELD } from '../../context/coach-adaptive-profile-collector.contract';
import { CONVERSATION_GOAL } from '../../context/conversation-goal-planner.contract';
import type { ConversationUnderstandingResult } from '../contracts/conversation-understanding.contract';
import { ConversationExecutionRouterService } from '../routing/conversation-execution-router.service';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';
import {
  goalDecision,
  planReference,
  understanding,
} from './conversation-routing.fixtures';

describe('ConversationExecutionRouterService', () => {
  const router = new ConversationExecutionRouterService(
    new ConversationUnderstandingValidator(),
  );

  it.each([
    [
      'ANSWER_MESSAGE',
      'COMMON_MESSAGE',
      'ANSWER',
      'GENERAL',
      'ANSWER_MESSAGE',
      null,
    ],
    [
      'GENERATE_DIET_PLAN',
      'DIET_PLAN_REQUEST',
      'GENERATE_PLAN',
      'NUTRITION',
      'NUTRITION_PLAN_GENERATION',
      'DIET',
    ],
    [
      'GENERATE_WORKOUT_PLAN',
      'WORKOUT_PLAN_REQUEST',
      'GENERATE_PLAN',
      'WORKOUT',
      'WORKOUT_PLAN_GENERATION',
      'WORKOUT',
    ],
    [
      'GENERATE_COMBINED_PLANS',
      'COMBINED_PLAN_REQUEST',
      'GENERATE_PLAN',
      'COMBINED',
      'COMBINED_PLAN_GENERATION',
      'BOTH',
    ],
    [
      'REVIEW_PROGRESS',
      'PROGRESS_REVIEW_REQUEST',
      'REVIEW_PROGRESS',
      'PROGRESS',
      'PROGRESS_REVIEW',
      null,
    ],
    [
      'REQUEST_CONFIRMATION',
      'CONFIRMATION_REQUIRED',
      'REQUEST_CONFIRMATION',
      'GENERAL',
      'CONFIRMATION',
      null,
    ],
    [
      'SHOW_CURRENT_PLAN',
      'CURRENT_PLAN_REQUEST',
      'PRESENT_CURRENT_PLAN',
      'NUTRITION',
      'CURRENT_PLAN_PRESENTATION',
      'DIET',
    ],
    [
      'SHOW_PLAN_STATUS',
      'PLAN_STATUS_REQUEST',
      'PRESENT_PLAN_STATUS',
      'WORKOUT',
      'PLAN_STATUS',
      'WORKOUT',
    ],
  ] as const)(
    'routes %s without executing it',
    (goal, intent, operation, domain, expectedKind, targetPlan) => {
      const route = router.route({
        understanding: understanding(intent, operation, domain),
        goalDecision: goalDecision(goal, intent, { targetPlan }),
      });

      expect(route.kind).toBe(expectedKind);
      expect(route.canExecute).toBe(true);
      expect(route.reasonCodes).toEqual(['PLANNER_GOAL_ROUTED']);
      expect(Object.isFrozen(route)).toBe(true);
    },
  );

  it('routes profile acquisition only with an explicit target and field', () => {
    const route = router.route({
      understanding: understanding(
        'DIET_PLAN_REQUEST',
        'GENERATE_PLAN',
        'NUTRITION',
      ),
      goalDecision: goalDecision(
        'ASK_PROFILE_INFORMATION',
        'DIET_PLAN_REQUEST',
        {
          targetPlan: 'DIET',
          selectedProfileField: PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL,
        },
      ),
    });
    const fallback = router.route({
      understanding: understanding(
        'DIET_PLAN_REQUEST',
        'GENERATE_PLAN',
        'NUTRITION',
      ),
      goalDecision: goalDecision(
        'ASK_PROFILE_INFORMATION',
        'DIET_PLAN_REQUEST',
        {
          targetPlan: 'DIET',
        },
      ),
    });

    expect(route).toMatchObject({
      kind: 'PROFILE_ACQUISITION',
      targetPlan: 'DIET',
      selectedProfileField: PROFILE_ACQUISITION_FIELD.PRIMARY_GOAL,
    });
    expect(fallback).toMatchObject({
      kind: 'LEGACY_FALLBACK',
      fallbackReason: 'GOAL_NOT_EXECUTABLE',
    });
  });

  it.each([
    [
      'UPDATE_DIET_PLAN',
      'DIET_PLAN_UPDATE_REQUEST',
      'NUTRITION',
      'DIET',
      'NUTRITION_PLAN_UPDATE',
    ],
    [
      'UPDATE_WORKOUT_PLAN',
      'WORKOUT_PLAN_UPDATE_REQUEST',
      'WORKOUT',
      'WORKOUT',
      'WORKOUT_PLAN_UPDATE',
    ],
  ] as const)(
    'requires resolved context before routing %s',
    (goal, intent, domain, plan, routeKind) => {
      const withoutContext = router.route({
        understanding: understanding(intent, 'UPDATE_PLAN', domain),
        goalDecision: goalDecision(goal, intent, { targetPlan: plan }),
      });
      const withContext = router.route({
        understanding: understanding(intent, 'UPDATE_PLAN', domain, {
          references: [planReference(domain)],
        }),
        goalDecision: goalDecision(goal, intent, { targetPlan: plan }),
      });

      expect(withoutContext).toMatchObject({
        kind: 'CONFIRMATION',
        reasonCodes: ['MISSING_UPDATE_CONTEXT'],
      });
      expect(withContext.kind).toBe(routeKind);
    },
  );

  it('uses nutrition guidance only for the nutrition domain', () => {
    expect(
      router.route({
        understanding: understanding(
          'NUTRITION_QUESTION',
          'PROVIDE_GUIDANCE',
          'NUTRITION',
        ),
        goalDecision: goalDecision('GENERAL_GUIDANCE', 'NUTRITION_QUESTION'),
      }).kind,
    ).toBe('NUTRITION_GUIDANCE');
    expect(
      router.route({
        understanding: understanding(
          'GENERAL_GUIDANCE_REQUEST',
          'PROVIDE_GUIDANCE',
          'GENERAL',
        ),
        goalDecision: goalDecision(
          'GENERAL_GUIDANCE',
          'GENERAL_GUIDANCE_REQUEST',
        ),
      }).kind,
    ).toBe('ANSWER_MESSAGE');
    expect(
      router.route({
        understanding: understanding(
          'GENERAL_GUIDANCE_REQUEST',
          'PROVIDE_GUIDANCE',
          'WORKOUT',
        ),
        goalDecision: goalDecision(
          'GENERAL_GUIDANCE',
          'GENERAL_GUIDANCE_REQUEST',
        ),
      }),
    ).toMatchObject({
      kind: 'LEGACY_FALLBACK',
      fallbackReason: 'UNSUPPORTED_GUIDANCE_DOMAIN',
    });
  });

  it.each([
    ['SHOW_CURRENT_PLAN', 'CURRENT_PLAN_REQUEST', 'PRESENT_CURRENT_PLAN'],
    ['SHOW_PLAN_STATUS', 'PLAN_STATUS_REQUEST', 'PRESENT_PLAN_STATUS'],
  ] as const)(
    'requests confirmation when %s has no target',
    (goal, intent, operation) => {
      const route = router.route({
        understanding: understanding(intent, operation, 'GENERAL'),
        goalDecision: goalDecision(goal, intent),
      });
      expect(route).toMatchObject({
        kind: 'CONFIRMATION',
        reasonCodes: ['MISSING_TARGET_PLAN'],
      });
    },
  );

  it('gives safety precedence over a generative goal', () => {
    const unsafe: ConversationUnderstandingResult = {
      ...understanding('DIET_PLAN_REQUEST', 'GENERATE_PLAN', 'NUTRITION'),
      safety: {
        signals: [{ category: 'MEDICAL', severity: 'HIGH' }],
        requiresSafeResponse: true,
        requiresProfessionalGuidance: true,
        medicalAdviceProhibited: true,
      },
      entities: [
        {
          kind: 'SAFETY_REPORT',
          signal: 'MEDICAL_CONDITION',
          bodyArea: null,
          severity: 'HIGH',
        },
      ],
    };
    const route = router.route({
      understanding: unsafe,
      goalDecision: goalDecision('GENERATE_DIET_PLAN', 'DIET_PLAN_REQUEST', {
        targetPlan: 'DIET',
      }),
    });

    expect(route).toMatchObject({
      kind: 'SAFETY_RESPONSE',
      action: 'URGENT_GUIDANCE',
      reasonCodes: ['SAFETY_PRECEDENCE'],
    });
  });

  it.each([
    [
      'goal cannot execute',
      goalDecision('GENERATE_DIET_PLAN', 'DIET_PLAN_REQUEST', {
        targetPlan: 'DIET',
        canExecute: false,
      }),
      'GOAL_NOT_EXECUTABLE',
    ],
    [
      'intent mismatch',
      goalDecision('GENERATE_DIET_PLAN', 'WORKOUT_PLAN_REQUEST', {
        targetPlan: 'DIET',
      }),
      'DECISION_INTENT_MISMATCH',
    ],
    [
      'unknown goal',
      goalDecision(CONVERSATION_GOAL.UNKNOWN, 'UNKNOWN', { canExecute: true }),
      'UNKNOWN_GOAL',
    ],
  ] as const)('falls back safely when %s', (_name, decision, reason) => {
    const intent =
      decision.recognizedIntent === 'UNKNOWN' ? 'UNKNOWN' : 'DIET_PLAN_REQUEST';
    const route = router.route({
      understanding: understanding(
        intent,
        intent === 'UNKNOWN' ? 'NONE' : 'GENERATE_PLAN',
        intent === 'UNKNOWN' ? 'UNKNOWN' : 'NUTRITION',
      ),
      goalDecision: decision,
    });

    expect(route).toMatchObject({
      kind: 'LEGACY_FALLBACK',
      fallbackReason: reason,
    });
  });
});
