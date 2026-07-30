import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import { NutritionPlanningStrategyService } from '../diet/v2/nutrition-planning-strategy.service';
import { LongitudinalCoachingEngineService } from '../longitudinal-coaching/longitudinal-coaching-engine.service';
import { NutritionKnowledgeResolverService } from '../nutrition-knowledge/nutrition-knowledge-resolver.service';
import { NutritionReasoningEngineService } from '../nutrition-reasoning/nutrition-reasoning-engine.service';
import {
  CONVERSATION_LAYER_MODE,
  ConversationLayerOperationalConfigService,
} from '../responses/conversation-layer-operational-config.service';
import { WorkoutKnowledgeResolverService } from '../workout-knowledge/workout-knowledge-resolver.service';
import { WorkoutReasoningEngineService } from '../workout-reasoning/workout-reasoning-engine.service';
import { WorkoutPlanningStrategyService } from '../workout/v2/workout-planning-strategy.service';
import { NutritionReasoningShadowAdapter } from './nutrition-reasoning-shadow.adapter';
import {
  UNIFIED_SHADOW_ADAPTER_VERSION,
  UNIFIED_SHADOW_COMPARATOR_VERSION,
  UNIFIED_SHADOW_PIPELINE_VERSION,
  UnifiedShadowAuditMetadata,
  UnifiedShadowDecisionPipelineInput,
  UnifiedShadowDecisionPipelineResult,
  UnifiedShadowExecutionArtifacts,
  UnifiedShadowFailureCode,
  UnifiedShadowFailureMetadata,
  UnifiedShadowLatencyMetadata,
} from './unified-shadow-decision.contract';
import { UnifiedShadowDecisionAuditService } from './unified-shadow-decision-audit.service';
import { UnifiedShadowDecisionComparator } from './unified-shadow-decision-comparator';
import { WorkoutReasoningShadowAdapter } from './workout-reasoning-shadow.adapter';

type UnifiedShadowStage =
  | 'CONFIG'
  | 'COLLECTOR'
  | 'PLANNER'
  | 'LONGITUDINAL'
  | 'NUTRITION_REASONING'
  | 'WORKOUT_REASONING'
  | 'NUTRITION_STRATEGY'
  | 'WORKOUT_STRATEGY'
  | 'ADAPTER'
  | 'COMPARATOR'
  | 'AUDIT';

@Injectable()
export class UnifiedShadowDecisionPipelineService {
  constructor(
    private readonly operationalConfig: ConversationLayerOperationalConfigService,
    private readonly collector: CoachAdaptiveProfileCollectorService,
    private readonly planner: ConversationGoalPlannerService,
    private readonly longitudinal: LongitudinalCoachingEngineService,
    private readonly nutritionKnowledge: NutritionKnowledgeResolverService,
    private readonly nutritionReasoning: NutritionReasoningEngineService,
    private readonly workoutKnowledge: WorkoutKnowledgeResolverService,
    private readonly workoutReasoning: WorkoutReasoningEngineService,
    private readonly nutritionStrategy: NutritionPlanningStrategyService,
    private readonly workoutStrategy: WorkoutPlanningStrategyService,
    private readonly nutritionAdapter: NutritionReasoningShadowAdapter,
    private readonly workoutAdapter: WorkoutReasoningShadowAdapter,
    private readonly comparator: UnifiedShadowDecisionComparator,
    private readonly audit: UnifiedShadowDecisionAuditService,
  ) {}

