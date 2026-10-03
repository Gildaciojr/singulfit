import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CoachProfileAcquisitionCycleStatus,
  MessageDirection,
  MessageType,
  ScheduledMessageStatus,
} from '@prisma/client';
import {
  PROFILE_ACQUISITION_INTENT,
  profileAcquisitionModalityFromWorkoutModality,
  type ProfileAcquisitionConversationContext,
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
import type { ConversationEntity } from '../contracts/conversation-entity.contract';
import type { ConversationGoalPreparationInput } from '../contracts/conversation-goal-preparation.contract';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import type { ProfileAcquisitionDecision } from '../../context/coach-adaptive-profile-collector.contract';
import { CoachConversationHumanContextBuilder } from '../../context/coach-conversation-human-context.builder';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import { ConversationEntityRecognizerService } from '../understanding/conversation-entity-recognizer.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';

export interface ConversationTurnContext {
  readonly understandingInput: ConversationUnderstandingInput;
  readonly snapshot: CoachProfileSnapshot;
  readonly adaptiveDecision: ProfileAcquisitionDecision;
  readonly preparationBase: Omit<
    ConversationGoalPreparationInput,
    'understanding'
  >;
  readonly humanContext: CoachConversationHumanContext;
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
    private readonly humanContextBuilder: CoachConversationHumanContextBuilder,
    private readonly normalizer: ConversationMessageNormalizerService,
    private readonly entityRecognizer: ConversationEntityRecognizerService,
  ) {}

  async build(
    input: ConversationRuntimeInput,
  ): Promise<ConversationTurnContext> {
    const referenceDate = new Date(input.receivedAt);
    if (Number.isNaN(referenceDate.getTime())) {
      throw new Error('CONVERSATION_RUNTIME_INVALID_REFERENCE_DATE');
    }
    const [conversation, scheduledMessages, foundActiveCycle, snapshot] =
      await Promise.all([
        this.prisma.conversation.findFirst({
          where: { id: input.conversationId, userId: input.userId },
          select: {
            id: true,
            userId: true,
            messages: {
              where: {
                id: { not: input.messageId },
                type: MessageType.TEXT,
                timestamp: { lte: referenceDate },
              },
              select: {
                conversationId: true,
                conversation: { select: { userId: true } },
                direction: true,
                content: true,
                timestamp: true,
              },
              orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
              take: 8,
            },
          },
        }),
        this.prisma.scheduledMessage.findMany({
          where: {
            userId: input.userId,
            conversationId: input.conversationId,
            status: ScheduledMessageStatus.SENT,
            OR: [
              { sentAt: { lte: referenceDate } },
              { sentAt: null, scheduledFor: { lte: referenceDate } },
            ],
            scheduledFor: {
              gte: new Date(referenceDate.getTime() - 48 * 60 * 60 * 1_000),
              lt: referenceDate,
            },
          },
          select: {
            id: true,
            userId: true,
            conversationId: true,
            content: true,
            context: true,
            externalMessageId: true,
            scheduledFor: true,
            sentAt: true,
            automationRule: { select: { code: true } },
            coachMessage: { select: { userId: true, context: true } },
          },
          orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
          take: 8,
        }),
        this.prisma.coachProfileAcquisitionCycle.findFirst({
          where: {
            userId: input.userId,
            active: true,
            expiresAt: { gt: referenceDate },
          },
          select: {
            userId: true,
            field: true,
            status: true,
            logicalTurn: true,
          },
          orderBy: [{ referenceDate: 'desc' }, { createdAt: 'desc' }],
        }),
        this.snapshotBuilder.build(input.userId, referenceDate),
      ]);
    if (
      !conversation ||
      conversation.id !== input.conversationId ||
      conversation.userId !== input.userId
    )
      throw new NotFoundException('Conversa não encontrada');
    if (
      snapshot.identity.userId.status !== 'KNOWN' ||
      snapshot.identity.userId.value !== input.userId
    )
      throw new NotFoundException('Profile snapshot ownership mismatch');

    const merged = [
      ...conversation.messages
        .filter(
          (message) =>
            message.timestamp <= referenceDate &&
            message.conversationId === input.conversationId &&
            message.conversation.userId === input.userId,
        )
        .map((message) => ({
          direction: message.direction,
          content: message.content,
          timestamp: message.timestamp,
          priority: 0,
          externalMessageId: null,
          replyToExternalMessageId: null,
          scheduledMessageId: null,
          source: null,
          automationRuleCode: null,
          structuredContext: null,
        })),
      ...scheduledMessages
        .filter(
          (message) =>
            message.userId === input.userId &&
            message.conversationId === input.conversationId &&
            (!message.coachMessage ||
              message.coachMessage.userId === input.userId) &&
            (message.sentAt ?? message.scheduledFor) <= referenceDate,
        )
        .map((message) => ({
          direction: MessageDirection.OUTBOUND,
          content: message.content,
          timestamp: message.sentAt ?? message.scheduledFor,
          priority: 1,
          externalMessageId: message.externalMessageId,
          replyToExternalMessageId: null,
          scheduledMessageId: message.id,
          source: this.contextSource(message.context),
          automationRuleCode:
            message.automationRule?.code ??
            this.contextRuleCode(message.context),
          structuredContext: this.contextRecord(
            message.coachMessage?.context ?? message.context,
          ),
        })),
    ]
      .sort(
        (left, right) =>
          right.timestamp.getTime() - left.timestamp.getTime() ||
          left.priority - right.priority,
      )
      .filter((message, index, entries) => {
        const key = `${message.direction}:${message.content.trim()}`;
        return (
          entries.findIndex(
            (candidate) =>
              `${candidate.direction}:${candidate.content.trim()}` === key,
          ) === index
        );
      })
      .slice(0, 8)
      .reverse();
    const history = merged.map((message, index) =>
      Object.freeze({
        logicalTurn: index + 1,
        direction: message.direction,
        text: message.content,
        occurredAt: message.timestamp.toISOString(),
        externalMessageId: message.externalMessageId,
        replyToExternalMessageId: message.replyToExternalMessageId,
        scheduledMessageId: message.scheduledMessageId,
        source: message.source,
        automationRuleCode: message.automationRuleCode,
        structuredContext: message.structuredContext,
      }),
    );
    const activeCycle =
      input.proactiveReply || foundActiveCycle?.userId !== input.userId
        ? null
        : foundActiveCycle;
    const currentLogicalTurn = Math.max(
      history.length + 1,
      (activeCycle?.logicalTurn ?? 0) + 1,
    );
    const conversationContext = this.profileAcquisitionContext(input.text);
    const adaptiveDecision = this.collector.decide({
      snapshot,
      intent: this.collectorIntent(input.legacyIntent),
      conversationContext,
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
      replyToExternalMessageId: input.replyToExternalMessageId ?? null,
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
    const humanContext = this.humanContextBuilder.build(snapshot, {
      expectedUserId: input.userId,
      currentMessage: input.text,
      recentHistory: history,
    });
    return Object.freeze({
      understandingInput,
      snapshot,
      adaptiveDecision,
      preparationBase,
      humanContext,
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

  private profileAcquisitionContext(
    text: string,
  ): ProfileAcquisitionConversationContext {
    const modality = this.entityRecognizer
      .recognize(this.normalizer.normalize(text))
      .entities.find(
        (
          entity,
        ): entity is Extract<
          ConversationEntity,
          { kind: 'WORKOUT_MODALITY' }
        > => entity.kind === 'WORKOUT_MODALITY',
      );
    return Object.freeze({
      modality: modality
        ? Object.freeze({
            value: profileAcquisitionModalityFromWorkoutModality(
              modality.value,
            ),
            evidence: 'EXPLICIT' as const,
          })
        : undefined,
    });
  }

  private targetPlan(
    intent: ConversationLegacyIntent,
  ): 'DIET' | 'WORKOUT' | 'BOTH' | null {
    return intent === 'UNKNOWN' ? null : intent;
  }

  private contextRecord(
    value: unknown,
  ): Readonly<Record<string, unknown>> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.freeze({ ...(value as Record<string, unknown>) })
      : null;
  }

  private contextSource(value: unknown): string | null {
    const context = this.contextRecord(value);
    return typeof context?.source === 'string' ? context.source : null;
  }

  private contextRuleCode(value: unknown): string | null {
    const context = this.contextRecord(value);
    return typeof context?.ruleCode === 'string' ? context.ruleCode : null;
  }
}
