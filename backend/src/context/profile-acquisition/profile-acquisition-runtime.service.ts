import { Injectable } from '@nestjs/common';
import {
  CoachProfileAcquisitionCycleStatus,
  MessageDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROFILE_ACQUISITION_INTENT,
  type ProfileAcquisitionIntent,
  type ProfileAcquisitionInteraction,
} from '../coach-adaptive-profile-collector.contract';
import { CoachAdaptiveProfileCollectorService } from '../coach-adaptive-profile-collector.service';
import { CoachProfileSnapshotBuilder } from '../coach-profile-snapshot.builder';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
} from '../conversation-goal-planner.contract';
import { ConversationGoalPlannerService } from '../conversation-goal-planner.service';
import type { ProfileQuestionSpecification } from './profile-acquisition.contract';
import type { ProfileAcquisitionRuntimeEvaluation } from './profile-acquisition-internal-rollout.contract';
import { ProfileQuestionSpecificationService } from './profile-question.service';

export interface ProfileAcquisitionRuntimeState {
  readonly evaluation: ProfileAcquisitionRuntimeEvaluation;
  readonly specification: ProfileQuestionSpecification | null;
}

@Injectable()
export class ProfileAcquisitionRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshotBuilder: CoachProfileSnapshotBuilder,
    private readonly collector: CoachAdaptiveProfileCollectorService,
    private readonly planner: ConversationGoalPlannerService,
    private readonly questionSpecifications: ProfileQuestionSpecificationService,
  ) {}

  async evaluate(
    userId: string,
    referenceDate: Date,
    intent: ProfileAcquisitionIntent = PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
  ): Promise<ProfileAcquisitionRuntimeState> {
    const [snapshot, cycles, logicalTurn] = await Promise.all([
      this.snapshotBuilder.build(userId, referenceDate),
      this.prisma.coachProfileAcquisitionCycle.findMany({
        where: { userId },
        orderBy: [{ logicalTurn: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.message.count({
        where: {
          direction: MessageDirection.INBOUND,
          conversation: { userId },
        },
      }),
    ]);
    const interactions = Object.freeze(
      cycles
        .map((cycle) => {
          const field = this.questionSpecifications.toCollectorField(
            cycle.field,
          );
          if (!field) return null;
          const terminalAnswer =
            cycle.status === CoachProfileAcquisitionCycleStatus.DECLINED ||
            cycle.status === CoachProfileAcquisitionCycleStatus.ANSWERED ||
            cycle.status === CoachProfileAcquisitionCycleStatus.COMPLETED;
          if (!terminalAnswer && !cycle.askedAt) return null;
          const outcome: ProfileAcquisitionInteraction['outcome'] =
            cycle.status === CoachProfileAcquisitionCycleStatus.DECLINED
              ? 'DECLINED'
              : cycle.status === CoachProfileAcquisitionCycleStatus.ANSWERED ||
                  cycle.status === CoachProfileAcquisitionCycleStatus.COMPLETED
                ? 'ANSWERED'
                : 'ASKED';
          return Object.freeze({
            field,
            outcome,
            logicalTurn: cycle.logicalTurn,
          });
        })
        .filter(
          (interaction): interaction is ProfileAcquisitionInteraction =>
            interaction !== null,
        ),
    );
    const adaptiveDecision = this.collector.decide({
      snapshot,
      intent,
      conversationContext: Object.freeze({}),
      memory: Object.freeze({ interactions: Object.freeze([]) }),
      recentHistory: Object.freeze({
        currentLogicalTurn: logicalTurn,
        interactions,
      }),
    });
    const goalIntent =
      intent === PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST
        ? CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST
        : intent === PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST
          ? CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST
          : CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST;
    const planTarget =
      intent === PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST
        ? 'WORKOUT'
        : intent === PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST
          ? 'BOTH'
          : 'DIET';
    const goalDecision = this.planner.plan({
      snapshot,
      adaptiveDecision,
      recognizedIntent: goalIntent,
      completion: snapshot.completion,
      conversationContext: Object.freeze({
        planTarget,
        progressContextAvailable: false,
        confirmationRequired: false,
      }),
      recentHistory: Object.freeze({
        currentLogicalTurn: logicalTurn,
        entries: Object.freeze([]),
      }),
    });
    const specification =
      this.questionSpecifications.fromDecision(adaptiveDecision);
    const selectedField = specification?.field ?? null;
    const reason: ProfileAcquisitionRuntimeEvaluation['reason'] =
      !adaptiveDecision.shouldAsk
        ? 'NO_ELIGIBLE_FIELD'
        : goalDecision.goal !== CONVERSATION_GOAL.ASK_PROFILE_INFORMATION
          ? 'PLANNER_DID_NOT_REQUEST_ACQUISITION'
          : !specification
            ? 'QUESTION_MAPPING_UNAVAILABLE'
            : 'READY';

    return Object.freeze({
      evaluation: Object.freeze({
        logicalTurn,
        selectedField,
        canAsk: reason === 'READY',
        reason,
      }),
      specification,
    });
  }
}