  async execute(
    input: UnifiedShadowDecisionPipelineInput,
  ): Promise<UnifiedShadowDecisionPipelineResult> {
    const totalStartedAt = performance.now();
    let stage: UnifiedShadowStage = 'CONFIG';

    try {
      if (
        this.operationalConfig.get().effectiveMode !==
        CONVERSATION_LAYER_MODE.SHADOW
      ) {
        return Object.freeze({
          status: 'SKIPPED',
          reason: 'MODE_NOT_SHADOW',
        });
      }

      const timings: MutableTimings = this.emptyTimings();

      stage = 'COLLECTOR';
      const collectorStartedAt = performance.now();
      const adaptiveDecision = this.collector.decide({
        ...input.collector,
        snapshot: input.snapshot,
      });
      timings.collectorMs = this.duration(collectorStartedAt);

      stage = 'PLANNER';
      const plannerStartedAt = performance.now();
      const plannerDecision = this.planner.plan({
        ...input.planner,
        snapshot: input.snapshot,
        adaptiveDecision,
        completion: input.snapshot.completion,
      });
      timings.plannerMs = this.duration(plannerStartedAt);

      stage = 'LONGITUDINAL';
      const longitudinalStartedAt = performance.now();
      const longitudinalDecision = this.longitudinal.decide({
        ...input.longitudinal,
        snapshot: input.snapshot,
      });
      timings.longitudinalMs = this.duration(longitudinalStartedAt);

      let nutritionReasoning: UnifiedShadowExecutionArtifacts['nutritionReasoning'] =
        null;
      if (input.nutrition) {
        stage = 'NUTRITION_REASONING';
        const startedAt = performance.now();
        const knowledge = this.nutritionKnowledge.resolve(input.snapshot);
        nutritionReasoning = this.nutritionReasoning.reason({
          snapshot: input.snapshot,
          knowledgePackages: knowledge.packages,
          conversationGoal: plannerDecision,
          artifactType: input.nutrition.planningContext.artifactType,
        });
        timings.nutritionReasoningMs = this.duration(startedAt);
      }

      let workoutReasoning: UnifiedShadowExecutionArtifacts['workoutReasoning'] =
        null;
      if (input.workout) {
        stage = 'WORKOUT_REASONING';
        const startedAt = performance.now();
        const knowledge = this.workoutKnowledge.resolve(input.snapshot);
        workoutReasoning = this.workoutReasoning.reason({
          snapshot: input.snapshot,
          knowledgeResolution: knowledge,
          conversationGoal: plannerDecision,
          artifactType: input.workout.planningContext.artifactType,
          recognizedModality: input.workout.recognizedModality,
        });
        timings.workoutReasoningMs = this.duration(startedAt);
      }

      let nutritionLegacyStrategy: UnifiedShadowExecutionArtifacts['nutritionLegacyStrategy'] =
        null;
      if (input.nutrition) {
        stage = 'NUTRITION_STRATEGY';
        const startedAt = performance.now();
        nutritionLegacyStrategy = this.nutritionStrategy.build(
          input.nutrition.planningContext,
        );
        timings.nutritionStrategyMs = this.duration(startedAt);
      }

      let workoutLegacyStrategy: UnifiedShadowExecutionArtifacts['workoutLegacyStrategy'] =
        null;
      if (input.workout) {
        stage = 'WORKOUT_STRATEGY';
        const startedAt = performance.now();
        workoutLegacyStrategy = this.workoutStrategy.build(
          input.workout.planningContext,
        );
        timings.workoutStrategyMs = this.duration(startedAt);
      }

      stage = 'ADAPTER';
      const adaptersStartedAt = performance.now();
      const nutritionShadowStrategy = nutritionReasoning
        ? this.nutritionAdapter.adapt(nutritionReasoning)
        : null;
      const workoutShadowStrategy = workoutReasoning
        ? this.workoutAdapter.adapt(workoutReasoning)
        : null;
      timings.adaptersMs = this.duration(adaptersStartedAt);

      const artifacts: UnifiedShadowExecutionArtifacts = {
        adaptiveDecision,
        plannerDecision,
        longitudinalDecision,
        nutritionReasoning,
        workoutReasoning,
        nutritionLegacyStrategy,
        workoutLegacyStrategy,
        nutritionShadowStrategy,
        workoutShadowStrategy,
      };

      stage = 'COMPARATOR';
      const comparatorStartedAt = performance.now();
      const comparison = this.comparator.compare({
        nutritionLegacy: artifacts.nutritionLegacyStrategy,
        nutritionShadow: artifacts.nutritionShadowStrategy,
        workoutLegacy: artifacts.workoutLegacyStrategy,
        workoutShadow: artifacts.workoutShadowStrategy,
        longitudinalLegacy: input.legacyLongitudinalDecision,
        longitudinalShadow: artifacts.longitudinalDecision,
      });
      timings.comparatorMs = this.duration(comparatorStartedAt);
      timings.totalMs = this.duration(totalStartedAt);

      const auditMetadata = this.auditMetadata(
        artifacts,
        comparison,
        this.freezeTimings(timings),
      );
      stage = 'AUDIT';
      const auditPersisted = await this.recordCompleted(input, auditMetadata);

      return deepFreeze({
        status: 'COMPLETED',
        artifacts,
        comparison,
        auditMetadata,
        auditPersisted,
      });
    } catch {
      const failure = deepFreeze({
        status: 'FAILED' as const,
        failureCode: this.failureCode(stage),
        pipelineVersion: UNIFIED_SHADOW_PIPELINE_VERSION,
        totalMs: this.duration(totalStartedAt),
      });
      const auditPersisted = await this.recordFailed(input, failure);
      return deepFreeze({ status: 'FAILED', failure, auditPersisted });
    }
  }

