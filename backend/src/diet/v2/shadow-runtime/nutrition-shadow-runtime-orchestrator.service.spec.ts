import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NutritionShadowOutputKind,
  NutritionShadowRuntimeDecisionType,
} from '@prisma/client';
import type { CoachProfileSnapshot } from '../../../context/coach-profile-snapshot.contract';
import type { ConversationGoalDecision } from '../../../context/conversation-goal-planner.contract';
import type { NutritionComparisonResult } from '../shadow-comparison/nutrition-shadow-comparison.contract';
import type { NutritionShadowComparatorService } from '../shadow-comparison/nutrition-shadow-comparator.service';
import type { NutritionShadowExecutionResult } from '../shadow/nutrition-shadow.contract';
import type { NutritionShadowRunnerService } from '../shadow/nutrition-shadow-runner.service';
import type { NutritionShadowExecutionPolicy } from './nutrition-shadow-execution.policy';
import type { NutritionShadowRuntimeDecisionRepository } from './nutrition-shadow-runtime-decision.repository';
import type { NutritionShadowRuntimeInput } from './nutrition-shadow-runtime.contract';
import { NutritionShadowRuntimeOrchestratorService } from './nutrition-shadow-runtime-orchestrator.service';
import type { NutritionShadowRuntimeResultReader } from './nutrition-shadow-runtime-result.reader';

