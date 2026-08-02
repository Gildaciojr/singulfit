import { Injectable } from '@nestjs/common';
import type {
  ConversationBridgeResult,
  ConversationOfficialSelection,
  ConversationRuntimeIntegrationInput,
} from '../contracts/conversation-runtime.contract';
import { ConversationExecutionBridgeService } from './conversation-execution-bridge.service';
import { ConversationOfficialSelectionService } from './conversation-official-selection.service';
import { ConversationRuntimeAuditService } from './conversation-runtime-audit.service';
import { ConversationRuntimeOperationalConfigService } from './conversation-runtime-operational-config.service';
import { ConversationRuntimeService } from './conversation-runtime.service';
import { ConversationShadowComparatorService } from './conversation-shadow-comparator.service';

type ConversationRuntimeDecisionInput = Omit<
  ConversationRuntimeIntegrationInput,
  'legacyContent'
>;

export type ConversationRuntimePreExecutionDecision =
  | Readonly<{
      source: 'LEGACY';
      reason: Exclude<
        ConversationOfficialSelection['reason'],
        'RUNTIME_SELECTED'
      >;
    }>
  | Readonly<{
      source: 'CONVERSATION_RUNTIME';
      content: string;
      reason: 'RUNTIME_SELECTED';
    }>;

@Injectable()
export class ConversationRuntimeIntegrationService {
  constructor(
    private readonly config: ConversationRuntimeOperationalConfigService,
    private readonly runtime: ConversationRuntimeService,
    private readonly bridge: ConversationExecutionBridgeService,
    private readonly selection: ConversationOfficialSelectionService,
    private readonly comparator: ConversationShadowComparatorService,
    private readonly audit: ConversationRuntimeAuditService,
  ) {}

  async select(
    input: ConversationRuntimeIntegrationInput,
  ): Promise<ConversationOfficialSelection> {
    const decision = await this.decide(input);
    if (decision.source === 'CONVERSATION_RUNTIME') {
      return decision;
    }
    return this.selection.legacy(input.legacyContent, decision.reason);
  }

  async decide(
    input: ConversationRuntimeDecisionInput,
  ): Promise<ConversationRuntimePreExecutionDecision> {
    const config = this.config.get();
    try {
      return await this.withTimeout(this.run(input), config.timeoutMs);
    } catch (error) {
      return this.legacyDecision(
        error instanceof ConversationRuntimeTimeoutError
          ? 'RUNTIME_TIMEOUT'
          : 'RUNTIME_FAILURE',
      );
    }
  }

  private async run(
    input: ConversationRuntimeDecisionInput,
  ): Promise<ConversationRuntimePreExecutionDecision> {
    const evaluation = await this.runtime.evaluate(input);
    const bridge: ConversationBridgeResult = evaluation.decision
      ? await this.bridge.execute(evaluation.decision, evaluation.humanContext)
      : Object.freeze({
          status: 'FALLBACK_REQUIRED',
          content: null,
          routeKind: null,
          reason: evaluation.summary.fallbackReason ?? 'NO_RUNTIME_DECISION',
        });
    const config = this.config.get();
    const selection = this.selection.select({
      legacyContent: '',
      config,
      eligible: true,
      evaluation,
      bridge,
    });
    const comparison = this.comparator.compare(
      input.legacyIntent,
      evaluation.summary,
    );
    await this.audit.record({
      request: input,
      evaluation,
      bridge,
      selection,
      comparison,
    });
    if (selection.source === 'CONVERSATION_RUNTIME') {
      return Object.freeze({
        source: selection.source,
        content: selection.content,
        reason: 'RUNTIME_SELECTED' as const,
      });
    }
    return this.legacyDecision(
      selection.reason === 'RUNTIME_SELECTED'
        ? 'RUNTIME_FALLBACK'
        : selection.reason,
    );
  }

  private legacyDecision(
    reason: Exclude<
      ConversationOfficialSelection['reason'],
      'RUNTIME_SELECTED'
    >,
  ): ConversationRuntimePreExecutionDecision {
    return Object.freeze({ source: 'LEGACY' as const, reason });
  }

  private withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ConversationRuntimeTimeoutError()),
        timeoutMs,
      );
      operation.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(
            error instanceof Error
              ? error
              : new Error('CONVERSATION_RUNTIME_UNKNOWN_FAILURE'),
          );
        },
      );
    });
  }
}

class ConversationRuntimeTimeoutError extends Error {
  constructor() {
    super('CONVERSATION_RUNTIME_TIMEOUT');
    this.name = ConversationRuntimeTimeoutError.name;
  }
}
