import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import {
  CONVERSATION_SELECTED_SOURCE,
  type SelectedCandidateDecision,
} from '../responses/conversation-candidate-selection.contract';
import { ConversationSelectionConfigService } from '../responses/conversation-selection-config.service';
import { NutritionConversationCandidateSelectionAuditService } from '../responses/nutrition-conversation-candidate-selection-audit.service';
import { NutritionConversationCandidateSelectorService } from '../responses/nutrition-conversation-candidate-selector.service';
import { NutritionConversationComparator } from '../responses/nutrition-conversation-comparator';
import { NutritionConversationLegacyCandidateAdapter } from '../responses/nutrition-conversation-legacy-candidate.adapter';
import { NutritionConversationRealizationExecutorService } from '../responses/nutrition-conversation-realization-executor.service';
import { CoachPlanningConversationPayloadBuilder } from '../responses/reasoning-bridge/coach-planning-conversation-payload.builder';
import { ConversationReasoningBridgeService } from '../responses/reasoning-bridge/conversation-reasoning-bridge.service';
import type { CoachPlanningExecutionResult } from './coach-planning-execution.contract';

export interface CoachPlanningConversationResponseInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly execution: CoachPlanningExecutionResult;
}

@Injectable()
export class CoachPlanningConversationResponseService {
  private readonly logger = new Logger(
    CoachPlanningConversationResponseService.name,
  );
  private readonly payloadBuilder =
    new CoachPlanningConversationPayloadBuilder();

  constructor(
    private readonly bridge: ConversationReasoningBridgeService,
    private readonly realizer: NutritionConversationRealizationExecutorService,
    private readonly adapter: NutritionConversationLegacyCandidateAdapter,
    private readonly comparator: NutritionConversationComparator,
    private readonly selectionConfig: ConversationSelectionConfigService,
    private readonly selector: NutritionConversationCandidateSelectorService,
    private readonly selectionAudit: NutritionConversationCandidateSelectionAuditService,
  ) {}

  async select(input: CoachPlanningConversationResponseInput): Promise<string> {
    const official = input.execution.content;
    try {
      const bridge = this.bridge.build({
        planner: input.execution.decision,
        nutrition: input.execution.nutritionReasoning,
        workout: input.execution.workoutReasoning,
        longitudinal: input.execution.longitudinalDecision,
        human: input.execution.humanContext,
        application: Object.freeze({
          nutrition: this.application(input.execution.reasoning.nutrition),
          workout: this.application(input.execution.reasoning.workout),
          longitudinal: this.application(
            input.execution.reasoning.longitudinal,
          ),
        }),
      });
      if (!bridge.evidence) return official;

      const startedAt = performance.now();
      const payload = this.payloadBuilder.build(
        official,
        bridge.evidence.human ?? null,
      );
      const candidate = await this.realizer.execute({
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        payload,
        reasoningEvidence: bridge.evidence,
      });
      const envelope = this.adapter.adapt(official, candidate);
      const comparison = this.comparator.compare({
        envelope,
        candidate,
        payload,
        incrementalLatencyMs: performance.now() - startedAt,
      });
      const config = this.selectionConfig.get();
      const selection = this.selector.select({
        officialResponse: official,
        candidate,
        comparison,
        metadata: {
          rolloutMode: config.effectiveMode,
          formatterVersion: config.formatterVersion,
          promptVersionId:
            candidate.operationalMetadata?.promptVersionId ?? null,
          candidateJobId: candidate.operationalMetadata?.aiJobId ?? null,
          timestamp: new Date().toISOString(),
        },
      });
      await this.auditSelection(
        input.userId,
        candidate.id,
        selection,
        startedAt,
      );
      return selection.selectedSource === CONVERSATION_SELECTED_SOURCE.CANDIDATE
        ? (candidate.candidateText ?? official)
        : official;
    } catch (error: unknown) {
      this.logger.warn(
        `Realização de planejamento isolada: ${this.safeMessage(error)}`,
      );
      return official;
    }
  }

  private application(
    state: CoachPlanningExecutionResult['reasoning']['nutrition'],
  ) {
    return Object.freeze({
      appliedToGeneration: state.reasoningAppliedToGeneration,
      observedOnly: state.reasoningObservedOnly,
      unavailable: state.reasoningUnavailable,
    });
  }

  private async auditSelection(
    userId: string,
    decisionReference: string,
    decision: SelectedCandidateDecision,
    startedAt: number,
  ): Promise<void> {
    try {
      await this.selectionAudit.record({
        userId,
        decisionReference,
        decision,
        selectionLatencyMs: performance.now() - startedAt,
      });
    } catch {
      return;
    }
  }

  private safeMessage(error: unknown): string {
    return (
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'falha não identificada'
    ).slice(0, 1_000);
  }
}
