import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import {
  CoachAdaptiveProfileCollectorInput,
  ProfileAcquisitionDecision,
} from '../context/coach-adaptive-profile-collector.contract';
import { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import type { CoachProfileSnapshot } from '../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  ConversationGoal,
  ConversationGoalDecision,
  ConversationGoalPlannerInput,
} from '../context/conversation-goal-planner.contract';
import { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import { AuditService } from '../observability/audit.service';
import type { CoachCommandIntent } from './coach-command.service';
import { ConversationGoalShadowComparator } from './conversation-goal-shadow-comparator';
import { ConversationGoalShadowConfigService } from './conversation-goal-shadow-config.service';
import type { ConversationGoalShadowComparison } from './conversation-goal-shadow-comparison.contract';
import { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';
import type { LegacyCoachIntentAdaptation } from './legacy-coach-intent-adapter.contract';

const CONVERSATION_GOAL_SHADOW_HISTORY_LIMIT = 1_000;
const CONVERSATION_GOAL_SHADOW_AUDIT_ENTITY = 'CONVERSATION_GOAL_SHADOW';

export type ConversationGoalShadowFailureCode =
  | 'INTENT_ADAPTER_FAILED'
  | 'SNAPSHOT_BUILD_FAILED'
  | 'COLLECTOR_FAILED'
  | 'PLANNER_FAILED'
  | 'COMPARISON_FAILED'
  | 'AUDIT_FAILED';

type ConversationGoalShadowStage =
  | 'INTENT_ADAPTER'
  | 'SNAPSHOT'
  | 'COLLECTOR'
  | 'PLANNER'
  | 'COMPARISON'
  | 'AUDIT';

export interface ExecuteConversationGoalShadowInput {
  readonly userId: string;
  readonly messageId: string;
  readonly legacyIntent: CoachCommandIntent;
  readonly referenceTimestamp: string;
  readonly onboardingActive: boolean;
  readonly equivalentGenerationInProgress: boolean;
}

interface ConversationGoalShadowDurations {
  readonly snapshotMs: number;
  readonly collectorMs: number;
  readonly plannerMs: number;
  readonly totalMs: number;
}

@Injectable()
export class ConversationGoalShadowPipelineService implements OnApplicationShutdown {
  private readonly logger = new Logger(
    ConversationGoalShadowPipelineService.name,
  );
  private readonly observedKeys = new Set<string>();
  private readonly observedOrder: string[] = [];
  private shuttingDown = false;

  constructor(
    private readonly config: ConversationGoalShadowConfigService,
    private readonly intentAdapter: LegacyCoachIntentAdapter,
    private readonly snapshotBuilder: CoachProfileSnapshotBuilder,
    private readonly collector: CoachAdaptiveProfileCollectorService,
    private readonly planner: ConversationGoalPlannerService,
    private readonly comparator: ConversationGoalShadowComparator,
    private readonly auditService: AuditService,
  ) {}

  execute(input: ExecuteConversationGoalShadowInput): void {
    try {
      if (
        this.shuttingDown ||
        input.onboardingActive ||
        !this.config.get().enabled ||
        !this.claim(input)
      ) {
        return;
      }

      void Promise.resolve()
        .then(() => this.run(input))
        .catch(() => {
          this.logger.warn('Conversation goal shadow failed: AUDIT_FAILED');
        });
    } catch {
      this.logger.warn('Conversation goal shadow failed: AUDIT_FAILED');
    }
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
  }

  private async run(input: ExecuteConversationGoalShadowInput): Promise<void> {
    const totalStartedAt = performance.now();
    let stage: ConversationGoalShadowStage = 'INTENT_ADAPTER';

    try {
      const adaptation = this.intentAdapter.adapt(input.legacyIntent);
      stage = 'SNAPSHOT';
      const snapshotStartedAt = performance.now();
      const snapshot = await this.snapshotBuilder.build(
        input.userId,
        this.referenceDate(input.referenceTimestamp),
      );
      const snapshotMs = this.duration(snapshotStartedAt);

      stage = 'COLLECTOR';
      const collectorStartedAt = performance.now();
      const adaptiveDecision = this.collector.decide(
        this.collectorInput(snapshot, adaptation),
      );
      const collectorMs = this.duration(collectorStartedAt);

      stage = 'PLANNER';
      const plannerStartedAt = performance.now();
      const plannerDecision = this.planner.plan(
        this.plannerInput(
          snapshot,
          adaptation,
          adaptiveDecision,
          input.equivalentGenerationInProgress,
        ),
      );
      const plannerMs = this.duration(plannerStartedAt);

      stage = 'COMPARISON';
      const comparison = this.comparator.compare({
        legacyIntent: input.legacyIntent,
        adaptation,
        snapshot,
        plannerDecision,
        referenceTimestamp: input.referenceTimestamp,
      });
      const durations = Object.freeze({
        snapshotMs,
        collectorMs,
        plannerMs,
        totalMs: this.duration(totalStartedAt),
      });

      stage = 'AUDIT';
      await this.recordCompleted(
        input,
        snapshot,
        adaptiveDecision,
        plannerDecision,
        comparison,
        durations,
      );
    } catch {
      await this.recordFailed(
        input,
        this.failureCode(stage),
        this.duration(totalStartedAt),
      );
    }
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
    equivalentGenerationInProgress: boolean,
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
        entries: this.goalHistory(adaptation, equivalentGenerationInProgress),
      }),
    });
  }

  private goalHistory(
    adaptation: LegacyCoachIntentAdaptation,
    generationInProgress: boolean,
  ): ConversationGoalPlannerInput['recentHistory']['entries'] {
    const goal = this.generationGoal(adaptation);

    return generationInProgress && goal
      ? Object.freeze([
          Object.freeze({
            goal,
            status: 'EXECUTING' as const,
            logicalTurn: 0,
          }),
        ])
      : Object.freeze([]);
  }

  private generationGoal(
    adaptation: LegacyCoachIntentAdaptation,
  ): ConversationGoal | null {
    if (adaptation.planTarget === 'DIET') {
      return CONVERSATION_GOAL.GENERATE_DIET_PLAN;
    }

    if (adaptation.planTarget === 'WORKOUT') {
      return CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN;
    }

    if (adaptation.planTarget === 'BOTH') {
      return CONVERSATION_GOAL.GENERATE_COMBINED_PLANS;
    }

    return null;
  }

  private async recordCompleted(
    input: ExecuteConversationGoalShadowInput,
    snapshot: CoachProfileSnapshot,
    adaptiveDecision: ProfileAcquisitionDecision,
    plannerDecision: ConversationGoalDecision,
    comparison: ConversationGoalShadowComparison,
    durations: ConversationGoalShadowDurations,
  ): Promise<void> {
    await this.auditService.record({
      userId: input.userId,
      action: 'CONVERSATION_GOAL_SHADOW_COMPLETED',
      entityType: CONVERSATION_GOAL_SHADOW_AUDIT_ENTITY,
      entityId: input.messageId,
      metadata: {
        status: 'COMPLETED',
        legacyIntent: input.legacyIntent,
        adaptedIntent: comparison.adaptedIntent,
        plannerGoal: comparison.plannerGoal,
        comparisonCategory: comparison.category,
        agreement: comparison.agreement,
        canExecute: comparison.canExecute,
        profileCompletionState: comparison.profileCompletionState,
        selectedProfileField: comparison.missingProfileField,
        collectorReason: adaptiveDecision.reason,
        collectorShouldAsk: adaptiveDecision.shouldAsk,
        planTarget: comparison.targetPlan,
        plannerReason: comparison.sanitizedReason,
        adapterVersion: comparison.adapterVersion,
        plannerVersion: comparison.plannerVersion,
        comparatorVersion: comparison.comparatorVersion,
        referenceTimestamp: comparison.referenceTimestamp,
        activeDietAvailable: 'value' in snapshot.plans.currentDiet,
        activeWorkoutAvailable: 'value' in snapshot.plans.currentWorkout,
        acquisitionHistoryAvailable: false,
        goalHistoryAvailable: input.equivalentGenerationInProgress,
        snapshotDurationMs: durations.snapshotMs,
        collectorDurationMs: durations.collectorMs,
        plannerDurationMs: durations.plannerMs,
        totalDurationMs: durations.totalMs,
      },
    });
  }

  private async recordFailed(
    input: ExecuteConversationGoalShadowInput,
    code: ConversationGoalShadowFailureCode,
    totalDurationMs: number,
  ): Promise<void> {
    try {
      await this.auditService.record({
        userId: input.userId,
        action: 'CONVERSATION_GOAL_SHADOW_FAILED',
        entityType: CONVERSATION_GOAL_SHADOW_AUDIT_ENTITY,
        entityId: input.messageId,
        metadata: {
          status: 'FAILED',
          failureCode: code,
          legacyIntent: input.legacyIntent,
          referenceTimestamp: input.referenceTimestamp,
          totalDurationMs,
        },
      });
    } catch {
      this.logger.warn('Conversation goal shadow failed: AUDIT_FAILED');
    }
  }

  private progressAvailable(snapshot: CoachProfileSnapshot): boolean {
    return (
      'value' in snapshot.longitudinal.latestProgressWeightKg ||
      'value' in snapshot.longitudinal.goalProgression ||
      'value' in snapshot.longitudinal.nutritionEvolution
    );
  }

  private referenceDate(value: string): Date {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new Error('Invalid conversation goal shadow reference timestamp');
    }

    return date;
  }

  private duration(startedAt: number): number {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }

  private failureCode(
    stage: ConversationGoalShadowStage,
  ): ConversationGoalShadowFailureCode {
    const codes: Record<
      ConversationGoalShadowStage,
      ConversationGoalShadowFailureCode
    > = {
      INTENT_ADAPTER: 'INTENT_ADAPTER_FAILED',
      SNAPSHOT: 'SNAPSHOT_BUILD_FAILED',
      COLLECTOR: 'COLLECTOR_FAILED',
      PLANNER: 'PLANNER_FAILED',
      COMPARISON: 'COMPARISON_FAILED',
      AUDIT: 'AUDIT_FAILED',
    };

    return codes[stage];
  }

  private claim(input: ExecuteConversationGoalShadowInput): boolean {
    const key = `${input.userId}:${input.messageId}`;

    if (this.observedKeys.has(key)) return false;
    this.observedKeys.add(key);
    this.observedOrder.push(key);

    if (this.observedOrder.length > CONVERSATION_GOAL_SHADOW_HISTORY_LIMIT) {
      const oldest = this.observedOrder.shift();
      if (oldest) this.observedKeys.delete(oldest);
    }

    return true;
  }
}
