import type { ConversationGoalDecision } from '../context/conversation-goal-planner.contract';
import type { NutritionReasoningResult } from '../nutrition-reasoning/nutrition-reasoning.contract';
import type { ConversationSelectionConfigService } from '../responses/conversation-selection-config.service';
import type { NutritionConversationCandidateSelectionAuditService } from '../responses/nutrition-conversation-candidate-selection-audit.service';
import type { NutritionConversationCandidateSelectorService } from '../responses/nutrition-conversation-candidate-selector.service';
import type { NutritionConversationComparator } from '../responses/nutrition-conversation-comparator';
import type { NutritionConversationLegacyCandidateAdapter } from '../responses/nutrition-conversation-legacy-candidate.adapter';
import type { NutritionConversationRealizationExecutorService } from '../responses/nutrition-conversation-realization-executor.service';
import type { ConversationReasoningBridgeService } from '../responses/reasoning-bridge/conversation-reasoning-bridge.service';
import type { CoachPlanningExecutionResult } from './coach-planning-execution.contract';
import { CoachPlanningConversationResponseService } from './coach-planning-conversation-response.service';

describe('CoachPlanningConversationResponseService', () => {
  const decision = Object.freeze({
    marker: 'planner',
  }) as unknown as ConversationGoalDecision;
  const nutrition = Object.freeze({
    marker: 'nutrition',
  }) as unknown as NutritionReasoningResult;

  function execution(): CoachPlanningExecutionResult {
    const unavailable = Object.freeze({
      reasoningAppliedToGeneration: false,
      reasoningObservedOnly: false,
      reasoningUnavailable: true,
      unavailableReason: 'DOMAIN_NOT_REQUESTED' as const,
    });
    return Object.freeze({
      content: 'resposta oficial legada',
      selectedSource: 'LEGACY',
      decision,
      nutritionReasoning: nutrition,
      workoutReasoning: null,
      longitudinalDecision: null,
      reasoning: Object.freeze({
        nutrition: Object.freeze({
          reasoningAppliedToGeneration: false,
          reasoningObservedOnly: true,
          reasoningUnavailable: false,
          unavailableReason: null,
        }),
        workout: unavailable,
        longitudinal: unavailable,
      }),
      dispatch: Object.freeze({
        content: 'resposta oficial legada',
        executor: 'DIET_LEGACY',
        generationCompleted: true,
        fallbackApplied: false,
      }),
      metadata: Object.freeze({
        correlationId: 'message-id',
        operationKey: 'message-id',
        executor: 'DIET_LEGACY',
        fallbackApplied: false,
        generationCompleted: true,
      }),
    });
  }

  function subject(selectedSource: 'CANDIDATE' | 'FORMATTER' = 'CANDIDATE') {
    const evidence = Object.freeze({
      summary: Object.freeze({
        goal: 'plano alimentar',
        decision: null,
        expectedBenefit: null,
      }),
      priorities: Object.freeze([]),
      strategies: Object.freeze([]),
      restrictions: Object.freeze([]),
      tradeoffs: Object.freeze([]),
      explanations: Object.freeze([]),
      teachingOpportunities: Object.freeze([]),
      suggestedQuestions: Object.freeze([]),
      safety: Object.freeze({
        requiresCaution: false,
        professionalGuidanceRecommended: false,
        guidance: Object.freeze([]),
      }),
      longitudinal: Object.freeze({
        continuity: null,
        progress: null,
        adherence: null,
        repetitionRisk: false,
      }),
      application: Object.freeze({
        nutrition: Object.freeze({
          appliedToGeneration: false,
          observedOnly: true,
          unavailable: false,
        }),
        workout: Object.freeze({
          appliedToGeneration: false,
          observedOnly: false,
          unavailable: true,
        }),
        longitudinal: Object.freeze({
          appliedToGeneration: false,
          observedOnly: false,
          unavailable: true,
        }),
      }),
    });
    const bridge = { build: jest.fn().mockReturnValue({ evidence }) };
    const candidate = Object.freeze({
      id: 'candidate-id',
      status: 'COMPLETED',
      candidateText: 'resposta candidata',
      sanitizedPayloadReference: 'payload-reference',
      realizedUnits: Object.freeze([]),
      omittedUnits: Object.freeze([]),
      realizedFacts: Object.freeze([]),
      realizedDecisions: Object.freeze([]),
      omittedDecisions: Object.freeze([]),
      disclaimerRealized: false,
      closingRealized: false,
      producedQuestionCount: 0,
    });
    const realizer = { execute: jest.fn().mockResolvedValue(candidate) };
    const adapter = {
      adapt: jest
        .fn()
        .mockReturnValue({ candidate: { content: 'resposta candidata' } }),
    };
    const comparison = Object.freeze({
      passedChecks: Object.freeze([]),
      failedChecks: Object.freeze([]),
      warnings: Object.freeze([]),
      checks: Object.freeze([]),
      candidateEligible: true,
      metrics: Object.freeze({ candidateCharacters: 18 }),
    });
    const comparator = { compare: jest.fn().mockReturnValue(comparison) };
    const selection = Object.freeze({
      selectedSource,
      reason:
        selectedSource === 'CANDIDATE'
          ? 'CANDIDATE_PROMOTED'
          : 'CANDIDATE_VALIDATION_FAILED',
      comparisonScore: 100,
      promptVersionId: null,
      candidateJobId: null,
      formatterVersion: 'formatter:v1',
      selectionStatus:
        selectedSource === 'CANDIDATE'
          ? 'CANDIDATE_SELECTED'
          : 'INVALID_CANDIDATE',
      rolloutMode: 'PRIMARY',
      candidateAvailable: true,
      candidateValid: true,
      timestamp: '2026-08-02T12:00:00.000Z',
      metrics: Object.freeze({
        formatterLength: 23,
        candidateLength: 18,
        candidateUnitCount: 0,
        disclaimerPresent: false,
        requiredFactsPresent: true,
        structureValid: true,
        humanizerScore: 100,
        validatorScore: 100,
      }),
    });
    const selector = { select: jest.fn().mockReturnValue(selection) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new CoachPlanningConversationResponseService(
      bridge as unknown as ConversationReasoningBridgeService,
      realizer as unknown as NutritionConversationRealizationExecutorService,
      adapter as unknown as NutritionConversationLegacyCandidateAdapter,
      comparator as unknown as NutritionConversationComparator,
      {
        get: jest.fn().mockReturnValue({
          effectiveMode: 'PRIMARY',
          formatterVersion: 'formatter:v1',
        }),
      } as unknown as ConversationSelectionConfigService,
      selector as unknown as NutritionConversationCandidateSelectorService,
      audit as unknown as NutritionConversationCandidateSelectionAuditService,
    );
    return { service, bridge, realizer, selector, audit, evidence };
  }

  const input = () => ({
    userId: 'user-id',
    conversationId: 'conversation-id',
    messageId: 'message-id',
    execution: execution(),
  });

  it('passes the exact reasoning instances once and makes a valid Candidate official', async () => {
    const test = subject();

    await expect(test.service.select(input())).resolves.toBe(
      'resposta candidata',
    );
    const bridgeInput = test.bridge.build.mock.calls[0][0];
    expect(bridgeInput.planner).toBe(decision);
    expect(bridgeInput.nutrition).toBe(nutrition);
    expect(test.bridge.build).toHaveBeenCalledTimes(1);
    expect(test.realizer.execute).toHaveBeenCalledTimes(1);
    expect(test.realizer.execute.mock.calls[0][0].reasoningEvidence).toBe(
      test.evidence,
    );
    expect(test.selector.select).toHaveBeenCalledTimes(1);
    expect(test.audit.record).toHaveBeenCalledTimes(1);
  });

  it('uses Formatter only when Candidate selection rejects the candidate', async () => {
    const test = subject('FORMATTER');

    await expect(test.service.select(input())).resolves.toBe(
      'resposta oficial legada',
    );
    expect(test.bridge.build).toHaveBeenCalledTimes(1);
    expect(test.realizer.execute).toHaveBeenCalledTimes(1);
    expect(test.selector.select).toHaveBeenCalledTimes(1);
  });

  it('falls back to the official content when realization fails', async () => {
    const test = subject();
    test.realizer.execute.mockRejectedValueOnce(new Error('timeout'));

    await expect(test.service.select(input())).resolves.toBe(
      'resposta oficial legada',
    );
    expect(test.selector.select).not.toHaveBeenCalled();
  });
});
