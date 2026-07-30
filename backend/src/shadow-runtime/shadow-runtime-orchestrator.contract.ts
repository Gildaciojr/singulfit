import type { ConversationLayerMode } from '../responses/conversation-layer-operational-config.service';
import type { ShadowObservationEmissionResult } from '../shadow-evaluation/shadow-observation-emitter';
import type {
  UnifiedShadowDecisionPipelineInput,
  UnifiedShadowDecisionPipelineResult,
  UnifiedShadowFailureCode,
} from '../unified-shadow-decision/unified-shadow-decision.contract';

export const SHADOW_RUNTIME_ORCHESTRATOR_VERSION = '2026.07.1' as const;

export type ShadowRuntimeFailureStage =
  | 'CONFIG'
  | 'VALIDATION'
  | 'PIPELINE'
  | 'BUNDLE'
  | 'EMITTER';

export type ShadowRuntimeReasonCode =
  | 'KILL_SWITCH_ENABLED'
  | 'MODE_NOT_SHADOW'
  | 'INVALID_RUN_ID'
  | 'CONFIG_EXCEPTION'
  | 'PIPELINE_SKIPPED'
  | 'PIPELINE_FAILED'
  | 'PIPELINE_EXCEPTION'
  | 'BUNDLE_FAILED'
  | 'EMITTER_SKIPPED'
  | 'EMITTER_FAILED'
  | 'EMITTER_EXCEPTION';

export type ShadowRuntimePipelineStatus =
  | 'NOT_EXECUTED'
  | UnifiedShadowDecisionPipelineResult['status'];

export type ShadowRuntimeEmitterStatus =
  | 'NOT_EXECUTED'
  | ShadowObservationEmissionResult['status'];

export interface ShadowRuntimeMetadata {
  readonly orchestratorVersion: typeof SHADOW_RUNTIME_ORCHESTRATOR_VERSION;
  readonly runId: string | null;
  readonly configuredMode: ConversationLayerMode | null;
  readonly effectiveMode: ConversationLayerMode | null;
  readonly killSwitchEnabled: boolean | null;
  readonly pipelineStatus: ShadowRuntimePipelineStatus;
  readonly pipelineFailureCode: UnifiedShadowFailureCode | null;
  readonly emitterStatus: ShadowRuntimeEmitterStatus;
}

export interface ShadowRuntimeOrchestratorInput {
  readonly runId: string;
  readonly pipelineInput: UnifiedShadowDecisionPipelineInput;
}

export type ShadowRuntimeOrchestratorResult =
  | Readonly<{
      status: 'SKIPPED';
      stage: ShadowRuntimeFailureStage;
      reasonCode: Extract<
        ShadowRuntimeReasonCode,
        | 'KILL_SWITCH_ENABLED'
        | 'MODE_NOT_SHADOW'
        | 'INVALID_RUN_ID'
        | 'PIPELINE_SKIPPED'
        | 'EMITTER_SKIPPED'
      >;
      metadata: ShadowRuntimeMetadata;
    }>
  | Readonly<{
      status: 'SUCCESS';
      metadata: ShadowRuntimeMetadata;
    }>
  | Readonly<{
      status: 'FAILED';
      stage: ShadowRuntimeFailureStage;
      reasonCode: Exclude<
        ShadowRuntimeReasonCode,
        | 'KILL_SWITCH_ENABLED'
        | 'MODE_NOT_SHADOW'
        | 'INVALID_RUN_ID'
        | 'PIPELINE_SKIPPED'
        | 'EMITTER_SKIPPED'
      >;
      metadata: ShadowRuntimeMetadata;
    }>;
