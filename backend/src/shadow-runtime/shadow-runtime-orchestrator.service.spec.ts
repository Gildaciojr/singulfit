import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONVERSATION_LAYER_MODE,
  ConversationLayerMode,
} from '../responses/conversation-layer-operational-config.service';
import type { ShadowObservationEmitter } from '../shadow-evaluation/shadow-observation-emitter';
import type {
  UnifiedShadowDecisionPipelineInput,
  UnifiedShadowDecisionPipelineResult,
  UnifiedShadowExecutionArtifacts,
} from '../unified-shadow-decision/unified-shadow-decision.contract';
import type { UnifiedShadowDecisionPipelineService } from '../unified-shadow-decision/unified-shadow-decision-pipeline.service';
import type { ShadowRuntimeOrchestratorInput } from './shadow-runtime-orchestrator.contract';
import { ShadowRuntimeOrchestrator } from './shadow-runtime-orchestrator.service';

describe('ShadowRuntimeOrchestrator', () => {
  function fixture<T>(value: unknown): T {
    return value as T;
  }

  const artifacts = fixture<UnifiedShadowExecutionArtifacts>({
    adaptiveDecision: { shouldAsk: false },
    plannerDecision: { goal: 'DIRECT_RESPONSE' },
    longitudinalDecision: { decision: 'KEEP_PLAN' },
    nutritionReasoning: null,
    workoutReasoning: null,
    nutritionLegacyStrategy: null,
    workoutLegacyStrategy: null,
    nutritionShadowStrategy: null,
    workoutShadowStrategy: null,
  });

  const completedResult = fixture<UnifiedShadowDecisionPipelineResult>({
    status: 'COMPLETED',
    artifacts,
    comparison: { overallCategory: 'EXACT_MATCH' },
    auditMetadata: { versions: {}, latency: {} },
    auditPersisted: false,
  });

  function input(runId = 'shadow-run-1'): ShadowRuntimeOrchestratorInput {
    return fixture<ShadowRuntimeOrchestratorInput>({
      runId,
      pipelineInput: {
        operation: { userId: 'internal-user', auditEntityId: 'internal-audit' },
        snapshot: { referenceDate: '2026-07-17T12:00:00.000Z' },
        collector: {},
        planner: {},
        longitudinal: {},
        nutrition: null,
        workout: null,
        legacyLongitudinalDecision: 'KEEP_PLAN',
      },
    });
  }

  function createSubject(options?: {
    readonly mode?: ConversationLayerMode;
    readonly killSwitchEnabled?: boolean;
    readonly pipelineResult?: UnifiedShadowDecisionPipelineResult;
    readonly emitterResult?: ReturnType<ShadowObservationEmitter['emit']>;
  }) {
    const mode = options?.mode ?? CONVERSATION_LAYER_MODE.SHADOW;
    const operationalConfig = {
      get: jest.fn(() => ({
        configuredMode: mode,
        effectiveMode: options?.killSwitchEnabled
          ? CONVERSATION_LAYER_MODE.OFF
          : mode,
        killSwitchEnabled: options?.killSwitchEnabled ?? false,
      })),
    };
    const pipeline = {
      execute: jest.fn<UnifiedShadowDecisionPipelineService['execute']>(() =>
        Promise.resolve(options?.pipelineResult ?? completedResult),
      ),
    };
    const emitter = {
      emit: jest.fn<ShadowObservationEmitter['emit']>(
        () => options?.emitterResult ?? Object.freeze({ status: 'SUCCESS' }),
      ),
    };

    return {
      service: new ShadowRuntimeOrchestrator(
        operationalConfig,
        pipeline,
        emitter,
      ),
      operationalConfig,
      pipeline,
      emitter,
    };
  }

  it('executes the pipeline and emitter exactly once only in SHADOW', async () => {
    const subject = createSubject();
    const runtimeInput = input();
    const before = JSON.stringify(runtimeInput);

    const result = await subject.service.execute(runtimeInput);

    expect(result).toEqual({
      status: 'SUCCESS',
      metadata: {
        orchestratorVersion: '2026.07.1',
        runId: runtimeInput.runId,
        configuredMode: 'SHADOW',
        effectiveMode: 'SHADOW',
        killSwitchEnabled: false,
        pipelineStatus: 'COMPLETED',
        pipelineFailureCode: null,
        emitterStatus: 'SUCCESS',
      },
    });
    expect(subject.pipeline.execute).toHaveBeenCalledTimes(1);
    expect(subject.pipeline.execute).toHaveBeenCalledWith(
      runtimeInput.pipelineInput,
    );
    expect(subject.emitter.emit).toHaveBeenCalledTimes(1);
    expect(subject.emitter.emit).toHaveBeenCalledWith({
      runId: runtimeInput.runId,
      snapshot: runtimeInput.pipelineInput.snapshot,
      artifacts,
      pipelineResult: completedResult,
    });
    const emitterInput = subject.emitter.emit.mock.calls[0][0];
    expect(emitterInput.artifacts).toBe(completedResult.artifacts);
    expect(emitterInput.pipelineResult).toBe(completedResult);
    expect(emitterInput.snapshot).toBe(runtimeInput.pipelineInput.snapshot);
    expect(JSON.stringify(runtimeInput)).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/artifacts|report|comparison/i);
  });

  it.each([
    CONVERSATION_LAYER_MODE.OFF,
    CONVERSATION_LAYER_MODE.INTERNAL,
    CONVERSATION_LAYER_MODE.CANARY,
    CONVERSATION_LAYER_MODE.ROLLOUT,
    CONVERSATION_LAYER_MODE.PRIMARY,
  ])('does not activate in %s mode', async (mode) => {
    const subject = createSubject({ mode });

    const result = await subject.service.execute(input());

    expect(result).toMatchObject({
      status: 'SKIPPED',
      stage: 'CONFIG',
      reasonCode: 'MODE_NOT_SHADOW',
      metadata: { effectiveMode: mode, pipelineStatus: 'NOT_EXECUTED' },
    });
    expect(subject.pipeline.execute).not.toHaveBeenCalled();
    expect(subject.emitter.emit).not.toHaveBeenCalled();
  });

  it('respects the kill switch before executing the pipeline', async () => {
    const subject = createSubject({
      mode: CONVERSATION_LAYER_MODE.PRIMARY,
      killSwitchEnabled: true,
    });

    await expect(subject.service.execute(input())).resolves.toMatchObject({
      status: 'SKIPPED',
      reasonCode: 'KILL_SWITCH_ENABLED',
      metadata: { effectiveMode: 'OFF', killSwitchEnabled: true },
    });
    expect(subject.pipeline.execute).not.toHaveBeenCalled();
  });

  it('skips invalid execution identity without invoking Shadow', async () => {
    const subject = createSubject();

    await expect(subject.service.execute(input('   '))).resolves.toMatchObject({
      status: 'SKIPPED',
      stage: 'VALIDATION',
      reasonCode: 'INVALID_RUN_ID',
      metadata: { runId: null },
    });
    expect(subject.pipeline.execute).not.toHaveBeenCalled();
  });

  it('classifies a pipeline SKIPPED result and never invokes the emitter', async () => {
    const subject = createSubject({
      pipelineResult: { status: 'SKIPPED', reason: 'MODE_NOT_SHADOW' },
    });

    await expect(subject.service.execute(input())).resolves.toMatchObject({
      status: 'SKIPPED',
      stage: 'PIPELINE',
      reasonCode: 'PIPELINE_SKIPPED',
      metadata: { pipelineStatus: 'SKIPPED' },
    });
    expect(subject.emitter.emit).not.toHaveBeenCalled();
  });

  it('classifies a pipeline FAILED result and preserves its structured code', async () => {
    const subject = createSubject({
      pipelineResult: fixture<UnifiedShadowDecisionPipelineResult>({
        status: 'FAILED',
        failure: {
          status: 'FAILED',
          failureCode: 'COMPARATOR_FAILED',
          pipelineVersion: '2026.07.1',
          totalMs: 1,
        },
        auditPersisted: false,
      }),
    });

    await expect(subject.service.execute(input())).resolves.toMatchObject({
      status: 'FAILED',
      stage: 'PIPELINE',
      reasonCode: 'PIPELINE_FAILED',
      metadata: {
        pipelineStatus: 'FAILED',
        pipelineFailureCode: 'COMPARATOR_FAILED',
      },
    });
    expect(subject.emitter.emit).not.toHaveBeenCalled();
  });

  it('isolates unexpected configuration and pipeline exceptions', async () => {
    const configFailure = createSubject();
    configFailure.operationalConfig.get.mockImplementation(() => {
      throw new Error('configuration unavailable');
    });
    await expect(configFailure.service.execute(input())).resolves.toMatchObject(
      {
        status: 'FAILED',
        stage: 'CONFIG',
        reasonCode: 'CONFIG_EXCEPTION',
      },
    );

    const pipelineFailure = createSubject();
    pipelineFailure.pipeline.execute.mockRejectedValue(
      new Error('pipeline unavailable'),
    );
    await expect(
      pipelineFailure.service.execute(input()),
    ).resolves.toMatchObject({
      status: 'FAILED',
      stage: 'PIPELINE',
      reasonCode: 'PIPELINE_EXCEPTION',
    });
    expect(pipelineFailure.emitter.emit).not.toHaveBeenCalled();
  });

  it.each([
    [
      Object.freeze({
        status: 'SKIPPED',
        reason: 'PIPELINE_NOT_COMPLETED',
      }),
      'SKIPPED',
      'EMITTER_SKIPPED',
    ],
    [
      Object.freeze({ status: 'FAILED', reason: 'EVALUATION_FAILED' }),
      'FAILED',
      'EMITTER_FAILED',
    ],
  ] as const)(
    'classifies emitter result %s without propagating it',
    async (emitterResult, status, reasonCode) => {
      const subject = createSubject({ emitterResult });

      await expect(subject.service.execute(input())).resolves.toMatchObject({
        status,
        stage: 'EMITTER',
        reasonCode,
      });
      expect(subject.pipeline.execute).toHaveBeenCalledTimes(1);
      expect(subject.emitter.emit).toHaveBeenCalledTimes(1);
    },
  );

  it('isolates unexpected emitter exceptions', async () => {
    const subject = createSubject();
    subject.emitter.emit.mockImplementation(() => {
      throw new Error('emitter unavailable');
    });

    await expect(subject.service.execute(input())).resolves.toMatchObject({
      status: 'FAILED',
      stage: 'EMITTER',
      reasonCode: 'EMITTER_EXCEPTION',
    });
  });

  it('is logically deterministic, deeply frozen and serializable', async () => {
    const subject = createSubject();
    const first = await subject.service.execute(input());
    const second = await subject.service.execute(input());

    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expectDeepFrozen(first);
    expect(subject.pipeline.execute).toHaveBeenCalledTimes(2);
    expect(subject.emitter.emit).toHaveBeenCalledTimes(2);
  });

  it('does not import engines, adapters, comparator or persistence infrastructure', () => {
    const source = readFileSync(
      join(__dirname, 'shadow-runtime-orchestrator.service.ts'),
      'utf8',
    );
    const forbidden = [
      'CoachAdaptiveProfileCollectorService',
      'ConversationGoalPlannerService',
      'LongitudinalCoachingEngineService',
      'NutritionKnowledgeResolverService',
      'WorkoutKnowledgeResolverService',
      'NutritionReasoningEngineService',
      'WorkoutReasoningEngineService',
      'NutritionPlanningStrategyService',
      'WorkoutPlanningStrategyService',
      'NutritionReasoningShadowAdapter',
      'WorkoutReasoningShadowAdapter',
      'UnifiedShadowDecisionComparator',
      'PrismaService',
      'EventBusService',
      'AuditService',
    ];

    for (const symbol of forbidden) expect(source).not.toContain(symbol);
  });

  it('is not registered or invoked by productive modules and services', () => {
    const protectedSources = [
      '../responses/response.module.ts',
      '../responses/response-builder.service.ts',
      '../automation/automation.module.ts',
      '../automation/coach-command.service.ts',
      '../diet/diet.module.ts',
      '../workout/workout.module.ts',
    ].map((path) => readFileSync(join(__dirname, path), 'utf8'));

    for (const source of protectedSources) {
      expect(source).not.toContain('ShadowRuntimeOrchestrator');
    }
  });
});

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
}