  private auditMetadata(
    artifacts: UnifiedShadowExecutionArtifacts,
    comparison: ReturnType<UnifiedShadowDecisionComparator['compare']>,
    latency: UnifiedShadowLatencyMetadata,
  ): UnifiedShadowAuditMetadata {
    const differences = [
      ...(comparison.nutrition?.differences ?? []),
      ...(comparison.workout?.differences ?? []),
      ...comparison.longitudinal.differences,
    ];
    return deepFreeze({
      status: 'COMPLETED',
      plannerGoal: artifacts.plannerDecision.goal,
      collectorShouldAsk: artifacts.adaptiveDecision.shouldAsk,
      overallCategory: comparison.overallCategory,
      nutritionCategory: comparison.nutrition?.category ?? null,
      workoutCategory: comparison.workout?.category ?? null,
      longitudinalCategory: comparison.longitudinal.category,
      nutritionIntensity:
        artifacts.nutritionReasoning?.interventionIntensity ?? null,
      nutritionComplexity:
        artifacts.nutritionReasoning?.recommendedComplexity ?? null,
      workoutIntensity:
        artifacts.workoutReasoning?.interventionIntensity ?? null,
      workoutComplexity:
        artifacts.workoutReasoning?.authorizedComplexity ?? null,
      workoutProgression:
        artifacts.workoutReasoning?.progressionDecision ?? null,
      longitudinalDecision: artifacts.longitudinalDecision.decision,
      differenceDimensions: [
        ...new Set(differences.map((difference) => difference.dimension)),
      ].sort(),
      differences,
      nutritionStrategyCodes:
        artifacts.nutritionShadowStrategy?.selectedStrategies ?? [],
      workoutStrategyCodes:
        artifacts.workoutShadowStrategy?.selectedStrategies ?? [],
      latency,
      versions: {
        adapter: UNIFIED_SHADOW_ADAPTER_VERSION,
        comparator: UNIFIED_SHADOW_COMPARATOR_VERSION,
        pipeline: UNIFIED_SHADOW_PIPELINE_VERSION,
        nutritionReasoning:
          artifacts.nutritionReasoning?.metadata.strategyVersion ?? null,
        workoutReasoning:
          artifacts.workoutReasoning?.metadata.strategyVersion ?? null,
        longitudinalPolicy:
          artifacts.longitudinalDecision.metadata.policyVersion,
      },
    });
  }

  private async recordCompleted(
    input: UnifiedShadowDecisionPipelineInput,
    metadata: UnifiedShadowAuditMetadata,
  ): Promise<boolean> {
    try {
      await this.audit.recordCompleted({
        userId: input.operation.userId,
        entityId: input.operation.auditEntityId,
        metadata,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async recordFailed(
    input: UnifiedShadowDecisionPipelineInput,
    metadata: UnifiedShadowFailureMetadata,
  ): Promise<boolean> {
    try {
      await this.audit.recordFailed({
        userId: input.operation.userId,
        entityId: input.operation.auditEntityId,
        metadata,
      });
      return true;
    } catch {
      return false;
    }
  }

  private failureCode(stage: UnifiedShadowStage): UnifiedShadowFailureCode {
    const codes: Readonly<
      Record<UnifiedShadowStage, UnifiedShadowFailureCode>
    > = Object.freeze({
      CONFIG: 'CONFIG_FAILED',
      COLLECTOR: 'COLLECTOR_FAILED',
      PLANNER: 'PLANNER_FAILED',
      LONGITUDINAL: 'LONGITUDINAL_FAILED',
      NUTRITION_REASONING: 'NUTRITION_REASONING_FAILED',
      WORKOUT_REASONING: 'WORKOUT_REASONING_FAILED',
      NUTRITION_STRATEGY: 'NUTRITION_STRATEGY_FAILED',
      WORKOUT_STRATEGY: 'WORKOUT_STRATEGY_FAILED',
      ADAPTER: 'ADAPTER_FAILED',
      COMPARATOR: 'COMPARATOR_FAILED',
      AUDIT: 'AUDIT_FAILED',
    });
    return codes[stage];
  }

  private emptyTimings(): MutableTimings {
    return {
      collectorMs: 0,
      plannerMs: 0,
      longitudinalMs: 0,
      nutritionReasoningMs: null,
      workoutReasoningMs: null,
      nutritionStrategyMs: null,
      workoutStrategyMs: null,
      adaptersMs: 0,
      comparatorMs: 0,
      totalMs: 0,
    };
  }

  private freezeTimings(timings: MutableTimings): UnifiedShadowLatencyMetadata {
    return Object.freeze({ ...timings });
  }

  private duration(startedAt: number): number {
    return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
  }
}

interface MutableTimings {
  collectorMs: number;
  plannerMs: number;
  longitudinalMs: number;
  nutritionReasoningMs: number | null;
  workoutReasoningMs: number | null;
  nutritionStrategyMs: number | null;
  workoutStrategyMs: number | null;
  adaptersMs: number;
  comparatorMs: number;
  totalMs: number;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
