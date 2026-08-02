import { Injectable, Logger } from '@nestjs/common';
import type { NutritionArtifactType } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import type {
  CoachAdaptiveProfileCollectorInput,
  ProfileAcquisitionDecision,
} from '../context/coach-adaptive-profile-collector.contract';
import { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type {
  ConversationGoalDecision,
  ConversationGoalPlannerInput,
} from '../context/conversation-goal-planner.contract';
import { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import {
  GenerateNutritionPlanV2InputBuilder,
  type GenerateNutritionPlanV2InputSource,
} from '../diet/v2/generate-nutrition-plan-v2-input.builder';
import type { GenerateNutritionPlanV2Input } from '../diet/v2/nutrition-planning-generation.contract';
import { NutritionShadowRuntimeOrchestratorService } from '../diet/v2/shadow-runtime/nutrition-shadow-runtime-orchestrator.service';
import { NutritionKnowledgeResolverService } from '../nutrition-knowledge/nutrition-knowledge-resolver.service';
import { NutritionReasoningEngineService } from '../nutrition-reasoning/nutrition-reasoning-engine.service';
import type { NutritionReasoningResult } from '../nutrition-reasoning/nutrition-reasoning.contract';
import { WorkoutKnowledgeResolverService } from '../workout-knowledge/workout-knowledge-resolver.service';
import { WorkoutReasoningEngineService } from '../workout-reasoning/workout-reasoning-engine.service';
import type { WorkoutReasoningResult } from '../workout-reasoning/workout-reasoning.contract';
import { WORKOUT_ARTIFACT_TYPE } from '../workout/v2/workout-planning-artifact.contract';
import type { CoachCommandIntent } from './coach-command.service';
import type { LegacyCoachIntentAdaptation } from './legacy-coach-intent-adapter.contract';
import { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';
import { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';
import type {
  CoachPlanningDispatchResult,
  CoachPlanningExecutionResult,
  CoachPlanningReasoningState,
} from './coach-planning-execution.contract';
import { NutritionV2PilotService } from './nutrition-v2-pilot.service';

export interface CoachPlanningRuntimeContext {
  readonly conversationId: string;
  readonly messageId: string;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly referenceDate: Date;
  readonly profileId?: string;
}

interface PreparedV2PlanningContext {
  readonly decision: ConversationGoalDecision;
  readonly snapshot: CoachProfileSnapshot;
  readonly source: GenerateNutritionPlanV2InputSource;
  readonly generationInput: GenerateNutritionPlanV2Input | null;
  readonly expectedArtifactType: NutritionArtifactType | null;
}

@Injectable()
export class CoachPlanningExecutionService {
  private readonly logger = new Logger(CoachPlanningExecutionService.name);

  constructor(
    private readonly dispatcher: CoachPlanningExecutionDispatcherService,
    private readonly snapshotBuilder?: CoachProfileSnapshotBuilder,
    private readonly intentAdapter?: LegacyCoachIntentAdapter,
    private readonly collector?: CoachAdaptiveProfileCollectorService,
    private readonly planner?: ConversationGoalPlannerService,
    private readonly nutritionPlanningInputBuilder?: GenerateNutritionPlanV2InputBuilder,
    private readonly nutritionShadowRuntime?: NutritionShadowRuntimeOrchestratorService,
    private readonly nutritionV2Pilot?: NutritionV2PilotService,
    private readonly nutritionKnowledge?: NutritionKnowledgeResolverService,
    private readonly nutritionReasoningEngine?: NutritionReasoningEngineService,
    private readonly workoutKnowledge?: WorkoutKnowledgeResolverService,
    private readonly workoutReasoningEngine?: WorkoutReasoningEngineService,
  ) {}

  async execute(
    userId: string,
    intent: CoachCommandIntent,
    runtime?: CoachPlanningRuntimeContext,
  ): Promise<string> {
    return (await this.executeStructured(userId, intent, runtime)).content;
  }

  async executeStructured(
    userId: string,
    intent: CoachCommandIntent,
    runtime?: CoachPlanningRuntimeContext,
  ): Promise<CoachPlanningExecutionResult> {
    let preparation: PreparedV2PlanningContext | null = null;

    try {
      preparation = await this.prepareV2Decision(
        userId,
        intent,
        runtime?.referenceDate ?? new Date(),
      );
    } catch {
      // A infraestrutura V2 permanece estritamente não bloqueante nesta fase.
    }

    const reasoningEnabled = runtime !== undefined;
    const nutrition = reasoningEnabled
      ? this.produceNutritionReasoning(preparation)
      : this.unavailableReasoning('CONVERSATION_LAYER_OFF');
    const workout = reasoningEnabled
      ? this.produceWorkoutReasoning(preparation)
      : this.unavailableReasoning('CONVERSATION_LAYER_OFF');
    const longitudinal = reasoningEnabled
      ? this.unavailableReasoning('CANONICAL_INPUT_UNAVAILABLE')
      : this.unavailableReasoning('CONVERSATION_LAYER_OFF');

    const legacyStartedAt = performance.now();
    let legacySucceeded = true;
    let dispatch: CoachPlanningDispatchResult;
    try {
      dispatch = await this.dispatcher.dispatchStructured({
        userId,
        legacyIntent: intent,
        decision: preparation?.decision ?? null,
      });
    } catch (error: unknown) {
      legacySucceeded = false;
      dispatch = Object.freeze({
        content: this.failureMessage(error),
        executor: 'FAILURE_FALLBACK' as const,
        generationCompleted: false,
        fallbackApplied: true,
      });
    }

    const legacyContent = dispatch.content;
    let selectedContent = legacyContent;
    let selectedSource: CoachPlanningExecutionResult['selectedSource'] =
      'LEGACY';
    let suppressShadow = false;
    if (runtime && preparation && this.nutritionV2Pilot) {
      try {
        const selection = await this.nutritionV2Pilot.select({
          userId,
          profileId: runtime.profileId ?? null,
          decision: preparation.decision,
          generationInput: preparation.generationInput,
          correlationId: runtime.correlationId,
          traceId: runtime.traceId,
          legacyContent,
        });
        selectedContent = selection.content;
        selectedSource =
          selection.selected === 'V2' ? 'NUTRITION_V2' : 'LEGACY';
        suppressShadow = selection.suppressShadow;
      } catch (error: unknown) {
        this.logger.warn(
          `Nutrition V2 Pilot isolado: ${this.safeMessage(error)}`,
        );
      }
    }

    if (
      runtime &&
      preparation &&
      this.nutritionShadowRuntime &&
      !suppressShadow
    ) {
      try {
        this.nutritionShadowRuntime.execute({
          source: preparation.source,
          expectedArtifactType: preparation.expectedArtifactType,
          correlationId: runtime.correlationId,
          traceId: runtime.traceId,
          legacy: {
            conversationId: runtime.conversationId,
            messageId: runtime.messageId,
            response: legacyContent,
            responseType: intent,
            durationMs: Math.max(
              0,
              Math.round(performance.now() - legacyStartedAt),
            ),
            provider: null,
            model: null,
            totalTokens: null,
            estimatedCostUsd: null,
            attempts: 1,
            parserSucceeded: legacySucceeded,
            validationSucceeded: legacySucceeded,
          },
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Nutrition Shadow Runtime isolado: ${this.safeMessage(error)}`,
        );
      }
    }

    return Object.freeze({
      content: selectedContent,
      selectedSource,
      decision: preparation?.decision ?? null,
      nutritionReasoning: nutrition.result,
      workoutReasoning: workout.result,
      longitudinalDecision: null,
      reasoning: Object.freeze({
        nutrition: nutrition.state,
        workout: workout.state,
        longitudinal: longitudinal.state,
      }),
      dispatch,
      metadata: Object.freeze({
        correlationId: runtime?.correlationId ?? null,
        operationKey: runtime?.messageId ?? null,
        executor: dispatch.executor,
        fallbackApplied: dispatch.fallbackApplied,
        generationCompleted: dispatch.generationCompleted,
      }),
    });
  }

  private async prepareV2Decision(
    userId: string,
    intent: CoachCommandIntent,
    referenceDate: Date,
  ): Promise<PreparedV2PlanningContext | null> {
    if (
      !this.snapshotBuilder ||
      !this.intentAdapter ||
      !this.collector ||
      !this.planner
    ) {
      return null;
    }

    const snapshot = await this.snapshotBuilder.build(userId, referenceDate);
    const adaptation = this.intentAdapter.adapt(intent);
    const adaptiveDecision = this.collector.decide(
      this.collectorInput(snapshot, adaptation),
    );
    const decision = this.planner.plan(
      this.plannerInput(snapshot, adaptation, adaptiveDecision),
    );
    const source = Object.freeze({
      userId,
      decision,
      snapshot,
      referenceDate,
    });
    const builtInput = this.nutritionPlanningInputBuilder?.build(source);
    return Object.freeze({
      decision,
      snapshot,
      source,
      generationInput: builtInput ?? null,
      expectedArtifactType: builtInput?.explicitArtifactType ?? null,
    });
  }

  private produceNutritionReasoning(
    preparation: PreparedV2PlanningContext | null,
  ): {
    readonly result: NutritionReasoningResult | null;
    readonly state: CoachPlanningReasoningState;
  } {
    const artifactType = preparation?.generationInput?.explicitArtifactType;
    if (!preparation || !artifactType) {
      return this.unavailableReasoning(
        preparation ? 'DOMAIN_NOT_REQUESTED' : 'CANONICAL_INPUT_UNAVAILABLE',
      );
    }
    if (!this.nutritionKnowledge || !this.nutritionReasoningEngine) {
      return this.unavailableReasoning('CANONICAL_INPUT_UNAVAILABLE');
    }
    try {
      const knowledge = this.nutritionKnowledge.resolve(preparation.snapshot);
      const result = this.nutritionReasoningEngine.reason({
        snapshot: preparation.snapshot,
        knowledgePackages: knowledge.packages,
        conversationGoal: preparation.decision,
        artifactType,
      });
      return Object.freeze({
        result,
        state: this.observedReasoning(),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Nutrition Reasoning oficial isolado: ${this.safeMessage(error)}`,
      );
      return this.unavailableReasoning('PRODUCTION_FAILED');
    }
  }

  private produceWorkoutReasoning(
    preparation: PreparedV2PlanningContext | null,
  ): {
    readonly result: WorkoutReasoningResult | null;
    readonly state: CoachPlanningReasoningState;
  } {
    if (!preparation || !this.isWorkoutGoal(preparation.decision)) {
      return this.unavailableReasoning(
        preparation ? 'DOMAIN_NOT_REQUESTED' : 'CANONICAL_INPUT_UNAVAILABLE',
      );
    }
    if (!this.workoutKnowledge || !this.workoutReasoningEngine) {
      return this.unavailableReasoning('CANONICAL_INPUT_UNAVAILABLE');
    }
    try {
      const knowledgeResolution = this.workoutKnowledge.resolve(
        preparation.snapshot,
      );
      const result = this.workoutReasoningEngine.reason({
        snapshot: preparation.snapshot,
        knowledgeResolution,
        conversationGoal: preparation.decision,
        artifactType: WORKOUT_ARTIFACT_TYPE.WEEKLY_PLAN,
        recognizedModality: null,
      });
      return Object.freeze({
        result,
        state: this.observedReasoning(),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Workout Reasoning oficial isolado: ${this.safeMessage(error)}`,
      );
      return this.unavailableReasoning('PRODUCTION_FAILED');
    }
  }

  private isWorkoutGoal(decision: ConversationGoalDecision): boolean {
    return (
      decision.goal === 'GENERATE_WORKOUT_PLAN' ||
      decision.goal === 'GENERATE_COMBINED_PLANS'
    );
  }

  private observedReasoning(): CoachPlanningReasoningState {
    return Object.freeze({
      reasoningAppliedToGeneration: false,
      reasoningObservedOnly: true,
      reasoningUnavailable: false,
      unavailableReason: null,
    });
  }

  private unavailableReasoning(
    unavailableReason: NonNullable<
      CoachPlanningReasoningState['unavailableReason']
    >,
  ): {
    readonly result: null;
    readonly state: CoachPlanningReasoningState;
  } {
    return Object.freeze({
      result: null,
      state: Object.freeze({
        reasoningAppliedToGeneration: false,
        reasoningObservedOnly: false,
        reasoningUnavailable: true,
        unavailableReason,
      }),
    });
  }

  private collectorInput(
    snapshot: CoachProfileSnapshot,
    adaptation: LegacyCoachIntentAdaptation,
  ): CoachAdaptiveProfileCollectorInput {
    const noInteractions = Object.freeze([]);

    return Object.freeze({
      snapshot,
      intent: adaptation.acquisitionIntent,
      conversationContext: Object.freeze({}),
      memory: Object.freeze({ interactions: noInteractions }),
      recentHistory: Object.freeze({
        currentLogicalTurn: 0,
        interactions: noInteractions,
      }),
    });
  }

  private plannerInput(
    snapshot: CoachProfileSnapshot,
    adaptation: LegacyCoachIntentAdaptation,
    adaptiveDecision: ProfileAcquisitionDecision,
  ): ConversationGoalPlannerInput {
    return Object.freeze({
      snapshot,
      adaptiveDecision,
      recognizedIntent: adaptation.recognizedIntent,
      completion: snapshot.completion,
      conversationContext: Object.freeze({
        planTarget: adaptation.planTarget ?? undefined,
        progressContextAvailable: this.progressAvailable(snapshot),
        confirmationRequired: false,
      }),
      recentHistory: Object.freeze({
        currentLogicalTurn: 0,
        entries: Object.freeze([]),
      }),
    });
  }

  private progressAvailable(snapshot: CoachProfileSnapshot): boolean {
    return (
      'value' in snapshot.longitudinal.latestProgressWeightKg ||
      'value' in snapshot.longitudinal.goalProgression ||
      'value' in snapshot.longitudinal.nutritionEvolution
    );
  }

  private failureMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : '';

    if (/assinatura|acesso|subscription|forbidden/i.test(message)) {
      return 'Para gerar seu plano personalizado, sua assinatura precisa estar ativa. Assim que o acesso estiver liberado, eu continuo daqui.';
    }

    if (/perfil fitness|perfil/i.test(message)) {
      return 'Ainda preciso do seu perfil completo para gerar um plano seguro e personalizado. Conclua o onboarding e me peça novamente.';
    }

    return 'Tive uma falha ao gerar seu plano agora. Tente novamente em alguns instantes que eu continuo te ajudando.';
  }

  private safeMessage(error: unknown): string {
    return (
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'falha Shadow não identificada'
    ).slice(0, 1_000);
  }
}
