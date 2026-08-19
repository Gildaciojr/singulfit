import { Injectable, Logger, Optional } from '@nestjs/common';
import { type NutritionArtifactType } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import type {
  CoachAdaptiveProfileCollectorInput,
  ProfileAcquisitionContextValue,
  ProfileAcquisitionConversationContext,
  ProfileAcquisitionDecision,
  ProfileAcquisitionModality,
} from '../context/coach-adaptive-profile-collector.contract';
import { PROFILE_ACQUISITION_MODALITY } from '../context/coach-adaptive-profile-collector.contract';
import { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import { CoachConversationHumanContextBuilder } from '../context/coach-conversation-human-context.builder';
import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import type {
  ConversationGoalDecision,
  ConversationGoalPlannerInput,
} from '../context/conversation-goal-planner.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
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
import {
  WORKOUT_ARTIFACT_TYPE,
  WORKOUT_MODALITY,
  type WorkoutModality,
} from '../workout/v2/workout-planning-artifact.contract';
import { GenerateWorkoutPlanV2InputBuilder } from '../workout/v2/generate-workout-plan-v2-input.builder';
import type {
  WorkoutPlanningValue,
  WorkoutRecognizedContext,
} from '../workout/v2/workout-planning-context.contract';
import type { GenerateWorkoutPlanV2Input } from '../workout/v2/workout-planning-generation.contract';
import {
  WorkoutPlanMutationResolverService,
  type WorkoutPlanMutationResolution,
} from '../workout/v2/workout-plan-mutation-resolver.service';
import { PrismaService } from '../prisma/prisma.service';
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
import {
  PlanningExecutionRoutePolicyService,
  type PlanningExecutionRouteSelection,
} from './planning-execution-route-policy.service';
import {
  type CurrentGoalResolution,
  UserGoalEngineService,
} from './user-goal-engine.service';
import {
  CurrentGoalCommitService,
  CurrentGoalPersistenceError,
  type CurrentGoalCommitResult,
} from './current-goal-commit.service';
import type { PendingGoalConfirmationContext } from './pending-conversation-action.contract';
import type { PendingGoalConsumptionResult } from './pending-conversation-action.contract';
import { PendingConversationActionService } from './pending-conversation-action.service';

export interface CoachPlanningRuntimeContext {
  readonly conversationId: string;
  readonly messageId: string;
  readonly correlationId: string;
  readonly traceId?: string;
  readonly referenceDate: Date;
  readonly profileId?: string;
  readonly currentMessage?: string;
  readonly pendingGoalConfirmation?: PendingGoalConfirmationContext;
  readonly suppressCurrentGoalResolution?: boolean;
}

interface PreparedV2PlanningContext {
  readonly decision: ConversationGoalDecision;
  readonly snapshot: CoachProfileSnapshot;
  readonly source: GenerateNutritionPlanV2InputSource;
  readonly generationInput: GenerateNutritionPlanV2Input | null;
  readonly expectedArtifactType: NutritionArtifactType | null;
  readonly goalResolution: CurrentGoalResolution | undefined;
  readonly workoutGenerationInput: GenerateWorkoutPlanV2Input | null;
  readonly workoutProfileId: string | null;
  readonly workoutMutation: boolean;
  readonly workoutV2Response: string | null;
  readonly profileAcquisitionContext: ProfileAcquisitionConversationContext;
}

export class PendingGoalContinuationInProgressError extends Error {
  constructor() {
    super('PENDING_GOAL_CONTINUATION_IN_PROGRESS');
    this.name = PendingGoalContinuationInProgressError.name;
  }
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
    _nutritionV2Pilot?: NutritionV2PilotService,
    private readonly nutritionKnowledge?: NutritionKnowledgeResolverService,
    private readonly nutritionReasoningEngine?: NutritionReasoningEngineService,
    private readonly workoutKnowledge?: WorkoutKnowledgeResolverService,
    private readonly workoutReasoningEngine?: WorkoutReasoningEngineService,
    private readonly humanContextBuilder?: CoachConversationHumanContextBuilder,
    private readonly routePolicy?: PlanningExecutionRoutePolicyService,
    @Optional() private readonly goalEngine?: UserGoalEngineService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly currentGoalCommit?: CurrentGoalCommitService,
    @Optional()
    private readonly pendingActions?: PendingConversationActionService,
    @Optional()
    private readonly workoutPlanningInputBuilder?: GenerateWorkoutPlanV2InputBuilder,
    @Optional()
    private readonly workoutMutationResolver?: WorkoutPlanMutationResolverService,
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
    let pendingExecutionClaimToken: string | undefined;

    try {
      preparation = await this.prepareV2Decision(userId, intent, runtime);
    } catch (error: unknown) {
      if (error instanceof CurrentGoalPersistenceError) throw error;
      this.logger.warn(
        `Planning V2 preparation unavailable: ${this.safeMessage(error)}`,
      );
      if (intent === 'WORKOUT') {
        return this.workoutPreparationFailureResult(error, runtime);
      }
      // Diet e combined preservam a tolerância anterior nesta fronteira.
    }
    if (intent === 'WORKOUT' && !preparation) {
      return this.workoutPreparationFailureResult(
        new Error('Workout V2 productive preparation unavailable'),
        runtime,
      );
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

    const routeSelection = this.selectRoute(userId, runtime, preparation);
    this.observeRouteSelection(routeSelection, runtime?.correlationId);
    await this.createPendingGoalConfirmation(
      userId,
      intent,
      preparation,
      runtime,
    );
    const goalCommit = await this.commitResolvedGoal(
      userId,
      preparation?.goalResolution,
      runtime,
      routeSelection,
    );
    if (
      runtime?.pendingGoalConfirmation?.resolution.status === 'RESOLVED' &&
      goalCommit !== 'APPLIED' &&
      goalCommit !== 'CONTINUE'
    ) {
      return this.suppressedPendingResult(preparation, routeSelection, runtime);
    }
    if (goalCommit === 'STALE') {
      return this.staleGoalResult(preparation, routeSelection, runtime);
    }
    if (
      runtime?.pendingGoalConfirmation?.resolution.status === 'RESOLVED' &&
      this.pendingActions
    ) {
      const executionClaim =
        await this.pendingActions.claimGoalContinuationExecution({
          userId,
          conversationId: runtime.conversationId,
          actionId: runtime.pendingGoalConfirmation.actionId,
          consumerMessageId: runtime.messageId,
          claimedAt: new Date(),
        });
      if (executionClaim.status === 'IN_PROGRESS') {
        throw new PendingGoalContinuationInProgressError();
      }
      if (executionClaim.status === 'COMPLETED') {
        return this.suppressedPendingResult(
          preparation,
          routeSelection,
          runtime,
        );
      }
      pendingExecutionClaimToken = executionClaim.claimToken;
    }

    const legacyStartedAt = performance.now();
    let legacySucceeded = true;
    let dispatch: CoachPlanningDispatchResult;
    const continuationOperationKey = this.continuationOperationKey(runtime);
    try {
      dispatch = await this.dispatcher.dispatchStructured({
        userId,
        legacyIntent: intent,
        decision: preparation?.decision ?? null,
        routeSelection,
        continuationOperationKey,
        currentMessage: runtime?.currentMessage,
        referenceDate: runtime?.referenceDate,
        workoutV2Response: preparation?.workoutV2Response ?? undefined,
        nutritionV2:
          routeSelection.nutrition === 'V2' &&
          preparation?.generationInput &&
          runtime?.profileId
            ? {
                generationInput: preparation.generationInput,
                profileId: runtime.profileId,
                correlationId: runtime.correlationId,
                traceId: runtime.traceId,
                continuationOperationKey,
              }
            : undefined,
        workoutV2:
          routeSelection.workout === 'V2' &&
          preparation?.workoutGenerationInput &&
          preparation.workoutProfileId &&
          runtime
            ? {
                generationInput: preparation.workoutGenerationInput,
                profileId: preparation.workoutProfileId,
                correlationId: runtime.correlationId,
                traceId: runtime.traceId,
              }
            : undefined,
      });
      if (pendingExecutionClaimToken && !dispatch.generationCompleted) {
        throw new Error('PENDING_GOAL_CONTINUATION_GENERATION_INCOMPLETE');
      }
    } catch (error: unknown) {
      legacySucceeded = false;
      this.logger.warn(
        `Planning route failed: ${JSON.stringify({
          domain: routeSelection.nutrition ? 'NUTRITION' : 'WORKOUT',
          selectedRoute:
            routeSelection.nutrition ?? routeSelection.workout ?? 'LEGACY',
          reason: routeSelection.reason,
          correlationId: runtime?.correlationId ?? null,
          failure: this.safeMessage(error),
        })}`,
      );
      if (pendingExecutionClaimToken && runtime?.pendingGoalConfirmation) {
        await this.releasePendingExecution(
          userId,
          runtime,
          pendingExecutionClaimToken,
        );
        throw error;
      }
      dispatch = Object.freeze({
        content: this.failureMessage(error),
        executor: 'FAILURE_FALLBACK' as const,
        generationCompleted: false,
        fallbackApplied: true,
      });
    }

    const legacyContent = dispatch.content;
    const selectedContent = legacyContent;
    const selectedSource: CoachPlanningExecutionResult['selectedSource'] =
      routeSelection.nutrition === 'V2'
        ? 'NUTRITION_V2'
        : routeSelection.workout === 'V2'
          ? 'WORKOUT_V2'
          : 'LEGACY';
    const suppressShadow = routeSelection.suppressNutritionShadow;

    this.logger.log(
      `Planning route completed: ${JSON.stringify({
        domain: routeSelection.nutrition ? 'NUTRITION' : 'WORKOUT',
        selectedRoute:
          routeSelection.nutrition ?? routeSelection.workout ?? 'LEGACY',
        reason: routeSelection.reason,
        pilotStatus: routeSelection.nutritionPilotStatus,
        correlationId: runtime?.correlationId ?? null,
        executor: dispatch.executor,
        generationCompleted: dispatch.generationCompleted,
        fallbackApplied: dispatch.fallbackApplied,
        responseImplementation: selectedSource,
        durationMs: Math.max(
          0,
          Math.round(performance.now() - legacyStartedAt),
        ),
      })}`,
    );

    if (
      runtime &&
      preparation &&
      this.nutritionShadowRuntime &&
      selectedSource === 'LEGACY' &&
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
      responseRequired: true,
      pendingExecutionClaimToken,
      profileAcquisitionContext: preparation?.profileAcquisitionContext,
      selectedSource,
      decision: preparation?.decision ?? null,
      nutritionReasoning: nutrition.result,
      workoutReasoning: workout.result,
      longitudinalDecision: null,
      humanContext:
        preparation && this.humanContextBuilder
          ? this.humanContextBuilder.build(preparation.snapshot, {
              currentMessage: runtime?.currentMessage,
            })
          : null,
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
        routeSelection,
      }),
    });
  }

  private continuationOperationKey(
    runtime: CoachPlanningRuntimeContext | undefined,
  ): string | undefined {
    const pending = runtime?.pendingGoalConfirmation;
    if (!pending || !runtime) return undefined;
    return `pending-goal-continuation:${pending.actionId}:${runtime.messageId}:nutrition`;
  }

  private workoutPreparationFailureResult(
    error: unknown,
    runtime: CoachPlanningRuntimeContext | undefined,
  ): CoachPlanningExecutionResult {
    const routeSelection = Object.freeze({
      nutrition: null,
      workout: 'V2' as const,
      reason: 'WORKOUT_V2_PRODUCTIVE_GENERATION' as const,
      nutritionPilotStatus: null,
      suppressNutritionShadow: false,
    });
    const dispatch = Object.freeze({
      content: this.failureMessage(error),
      executor: 'FAILURE_FALLBACK' as const,
      generationCompleted: false,
      fallbackApplied: false,
      workoutDisposition: 'BLOCKED' as const,
    });
    const unavailable = this.unavailableReasoning('PRODUCTION_FAILED').state;
    return Object.freeze({
      content: dispatch.content,
      responseRequired: true,
      selectedSource: 'WORKOUT_V2' as const,
      decision: null,
      nutritionReasoning: null,
      workoutReasoning: null,
      longitudinalDecision: null,
      humanContext: null,
      reasoning: Object.freeze({
        nutrition: unavailable,
        workout: unavailable,
        longitudinal: unavailable,
      }),
      dispatch,
      metadata: Object.freeze({
        correlationId: runtime?.correlationId ?? null,
        operationKey: runtime?.messageId ?? null,
        executor: dispatch.executor,
        fallbackApplied: false,
        generationCompleted: false,
        routeSelection,
      }),
    });
  }

  private async releasePendingExecution(
    userId: string,
    runtime: CoachPlanningRuntimeContext,
    claimToken: string,
  ): Promise<void> {
    const pending = runtime.pendingGoalConfirmation;
    if (!pending || !this.pendingActions) return;
    try {
      await this.pendingActions.releaseGoalContinuationExecution({
        userId,
        conversationId: runtime.conversationId,
        actionId: pending.actionId,
        consumerMessageId: runtime.messageId,
        claimToken,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Pending continuation release failed: ${this.safeMessage(error)}`,
      );
    }
  }

  private selectRoute(
    userId: string,
    runtime: CoachPlanningRuntimeContext | undefined,
    preparation: PreparedV2PlanningContext | null,
  ): PlanningExecutionRouteSelection {
    const storedRoute = runtime?.pendingGoalConfirmation?.payload.selectedRoute;
    if (runtime?.pendingGoalConfirmation?.continuation && storedRoute) {
      return storedRoute;
    }
    if (this.routePolicy) {
      return this.routePolicy.select({
        userId,
        profileId: runtime?.profileId ?? null,
        decision: preparation?.decision ?? null,
        generationInput: preparation?.generationInput ?? null,
        workoutGenerationInput: preparation?.workoutGenerationInput ?? null,
        workoutMutation: preparation?.workoutMutation ?? false,
      });
    }
    return Object.freeze({
      nutrition: 'LEGACY' as const,
      workout: null,
      reason: 'LEGACY_INTENT_OR_UNSUPPORTED_GOAL' as const,
      nutritionPilotStatus: null,
      suppressNutritionShadow: false,
    });
  }

  private observeRouteSelection(
    selection: PlanningExecutionRouteSelection,
    correlationId: string | undefined,
  ): void {
    this.logger.debug(
      `Planning route selected: ${JSON.stringify({
        nutrition: selection.nutrition,
        workout: selection.workout,
        reason: selection.reason,
        nutritionPilotStatus: selection.nutritionPilotStatus,
        correlationId: correlationId ?? null,
      })}`,
    );
  }

  private async prepareV2Decision(
    userId: string,
    intent: CoachCommandIntent,
    runtime: CoachPlanningRuntimeContext | undefined,
  ): Promise<PreparedV2PlanningContext | null> {
    if (
      !this.snapshotBuilder ||
      !this.intentAdapter ||
      !this.collector ||
      !this.planner
    ) {
      return null;
    }

    const referenceDate = runtime?.referenceDate ?? new Date();
    const goalResolution = runtime?.pendingGoalConfirmation
      ? runtime.pendingGoalConfirmation.resolution
      : runtime?.suppressCurrentGoalResolution
        ? undefined
        : this.goalEngine?.resolveCurrentMessage(runtime?.currentMessage);
    const canonicalSnapshot = await this.snapshotBuilder.build(
      userId,
      referenceDate,
    );
    const snapshot = this.withPendingRequestContext(
      this.withCurrentDesiredOutcome(canonicalSnapshot, goalResolution),
      runtime?.pendingGoalConfirmation,
    );
    const legacyAdaptation = this.intentAdapter.adapt(intent);
    const readRequested = this.workoutReadRequested(
      intent,
      runtime?.currentMessage,
    );
    const baseWorkoutContext =
      intent === 'WORKOUT' && this.workoutPlanningInputBuilder
        ? this.workoutPlanningInputBuilder.recognizeDeclaredContext(
            runtime?.currentMessage,
          )
        : undefined;
    let mutation: WorkoutPlanMutationResolution = Object.freeze({
      status: 'NOT_A_MUTATION' as const,
    });
    if (this.workoutMutationRequested(intent, runtime?.currentMessage)) {
      mutation = this.workoutMutationResolver
        ? await this.workoutMutationResolver.resolve(
            userId,
            runtime?.currentMessage,
            baseWorkoutContext ?? Object.freeze({}),
          )
        : Object.freeze({
            status: 'CLARIFICATION' as const,
            message:
              'Não consegui preparar a alteração do plano com segurança agora.',
          });
    }
    const adaptation = readRequested
      ? Object.freeze({
          ...legacyAdaptation,
          recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST,
          planTarget: 'WORKOUT' as const,
        })
      : mutation.status !== 'NOT_A_MUTATION'
        ? Object.freeze({
            ...legacyAdaptation,
            recognizedIntent:
              CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST,
            planTarget: 'WORKOUT' as const,
          })
        : legacyAdaptation;
    const declaredWorkoutContext =
      mutation.status === 'READY'
        ? mutation.recognizedContext
        : readRequested
          ? undefined
          : baseWorkoutContext;
    const workoutV2Response =
      mutation.status === 'CLARIFICATION' ||
      mutation.status === 'NO_CURRENT_PLAN'
        ? mutation.message
        : null;
    const profileAcquisitionContext = this.profileAcquisitionContext(
      declaredWorkoutContext,
    );
    const adaptiveDecision = this.collector.decide(
      this.collectorInput(snapshot, adaptation, profileAcquisitionContext),
    );
    const plannedDecision = this.planner.plan(
      this.plannerInput(snapshot, adaptation, adaptiveDecision),
    );
    const decision = this.goalDecision(plannedDecision, goalResolution);
    this.logger.debug(
      `Planning V2 preparation completed: ${JSON.stringify({
        legacyIntent: intent,
        recognizedIntent: adaptation.recognizedIntent,
        acquisitionIntent: adaptation.acquisitionIntent,
        planTarget: adaptation.planTarget ?? null,
        plannerGoal: decision.goal,
        plannerReason: decision.reason,
        canExecute: decision.canExecute,
        profileCompletionState: decision.profileCompletionState,
        selectedProfileField: decision.selectedProfileField,
        collectorReason: adaptiveDecision.reason,
        collectorShouldAsk: adaptiveDecision.shouldAsk,
        collectorReadiness: adaptiveDecision.readiness,
        snapshotCompletionOverall: snapshot.completion.overall,
      })}`,
    );
    const source = Object.freeze({
      userId,
      decision,
      snapshot,
      referenceDate,
    });
    const builtInput = this.nutritionPlanningInputBuilder?.build(source);
    const builtWorkoutInput =
      intent === 'WORKOUT' &&
      adaptation.recognizedIntent !==
        CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST &&
      !workoutV2Response &&
      this.workoutPlanningInputBuilder
        ? await this.workoutPlanningInputBuilder.build({
            userId,
            profileId: runtime?.profileId,
            decision,
            declaredContext: declaredWorkoutContext,
            snapshot,
            referenceDate,
            currentMessage: runtime?.currentMessage,
            previousPlan:
              mutation.status === 'READY' ? mutation.previousPlan : undefined,
          })
        : null;
    return Object.freeze({
      decision,
      snapshot,
      source,
      generationInput: builtInput ?? null,
      expectedArtifactType: builtInput?.explicitArtifactType ?? null,
      goalResolution,
      workoutGenerationInput: builtWorkoutInput?.generationInput ?? null,
      workoutProfileId: builtWorkoutInput?.profileId ?? null,
      workoutMutation: mutation.status !== 'NOT_A_MUTATION',
      workoutV2Response,
      profileAcquisitionContext,
    });
  }

  private workoutReadRequested(
    intent: CoachCommandIntent,
    message: string | undefined,
  ): boolean {
    if (intent !== 'WORKOUT' || !message) return false;
    const normalized = message
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return (
      /\b(meu|minha)\s+(?:plano\s+de\s+)?treino\b/u.test(normalized) ||
      /\bo que (?:eu )?treino (?:hoje|amanha)\b/u.test(normalized) ||
      /\b(?:mostra|mostre|ver|qual|consulta|consultar)\b.*\b(?:treino|sessao)\b/u.test(
        normalized,
      ) ||
      /\btreino\s+(?:de\s+)?(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|\d)\b/u.test(
        normalized,
      )
    );
  }

  private workoutMutationRequested(
    intent: CoachCommandIntent,
    message: string | undefined,
  ): boolean {
    if (intent !== 'WORKOUT' || !message) return false;
    const normalized = message
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (/\bnovo plano\b/u.test(normalized)) return false;
    return /\b(troque|trocar|substitua|substituir|nao posso fazer|nao tenho essa maquina|sem essa maquina|agora|adapte|adapta|ajuste|ajusta|inclua|incluir|so tenho|so vou treinar|vou treinar so|focar mais|vou comecar a correr|quero comecar a correr)\b/u.test(
      normalized,
    );
  }

  private async commitResolvedGoal(
    userId: string,
    resolution: CurrentGoalResolution | undefined,
    runtime: CoachPlanningRuntimeContext | undefined,
    routeSelection: PlanningExecutionRouteSelection,
  ): Promise<CurrentGoalCommitResult | PendingGoalConsumptionResult> {
    if (resolution?.status !== 'RESOLVED' || !runtime) {
      return 'NOT_APPLICABLE';
    }
    if (runtime.pendingGoalConfirmation && this.pendingActions) {
      return this.pendingActions.consumeGoalConfirmation({
        userId,
        conversationId: runtime.conversationId,
        consumerMessageId: runtime.messageId,
        referenceDate: runtime.referenceDate,
        context: runtime.pendingGoalConfirmation,
        routeSelection,
      });
    }
    const goalCommit =
      this.currentGoalCommit ??
      (this.prisma ? new CurrentGoalCommitService(this.prisma) : undefined);
    return goalCommit
      ? goalCommit.commit({
          userId,
          operationKey: runtime.messageId,
          referenceDate: runtime.referenceDate,
          resolution,
        })
      : 'NOT_APPLICABLE';
  }

  private goalDecision(
    decision: ConversationGoalDecision,
    resolution: CurrentGoalResolution | undefined,
  ): ConversationGoalDecision {
    if (resolution?.status !== 'REQUIRES_CONFIRMATION') return decision;
    return Object.freeze({
      ...decision,
      recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED,
      goal: CONVERSATION_GOAL.REQUEST_CONFIRMATION,
      reason: 'CONFIRMATION_REQUIRED' as const,
      canExecute: false,
      confidence: 'HIGH' as const,
      selectedProfileField: null,
    });
  }

  private staleGoalResult(
    preparation: PreparedV2PlanningContext | null,
    routeSelection: PlanningExecutionRouteSelection,
    runtime: CoachPlanningRuntimeContext | undefined,
  ): CoachPlanningExecutionResult {
    const dispatch = Object.freeze({
      content:
        'Já considerei uma atualização de objetivo mais recente. Confirme seu objetivo atual antes de gerar um novo plano.',
      executor: 'UNKNOWN_LEGACY' as const,
      generationCompleted: false,
      fallbackApplied: false,
    });
    const unavailable = this.unavailableReasoning(
      'CANONICAL_INPUT_UNAVAILABLE',
    ).state;
    return Object.freeze({
      content: dispatch.content,
      responseRequired: true,
      selectedSource: 'LEGACY' as const,
      decision: preparation?.decision ?? null,
      nutritionReasoning: null,
      workoutReasoning: null,
      longitudinalDecision: null,
      humanContext:
        preparation && this.humanContextBuilder
          ? this.humanContextBuilder.build(preparation.snapshot, {
              currentMessage: runtime?.currentMessage,
            })
          : null,
      reasoning: Object.freeze({
        nutrition: unavailable,
        workout: unavailable,
        longitudinal: unavailable,
      }),
      dispatch,
      metadata: Object.freeze({
        correlationId: runtime?.correlationId ?? null,
        operationKey: runtime?.messageId ?? null,
        executor: dispatch.executor,
        fallbackApplied: false,
        generationCompleted: false,
        routeSelection,
      }),
    });
  }

  private async createPendingGoalConfirmation(
    userId: string,
    intent: CoachCommandIntent,
    preparation: PreparedV2PlanningContext | null,
    runtime: CoachPlanningRuntimeContext | undefined,
  ): Promise<void> {
    if (
      !this.pendingActions ||
      !runtime ||
      runtime.pendingGoalConfirmation ||
      preparation?.decision.goal !== CONVERSATION_GOAL.REQUEST_CONFIRMATION ||
      preparation.goalResolution?.status !== 'REQUIRES_CONFIRMATION'
    ) {
      return;
    }
    await this.pendingActions.createGoalConfirmation({
      userId,
      conversationId: runtime.conversationId,
      sourceMessageId: runtime.messageId,
      originalIntent: intent,
      originalMessage: runtime.currentMessage ?? '',
      referenceDate: runtime.referenceDate,
      declaredOutcome: preparation.goalResolution.declaredOutcome,
    });
  }

  private suppressedPendingResult(
    preparation: PreparedV2PlanningContext | null,
    routeSelection: PlanningExecutionRouteSelection,
    runtime: CoachPlanningRuntimeContext,
  ): CoachPlanningExecutionResult {
    const dispatch = Object.freeze({
      content: '',
      executor: 'UNKNOWN_LEGACY' as const,
      generationCompleted: false,
      fallbackApplied: false,
    });
    const unavailable = this.unavailableReasoning(
      'CANONICAL_INPUT_UNAVAILABLE',
    ).state;
    return Object.freeze({
      content: '',
      responseRequired: false,
      selectedSource: 'LEGACY' as const,
      decision: preparation?.decision ?? null,
      nutritionReasoning: null,
      workoutReasoning: null,
      longitudinalDecision: null,
      humanContext: null,
      reasoning: Object.freeze({
        nutrition: unavailable,
        workout: unavailable,
        longitudinal: unavailable,
      }),
      dispatch,
      metadata: Object.freeze({
        correlationId: runtime.correlationId,
        operationKey: runtime.messageId,
        executor: dispatch.executor,
        fallbackApplied: false,
        generationCompleted: false,
        routeSelection,
      }),
    });
  }

  private withPendingRequestContext(
    snapshot: CoachProfileSnapshot,
    pending: PendingGoalConfirmationContext | undefined,
  ): CoachProfileSnapshot {
    const desiredMealCount = pending?.payload.desiredMealCount;
    if (desiredMealCount === null || desiredMealCount === undefined) {
      return snapshot;
    }
    return Object.freeze({
      ...snapshot,
      nutrition: Object.freeze({
        ...snapshot.nutrition,
        desiredMealCount: Object.freeze({
          status: 'KNOWN' as const,
          value: desiredMealCount,
          sources: Object.freeze(['USER' as const]),
        }),
      }),
    });
  }

  private withCurrentDesiredOutcome(
    snapshot: CoachProfileSnapshot,
    resolution: CurrentGoalResolution | undefined,
  ): CoachProfileSnapshot {
    if (!resolution || resolution.status === 'NO_CHANGE') return snapshot;
    if (resolution.status === 'REQUIRES_CONFIRMATION') {
      if (!resolution.declaredOutcome) return snapshot;
      return Object.freeze({
        ...snapshot,
        nutrition: Object.freeze({
          ...snapshot.nutrition,
          desiredOutcome: Object.freeze({
            status: 'REQUIRES_CONFIRMATION' as const,
            value: resolution.declaredOutcome,
            sources: Object.freeze(['USER' as const]),
          }),
        }),
      });
    }
    return Object.freeze({
      ...snapshot,
      nutrition: Object.freeze({
        ...snapshot.nutrition,
        primaryGoal: Object.freeze({
          status: 'KNOWN' as const,
          value: resolution.primaryGoal,
          sources: Object.freeze(['USER' as const]),
        }),
        desiredOutcome: Object.freeze({
          status: 'KNOWN' as const,
          value: resolution.declaredOutcome,
          sources: Object.freeze(['USER' as const]),
        }),
      }),
      training: Object.freeze({
        ...snapshot.training,
        primaryGoal: Object.freeze({
          status: 'KNOWN' as const,
          value: resolution.primaryGoal,
          sources: Object.freeze(['USER' as const]),
        }),
      }),
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
    conversationContext: ProfileAcquisitionConversationContext = Object.freeze(
      {},
    ),
  ): CoachAdaptiveProfileCollectorInput {
    const noInteractions = Object.freeze([]);

    return Object.freeze({
      snapshot,
      intent: adaptation.acquisitionIntent,
      conversationContext,
      memory: Object.freeze({ interactions: noInteractions }),
      recentHistory: Object.freeze({
        currentLogicalTurn: 0,
        interactions: noInteractions,
      }),
    });
  }

  private profileAcquisitionContext(
    recognized: WorkoutRecognizedContext | undefined,
  ): ProfileAcquisitionConversationContext {
    if (!recognized) return Object.freeze({});
    const modality = this.explicitWorkoutValue(recognized.modality);

    return Object.freeze({
      modality: modality
        ? Object.freeze({
            value: this.profileAcquisitionModality(modality.value),
            evidence: modality.evidence,
          })
        : undefined,
      experience: this.explicitWorkoutValue(recognized.experience),
      environment: this.explicitWorkoutValue(recognized.environment),
      equipment: this.explicitWorkoutValue(recognized.equipment),
      weeklyFrequency: this.explicitWorkoutValue(recognized.weeklyFrequency),
      sessionDurationMinutes: this.explicitWorkoutValue(
        recognized.sessionDurationMinutes,
      ),
    });
  }

  private explicitWorkoutValue<T>(
    value: WorkoutPlanningValue<T> | undefined,
  ): ProfileAcquisitionContextValue<T> | undefined {
    if (!value || value.status !== 'CONFIRMED') return undefined;
    return Object.freeze({ value: value.value, evidence: 'EXPLICIT' as const });
  }

  private profileAcquisitionModality(
    modality: WorkoutModality,
  ): ProfileAcquisitionModality {
    switch (modality) {
      case WORKOUT_MODALITY.GYM_STRENGTH:
        return PROFILE_ACQUISITION_MODALITY.GYM;
      case WORKOUT_MODALITY.HOME_WORKOUT:
        return PROFILE_ACQUISITION_MODALITY.HOME;
      case WORKOUT_MODALITY.RUNNING:
        return PROFILE_ACQUISITION_MODALITY.RUNNING;
      case WORKOUT_MODALITY.CROSSFIT:
        return PROFILE_ACQUISITION_MODALITY.CROSSFIT;
      case WORKOUT_MODALITY.CYCLING:
        return PROFILE_ACQUISITION_MODALITY.CYCLING;
      default:
        return PROFILE_ACQUISITION_MODALITY.OTHER;
    }
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
