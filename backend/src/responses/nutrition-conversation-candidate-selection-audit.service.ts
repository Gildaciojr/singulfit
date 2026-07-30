import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../observability/audit.service';
import type { SelectedCandidateDecision } from './conversation-candidate-selection.contract';

export interface RecordNutritionConversationCandidateSelectionInput {
  readonly userId: string;
  readonly decisionReference: string;
  readonly decision: SelectedCandidateDecision;
  readonly selectionLatencyMs: number;
}

@Injectable()
export class NutritionConversationCandidateSelectionAuditService {
  constructor(private readonly auditService: AuditService) {}

  async record(
    input: RecordNutritionConversationCandidateSelectionInput,
  ): Promise<void> {
    const decision = input.decision;
    const metadata: Prisma.InputJsonObject = {
      selectionStatus: decision.selectionStatus,
      selectedSource: decision.selectedSource,
      reason: decision.reason,
      candidateAvailable: decision.candidateAvailable,
      candidateValid: decision.candidateValid,
      formatterVersion: decision.formatterVersion,
      promptVersionId: decision.promptVersionId,
      candidateJobId: decision.candidateJobId,
      rolloutMode: decision.rolloutMode,
      comparisonScore: decision.comparisonScore,
      timestamp: decision.timestamp,
      selectionLatencyMs: Math.max(0, input.selectionLatencyMs),
      formatterLength: decision.metrics.formatterLength,
      candidateLength: decision.metrics.candidateLength,
      candidateUnitCount: decision.metrics.candidateUnitCount,
      disclaimerPresent: decision.metrics.disclaimerPresent,
      requiredFactsPresent: decision.metrics.requiredFactsPresent,
      structureValid: decision.metrics.structureValid,
      humanizerScore: decision.metrics.humanizerScore,
      validatorScore: decision.metrics.validatorScore,
    };

    await this.auditService.record({
      userId: input.userId,
      action: 'CONVERSATION_CANDIDATE_SELECTION_DECIDED',
      entityType: 'CONVERSATION_CANDIDATE_SELECTION',
      entityId: input.decisionReference,
      metadata,
    });
  }
}
