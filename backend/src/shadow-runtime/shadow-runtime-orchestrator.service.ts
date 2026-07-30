import {
  CONVERSATION_LAYER_MODE,
  ConversationLayerOperationalConfigService,
} from '../responses/conversation-layer-operational-config.service';
import type { ConversationLayerOperationalConfig } from '../responses/conversation-layer-operational-config.service';
import { ShadowObservationEmitter } from '../shadow-evaluation/shadow-observation-emitter';
import type { ShadowObservationEmitterInput } from '../shadow-evaluation/shadow-observation-emitter';
import type { UnifiedShadowDecisionPipelineResult } from '../unified-shadow-decision/unified-shadow-decision.contract';
import type { UnifiedShadowDecisionPipelineService } from '../unified-shadow-decision/unified-shadow-decision-pipeline.service';
import {
  SHADOW_RUNTIME_ORCHESTRATOR_VERSION,
  ShadowRuntimeFailureStage,
  ShadowRuntimeMetadata,
  ShadowRuntimeOrchestratorInput,
  ShadowRuntimeOrchestratorResult,
  ShadowRuntimeReasonCode,
} from './shadow-runtime-orchestrator.contract';

type OperationalConfigPort = Pick<
  ConversationLayerOperationalConfigService,
  'get'
>;
type UnifiedShadowPipelinePort = Pick<
  UnifiedShadowDecisionPipelineService,
  'execute'
>;
type ShadowObservationEmitterPort = Pick<ShadowObservationEmitter, 'emit'>;

export class ShadowRuntimeOrchestrator {
  constructor(
    private readonly operationalConfig: OperationalConfigPort,
    private readonly pipeline: UnifiedShadowPipelinePort,
    private readonly emitter: ShadowObservationEmitterPort,
  ) {}

  async execute(
    input: ShadowRuntimeOrchestratorInput,
  ): Promise<ShadowRuntimeOrchestratorResult> {
    let config: ConversationLayerOperationalConfig;
    try {
      config = this.operationalConfig.get();
    } catch {
      return this.failed('CONFIG', 'CONFIG_EXCEPTION', {
        runId: this.validRunId(input.runId) ? input.runId : null,
      });
    }

    const base = {
      runId: this.validRunId(input.runId) ? input.runId : null,
      configuredMode: config.configuredMode,
      effectiveMode: config.effectiveMode,
      killSwitchEnabled: config.killSwitchEnabled,
    };

    if (config.killSwitchEnabled) {
      return this.skipped('CONFIG', 'KILL_SWITCH_ENABLED', base);
    }

    if (config.effectiveMode !== CONVERSATION_LAYER_MODE.SHADOW) {
      return this.skipped('CONFIG', 'MODE_NOT_SHADOW', base);
    }

    if (!this.validRunId(input.runId)) {
      return this.skipped('VALIDATION', 'INVALID_RUN_ID', base);
    }

    let pipelineResult: UnifiedShadowDecisionPipelineResult;
    try {
      pipelineResult = await this.pipeline.execute(input.pipelineInput);
    } catch {
      return this.failed('PIPELINE', 'PIPELINE_EXCEPTION', base);
    }

    if (pipelineResult.status === 'SKIPPED') {
      return this.skipped('PIPELINE', 'PIPELINE_SKIPPED', {
        ...base,
        pipelineStatus: pipelineResult.status,
      });
    }

    if (pipelineResult.status === 'FAILED') {
      return this.failed('PIPELINE', 'PIPELINE_FAILED', {
        ...base,
        pipelineStatus: pipelineResult.status,
        pipelineFailureCode: pipelineResult.failure.failureCode,
      });
    }

    let emitterInput: ShadowObservationEmitterInput;
    try {
      emitterInput = Object.freeze({
        runId: input.runId,
        snapshot: input.pipelineInput.snapshot,
        artifacts: pipelineResult.artifacts,
        pipelineResult,
      });
    } catch {
      return this.failed('BUNDLE', 'BUNDLE_FAILED', {
        ...base,
        pipelineStatus: pipelineResult.status,
      });
    }

    let emitterResult: ReturnType<ShadowObservationEmitter['emit']>;
    try {
      emitterResult = this.emitter.emit(emitterInput);
    } catch {
      return this.failed('EMITTER', 'EMITTER_EXCEPTION', {
        ...base,
        pipelineStatus: pipelineResult.status,
      });
    }

    if (emitterResult.status === 'SKIPPED') {
      return this.skipped('EMITTER', 'EMITTER_SKIPPED', {
        ...base,
        pipelineStatus: pipelineResult.status,
        emitterStatus: emitterResult.status,
      });
    }

    if (emitterResult.status === 'FAILED') {
      return this.failed('EMITTER', 'EMITTER_FAILED', {
        ...base,
        pipelineStatus: pipelineResult.status,
        emitterStatus: emitterResult.status,
      });
    }

    return deepFreeze({
      status: 'SUCCESS',
      metadata: this.metadata({
        ...base,
        pipelineStatus: pipelineResult.status,
        emitterStatus: emitterResult.status,
      }),
    });
  }

  private validRunId(runId: unknown): runId is string {
    return typeof runId === 'string' && runId.trim().length > 0;
  }

  private skipped(
    stage: ShadowRuntimeFailureStage,
    reasonCode: Extract<
      ShadowRuntimeReasonCode,
      | 'KILL_SWITCH_ENABLED'
      | 'MODE_NOT_SHADOW'
      | 'INVALID_RUN_ID'
      | 'PIPELINE_SKIPPED'
      | 'EMITTER_SKIPPED'
    >,
    metadata: Partial<ShadowRuntimeMetadata>,
  ): ShadowRuntimeOrchestratorResult {
    return deepFreeze({
      status: 'SKIPPED',
      stage,
      reasonCode,
      metadata: this.metadata(metadata),
    });
  }

  private failed(
    stage: ShadowRuntimeFailureStage,
    reasonCode: Exclude<
      ShadowRuntimeReasonCode,
      | 'KILL_SWITCH_ENABLED'
      | 'MODE_NOT_SHADOW'
      | 'INVALID_RUN_ID'
      | 'PIPELINE_SKIPPED'
      | 'EMITTER_SKIPPED'
    >,
    metadata: Partial<ShadowRuntimeMetadata>,
  ): ShadowRuntimeOrchestratorResult {
    return deepFreeze({
      status: 'FAILED',
      stage,
      reasonCode,
      metadata: this.metadata(metadata),
    });
  }

  private metadata(
    value: Partial<ShadowRuntimeMetadata>,
  ): ShadowRuntimeMetadata {
    return {
      orchestratorVersion: SHADOW_RUNTIME_ORCHESTRATOR_VERSION,
      runId: value.runId ?? null,
      configuredMode: value.configuredMode ?? null,
      effectiveMode: value.effectiveMode ?? null,
      killSwitchEnabled: value.killSwitchEnabled ?? null,
      pipelineStatus: value.pipelineStatus ?? 'NOT_EXECUTED',
      pipelineFailureCode: value.pipelineFailureCode ?? null,
      emitterStatus: value.emitterStatus ?? 'NOT_EXECUTED',
    };
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
