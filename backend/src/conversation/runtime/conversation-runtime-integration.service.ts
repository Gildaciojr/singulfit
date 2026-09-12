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
    }>
  | Readonly<{
      source: 'SAFE_RESPONSE';
      content: string;
      reason:
        | 'AMBIGUOUS'
        | 'NO_RUNTIME_DECISION'
        | 'BRIDGE_FAILURE'
        | 'INVALID_RESPONSE_CONTENT'
        | 'RUNTIME_TIMEOUT'
        | 'RUNTIME_FAILURE';
    }>
  | Readonly<{
      source: 'PLANNING_HANDOFF';
      reason: 'SIDE_EFFECT_ROUTE_REQUIRES_SINGLE_EXECUTION';
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
    if (decision.source === 'SAFE_RESPONSE') {
      return Object.freeze({
        source: 'CONVERSATION_RUNTIME' as const,
        content: decision.content,
        reason: 'RUNTIME_SELECTED' as const,
      });
    }
    if (decision.source === 'PLANNING_HANDOFF') {
      return this.selection.legacy(input.legacyContent, 'RUNTIME_FALLBACK');
    }
    return this.selection.legacy(input.legacyContent, decision.reason);
  }

  async decide(
    input: ConversationRuntimeDecisionInput,
  ): Promise<ConversationRuntimePreExecutionDecision> {
    const config = this.config.get();
    if (!config.valid || config.killSwitch || config.mode === 'OFF') {
      return this.legacyDecision('RUNTIME_DISABLED');
    }
    const eligible = this.config.isOfficiallyEligible(input.userId, config);
    if (config.mode !== 'SHADOW' && !eligible) {
      return this.legacyDecision('USER_NOT_ELIGIBLE');
    }
    try {
      const deadlineAtMs = Date.now() + config.timeoutMs;
      return await this.withTimeout(
        this.run(input, config, eligible, deadlineAtMs),
        config.timeoutMs,
      );
    } catch (error) {
      return this.safeFailure(
        error instanceof ConversationRuntimeTimeoutError
          ? 'RUNTIME_TIMEOUT'
          : 'RUNTIME_FAILURE',
      );
    }
  }

  private async run(
    input: ConversationRuntimeDecisionInput,
    config: ReturnType<ConversationRuntimeOperationalConfigService['get']>,
    eligible: boolean,
    deadlineAtMs: number,
  ): Promise<ConversationRuntimePreExecutionDecision> {
    const evaluation = await this.runtime.evaluate(input);
    const bridge: ConversationBridgeResult = evaluation.decision
      ? await this.bridge.execute(
          evaluation.decision,
          evaluation.humanContext,
          {
            userId: input.userId,
            conversationId: input.conversationId,
            messageId: input.messageId,
            deadlineAtMs,
            referenceDate: new Date(input.receivedAt),
          },
        )
      : Object.freeze({
          status: 'FALLBACK_REQUIRED',
          content: null,
          routeKind: null,
          reason: evaluation.summary.fallbackReason ?? 'NO_RUNTIME_DECISION',
        });
    const selection = this.selection.select({
      legacyContent: '',
      config,
      eligible,
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
    if (selection.reason === 'SHADOW_ONLY') {
      return this.legacyDecision(selection.reason);
    }
    if (this.isIntentionalPlanningHandoff(bridge)) {
      return Object.freeze({
        source: 'PLANNING_HANDOFF' as const,
        reason: 'SIDE_EFFECT_ROUTE_REQUIRES_SINGLE_EXECUTION' as const,
      });
    }
    const failureReason = evaluation.summary.ambiguityPresent
      ? 'AMBIGUOUS'
      : bridge.status === 'FAILED' || bridge.status === 'FALLBACK_REQUIRED'
        ? bridge.reason === 'INVALID_RESPONSE_CONTENT'
          ? 'INVALID_RESPONSE_CONTENT'
          : 'BRIDGE_FAILURE'
        : 'NO_RUNTIME_DECISION';
    return this.safeFailure(failureReason);
  }

  private legacyDecision(
    reason: Exclude<
      ConversationOfficialSelection['reason'],
      'RUNTIME_SELECTED'
    >,
  ): ConversationRuntimePreExecutionDecision {
    return Object.freeze({ source: 'LEGACY' as const, reason });
  }

  private safeFailure(
    reason: Extract<
      ConversationRuntimePreExecutionDecision,
      { source: 'SAFE_RESPONSE' }
    >['reason'],
  ): ConversationRuntimePreExecutionDecision {
    const content =
      reason === 'AMBIGUOUS'
        ? 'Quero entender direito antes de fazer qualquer alteração. Pode me explicar um pouco melhor o que você quer?'
        : 'Não consegui concluir isso com segurança agora. Pode tentar novamente em instantes?';
    return Object.freeze({ source: 'SAFE_RESPONSE' as const, content, reason });
  }

  private isIntentionalPlanningHandoff(
    bridge: ConversationBridgeResult,
  ): boolean {
    return (
      bridge.status === 'FALLBACK_REQUIRED' &&
      bridge.reason === 'SIDE_EFFECT_ROUTE_REQUIRES_LEGACY_SINGLE_EXECUTION' &&
      bridge.routeKind !== null &&
      [
        'NUTRITION_PLAN_GENERATION',
        'WORKOUT_PLAN_GENERATION',
        'COMBINED_PLAN_GENERATION',
        'NUTRITION_PLAN_UPDATE',
        'WORKOUT_PLAN_UPDATE',
      ].includes(bridge.routeKind)
    );
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
