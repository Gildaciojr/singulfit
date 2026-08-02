import { Injectable } from '@nestjs/common';
import { CONVERSATION_RECOGNIZED_INTENT } from '../../context/conversation-goal-planner.contract';
import type { ConversationUnderstandingInput } from '../contracts/conversation-understanding.contract';
import {
  CONVERSATION_DOMAIN,
  CONVERSATION_OPERATION,
} from '../contracts/conversation-intent.contract';
import type {
  ConversationDomainResolution,
  ConversationIntentResolution,
  ConversationOperationResolution,
} from '../contracts/conversation-understanding-pipeline.contract';

@Injectable()
export class ConversationIntentResolverService {
  resolve(
    input: ConversationUnderstandingInput,
    operation: ConversationOperationResolution,
    domain: ConversationDomainResolution,
  ): ConversationIntentResolution {
    if (
      operation.operation === CONVERSATION_OPERATION.REQUEST_CONFIRMATION &&
      input.continuity.pendingConfirmation
    ) {
      return this.result(
        CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED,
        'HIGH',
      );
    }

    switch (operation.operation) {
      case CONVERSATION_OPERATION.PRESENT_PLAN_STATUS:
        return this.result(
          CONVERSATION_RECOGNIZED_INTENT.PLAN_STATUS_REQUEST,
          'HIGH',
        );
      case CONVERSATION_OPERATION.PRESENT_CURRENT_PLAN:
        return this.result(
          CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST,
          'HIGH',
        );
      case CONVERSATION_OPERATION.REVIEW_PROGRESS:
        return this.result(
          CONVERSATION_RECOGNIZED_INTENT.PROGRESS_REVIEW_REQUEST,
          'HIGH',
        );
      case CONVERSATION_OPERATION.GENERATE_PLAN:
        if (domain.domain === CONVERSATION_DOMAIN.NUTRITION) {
          return this.result(
            CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
            'HIGH',
          );
        }
        if (domain.domain === CONVERSATION_DOMAIN.WORKOUT) {
          return this.result(
            CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
            'HIGH',
          );
        }
        if (domain.domain === CONVERSATION_DOMAIN.COMBINED) {
          return this.result(
            CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST,
            'HIGH',
          );
        }
        break;
      case CONVERSATION_OPERATION.UPDATE_PLAN:
      case CONVERSATION_OPERATION.SUBSTITUTE_ITEM:
        if (domain.domain === CONVERSATION_DOMAIN.NUTRITION) {
          return this.result(
            CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST,
            'HIGH',
          );
        }
        if (domain.domain === CONVERSATION_DOMAIN.WORKOUT) {
          return this.result(
            CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST,
            'HIGH',
          );
        }
        break;
      case CONVERSATION_OPERATION.PROVIDE_GUIDANCE:
        if (domain.domain === CONVERSATION_DOMAIN.NUTRITION) {
          return this.result(
            CONVERSATION_RECOGNIZED_INTENT.NUTRITION_QUESTION,
            'HIGH',
          );
        }
        return this.result(
          CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST,
          domain.contextual ? 'MEDIUM' : 'HIGH',
        );
      case CONVERSATION_OPERATION.ANSWER:
        return this.result(
          CONVERSATION_RECOGNIZED_INTENT.COMMON_MESSAGE,
          domain.contextual ? 'MEDIUM' : 'HIGH',
        );
      default:
        break;
    }

    return this.result(CONVERSATION_RECOGNIZED_INTENT.UNKNOWN, 'LOW');
  }

  private result(
    intent: ConversationIntentResolution['intent'],
    confidence: ConversationIntentResolution['confidence'],
  ): ConversationIntentResolution {
    return Object.freeze({ intent, confidence });
  }
}
