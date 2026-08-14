import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { ConversationShadowDiagnosticsService } from './conversation-shadow-diagnostics.service';
import { CONVERSATION_LAYER_MODE } from './conversation-layer-operational-config.service';
import { ConversationLayerOperationalConfigService } from './conversation-layer-operational-config.service';
import { NutritionConversationAuthorizedFactsBuilder } from './nutrition-conversation-authorized-facts.builder';
import {
  BuildNutritionConversationContextInput,
  NutritionConversationContextBuilder,
} from './nutrition-conversation-context.builder';
import { NutritionConversationComposer } from './nutrition-conversation-composer';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import { NutritionConversationRealizationExecutorService } from './nutrition-conversation-realization-executor.service';
import { NutritionConversationLegacyCandidateAdapter } from './nutrition-conversation-legacy-candidate.adapter';
import { NutritionConversationComparator } from './nutrition-conversation-comparator';
import { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';
import { ConversationSelectionConfigService } from './conversation-selection-config.service';
import { NutritionConversationCandidateSelectorService } from './nutrition-conversation-candidate-selector.service';
import { NutritionConversationCandidateSelectionAuditService } from './nutrition-conversation-candidate-selection-audit.service';
import { NutritionConversationInternalEligibilityService } from './nutrition-conversation-internal-eligibility.service';
import type { ConversationReasoningBridgeInput } from './reasoning-bridge/conversation-reasoning-bridge.contract';
import { ConversationReasoningBridgeService } from './reasoning-bridge/conversation-reasoning-bridge.service';
import {
  CONVERSATION_SELECTED_SOURCE,
  CONVERSATION_SELECTION_ROLLOUT_MODE,
  type ConversationSelectedSource,
} from './conversation-candidate-selection.contract';

const SHADOW_TOTAL_TIMEOUT_MS = 25_000;
const SHADOW_CONCURRENCY_LIMIT = 2;

export interface ExecuteNutritionConversationShadowInput {
  readonly operation: {
    readonly userId: string;
    readonly conversationId: string;
    readonly messageId: string;
  };
  readonly conversation: BuildNutritionConversationContextInput;
  readonly legacyText: string;
  readonly reasoning?: ConversationReasoningBridgeInput;
}

export interface NutritionConversationOfficialSelectionResult {
  readonly content: string;
  readonly selectedSource: ConversationSelectedSource;
  readonly candidateExecutionAttempted: boolean;
}

@Injectable()
export class NutritionConversationShadowPipelineService implements OnApplicationShutdown {
  private readonly reasoningBridge = new ConversationReasoningBridgeService();
  private activeExecutions = 0;
  private shuttingDown = false;

  constructor(
    private readonly operationalConfig: ConversationLayerOperationalConfigService,
    private readonly contextBuilder: NutritionConversationContextBuilder,
    private readonly decisionEngine: NutritionConversationDecisionEngine,
    private readonly scoringPolicy: NutritionConversationDecisionScoringPolicy,
    private readonly composer: NutritionConversationComposer,
    private readonly authorizedFactsBuilder: NutritionConversationAuthorizedFactsBuilder,
    private readonly sanitizedPayloadBuilder: SanitizedConversationPayloadBuilder,
    private readonly realizationExecutor: NutritionConversationRealizationExecutorService,
    private readonly adapter: NutritionConversationLegacyCandidateAdapter,
    private readonly comparator: NutritionConversationComparator,
    private readonly selectionConfig: ConversationSelectionConfigService,
    private readonly internalEligibility: NutritionConversationInternalEligibilityService,
    private readonly candidateSelector: NutritionConversationCandidateSelectorService,
    private readonly selectionAudit: NutritionConversationCandidateSelectionAuditService,
    private readonly diagnostics: ConversationShadowDiagnosticsService,
  ) {}

  execute(input: ExecuteNutritionConversationShadowInput): void {
    try {
      if (
        this.shuttingDown ||
        this.operationalConfig.get().effectiveMode !==
          CONVERSATION_LAYER_MODE.SHADOW
      ) {
        return;
      }

      if (this.activeExecutions >= SHADOW_CONCURRENCY_LIMIT) {
        this.safeDiagnostic({ event: 'SKIPPED_CONCURRENCY' });
        return;
      }

      this.activeExecutions += 1;
      this.safeDiagnostic({ event: 'STARTED' });
      const startedAt = performance.now();
      const work = Promise.resolve()
        .then(() => this.run(input, startedAt))
        .catch(() => undefined)
        .finally(() => {
          this.activeExecutions -= 1;
        });

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          this.safeDiagnostic({
            event: 'TIMEOUT',
            component: 'SHADOW_PIPELINE',
            latencyMs: SHADOW_TOTAL_TIMEOUT_MS,
          });
          resolve();
        }, SHADOW_TOTAL_TIMEOUT_MS);
        timeoutHandle.unref();
      });

      void Promise.race([work, timeout])
        .catch(() => undefined)
        .finally(() => {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        });
    } catch {
      this.safeDiagnostic({ event: 'FAILED', component: 'EXECUTE' });
    }
  }

  async selectOfficial(
    input: ExecuteNutritionConversationShadowInput,
  ): Promise<NutritionConversationOfficialSelectionResult> {
    if (!this.isOfficialSelectionEnabled(input.operation.userId)) {
      return Object.freeze({
        content: input.legacyText,
        selectedSource: CONVERSATION_SELECTED_SOURCE.FORMATTER,
        candidateExecutionAttempted: false,
      });
    }

    const startedAt = performance.now();
    try {
      const result = await this.runSelection(input, startedAt);
      return Object.freeze({
        ...result,
        candidateExecutionAttempted: true,
      });
    } catch {
      this.safeDiagnostic({ event: 'FAILED', component: 'OFFICIAL_SELECTION' });
      return Object.freeze({
        content: input.legacyText,
        selectedSource: CONVERSATION_SELECTED_SOURCE.FORMATTER,
        candidateExecutionAttempted: true,
      });
    }
  }

  isOfficialSelectionEnabled(userId: string): boolean {
    const layer = this.operationalConfig.get();
    const selection = this.selectionConfig.get();
    if (
      this.shuttingDown ||
      layer.effectiveMode === CONVERSATION_LAYER_MODE.OFF ||
      layer.effectiveMode === CONVERSATION_LAYER_MODE.SHADOW ||
      selection.effectiveMode === CONVERSATION_SELECTION_ROLLOUT_MODE.OFF
    ) {
      return false;
    }
    if (
      layer.effectiveMode === CONVERSATION_LAYER_MODE.INTERNAL ||
      selection.effectiveMode === CONVERSATION_SELECTION_ROLLOUT_MODE.INTERNAL
    ) {
      return this.internalEligibility.isEligible(userId);
    }
    return true;
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
  }

  private async run(
    input: ExecuteNutritionConversationShadowInput,
    startedAt: number,
  ): Promise<void> {
    try {
      await this.runSelection(input, startedAt);
    } catch {
      return;
    }
  }

  private async runSelection(
    input: ExecuteNutritionConversationShadowInput,
    startedAt: number,
  ): Promise<
    Pick<
      NutritionConversationOfficialSelectionResult,
      'content' | 'selectedSource'
    >
  > {
    let component = 'CONTEXT';

    try {
      const context = this.contextBuilder.build(input.conversation);
      component = 'ENGINE';
      const candidates = this.decisionEngine.generate(context);
      component = 'POLICY';
      const decisionPlan = this.scoringPolicy.select(context, candidates);
      component = 'COMPOSER';
      const compositionPlan = this.composer.compose(context, decisionPlan);
      component = 'AUTHORIZED_FACTS';
      const authorizedFacts = this.authorizedFactsBuilder.build(context);
      component = 'PAYLOAD';
      const sanitizedPayload = this.sanitizedPayloadBuilder.build({
        context,
        authorizedFacts,
        decisionPlan,
        compositionPlan,
      });
      const reasoning = this.reasoningBridge.build(input.reasoning ?? {});

      component = 'REALIZER';
      const realization = await this.realizationExecutor.execute({
        ...input.operation,
        payload: sanitizedPayload,
        ...(reasoning.evidence
          ? { reasoningEvidence: reasoning.evidence }
          : {}),
      });
      component = 'ADAPTER';
      const envelope = this.adapter.adapt(input.legacyText, realization);
      component = 'COMPARATOR';
      const comparison = this.comparator.compare({
        envelope,
        candidate: realization,
        payload: sanitizedPayload,
        incrementalLatencyMs: performance.now() - startedAt,
      });
      component = 'SELECTION_CONFIG';
      const selectionConfig = this.selectionConfig.get();
      component = 'CANDIDATE_SELECTOR';
      const selectionStartedAt = performance.now();
      const selectionDecision = this.candidateSelector.select({
        officialResponse: input.legacyText,
        candidate: realization,
        comparison,
        metadata: {
          rolloutMode: selectionConfig.effectiveMode,
          formatterVersion: selectionConfig.formatterVersion,
          promptVersionId:
            realization.operationalMetadata?.promptVersionId ?? null,
          candidateJobId: realization.operationalMetadata?.aiJobId ?? null,
          timestamp: new Date().toISOString(),
        },
      });
      const selectionLatencyMs = performance.now() - selectionStartedAt;
      let selectionAuditPersisted = true;

      component = 'SELECTION_AUDIT';
      try {
        await this.selectionAudit.record({
          userId: input.operation.userId,
          decisionReference:
            realization.operationalMetadata?.aiJobId ??
            realization.sanitizedPayloadReference,
          decision: selectionDecision,
          selectionLatencyMs,
        });
      } catch {
        selectionAuditPersisted = false;
        this.safeDiagnostic({
          event: 'FAILED',
          component: 'SELECTION_AUDIT',
        });
      }

      this.safeDiagnostic({
        event: 'COMPLETED',
        realizerStatus: realization.status,
        ...(realization.failureCode
          ? { realizerFailureCode: realization.failureCode }
          : {}),
        candidateEligible: comparison.candidateEligible,
        rejectionCode: comparison.ineligibilityCode,
        ...(realization.violationDetails
          ? { violationDetails: realization.violationDetails }
          : {}),
        latencyMs: comparison.metrics.incrementalLatencyMs,
        legacyCharacters: comparison.metrics.legacyCharacters,
        candidateCharacters: comparison.metrics.candidateCharacters,
        candidateQuestions: comparison.metrics.candidateQuestions,
        candidateEmojis: comparison.metrics.candidateEmojis,
        fallback: realization.status === 'FALLBACK',
        selectionLatencyMs,
        selectionStatus: selectionDecision.selectionStatus,
        selectedSource: selectionDecision.selectedSource,
        selectionReason: selectionDecision.reason,
        candidateAvailable: selectionDecision.candidateAvailable,
        candidateValid: selectionDecision.candidateValid,
        comparisonScore: selectionDecision.comparisonScore,
        formatterVersion: selectionDecision.formatterVersion,
        promptVersionId: selectionDecision.promptVersionId,
        candidateJobId: selectionDecision.candidateJobId,
        selectionAuditPersisted,
      });
      return Object.freeze({
        content:
          selectionDecision.selectedSource ===
          CONVERSATION_SELECTED_SOURCE.CANDIDATE
            ? (realization.candidateText ?? input.legacyText)
            : input.legacyText,
        selectedSource: selectionDecision.selectedSource,
      });
    } catch (error: unknown) {
      this.safeDiagnostic({ event: 'FAILED', component });
      throw error;
    }
  }

  private safeDiagnostic(
    diagnostic: Parameters<ConversationShadowDiagnosticsService['record']>[0],
  ): void {
    try {
      this.diagnostics.record(diagnostic);
    } catch {
      return;
    }
  }
}
