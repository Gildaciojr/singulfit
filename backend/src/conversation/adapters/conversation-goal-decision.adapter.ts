import { Injectable } from '@nestjs/common';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  type ConversationGoalDecision,
} from '../../context/conversation-goal-planner.contract';
import {
  CONVERSATION_DOMAIN,
  CONVERSATION_OPERATION,
  type ConversationDomain,
  type ConversationOperation,
} from '../contracts/conversation-intent.contract';
import {
  CONVERSATION_UNDERSTANDING_VERSION,
  type ConversationUnderstandingResult,
} from '../contracts/conversation-understanding.contract';

export interface ConversationGoalDecisionAdapterMetadata {
  readonly operationKey: string;
  readonly evaluatedAt: string;
}

@Injectable()
export class ConversationGoalDecisionAdapter {
  adapt(
    decision: ConversationGoalDecision,
    metadata: ConversationGoalDecisionAdapterMetadata,
  ): ConversationUnderstandingResult {
    const failed = decision.goal === CONVERSATION_GOAL.UNKNOWN;
    const result = {
      intent: decision.recognizedIntent,
      operation: this.operation(decision.recognizedIntent),
      domain: this.domain(decision),
      confidence: decision.confidence,
      secondaryIntents: Object.freeze([]),
      entities: Object.freeze([]),
      references: Object.freeze(
        decision.targetPlan
          ? [
              Object.freeze({
                kind: 'PLAN' as const,
                domain:
                  decision.targetPlan === 'DIET'
                    ? ('NUTRITION' as const)
                    : decision.targetPlan === 'WORKOUT'
                      ? ('WORKOUT' as const)
                      : ('BOTH' as const),
                target: 'CURRENT' as const,
                ordinal: null,
                resolution: 'RESOLVED' as const,
                source: 'PROFILE_CONTEXT' as const,
              }),
            ]
          : [],
      ),
      ambiguity: Object.freeze({
        present: failed,
        codes: Object.freeze(failed ? ['INSUFFICIENT_CONTEXT' as const] : []),
        clarificationRequired: failed,
      }),
      safety: Object.freeze({
        signals: Object.freeze([]),
        requiresSafeResponse: false,
        requiresProfessionalGuidance: false,
        medicalAdviceProhibited: true,
      }),
      metadata: Object.freeze({
        contractVersion: CONVERSATION_UNDERSTANDING_VERSION,
        source: 'CURRENT_PLANNER_ADAPTER' as const,
        operationKey: metadata.operationKey,
        evaluatedAt: metadata.evaluatedAt,
        contextUsed: Object.freeze(['COLLECTOR_DECISION' as const]),
        rationaleCodes: Object.freeze([
          failed
            ? ('INSUFFICIENT_CONTEXT' as const)
            : ('CURRENT_PLANNER_DECISION' as const),
        ]),
      }),
    };

    return failed
      ? Object.freeze({
          ...result,
          status: 'FAILED' as const,
          failure: 'CONTEXT_UNAVAILABLE' as const,
        })
      : Object.freeze({
          ...result,
          status: 'UNDERSTOOD' as const,
          failure: null,
        });
  }

  private operation(
    intent: ConversationGoalDecision['recognizedIntent'],
  ): ConversationOperation {
    switch (intent) {
      case CONVERSATION_RECOGNIZED_INTENT.COMMON_MESSAGE:
        return CONVERSATION_OPERATION.ANSWER;
      case CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST:
      case CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST:
      case CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST:
        return CONVERSATION_OPERATION.GENERATE_PLAN;
      case CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST:
      case CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST:
        return CONVERSATION_OPERATION.UPDATE_PLAN;
      case CONVERSATION_RECOGNIZED_INTENT.PROGRESS_REVIEW_REQUEST:
        return CONVERSATION_OPERATION.REVIEW_PROGRESS;
      case CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED:
        return CONVERSATION_OPERATION.REQUEST_CONFIRMATION;
      case CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST:
        return CONVERSATION_OPERATION.PRESENT_CURRENT_PLAN;
      case CONVERSATION_RECOGNIZED_INTENT.PLAN_STATUS_REQUEST:
        return CONVERSATION_OPERATION.PRESENT_PLAN_STATUS;
      case CONVERSATION_RECOGNIZED_INTENT.NUTRITION_QUESTION:
      case CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST:
        return CONVERSATION_OPERATION.PROVIDE_GUIDANCE;
      default:
        return CONVERSATION_OPERATION.NONE;
    }
  }

  private domain(decision: ConversationGoalDecision): ConversationDomain {
    if (decision.targetPlan === 'DIET') return CONVERSATION_DOMAIN.NUTRITION;
    if (decision.targetPlan === 'WORKOUT') return CONVERSATION_DOMAIN.WORKOUT;
    if (decision.targetPlan === 'BOTH') return CONVERSATION_DOMAIN.COMBINED;
    if (
      decision.recognizedIntent ===
      CONVERSATION_RECOGNIZED_INTENT.NUTRITION_QUESTION
    ) {
      return CONVERSATION_DOMAIN.NUTRITION;
    }
    if (decision.goal === CONVERSATION_GOAL.ASK_PROFILE_INFORMATION) {
      return CONVERSATION_DOMAIN.PROFILE;
    }
    if (decision.goal === CONVERSATION_GOAL.REVIEW_PROGRESS) {
      return CONVERSATION_DOMAIN.PROGRESS;
    }
    if (
      decision.goal === CONVERSATION_GOAL.ANSWER_MESSAGE ||
      decision.goal === CONVERSATION_GOAL.GENERAL_GUIDANCE ||
      decision.goal === CONVERSATION_GOAL.REQUEST_CONFIRMATION ||
      decision.goal === CONVERSATION_GOAL.SHOW_CURRENT_PLAN ||
      decision.goal === CONVERSATION_GOAL.SHOW_PLAN_STATUS
    ) {
      return CONVERSATION_DOMAIN.GENERAL;
    }
    return CONVERSATION_DOMAIN.UNKNOWN;
  }
}
