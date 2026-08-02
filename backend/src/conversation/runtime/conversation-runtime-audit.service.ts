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
        action: 'CONVERSATION_RUNTIME_EVALUATED',
        entityType: 'CONVERSATION_RUNTIME',
        entityId: this.hash(input.request.messageId),
        metadata: {
          userHash: this.hash(input.request.userId),
          conversationHash: this.hash(input.request.conversationId),
          mode: input.evaluation.summary.mode,
          runtimeStatus: input.evaluation.summary.status,
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
}