describe(NutritionShadowRuntimeOrchestratorService.name, () => {
  const known = <T>(value: T) =>
    Object.freeze({
      status: 'KNOWN' as const,
      value,
      sources: Object.freeze([]),
    });
  const unknown = Object.freeze({
    status: 'UNKNOWN' as const,
    sources: Object.freeze([]),
  });
  const decision = Object.freeze({
    recognizedIntent: 'GENERAL_GUIDANCE_REQUEST',
    goal: 'GENERAL_GUIDANCE',
    reason: 'GENERAL_GUIDANCE_REQUESTED',
    targetPlan: 'DIET',
    profileCompletionState: 'COMPLETE',
    canExecute: true,
    confidence: 'HIGH',
    selectedProfileField: null,
    metPreconditions: Object.freeze([]),
    missingPreconditions: Object.freeze([]),
    pendingDependencies: Object.freeze([]),
  }) satisfies ConversationGoalDecision;
  const snapshot = Object.freeze({
    identity: Object.freeze({ userId: known('user-id') }),
    nutrition: Object.freeze({
      primaryGoal: known('WEIGHT_LOSS'),
      desiredOutcome: known('reduzir gordura'),
      dietaryPattern: known('vegetariano'),
      cookingAvailability: known('noturna'),
      hydration: known('adequada'),
      declaredFoodRejections: known(Object.freeze(['amendoim'])),
      foodIntolerances: unknown,
    }),
    restrictions: Object.freeze({
      foodRestrictions: known(Object.freeze([])),
      allergies: known(Object.freeze([])),
    }),
  }) as unknown as CoachProfileSnapshot;

  function input(): NutritionShadowRuntimeInput {
    return {
      source: {
        userId: 'user-id',
        decision,
        snapshot,
        referenceDate: new Date('2026-07-29T12:00:00.000Z'),
      },
      expectedArtifactType: 'POINT_GUIDANCE',
      legacy: {
        conversationId: 'conversation-id',
        messageId: 'message-id',
        response: 'orientação nutricional oficial',
        responseType: 'DIET',
        durationMs: 25,
        provider: null,
        model: null,
        totalTokens: null,
        estimatedCostUsd: null,
        attempts: 1,
        parserSucceeded: true,
        validationSucceeded: true,
      },
      correlationId: 'message-id',
    };
  }

  function setup(options?: {
    readonly enabled?: boolean;
    readonly disabledReason?: 'DISABLED' | 'NON_NUTRITION_GOAL';
    readonly policyError?: Error;
    readonly shadowResult?: NutritionShadowExecutionResult;
  }) {
    const policy = {
      evaluate: jest.fn(() => {
        if (options?.policyError) throw options.policyError;
        return options?.enabled === false
          ? ({
              enabled: false,
              reason: options.disabledReason ?? 'DISABLED',
            } as const)
          : ({ enabled: true } as const);
      }),
    };
    const runner = {
      executeSafely: jest.fn<
        ReturnType<NutritionShadowRunnerService['executeSafely']>,
        Parameters<NutritionShadowRunnerService['executeSafely']>
      >(() =>
        Promise.resolve(
          options?.shadowResult ?? {
            status: 'SUCCEEDED',
            shadowRunId: 'shadow-run-id',
            artifactType: 'POINT_GUIDANCE',
            kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
            documentHash: 'shadow-hash',
            durationMs: 20,
            reused: false,
          },
        ),
      ),
    };
    const reader = {
      findSucceeded: jest.fn<
        ReturnType<NutritionShadowRuntimeResultReader['findSucceeded']>,
        Parameters<NutritionShadowRuntimeResultReader['findSucceeded']>
      >(() =>
        Promise.resolve({
          shadowRunId: 'shadow-run-id',
          conversationGoal: 'GENERAL_GUIDANCE',
          artifactType: 'POINT_GUIDANCE',
          kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
          document: {
            artifact: {
              guidance: {
                text: 'WEIGHT_LOSS reduzir gordura vegetariano noturna adequada',
              },
            },
          },
          documentHash: 'shadow-hash',
          durationMs: 20,
          provider: 'OPENAI',
          model: 'gpt-model',
          totalTokens: 10,
          estimatedCostUsd: '0.00100000',
          attempts: 1,
          parserSucceeded: true,
          validationSucceeded: true,
        }),
      ),
    };
    const comparison: NutritionComparisonResult = {
      comparisonId: 'comparison-id',
      conversationId: 'conversation-id',
      shadowRunId: 'shadow-run-id',
      equivalent: false,
      structuralScore: 100,
      semanticScore: 80,
      operationalScore: 100,
      overallScore: 93,
      divergences: [],
      metrics: {
        timeRatio: '0.80000000',
        tokenRatio: null,
        costRatio: null,
        contentOverlap: 0.8,
      },
      reused: false,
    };
    const comparator = {
      compare: jest.fn<
        ReturnType<NutritionShadowComparatorService['compare']>,
        Parameters<NutritionShadowComparatorService['compare']>
      >(() => Promise.resolve(comparison)),
    };
    const decisions = {
      claim: jest.fn<
        ReturnType<NutritionShadowRuntimeDecisionRepository['claim']>,
        Parameters<NutritionShadowRuntimeDecisionRepository['claim']>
      >((claimInput) =>
        Promise.resolve({
          kind: 'OWNERSHIP_CREATED' as const,
          decision: {
            id: claimInput.id,
            inputFingerprint: claimInput.inputFingerprint,
            conversationGoal: claimInput.conversationGoal,
            decision: NutritionShadowRuntimeDecisionType.PENDING,
            skipReason: null,
            shadowRunId: null,
            ownershipClaimedAt: new Date('2026-07-29T12:00:00.000Z'),
            ownershipExpiresAt: new Date('2026-07-29T12:02:00.000Z'),
          },
          ownership: {
            token: claimInput.ownershipToken,
            claimedAt: new Date('2026-07-29T12:00:00.000Z'),
            expiresAt: new Date('2026-07-29T12:02:00.000Z'),
          },
        }),
      ),
      completeStarted: jest.fn(() => Promise.resolve()),
      completeSkipped: jest.fn(() => Promise.resolve()),
    };
    const service = new NutritionShadowRuntimeOrchestratorService(
      policy as unknown as NutritionShadowExecutionPolicy,
      runner as unknown as NutritionShadowRunnerService,
      comparator as unknown as NutritionShadowComparatorService,
      reader,
      decisions as unknown as NutritionShadowRuntimeDecisionRepository,
    );
    return { service, policy, runner, reader, comparator, decisions };
  }

  it('starts asynchronously and compares only after Shadow completion', async () => {
    const subject = setup();
    const runtimeInput = input();

    expect(subject.service.execute(runtimeInput)).toEqual({
      status: 'STARTED',
      runtimeDecisionId: expect.any(String),
    });
    expect(subject.runner.executeSafely).not.toHaveBeenCalled();

    await subject.service.onApplicationShutdown();

    expect(subject.runner.executeSafely.mock.calls[0][0]).toEqual({
      source: runtimeInput.source,
      correlationId: 'message-id',
      traceId: undefined,
      conversationId: 'conversation-id',
      messageId: 'message-id',
    });
    expect(subject.reader.findSucceeded.mock.calls[0][0]).toBe('shadow-run-id');
    expect(subject.comparator.compare.mock.calls[0][0]).toMatchObject({
      legacy: runtimeInput.legacy,
      expectation: {
        artifactType: 'POINT_GUIDANCE',
        kind: NutritionShadowOutputKind.CONVERSATIONAL_ARTIFACT,
        conversationGoal: 'GENERAL_GUIDANCE',
        objectiveTerms: ['WEIGHT_LOSS', 'reduzir gordura'],
        focusTerms: ['vegetariano'],
        contextTerms: ['noturna', 'adequada'],
        forbiddenRestrictionTerms: ['amendoim'],
      },
    });
    expect(
      subject.runner.executeSafely.mock.invocationCallOrder[0],
    ).toBeLessThan(subject.reader.findSucceeded.mock.invocationCallOrder[0]);
    expect(
      subject.reader.findSucceeded.mock.invocationCallOrder[0],
    ).toBeLessThan(subject.comparator.compare.mock.invocationCallOrder[0]);
    expect(subject.decisions.completeStarted).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'shadow-run-id',
    );
  });

  it('does not execute when another process still owns the pending decision', async () => {
    const subject = setup();
    subject.decisions.claim.mockResolvedValueOnce({
      kind: 'OWNERSHIP_ACTIVE',
      decision: {
        id: 'runtime-decision-id',
        inputFingerprint: 'fingerprint',
        conversationGoal: 'GENERAL_GUIDANCE',
        decision: NutritionShadowRuntimeDecisionType.PENDING,
        skipReason: null,
        shadowRunId: null,
        ownershipClaimedAt: new Date('2026-07-29T12:00:00.000Z'),
        ownershipExpiresAt: new Date('2026-07-29T12:02:00.000Z'),
      },
      ownershipClaimedAt: new Date('2026-07-29T12:00:00.000Z'),
      ownershipExpiresAt: new Date('2026-07-29T12:02:00.000Z'),
    });

    subject.service.execute(input());
    await subject.service.onApplicationShutdown();

    expect(subject.runner.executeSafely).not.toHaveBeenCalled();
    expect(subject.decisions.completeStarted).not.toHaveBeenCalled();
    expect(subject.decisions.completeSkipped).not.toHaveBeenCalled();
  });

  it('continues execution with the token returned by an expired ownership reclaim', async () => {
    const subject = setup();
    subject.decisions.claim.mockResolvedValueOnce({
      kind: 'OWNERSHIP_RECOVERED',
      decision: {
        id: 'runtime-decision-id',
        inputFingerprint: 'fingerprint',
        conversationGoal: 'GENERAL_GUIDANCE',
        decision: NutritionShadowRuntimeDecisionType.PENDING,
        skipReason: null,
        shadowRunId: null,
        ownershipClaimedAt: new Date('2026-07-29T12:03:00.000Z'),
        ownershipExpiresAt: new Date('2026-07-29T12:05:00.000Z'),
      },
      ownership: {
        token: 'recovered-ownership-token',
        claimedAt: new Date('2026-07-29T12:03:00.000Z'),
        expiresAt: new Date('2026-07-29T12:05:00.000Z'),
      },
      previousOwnershipExpiresAt: new Date('2026-07-29T12:02:00.000Z'),
    });

    subject.service.execute(input());
    await subject.service.onApplicationShutdown();

    expect(subject.runner.executeSafely).toHaveBeenCalledTimes(1);
    expect(subject.decisions.completeStarted).toHaveBeenCalledWith(
      expect.any(String),
      'recovered-ownership-token',
      'shadow-run-id',
    );
  });

  it.each([
    NutritionShadowRuntimeDecisionType.STARTED,
    NutritionShadowRuntimeDecisionType.SKIPPED,
  ])('never reexecutes a terminal %s decision', async (terminalDecision) => {
    const subject = setup();
    subject.decisions.claim.mockResolvedValueOnce({
      kind: 'TERMINAL_REUSED',
      decision: {
        id: 'runtime-decision-id',
        inputFingerprint: 'fingerprint',
        conversationGoal: 'GENERAL_GUIDANCE',
        decision: terminalDecision,
        skipReason:
          terminalDecision === NutritionShadowRuntimeDecisionType.SKIPPED
            ? 'DISABLED_BY_POLICY'
            : null,
        shadowRunId:
          terminalDecision === NutritionShadowRuntimeDecisionType.STARTED
            ? 'shadow-run-id'
            : null,
        ownershipClaimedAt: null,
        ownershipExpiresAt: null,
      },
    });

    subject.service.execute(input());
    await subject.service.onApplicationShutdown();

    expect(subject.runner.executeSafely).not.toHaveBeenCalled();
    expect(subject.decisions.completeStarted).not.toHaveBeenCalled();
    expect(subject.decisions.completeSkipped).not.toHaveBeenCalled();
  });

  it('is disabled by default policy and never starts Shadow', async () => {
    const subject = setup({ enabled: false });

    expect(subject.service.execute(input())).toEqual({
      status: 'SKIPPED',
      reason: 'DISABLED_BY_POLICY',
      runtimeDecisionId: expect.any(String),
    });
    await subject.service.onApplicationShutdown();
    expect(subject.runner.executeSafely).not.toHaveBeenCalled();
    expect(subject.decisions.completeSkipped).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'DISABLED_BY_POLICY',
    );
  });

  it('persists a non-nutrition goal as an explicit skip', async () => {
    const subject = setup({
      enabled: false,
      disabledReason: 'NON_NUTRITION_GOAL',
    });

    expect(subject.service.execute(input())).toMatchObject({
      status: 'SKIPPED',
      reason: 'NON_NUTRITION_GOAL',
    });
    await subject.service.onApplicationShutdown();
    expect(subject.decisions.completeSkipped).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'NON_NUTRITION_GOAL',
    );
    expect(subject.runner.executeSafely).not.toHaveBeenCalled();
  });

  it.each([
    {
      status: 'FAILED',
      shadowRunId: 'shadow-run-id',
      errorCategory: 'PROVIDER_ERROR',
      durationMs: 10,
    },
    {
      status: 'SKIPPED',
      reason: 'SHADOW_STORAGE_UNAVAILABLE',
      operationKey: 'operation-key',
    },
  ] as const)(
    'isolates Shadow result $status and does not compare',
    async (shadowResult) => {
      const subject = setup({ shadowResult });

      expect(subject.service.execute(input())).toEqual({
        status: 'STARTED',
        runtimeDecisionId: expect.any(String),
      });
      await subject.service.onApplicationShutdown();
      expect(subject.reader.findSucceeded).not.toHaveBeenCalled();
      expect(subject.comparator.compare).not.toHaveBeenCalled();
      if (shadowResult.status === 'FAILED')
        expect(subject.decisions.completeStarted).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          'shadow-run-id',
        );
      else
        expect(subject.decisions.completeSkipped).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          'STORAGE_UNAVAILABLE',
        );
    },
  );

  it('isolates result storage, comparator and comparison persistence failures', async () => {
    const readerFailure = setup();
    readerFailure.reader.findSucceeded.mockRejectedValueOnce(
      new Error('shadow storage unavailable'),
    );
    expect(readerFailure.service.execute(input())).toEqual({
      status: 'STARTED',
      runtimeDecisionId: expect.any(String),
    });
    await expect(
      readerFailure.service.onApplicationShutdown(),
    ).resolves.toBeUndefined();

    const comparatorFailure = setup();
    comparatorFailure.comparator.compare.mockRejectedValueOnce(
      new Error('comparison persistence unavailable'),
    );
    expect(comparatorFailure.service.execute(input())).toEqual({
      status: 'STARTED',
      runtimeDecisionId: expect.any(String),
    });
    await expect(
      comparatorFailure.service.onApplicationShutdown(),
    ).resolves.toBeUndefined();
  });

  it('ignores comparison when the existing Builder cannot resolve artifact granularity', async () => {
    const subject = setup();
    const runtimeInput = { ...input(), expectedArtifactType: null };

    expect(subject.service.execute(runtimeInput)).toEqual({
      status: 'STARTED',
      runtimeDecisionId: expect.any(String),
    });
    await subject.service.onApplicationShutdown();
    expect(subject.runner.executeSafely).toHaveBeenCalledTimes(1);
    expect(subject.reader.findSucceeded).not.toHaveBeenCalled();
    expect(subject.comparator.compare).not.toHaveBeenCalled();
  });

  it('rejects new work during shutdown without propagating errors', async () => {
    const subject = setup();
    await subject.service.onApplicationShutdown();

    expect(subject.service.execute(input())).toEqual({
      status: 'SKIPPED',
      reason: 'SHUTTING_DOWN',
      runtimeDecisionId: expect.any(String),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(subject.decisions.completeSkipped).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'SHUTTING_DOWN',
    );
  });

  it('persists policy errors and invalid context as explicit skips', async () => {
    const policyFailure = setup({
      policyError: new Error('config unavailable'),
    });
    expect(policyFailure.service.execute(input())).toMatchObject({
      status: 'SKIPPED',
      reason: 'POLICY_EVALUATION_ERROR',
    });
    await policyFailure.service.onApplicationShutdown();
    expect(policyFailure.decisions.completeSkipped).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'POLICY_EVALUATION_ERROR',
    );

    const invalid = setup();
    expect(
      invalid.service.execute({ ...input(), correlationId: ' ' }),
    ).toMatchObject({
      status: 'SKIPPED',
      reason: 'MISSING_REQUIRED_CONTEXT',
    });
    await invalid.service.onApplicationShutdown();
    expect(invalid.runner.executeSafely).not.toHaveBeenCalled();
  });

  it('does not start generation when decision evidence cannot be claimed', async () => {
    const subject = setup();
    subject.decisions.claim.mockRejectedValueOnce(
      new Error('decision storage unavailable'),
    );

    expect(subject.service.execute(input())).toMatchObject({
      status: 'STARTED',
    });
    await subject.service.onApplicationShutdown();
    expect(subject.runner.executeSafely).not.toHaveBeenCalled();
  });

  it('does not compare a run whose persisted goal differs from the original goal', async () => {
    const subject = setup();
    subject.reader.findSucceeded.mockResolvedValueOnce({
      ...(await subject.reader.findSucceeded('fixture'))!,
      conversationGoal: 'GENERATE_DIET_PLAN',
    });
    subject.reader.findSucceeded.mockClear();

    subject.service.execute(input());
    await subject.service.onApplicationShutdown();
    expect(subject.comparator.compare).not.toHaveBeenCalled();
  });

  it('persists attempts rejected by the runtime concurrency limit', async () => {
    const subject = setup();
    let release!: (result: NutritionShadowExecutionResult) => void;
    const blocked = new Promise<NutritionShadowExecutionResult>((resolve) => {
      release = resolve;
    });
    subject.runner.executeSafely.mockImplementation(() => blocked);

    subject.service.execute(input());
    subject.service.execute({
      ...input(),
      legacy: { ...input().legacy, messageId: 'message-id-2' },
      correlationId: 'message-id-2',
    });
    expect(
      subject.service.execute({
        ...input(),
        legacy: { ...input().legacy, messageId: 'message-id-3' },
        correlationId: 'message-id-3',
      }),
    ).toMatchObject({
      status: 'SKIPPED',
      reason: 'CONCURRENCY_LIMIT',
    });

    release({
      status: 'FAILED',
      shadowRunId: 'shadow-run-id',
      errorCategory: 'PROVIDER_ERROR',
      durationMs: 10,
    });
    await subject.service.onApplicationShutdown();
    expect(subject.decisions.completeSkipped).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'CONCURRENCY_LIMIT',
    );
  });

  it('has no official persistence, executor, formatter or outbound dependency', () => {
    const source = readFileSync(
      join(__dirname, 'nutrition-shadow-runtime-orchestrator.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /NutritionApplicationExecutor|NutritionPlanV2Persistence|NutritionConversationalArtifactPersistence|DietGeneratorService|NutritionResponseFormatter|AIService|Evolution|PagBank|WhatsApp|EventBus/,
    );
  });
});
