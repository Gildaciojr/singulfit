import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../observability/audit.service';
import type {
  ConversationBridgeResult,
  ConversationOfficialSelection,
  ConversationRuntimeEvaluation,
  ConversationRuntimeInput,
} from '../contracts/conversation-runtime.contract';
import type { ConversationShadowComparison } from './conversation-shadow-comparator.service';

@Injectable()
export class ConversationRuntimeAuditService {
  private readonly logger = new Logger(ConversationRuntimeAuditService.name);

  constructor(private readonly audit: AuditService) {}

  async record(input: {
    readonly request: ConversationRuntimeInput;
    readonly evaluation: ConversationRuntimeEvaluation;
    readonly bridge: ConversationBridgeResult;
    readonly selection: ConversationOfficialSelection;
    readonly comparison: ConversationShadowComparison;
  }): Promise<void> {
    try {
      await this.audit.record({
        userId: input.request.userId,
        action: 'CONVERSATION_RUNTIME_EVALUATED',
        entityType: 'CONVERSATION_RUNTIME',
        entityId: this.hash(input.request.messageId),
        metadata: {
          messageId: input.request.messageId,
          conversationId: input.request.conversationId,
          userHash: this.hash(input.request.userId),
          conversationHash: this.hash(input.request.conversationId),
          mode: input.evaluation.summary.mode,
          runtimeStatus: input.evaluation.summary.status,
          runtimeFallbackReason: this.safeFallbackReason(
            input.evaluation.summary.fallbackReason,
          ),
          understandingStatus: input.evaluation.summary.understandingStatus,
          recognizedIntent: input.evaluation.summary.recognizedIntent ?? 'NONE',
          goal: input.evaluation.summary.goal ?? 'NONE',
          routeKind: input.evaluation.summary.routeKind ?? 'NONE',
          confidence: input.evaluation.summary.confidence ?? 'NONE',
          ambiguityPresent: input.evaluation.summary.ambiguityPresent,
          safetyRequired: input.evaluation.summary.safetyRequired,
          bridgeStatus: input.bridge.status,
          selectedSource: input.selection.source,
          selectionReason: input.selection.reason,
          equivalent: input.comparison.equivalent,
          comparisonCode: input.comparison.code,
          comparisonClassification: input.comparison.classification,
          operationKey: input.evaluation.summary.operationKey,
          runtimeVersion: input.evaluation.summary.versions.runtime,
          understandingVersion: input.evaluation.summary.versions.understanding,
          routingVersion: input.evaluation.summary.versions.routing,
          durationMs: input.evaluation.summary.durationMs,
          answerSource:
            input.bridge.observability?.answerSource ?? 'DETERMINISTIC',
          answerDisposition:
            input.bridge.observability?.disposition ?? 'NOT_APPLICABLE',
          answerDomain: input.bridge.observability?.domain ?? 'NOT_APPLICABLE',
          answerGrounding:
            input.bridge.observability?.grounding ?? 'NOT_APPLICABLE',
          providerDurationMs:
            input.bridge.observability?.providerDurationMs ?? 0,
          promptTokens: input.bridge.observability?.promptTokens ?? 0,
          completionTokens: input.bridge.observability?.completionTokens ?? 0,
          totalTokens: input.bridge.observability?.totalTokens ?? 0,
          answerFallbackReason:
            input.bridge.observability?.fallbackReason ?? 'NONE',
          effectiveReferentSource:
            input.bridge.observability?.effectiveReferentSource ?? null,
          effectiveReferentMessageId:
            input.bridge.observability?.effectiveReferentMessageId ?? null,
          effectiveReferentDomain:
            input.bridge.observability?.effectiveReferentDomain ?? null,
          effectiveReferentMeal:
            input.bridge.observability?.effectiveReferentMeal ?? null,
          nutritionAdviceInitialViolation:
            input.bridge.observability?.nutritionAdviceInitialViolation ?? null,
          nutritionAdviceRetryAttempted:
            input.bridge.observability?.nutritionAdviceRetryAttempted ?? false,
          nutritionAdviceRetryOutcome:
            input.bridge.observability?.nutritionAdviceRetryOutcome ??
            'NOT_ATTEMPTED',
        },
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao registrar auditoria do Conversation Runtime: ${
          error instanceof Error ? error.name : 'UnknownError'
        }`,
      );
    }
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private safeFallbackReason(reason: string | null): string {
    if (reason === null) return 'NONE';
    const reasons = [
      'INVALID_IDENTIFIERS',
      'CONTEXT_BUILD_FAILED',
      'UNDERSTANDING_FAILED',
      'ROUTING_FAILED',
      'EMPTY_MESSAGE',
      'UNSUPPORTED_CONTENT',
      'INVALID_RESULT',
      'AMBIGUOUS',
      'CONTEXT_UNAVAILABLE',
      'NOT_IMPLEMENTED',
    ];
    return reasons.includes(reason) ? reason : 'UNCLASSIFIED_FAILURE';
  }
}
