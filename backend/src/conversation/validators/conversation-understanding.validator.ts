import { Injectable } from '@nestjs/common';
import { CONVERSATION_RECOGNIZED_INTENT } from '../../context/conversation-goal-planner.contract';
import type {
  ConversationEntity,
  ConversationReference,
} from '../contracts/conversation-entity.contract';
import {
  CONVERSATION_DOMAIN,
  CONVERSATION_OPERATION,
} from '../contracts/conversation-intent.contract';
import {
  CONVERSATION_UNDERSTANDING_VERSION,
  type ConversationUnderstandingResult,
} from '../contracts/conversation-understanding.contract';
import { evaluateConversationSafety } from '../routing/conversation-safety-routing.policy';

export type ConversationUnderstandingValidationCode =
  | 'INVALID_VERSION'
  | 'INVALID_OPERATION'
  | 'INVALID_DOMAIN'
  | 'INVALID_AMBIGUITY'
  | 'INVALID_REFERENCE'
  | 'INCOMPATIBLE_ENTITY'
  | 'INVALID_SAFETY'
  | 'INVALID_METADATA';

export interface ConversationUnderstandingValidation {
  readonly valid: boolean;
  readonly errors: readonly ConversationUnderstandingValidationCode[];
}

@Injectable()
export class ConversationUnderstandingValidator {
  validate(
    result: ConversationUnderstandingResult,
  ): ConversationUnderstandingValidation {
    const errors = new Set<ConversationUnderstandingValidationCode>();
    if (
      result.metadata.contractVersion !== CONVERSATION_UNDERSTANDING_VERSION
    ) {
      errors.add('INVALID_VERSION');
    }
    if (
      !result.metadata.operationKey.trim() ||
      !this.validDate(result.metadata.evaluatedAt)
    ) {
      errors.add('INVALID_METADATA');
    }
    if (!this.operationCompatible(result)) errors.add('INVALID_OPERATION');
    if (!this.domainCompatible(result)) errors.add('INVALID_DOMAIN');
    if (!this.ambiguityValid(result)) errors.add('INVALID_AMBIGUITY');
    if (
      result.references.some((reference) => !this.referenceValid(reference))
    ) {
      errors.add('INVALID_REFERENCE');
    }
    if (
      result.entities.some(
        (entity) => !this.entityCompatible(entity, result.domain),
      )
    ) {
      errors.add('INCOMPATIBLE_ENTITY');
    }
    const safetyEntities = result.entities.filter(
      (entity) => entity.kind === 'SAFETY_REPORT',
    );
    const safetyRouting = evaluateConversationSafety(result.safety);
    const professionalGuidance =
      safetyRouting.action === 'PROFESSIONAL_GUIDANCE' ||
      safetyRouting.action === 'URGENT_GUIDANCE';
    if (
      result.safety.requiresSafeResponse !== safetyRouting.routeRequired ||
      result.safety.requiresProfessionalGuidance !== professionalGuidance ||
      safetyEntities.length > result.safety.signals.length ||
      !result.safety.medicalAdviceProhibited
    ) {
      errors.add('INVALID_SAFETY');
    }
    return Object.freeze({
      valid: errors.size === 0,
      errors: Object.freeze([...errors]),
    });
  }

  assertValid(result: ConversationUnderstandingResult): void {
    const validation = this.validate(result);
    if (!validation.valid) {
      throw new Error(
        `Conversation Understanding inválido: ${validation.errors.join(', ')}`,
      );
    }
  }

