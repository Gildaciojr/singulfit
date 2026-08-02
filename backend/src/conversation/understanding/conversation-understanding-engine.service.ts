import { Injectable } from '@nestjs/common';
import {
  CONVERSATION_UNDERSTANDING_VERSION,
  type ConversationContextUsage,
  type ConversationRationaleCode,
  type ConversationUnderstandingFailure,
  type ConversationUnderstandingInput,
  type ConversationUnderstandingResult,
} from '../contracts/conversation-understanding.contract';
import { CONVERSATION_RECOGNIZED_INTENT } from '../../context/conversation-goal-planner.contract';
import {
  CONVERSATION_DOMAIN,
  CONVERSATION_OPERATION,
} from '../contracts/conversation-intent.contract';
import { ConversationUnderstandingValidator } from '../validators/conversation-understanding.validator';
import { ConversationAmbiguityResolverService } from './conversation-ambiguity-resolver.service';
import { ConversationDomainResolverService } from './conversation-domain-resolver.service';
import { ConversationEntityRecognizerService } from './conversation-entity-recognizer.service';
import { ConversationIntentResolverService } from './conversation-intent-resolver.service';
import { ConversationMessageNormalizerService } from './conversation-message-normalizer.service';
import { ConversationOperationResolverService } from './conversation-operation-resolver.service';
import { ConversationReferenceResolverService } from './conversation-reference-resolver.service';
import { ConversationSafetyDetectorService } from './conversation-safety-detector.service';
import { ConversationTokenizerService } from './conversation-tokenizer.service';

@Injectable()
export class ConversationUnderstandingEngineService {
  constructor(
    private readonly normalizer: ConversationMessageNormalizerService,
    private readonly tokenizer: ConversationTokenizerService,
    private readonly referenceResolver: ConversationReferenceResolverService,
    private readonly entityRecognizer: ConversationEntityRecognizerService,
    private readonly operationResolver: ConversationOperationResolverService,
    private readonly domainResolver: ConversationDomainResolverService,
    private readonly intentResolver: ConversationIntentResolverService,
    private readonly ambiguityResolver: ConversationAmbiguityResolverService,
    private readonly safetyDetector: ConversationSafetyDetectorService,
    private readonly validator: ConversationUnderstandingValidator,
  ) {}

  understand(
    input: ConversationUnderstandingInput,
  ): ConversationUnderstandingResult {
    const normalized = this.normalizer.normalize(input.text);
    if (!this.validInput(input)) {
      return this.failure(input, 'INVALID_RESULT');
    }
    if (!normalized.canonical) return this.failure(input, 'EMPTY_MESSAGE');
    if (!normalized.hasLexicalContent) {
      return this.failure(input, 'UNSUPPORTED_CONTENT');
    }

    const tokenized = this.tokenizer.tokenize(normalized);
    const references = this.referenceResolver.resolve(
      input,
      normalized,
      tokenized,
    );
    const entities = this.entityRecognizer.recognize(normalized);
    const operation = this.operationResolver.resolve(input, normalized);
    const domain = this.domainResolver.resolve(
      input,
      normalized,
      entities,
      references,
    );
    const intent = this.intentResolver.resolve(input, operation, domain);
    const ambiguity = this.ambiguityResolver.resolve(
      normalized,
      references,
      operation,
      domain,
      intent,
    );
    const safety = this.safetyDetector.detect(normalized);
    const metadata = this.metadata(
      input,
      references,
      ambiguity.ambiguity.present,
      safety.safety.requiresSafeResponse,
    );

    if (safety.safety.requiresSafeResponse) {
      return this.validated(
        Object.freeze({
          status: 'UNDERSTOOD',
          failure: null,
          intent: CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST,
          operation: CONVERSATION_OPERATION.PROVIDE_GUIDANCE,
          domain: CONVERSATION_DOMAIN.SAFETY,
          confidence: 'HIGH',
          secondaryIntents: Object.freeze([]),
          entities: Object.freeze([...entities.entities, ...safety.entities]),
          references: references.references,
          ambiguity: Object.freeze({
            present: false,
            codes: Object.freeze([]),
            clarificationRequired: false,
          }),
          safety: safety.safety,
          metadata,
        }),
      );
    }

    if (ambiguity.ambiguity.present) {
      return this.validated(
        Object.freeze({
          status: 'FAILED',
          failure: 'AMBIGUOUS',
          intent: CONVERSATION_RECOGNIZED_INTENT.UNKNOWN,
          operation: CONVERSATION_OPERATION.NONE,
          domain: CONVERSATION_DOMAIN.UNKNOWN,
          confidence: 'LOW',
          secondaryIntents: Object.freeze([]),
          entities: Object.freeze([]),
          references: Object.freeze([]),
          ambiguity: ambiguity.ambiguity,
          safety: safety.safety,
          metadata,
        }),
      );
    }

    return this.validated(
      Object.freeze({
        status: 'UNDERSTOOD',
        failure: null,
        intent: intent.intent,
        operation: operation.operation,
        domain: domain.domain,
        confidence: intent.confidence,
        secondaryIntents: Object.freeze([]),
        entities: entities.entities,
        references: references.references,
        ambiguity: ambiguity.ambiguity,
        safety: safety.safety,
        metadata,
      }),
    );
  }

