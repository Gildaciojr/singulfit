import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ConversationRuntimeEvaluation,
  ConversationRuntimeInput,
  ConversationRuntimeSummary,
} from '../contracts/conversation-runtime.contract';
import { ConversationRoutingDecisionService } from '../routing/conversation-routing-decision.service';
import { ConversationUnderstandingService } from '../understanding/conversation-understanding.service';
import { ConversationRuntimeOperationalConfigService } from './conversation-runtime-operational-config.service';
import { ConversationTurnContextBuilderService } from './conversation-turn-context-builder.service';

@Injectable()
export class ConversationRuntimeService {
  constructor(
    private readonly config: ConversationRuntimeOperationalConfigService,
    private readonly contextBuilder: ConversationTurnContextBuilderService,
    private readonly understanding: ConversationUnderstandingService,
    private readonly routing: ConversationRoutingDecisionService,
  ) {}

  async evaluate(
    input: ConversationRuntimeInput,
  ): Promise<ConversationRuntimeEvaluation> {
    const startedAt = Date.now();
    const config = this.config.get();
    const operationKey = `conversation-runtime:v1:${createHash('sha256')
      .update(`${input.userId}:${input.messageId}`)
      .digest('hex')}`;
    if (!this.validIdentifiers(input)) {
      return Object.freeze({
        summary: this.summary({
          status: 'FAILED',
          mode: config.mode,
          operationKey,
          fallbackReason: 'INVALID_IDENTIFIERS',
          authorized: true,
          durationMs: Date.now() - startedAt,
        }),
        decision: null,
      });
    }
    try {
      const context = await this.contextBuilder.build(input);
      const understanding = await this.understanding.understand(
        context.understandingInput,
      );
      if (
        understanding.status === 'FAILED' ||
        understanding.ambiguity.present
      ) {
        return Object.freeze({
          summary: this.summary({
            status: 'FALLBACK_REQUIRED',
            mode: config.mode,
            operationKey,
            understandingStatus: understanding.status,
            recognizedIntent: understanding.intent,
            confidence: understanding.confidence,
            ambiguityPresent: understanding.ambiguity.present,
            safetyRequired: understanding.safety.requiresSafeResponse,
            authorized: true,
            fallbackReason: understanding.failure ?? 'AMBIGUOUS',
            durationMs: Date.now() - startedAt,
          }),
          decision: null,
        });
      }
      const decision = this.routing.decide({
        understanding,
        ...context.preparationBase,
      });
      return Object.freeze({
        summary: this.summary({
          status: 'OFFICIAL_CANDIDATE',
          mode: config.mode,
          operationKey,
          understandingStatus: 'UNDERSTOOD',
          recognizedIntent: understanding.intent,
          goal: decision.goalDecision.goal,
          routeKind: decision.executionRoute.kind,
          confidence: understanding.confidence,
          ambiguityPresent: false,
          safetyRequired: understanding.safety.requiresSafeResponse,
          authorized: true,
          durationMs: Date.now() - startedAt,
        }),
        decision,
      });
    } catch (error) {
      return Object.freeze({
        summary: this.summary({
          status: 'FAILED',
          mode: config.mode,
          operationKey,
          fallbackReason: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          authorized: true,
          durationMs: Date.now() - startedAt,
        }),
        decision: null,
      });
    }
  }

  private summary(
    input: Partial<ConversationRuntimeSummary> &
      Pick<
        ConversationRuntimeSummary,
        'status' | 'mode' | 'operationKey' | 'durationMs'
      >,
  ): ConversationRuntimeSummary {
    return Object.freeze({
      status: input.status,
      mode: input.mode,
      operationKey: input.operationKey,
      understandingStatus: input.understandingStatus ?? 'NOT_EVALUATED',
      recognizedIntent: input.recognizedIntent ?? null,
      goal: input.goal ?? null,
      routeKind: input.routeKind ?? null,
      confidence: input.confidence ?? null,
      ambiguityPresent: input.ambiguityPresent ?? false,
      safetyRequired: input.safetyRequired ?? false,
      authorized: input.authorized ?? false,
      fallbackReason: input.fallbackReason ?? null,
      durationMs: input.durationMs,
      versions: Object.freeze({
        runtime: 'conversation-runtime:v1',
        understanding: 'conversation-understanding:v1',
        routing: 'conversation-routing-decision:v1',
      }),
    });
  }

  private validIdentifiers(input: ConversationRuntimeInput): boolean {
    return Boolean(
      input.userId.trim() &&
      input.conversationId.trim() &&
      input.messageId.trim(),
    );
  }
}