  private operationCompatible(
    result: ConversationUnderstandingResult,
  ): boolean {
    if (result.status === 'FAILED')
      return result.operation === CONVERSATION_OPERATION.NONE;
    if (
      (result.intent ===
        CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST ||
        result.intent ===
          CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST) &&
      result.operation === CONVERSATION_OPERATION.SUBSTITUTE_ITEM
    ) {
      return true;
    }
    const expected: Readonly<
      Partial<
        Record<
          ConversationUnderstandingResult['intent'],
          ConversationUnderstandingResult['operation']
        >
      >
    > = {
      [CONVERSATION_RECOGNIZED_INTENT.COMMON_MESSAGE]:
        CONVERSATION_OPERATION.ANSWER,
      [CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST]:
        CONVERSATION_OPERATION.GENERATE_PLAN,
      [CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST]:
        CONVERSATION_OPERATION.GENERATE_PLAN,
      [CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST]:
        CONVERSATION_OPERATION.GENERATE_PLAN,
      [CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST]:
        CONVERSATION_OPERATION.UPDATE_PLAN,
      [CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST]:
        CONVERSATION_OPERATION.UPDATE_PLAN,
      [CONVERSATION_RECOGNIZED_INTENT.PROGRESS_REVIEW_REQUEST]:
        CONVERSATION_OPERATION.REVIEW_PROGRESS,
      [CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED]:
        CONVERSATION_OPERATION.REQUEST_CONFIRMATION,
      [CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST]:
        CONVERSATION_OPERATION.PRESENT_CURRENT_PLAN,
      [CONVERSATION_RECOGNIZED_INTENT.PLAN_STATUS_REQUEST]:
        CONVERSATION_OPERATION.PRESENT_PLAN_STATUS,
      [CONVERSATION_RECOGNIZED_INTENT.NUTRITION_QUESTION]:
        CONVERSATION_OPERATION.PROVIDE_GUIDANCE,
      [CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST]:
        CONVERSATION_OPERATION.PROVIDE_GUIDANCE,
      [CONVERSATION_RECOGNIZED_INTENT.UNKNOWN]: CONVERSATION_OPERATION.NONE,
    };
    return expected[result.intent] === result.operation;
  }

  private domainCompatible(result: ConversationUnderstandingResult): boolean {
    if (result.status === 'FAILED')
      return result.domain === CONVERSATION_DOMAIN.UNKNOWN;
    if (
      result.intent === CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST ||
      result.intent ===
        CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST ||
      result.intent === CONVERSATION_RECOGNIZED_INTENT.NUTRITION_QUESTION
    ) {
      return result.domain === CONVERSATION_DOMAIN.NUTRITION;
    }
    if (
      result.intent === CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST ||
      result.intent ===
        CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST
    ) {
      return result.domain === CONVERSATION_DOMAIN.WORKOUT;
    }
    if (
      result.intent === CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST
    ) {
      return result.domain === CONVERSATION_DOMAIN.COMBINED;
    }
    if (result.intent === CONVERSATION_RECOGNIZED_INTENT.UNKNOWN) {
      return result.domain === CONVERSATION_DOMAIN.UNKNOWN;
    }
    return result.domain !== CONVERSATION_DOMAIN.UNKNOWN;
  }

  private ambiguityValid(result: ConversationUnderstandingResult): boolean {
    return result.ambiguity.present
      ? result.ambiguity.codes.length > 0 &&
          result.ambiguity.clarificationRequired
      : result.ambiguity.codes.length === 0 &&
          !result.ambiguity.clarificationRequired;
  }

  private referenceValid(reference: ConversationReference): boolean {
    if (reference.kind === 'PLAN') {
      return reference.target === 'ORDINAL'
        ? reference.ordinal !== null &&
            Number.isInteger(reference.ordinal) &&
            reference.ordinal > 0
        : reference.ordinal === null;
    }
    return (
      reference.kind !== 'HISTORY_TURN' ||
      (Number.isInteger(reference.logicalTurn) && reference.logicalTurn >= 0)
    );
  }

  private entityCompatible(
    entity: ConversationEntity,
    domain: ConversationUnderstandingResult['domain'],
  ): boolean {
    const nutrition =
      entity.kind === 'NUTRITION_ARTIFACT' ||
      entity.kind === 'MEAL' ||
      entity.kind === 'FOOD' ||
      (entity.kind === 'PLAN_COMPONENT' && entity.domain === 'NUTRITION');
    const workout =
      entity.kind === 'WORKOUT_ARTIFACT' ||
      entity.kind === 'WORKOUT_MODALITY' ||
      entity.kind === 'EXERCISE' ||
      entity.kind === 'EQUIPMENT' ||
      (entity.kind === 'PLAN_COMPONENT' && entity.domain === 'WORKOUT');
    if (nutrition)
      return (
        domain === 'NUTRITION' || domain === 'COMBINED' || domain === 'SAFETY'
      );
    if (workout)
      return (
        domain === 'WORKOUT' || domain === 'COMBINED' || domain === 'SAFETY'
      );
    return true;
  }

  private validDate(value: string): boolean {
    return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
  }
}