  private failure(
    input: ConversationUnderstandingInput,
    failure: ConversationUnderstandingFailure,
  ): ConversationUnderstandingResult {
    return this.validated(
      Object.freeze({
        status: 'FAILED',
        failure,
        intent: CONVERSATION_RECOGNIZED_INTENT.UNKNOWN,
        operation: CONVERSATION_OPERATION.NONE,
        domain: CONVERSATION_DOMAIN.UNKNOWN,
        confidence: 'LOW',
        secondaryIntents: Object.freeze([]),
        entities: Object.freeze([]),
        references: Object.freeze([]),
        ambiguity: Object.freeze({
          present: false,
          codes: Object.freeze([]),
          clarificationRequired: false,
        }),
        safety: Object.freeze({
          signals: Object.freeze([]),
          requiresSafeResponse: false,
          requiresProfessionalGuidance: false,
          medicalAdviceProhibited: true,
        }),
        metadata: this.metadata(input, null, false, false),
      }),
    );
  }

  private metadata(
    input: ConversationUnderstandingInput,
    references: ReturnType<
      ConversationReferenceResolverService['resolve']
    > | null,
    ambiguous: boolean,
    safety: boolean,
  ): ConversationUnderstandingResult['metadata'] {
    const contextUsed = new Set<ConversationContextUsage>(['CURRENT_MESSAGE']);
    const rationale = new Set<ConversationRationaleCode>([
      'EXPLICIT_CURRENT_TURN',
    ]);
    if (references?.usedRecentHistory) contextUsed.add('RECENT_HISTORY');
    if (
      references?.usedContinuity ||
      input.continuity.pendingConfirmation ||
      input.continuity.activeProfileField !== null
    ) {
      contextUsed.add('CONTINUITY');
    }
    if (references?.usedProfile) contextUsed.add('PROFILE_SNAPSHOT');
    if (input.collector !== null) contextUsed.add('COLLECTOR_DECISION');
    if (
      references?.references.some(
        (reference) => reference.resolution === 'RESOLVED',
      )
    ) {
      rationale.add('CONTEXTUAL_REFERENCE_RESOLVED');
    }
    if (input.continuity.activeProfileField !== null) {
      rationale.add('ACTIVE_PROFILE_QUESTION');
    }
    if (input.continuity.pendingConfirmation)
      rationale.add('PENDING_CONFIRMATION');
    if (ambiguous) rationale.add('INSUFFICIENT_CONTEXT');
    if (safety) rationale.add('SAFETY_SIGNAL_PRESENT');

    return Object.freeze({
      contractVersion: CONVERSATION_UNDERSTANDING_VERSION,
      source: 'DETERMINISTIC',
      operationKey: `${CONVERSATION_UNDERSTANDING_VERSION}:${input.conversationId}:${input.messageId}:${input.continuity.currentLogicalTurn}`,
      evaluatedAt: this.evaluationDate(input),
      contextUsed: Object.freeze([...contextUsed]),
      rationaleCodes: Object.freeze([...rationale]),
    });
  }

  private evaluationDate(input: ConversationUnderstandingInput): string {
    if (this.validDate(input.receivedAt)) return input.receivedAt;
    if (this.validDate(input.profile.referenceDate))
      return input.profile.referenceDate;
    return '1970-01-01T00:00:00.000Z';
  }

  private validInput(input: ConversationUnderstandingInput): boolean {
    return (
      input.contractVersion === CONVERSATION_UNDERSTANDING_VERSION &&
      Boolean(input.userId.trim()) &&
      Boolean(input.conversationId.trim()) &&
      Boolean(input.messageId.trim()) &&
      this.validDate(input.receivedAt) &&
      Number.isInteger(input.continuity.currentLogicalTurn) &&
      input.continuity.currentLogicalTurn >= 0 &&
      input.recentHistory.every(
        (entry) =>
          Number.isInteger(entry.logicalTurn) &&
          entry.logicalTurn >= 0 &&
          entry.logicalTurn <= input.continuity.currentLogicalTurn &&
          this.validDate(entry.occurredAt),
      )
    );
  }

  private validDate(value: string): boolean {
    return Boolean(value.trim()) && !Number.isNaN(Date.parse(value));
  }

  private validated(
    result: ConversationUnderstandingResult,
  ): ConversationUnderstandingResult {
    this.validator.assertValid(result);
    return result;
  }
}
