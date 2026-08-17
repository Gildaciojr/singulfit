import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConversationLayerOperationalConfigService } from './conversation-layer-operational-config.service';
import type { ConversationShadowDiagnosticsService } from './conversation-shadow-diagnostics.service';
import type { NutritionConversationAuthorizedFactsBuilder } from './nutrition-conversation-authorized-facts.builder';
import type {
  BuildNutritionConversationContextInput,
  NutritionConversationContextBuilder,
} from './nutrition-conversation-context.builder';
import type { NutritionConversationComposer } from './nutrition-conversation-composer';
import type { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import type { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import type { NutritionConversationRealizationExecutorService } from './nutrition-conversation-realization-executor.service';
import type { NutritionConversationLegacyCandidateAdapter } from './nutrition-conversation-legacy-candidate.adapter';
import type { NutritionConversationComparator } from './nutrition-conversation-comparator';
import { NutritionConversationShadowPipelineService } from './nutrition-conversation-shadow-pipeline.service';
import type { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';
import type { ConversationSelectionConfigService } from './conversation-selection-config.service';
import type { NutritionConversationCandidateSelectorService } from './nutrition-conversation-candidate-selector.service';
import type { NutritionConversationCandidateSelectionAuditService } from './nutrition-conversation-candidate-selection-audit.service';
import type { NutritionConversationInternalEligibilityService } from './nutrition-conversation-internal-eligibility.service';

function subject(mode: 'OFF' | 'SHADOW' = 'SHADOW') {
  const context = Object.freeze({ context: true });
  const candidates = Object.freeze([{ candidate: true }]);
  const decisionPlan = Object.freeze({ plan: true });
  const compositionPlan = Object.freeze({ composition: true });
  const authorizedFacts = Object.freeze({ facts: true });
  const sanitizedPayload = Object.freeze({ payload: true });
  const languageResult = Object.freeze({
    status: 'COMPLETED',
    candidateText: 'candidate',
    sanitizedPayloadReference: 'payload-reference',
    operationalMetadata: Object.freeze({
      aiJobId: 'candidate-job-id',
      promptVersionId: 'prompt-version-id',
    }),
  });
  const operationalConfig = {
    get: jest.fn().mockReturnValue({ effectiveMode: mode }),
  };
  const contextBuilder = { build: jest.fn().mockReturnValue(context) };
  const decisionEngine = { generate: jest.fn().mockReturnValue(candidates) };
  const scoringPolicy = { select: jest.fn().mockReturnValue(decisionPlan) };
  const composer = { compose: jest.fn().mockReturnValue(compositionPlan) };
  const authorizedFactsBuilder = {
    build: jest.fn().mockReturnValue(authorizedFacts),
  };
  const sanitizedPayloadBuilder = {
    build: jest.fn().mockReturnValue(sanitizedPayload),
  };
  const realizationExecutor = {
    execute: jest.fn().mockResolvedValue(languageResult),
  };
  const adapter = {
    adapt: jest.fn().mockReturnValue({ candidate: { eligible: true } }),
  };
  const comparator = {
    compare: jest.fn().mockReturnValue({
      candidateEligible: true,
      metrics: {
        incrementalLatencyMs: 1,
        legacyCharacters: 6,
        candidateCharacters: 9,
        candidateQuestions: 0,
        candidateEmojis: 0,
      },
    }),
  };
  const selectionConfig = {
    get: jest.fn().mockReturnValue({
      effectiveMode: 'OFF',
      formatterVersion: 'nutrition-response-formatter:v1',
    }),
  };
  const internalEligibility = { isEligible: jest.fn().mockReturnValue(true) };
  const selectionDecision = Object.freeze({
    selectedSource: 'FORMATTER',
    reason: 'ROLLOUT_MODE_OFF',
    comparisonScore: 100,
    promptVersionId: 'prompt-version-id',
    candidateJobId: 'candidate-job-id',
    formatterVersion: 'nutrition-response-formatter:v1',
    selectionStatus: 'FUTURE_ROLLOUT_DISABLED',
    rolloutMode: 'OFF',
    candidateAvailable: true,
    candidateValid: true,
    timestamp: '2026-07-15T12:00:00.000Z',
    metrics: Object.freeze({}),
  });
  const candidateSelector = {
    select: jest.fn().mockReturnValue(selectionDecision),
  };
  const selectionAudit = { record: jest.fn().mockResolvedValue(undefined) };
  const diagnostics = { record: jest.fn() };
  const service = new NutritionConversationShadowPipelineService(
    operationalConfig as unknown as ConversationLayerOperationalConfigService,
    contextBuilder as unknown as NutritionConversationContextBuilder,
    decisionEngine as unknown as NutritionConversationDecisionEngine,
    scoringPolicy as unknown as NutritionConversationDecisionScoringPolicy,
    composer as unknown as NutritionConversationComposer,
    authorizedFactsBuilder as unknown as NutritionConversationAuthorizedFactsBuilder,
    sanitizedPayloadBuilder as unknown as SanitizedConversationPayloadBuilder,
    realizationExecutor as unknown as NutritionConversationRealizationExecutorService,
    adapter as unknown as NutritionConversationLegacyCandidateAdapter,
    comparator as unknown as NutritionConversationComparator,
    selectionConfig as unknown as ConversationSelectionConfigService,
    internalEligibility as unknown as NutritionConversationInternalEligibilityService,
    candidateSelector as unknown as NutritionConversationCandidateSelectorService,
    selectionAudit as unknown as NutritionConversationCandidateSelectionAuditService,
    diagnostics as unknown as ConversationShadowDiagnosticsService,
  );

  return {
    service,
    operationalConfig,
    contextBuilder,
    decisionEngine,
    scoringPolicy,
    composer,
    authorizedFactsBuilder,
    sanitizedPayloadBuilder,
    realizationExecutor,
    adapter,
    comparator,
    selectionConfig,
    internalEligibility,
    candidateSelector,
    selectionAudit,
    selectionDecision,
    diagnostics,
    context,
    candidates,
    decisionPlan,
    compositionPlan,
    authorizedFacts,
    sanitizedPayload,
  };
}

const conversation = Object.freeze({
  analysis: { id: 'analysis' },
}) as unknown as BuildNutritionConversationContextInput;
const input = Object.freeze({
  operation: Object.freeze({
    userId: 'user-id',
    conversationId: 'conversation-id',
    messageId: 'message-id',
  }),
  conversation,
  legacyText: 'legacy',
});
const reasoning = Object.freeze({
  planner: Object.freeze({
    recognizedIntent: 'COMBINED_PLAN_REQUEST' as const,
    goal: 'GENERATE_COMBINED_PLANS' as const,
    reason: 'COMBINED_PROFILE_READY' as const,
    targetPlan: 'BOTH' as const,
    profileCompletionState: 'COMPLETE' as const,
    canExecute: true,
    confidence: 'HIGH' as const,
    selectedProfileField: null,
    metPreconditions: Object.freeze([]),
    missingPreconditions: Object.freeze([]),
    pendingDependencies: Object.freeze([]),
  }),
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('NutritionConversationShadowPipelineService', () => {
  it('executes the complete pipeline in the approved order only in SHADOW', async () => {
    const target = subject();
    expect(target.service.execute(input)).toBeUndefined();
    await flush();

    expect(target.contextBuilder.build).toHaveBeenCalledWith(conversation);
    expect(target.decisionEngine.generate).toHaveBeenCalledWith(target.context);
    expect(target.scoringPolicy.select).toHaveBeenCalledWith(
      target.context,
      target.candidates,
    );
    expect(target.composer.compose).toHaveBeenCalledWith(
      target.context,
      target.decisionPlan,
    );
    expect(target.authorizedFactsBuilder.build).toHaveBeenCalledWith(
      target.context,
    );
    expect(target.sanitizedPayloadBuilder.build).toHaveBeenCalledWith({
      context: target.context,
      authorizedFacts: target.authorizedFacts,
      decisionPlan: target.decisionPlan,
      compositionPlan: target.compositionPlan,
    });
    expect(target.realizationExecutor.execute).toHaveBeenCalledWith({
      ...input.operation,
      payload: target.sanitizedPayload,
    });
    expect(target.adapter.adapt).toHaveBeenCalledWith(
      'legacy',
      expect.objectContaining({ status: 'COMPLETED' }),
    );
    expect(target.comparator.compare).toHaveBeenCalledWith(
      expect.objectContaining({ payload: target.sanitizedPayload }),
    );
    expect(target.candidateSelector.select).toHaveBeenCalledWith(
      expect.objectContaining({
        officialResponse: 'legacy',
        candidate: expect.objectContaining({ status: 'COMPLETED' }),
        comparison: expect.objectContaining({ candidateEligible: true }),
        metadata: expect.objectContaining({
          rolloutMode: 'OFF',
          formatterVersion: 'nutrition-response-formatter:v1',
          promptVersionId: 'prompt-version-id',
          candidateJobId: 'candidate-job-id',
        }),
      }),
    );
    expect(target.selectionAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        decisionReference: 'candidate-job-id',
        decision: target.selectionDecision,
      }),
    );
    const calls = [
      target.contextBuilder.build,
      target.decisionEngine.generate,
      target.scoringPolicy.select,
      target.composer.compose,
      target.authorizedFactsBuilder.build,
      target.sanitizedPayloadBuilder.build,
      target.realizationExecutor.execute,
    ].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(calls).toEqual([...calls].sort((left, right) => left - right));
  });

  it('bridges supplied reasoning before realization without changing official selection', async () => {
    const target = subject();
    target.service.execute({ ...input, reasoning });
    await flush();

    expect(target.realizationExecutor.execute).toHaveBeenCalledWith({
      ...input.operation,
      payload: target.sanitizedPayload,
      reasoningEvidence: expect.objectContaining({
        summary: expect.objectContaining({
          goal: 'criar planos de alimentação e treino',
        }),
      }),
    });
    expect(target.candidateSelector.select).toHaveBeenCalledWith(
      expect.objectContaining({ officialResponse: 'legacy' }),
    );
    expect(target.selectionDecision.selectedSource).toBe('FORMATTER');
  });

  it('returns the selected Candidate from the reusable official boundary', async () => {
    const target = subject();
    target.operationalConfig.get.mockReturnValue({ effectiveMode: 'INTERNAL' });
    target.selectionConfig.get.mockReturnValue({
      effectiveMode: 'INTERNAL',
      formatterVersion: 'nutrition-response-formatter:v1',
    });
    target.candidateSelector.select.mockReturnValue({
      ...target.selectionDecision,
      selectedSource: 'CANDIDATE',
      reason: 'CANDIDATE_PROMOTED',
      selectionStatus: 'CANDIDATE_SELECTED',
      rolloutMode: 'INTERNAL',
    });

    await expect(target.service.selectOfficial(input)).resolves.toEqual({
      content: 'candidate',
      selectedSource: 'CANDIDATE',
      candidateExecutionAttempted: true,
    });
    expect(target.realizationExecutor.execute).toHaveBeenCalledTimes(1);
    expect(target.selectionAudit.record).toHaveBeenCalledTimes(1);
  });

  it('fails closed before realization and selection for a non-allowlisted INTERNAL user', async () => {
    const target = subject();
    target.operationalConfig.get.mockReturnValue({ effectiveMode: 'INTERNAL' });
    target.selectionConfig.get.mockReturnValue({
      effectiveMode: 'INTERNAL',
      formatterVersion: 'nutrition-response-formatter:v1',
    });
    target.internalEligibility.isEligible.mockReturnValue(false);

    await expect(target.service.selectOfficial(input)).resolves.toEqual({
      content: 'legacy',
      selectedSource: 'FORMATTER',
      candidateExecutionAttempted: false,
    });
    expect(target.internalEligibility.isEligible).toHaveBeenCalledWith(
      'user-id',
    );
    expect(target.realizationExecutor.execute).not.toHaveBeenCalled();
    expect(target.candidateSelector.select).not.toHaveBeenCalled();
  });

  it('allows an allowlisted INTERNAL user to reach the normal selection flow', async () => {
    const target = subject();
    target.operationalConfig.get.mockReturnValue({ effectiveMode: 'INTERNAL' });
    target.selectionConfig.get.mockReturnValue({
      effectiveMode: 'INTERNAL',
      formatterVersion: 'nutrition-response-formatter:v1',
    });

    await expect(target.service.selectOfficial(input)).resolves.toMatchObject({
      candidateExecutionAttempted: true,
    });
    expect(target.realizationExecutor.execute).toHaveBeenCalledTimes(1);
    expect(target.candidateSelector.select).toHaveBeenCalledTimes(1);
  });

  it('reports INTERNAL official selection eligibility per user', () => {
    const target = subject();
    target.operationalConfig.get.mockReturnValue({ effectiveMode: 'INTERNAL' });
    target.selectionConfig.get.mockReturnValue({
      effectiveMode: 'INTERNAL',
      formatterVersion: 'nutrition-response-formatter:v1',
    });
    target.internalEligibility.isEligible.mockImplementation(
      (userId: string) => userId === 'allowed-user',
    );

    expect(target.service.isOfficialSelectionEnabled('blocked-user')).toBe(
      false,
    );
    expect(target.service.isOfficialSelectionEnabled('allowed-user')).toBe(
      true,
    );
  });

  it.each([
    ['INTERNAL', 'CANARY'],
    ['CANARY', 'INTERNAL'],
  ] as const)(
    'requires allowlist eligibility when layer=%s and selection=%s',
    (layerMode, selectionMode) => {
      const target = subject();
      target.operationalConfig.get.mockReturnValue({
        effectiveMode: layerMode,
      });
      target.selectionConfig.get.mockReturnValue({
        effectiveMode: selectionMode,
        formatterVersion: 'nutrition-response-formatter:v1',
      });
      target.internalEligibility.isEligible.mockReturnValue(false);

      expect(target.service.isOfficialSelectionEnabled('user-id')).toBe(false);
      expect(target.internalEligibility.isEligible).toHaveBeenCalledWith(
        'user-id',
      );
    },
  );

  it('returns Formatter without retry after an official Realizer failure', async () => {
    const target = subject();
    target.operationalConfig.get.mockReturnValue({ effectiveMode: 'INTERNAL' });
    target.selectionConfig.get.mockReturnValue({
      effectiveMode: 'INTERNAL',
      formatterVersion: 'nutrition-response-formatter:v1',
    });
    target.realizationExecutor.execute.mockRejectedValue(
      new Error('realizer failure'),
    );

    await expect(target.service.selectOfficial(input)).resolves.toEqual({
      content: 'legacy',
      selectedSource: 'FORMATTER',
      candidateExecutionAttempted: true,
    });
    expect(target.realizationExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it.each(['OFF', 'SHADOW'] as const)(
    'keeps official selection on Formatter in %s mode',
    async (mode) => {
      const target = subject(mode);
      target.selectionConfig.get.mockReturnValue({
        effectiveMode: 'INTERNAL',
        formatterVersion: 'nutrition-response-formatter:v1',
      });

      await expect(target.service.selectOfficial(input)).resolves.toEqual({
        content: 'legacy',
        selectedSource: 'FORMATTER',
        candidateExecutionAttempted: false,
      });
      expect(target.realizationExecutor.execute).not.toHaveBeenCalled();
    },
  );

  it.each(['OFF', 'SHADOW'] as const)(
    'keeps isOfficialSelectionEnabled false in %s regardless of allowlist',
    (mode) => {
      const target = subject(mode);
      target.selectionConfig.get.mockReturnValue({
        effectiveMode: 'INTERNAL',
        formatterVersion: 'nutrition-response-formatter:v1',
      });

      expect(target.service.isOfficialSelectionEnabled('user-id')).toBe(false);
      expect(target.internalEligibility.isEligible).not.toHaveBeenCalled();
    },
  );

  it('keeps selection OFF disabled regardless of allowlist', () => {
    const target = subject();
    target.operationalConfig.get.mockReturnValue({ effectiveMode: 'CANARY' });

    expect(target.service.isOfficialSelectionEnabled('user-id')).toBe(false);
    expect(target.internalEligibility.isEligible).not.toHaveBeenCalled();
  });

  it.each(['OFF', 'INTERNAL', 'CANARY', 'ROLLOUT', 'PRIMARY'] as const)(
    'does nothing in %s mode',
    (mode) => {
      const target = subject('OFF');
      target.operationalConfig.get.mockReturnValue({ effectiveMode: mode });
      target.service.execute(input);

      expect(target.contextBuilder.build).not.toHaveBeenCalled();
      expect(target.realizationExecutor.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Context', 'contextBuilder', 'build'],
    ['Engine', 'decisionEngine', 'generate'],
    ['Policy', 'scoringPolicy', 'select'],
    ['Composer', 'composer', 'compose'],
    ['AuthorizedFacts', 'authorizedFactsBuilder', 'build'],
    ['Payload', 'sanitizedPayloadBuilder', 'build'],
    ['Selection config', 'selectionConfig', 'get'],
    ['Candidate selector', 'candidateSelector', 'select'],
  ] as const)(
    'isolates a synchronous %s failure',
    async (_label, dependency) => {
      const target = subject();
      const failure = () => {
        throw new Error('shadow failure');
      };
      switch (dependency) {
        case 'contextBuilder':
          target.contextBuilder.build.mockImplementation(failure);
          break;
        case 'decisionEngine':
          target.decisionEngine.generate.mockImplementation(failure);
          break;
        case 'scoringPolicy':
          target.scoringPolicy.select.mockImplementation(failure);
          break;
        case 'composer':
          target.composer.compose.mockImplementation(failure);
          break;
        case 'authorizedFactsBuilder':
          target.authorizedFactsBuilder.build.mockImplementation(failure);
          break;
        case 'sanitizedPayloadBuilder':
          target.sanitizedPayloadBuilder.build.mockImplementation(failure);
          break;
        case 'selectionConfig':
          target.selectionConfig.get.mockImplementation(failure);
          break;
        case 'candidateSelector':
          target.candidateSelector.select.mockImplementation(failure);
          break;
      }

      expect(target.service.execute(input)).toBeUndefined();
      await flush();
    },
  );

  it('isolates an asynchronous Realizer failure', async () => {
    const target = subject();
    target.realizationExecutor.execute.mockRejectedValue(
      new Error('realizer failure'),
    );

    expect(target.service.execute(input)).toBeUndefined();
    await flush();
  });

  it('discards the LanguageRealizationResult deterministically', async () => {
    const first = subject();
    const second = subject();

    first.service.execute(input);
    second.service.execute(input);
    await flush();
    expect(first.realizationExecutor.execute.mock.calls).toEqual(
      second.realizationExecutor.execute.mock.calls,
    );
  });

  it('records sanitized block-scope violation details', async () => {
    const target = subject();
    target.realizationExecutor.execute.mockResolvedValueOnce({
      status: 'INVALID_STRUCTURE',
      candidateText: null,
      sanitizedPayloadReference: 'payload-reference',
      failureCode: 'UNIT_VALIDATION:FACT_NOT_LINKED_TO_BLOCK',
      violationDetails: [
        {
          code: 'FACT_NOT_LINKED_TO_BLOCK',
          blockKey: 'block-1-primary-observation',
          factKey: 'facts.totalFat',
        },
      ],
      operationalMetadata: {
        aiJobId: 'candidate-job-id',
        promptVersionId: 'prompt-version-id',
      },
    });

    target.service.execute(input);
    await flush();

    expect(target.diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'COMPLETED',
        realizerFailureCode: 'UNIT_VALIDATION:FACT_NOT_LINKED_TO_BLOCK',
        violationDetails: [
          {
            code: 'FACT_NOT_LINKED_TO_BLOCK',
            blockKey: 'block-1-primary-observation',
            factKey: 'facts.totalFat',
          },
        ],
      }),
    );
  });

  it('skips deterministically when the process concurrency limit is reached', async () => {
    const target = subject();
    target.realizationExecutor.execute.mockReturnValue(
      new Promise(() => undefined),
    );

    target.service.execute(input);
    target.service.execute(input);
    target.service.execute(input);
    await flush();

    expect(target.realizationExecutor.execute).toHaveBeenCalledTimes(2);
    expect(target.diagnostics.record).toHaveBeenCalledWith({
      event: 'SKIPPED_CONCURRENCY',
    });
  });

  it('absorbs comparator and diagnostics failures', async () => {
    const target = subject();
    target.comparator.compare.mockImplementation(() => {
      throw new Error('comparison failure');
    });
    target.diagnostics.record.mockImplementation(() => {
      throw new Error('diagnostic failure');
    });

    expect(target.service.execute(input)).toBeUndefined();
    await flush();
  });

  it('isolates selection audit persistence failure and still completes Shadow', async () => {
    const target = subject();
    target.selectionAudit.record.mockRejectedValue(
      new Error('audit persistence failure'),
    );

    expect(target.service.execute(input)).toBeUndefined();
    await flush();

    expect(target.diagnostics.record).toHaveBeenCalledWith({
      event: 'FAILED',
      component: 'SELECTION_AUDIT',
    });
    expect(target.diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'COMPLETED',
        selectedSource: 'FORMATTER',
        selectionAuditPersisted: false,
      }),
    );
  });

  it('does not start new work after application shutdown', () => {
    const target = subject();
    target.service.onApplicationShutdown();
    target.service.execute(input);

    expect(target.contextBuilder.build).not.toHaveBeenCalled();
  });

  it('applies a total timeout without releasing the active slot early', async () => {
    jest.useFakeTimers();
    const target = subject();
    target.realizationExecutor.execute.mockReturnValue(
      new Promise(() => undefined),
    );

    target.service.execute(input);
    await flush();
    await jest.advanceTimersByTimeAsync(25_000);

    expect(target.diagnostics.record).toHaveBeenCalledWith({
      event: 'TIMEOUT',
      component: 'SHADOW_PIPELINE',
      latencyMs: 25_000,
    });
    target.service.execute(input);
    target.service.execute(input);
    expect(target.diagnostics.record).toHaveBeenCalledWith({
      event: 'SKIPPED_CONCURRENCY',
    });
    jest.useRealTimers();
  });

  it('contains no direct persistence, outbound, event or production response dependency', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-conversation-shadow-pipeline.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(
      /Prisma|outbound|EventBus|Outbox|Evolution|MediaService|Worker|NutritionResponseFormatter|AIJob|PromptVersion|publish/,
    );
    expect(source).not.toMatch(/TODO|FIXME|console\.log/);
  });
});
