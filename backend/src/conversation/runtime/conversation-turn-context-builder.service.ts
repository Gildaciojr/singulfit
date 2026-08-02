import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CoachProfileAcquisitionCycleStatus,
  MessageType,
} from '@prisma/client';
import {
  PROFILE_ACQUISITION_INTENT,
  type ProfileAcquisitionIntent,
} from '../../context/coach-adaptive-profile-collector.contract';
import { CoachAdaptiveProfileCollectorService } from '../../context/coach-adaptive-profile-collector.service';
import { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import { ProfileQuestionSpecificationService } from '../../context/profile-acquisition/profile-question.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CoachProfileSnapshotConversationAdapter } from '../adapters/coach-profile-snapshot.adapter';
import { ProfileAcquisitionDecisionConversationAdapter } from '../adapters/profile-acquisition-decision.adapter';
import {
  CONVERSATION_UNDERSTANDING_VERSION,
  type ConversationUnderstandingInput,
} from '../contracts/conversation-understanding.contract';
import type {
  ConversationLegacyIntent,
  ConversationRuntimeInput,
} from '../contracts/conversation-runtime.contract';
import type { ConversationGoalPreparationInput } from '../contracts/conversation-goal-preparation.contract';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type { ProfileAcquisitionDecision } from '../../context/coach-adaptive-profile-collector.contract';

export interface ConversationTurnContext {
  readonly understandingInput: ConversationUnderstandingInput;
  readonly snapshot: CoachProfileSnapshot;
  readonly adaptiveDecision: ProfileAcquisitionDecision;
  readonly preparationBase: Omit<
    ConversationGoalPreparationInput,
    'understanding'
  >;
}

@Injectable()
export class ConversationTurnContextBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshotBuilder: CoachProfileSnapshotBuilder,
    private readonly collector: CoachAdaptiveProfileCollectorService,
    private readonly snapshotAdapter: CoachProfileSnapshotConversationAdapter,
    private readonly collectorAdapter: ProfileAcquisitionDecisionConversationAdapter,
    private readonly questions: ProfileQuestionSpecificationService,
  ) {}

  async build(
    input: ConversationRuntimeInput,
  ): Promise<ConversationTurnContext> {
    const referenceDate = new Date(input.receivedAt);
    if (Number.isNaN(referenceDate.getTime())) {
      throw new Error('CONVERSATION_RUNTIME_INVALID_REFERENCE_DATE');
    }
    const [conversation, activeCycle, snapshot] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id: input.conversationId, userId: input.userId },
        select: {
          messages: {
            where: { id: { not: input.messageId }, type: MessageType.TEXT },
            select: { direction: true, content: true, timestamp: true },
            orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
            take: 8,
          },
        },
      }),
      this.prisma.coachProfileAcquisitionCycle.findFirst({
        where: {
          userId: input.userId,
          active: true,
          expiresAt: { gt: referenceDate },
        },
        select: { field: true, status: true, logicalTurn: true },
        orderBy: [{ referenceDate: 'desc' }, { createdAt: 'desc' }],
      }),
      this.snapshotBuilder.build(input.userId, referenceDate),
    ]);
    if (!conversation) throw new NotFoundException('Conversa não encontrada');

    const history = [...conversation.messages].reverse().map((message, index) =>
      Object.freeze({
        logicalTurn: index + 1,
        direction: message.direction,
        text: message.content,
        occurredAt: message.timestamp.toISOString(),
      }),
    );
    const currentLogicalTurn = Math.max(
      history.length + 1,
      (activeCycle?.logicalTurn ?? 0) + 1,
    );
    const adaptiveDecision = this.collector.decide({
      snapshot,
      intent: this.collectorIntent(input.legacyIntent),
      conversationContext: {},
      memory: { interactions: [] },
      recentHistory: { currentLogicalTurn, interactions: [] },
    });
    const pendingConfirmation =
      activeCycle?.status ===
      CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING;
    const activeProfileField = activeCycle
      ? this.questions.toCollectorField(activeCycle.field)
      : null;
    const continuity = Object.freeze({
      currentLogicalTurn,
      activeProfileField,
      pendingConfirmation,
      targetPlan: this.targetPlan(input.legacyIntent),
    });
    const profile = this.snapshotAdapter.adapt(snapshot);
    const understandingInput = Object.freeze({
      contractVersion: CONVERSATION_UNDERSTANDING_VERSION,
      userId: input.userId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      channel: 'WHATSAPP' as const,
      text: input.text,
      receivedAt: input.receivedAt,
      profile,
      collector: this.collectorAdapter.adapt(adaptiveDecision),
      recentHistory: Object.freeze(history),
      continuity,
    });
    const preparationBase = Object.freeze({
      snapshot,
      adaptiveDecision,
      progressContextAvailable: profile.progressContextAvailable,
      confirmationPending: pendingConfirmation,
      recentHistory: Object.freeze({
        currentLogicalTurn,
        entries: Object.freeze([]),
      }),
      continuity,
      referenceDate: snapshot.referenceDate,
    });
    return Object.freeze({
      understandingInput,
      snapshot,
      adaptiveDecision,
      preparationBase,
    });
  }

  private collectorIntent(
    intent: ConversationLegacyIntent,
  ): ProfileAcquisitionIntent {
    if (intent === 'DIET') return PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST;
    if (intent === 'WORKOUT')
      return PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST;
    if (intent === 'BOTH')
      return PROFILE_ACQUISITION_INTENT.COMBINED_PLAN_REQUEST;
    return PROFILE_ACQUISITION_INTENT.GENERAL_CONVERSATION;
  }

  private targetPlan(
    intent: ConversationLegacyIntent,
  ): 'DIET' | 'WORKOUT' | 'BOTH' | null {
    return intent === 'UNKNOWN' ? null : intent;
  }
}
