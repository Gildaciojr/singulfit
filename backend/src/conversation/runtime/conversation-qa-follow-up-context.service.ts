import { Injectable } from '@nestjs/common';
import {
  AIJobStatus,
  AIJobType,
  MessageDirection,
  MessageType,
  ScheduledMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTIVE_CONVERSATION_QA_PROMPT } from './conversation-qa-capability';
import { ConversationPublicAnswerBoundaryService } from './conversation-public-answer-boundary.service';
import { normalizeConversationQACandidate } from './conversation-qa-candidate-normalizer';
import { nutritionRequest } from '../understanding/nutrition-request.policy';
import { currentWorkoutModality } from '../../workout/v2/workout-modality-resolution.service';
import { WorkoutPlanV2Parser } from '../../workout/v2/workout-plan-v2.parser';
import {
  WORKOUT_PLANNING_V2_PROMPT,
  WORKOUT_PLANNING_V2_PROMPT_V7,
} from '../../workout/v2/workout-planning-v2.prompt.definition';
import type { ConversationAnswerCandidate } from './conversation-qa.contract';
import {
  effectiveNutritionRequest,
  readOnlyFollowUp,
  type CurrentReadOnlyReferent,
} from './conversation-read-only-referent.policy';

export interface ConversationQAFollowUpLookupInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
}

export interface ConversationQAFollowUpContext {
  readonly sourceMessageId: string;
  readonly previousAnswer: string;
  readonly previousFollowUpQuestion: string;
}

@Injectable()
export class ConversationQAFollowUpContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boundary: ConversationPublicAnswerBoundaryService,
  ) {}

  async hasBlockingLifecycle(
    input: ConversationQAFollowUpLookupInput,
    at: Date,
  ): Promise<boolean> {
    const [mutation, profile] = await Promise.all([
      this.prisma.pendingConversationAction?.findFirst({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          expiresAt: { gt: at },
          status: {
            in: ['PENDING', 'CONSUMED_PENDING_EXECUTION', 'EXECUTING'],
          },
        },
        select: { id: true },
      }),
      this.prisma.coachProfileAcquisitionCycle?.findFirst({
        where: {
          userId: input.userId,
          active: true,
          expiresAt: { gt: at },
          status: { in: ['ASKED', 'CONFIRMATION_PENDING'] },
        },
        select: { id: true },
      }),
    ]);
    return Boolean(mutation || profile);
  }

  async findReferent(
    input: ConversationQAFollowUpLookupInput,
  ): Promise<CurrentReadOnlyReferent | null> {
    const current = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
        type: 'TEXT',
        direction: 'INBOUND',
      },
      select: { timestamp: true, replyToExternalMessageId: true },
    });
    if (!current || (await this.hasBlockingLifecycle(input, current.timestamp)))
      return null;
    return this.deliveredReferent(
      input,
      current.timestamp,
      current.replyToExternalMessageId,
      0,
    );
  }

  private async deliveredReferent(
    input: ConversationQAFollowUpLookupInput,
    before: Date,
    quote: string | null,
    depth: number,
  ): Promise<CurrentReadOnlyReferent | null> {
    if (depth >= 4) return null;
    const row = await this.prisma.scheduledMessage.findFirst({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        status: 'SENT',
        sentAt: { lt: before, gt: new Date(before.getTime() - 86_400_000) },
        ...(quote ? { externalMessageId: quote } : {}),
      },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        conversationId: true,
        content: true,
        context: true,
        sentAt: true,
      },
    });
    if (
      !row ||
      row.userId !== input.userId ||
      row.conversationId !== input.conversationId ||
      !row.sentAt ||
      row.sentAt >= before ||
      !this.record(row.context) ||
      row.context.source !== 'WHATSAPP_COACH_COMMAND' ||
      typeof row.context.sourceMessageId !== 'string'
    )
      return null;
    const source = await this.prisma.message.findFirst({
      where: {
        id: row.context.sourceMessageId,
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
        direction: 'INBOUND',
        type: 'TEXT',
        timestamp: { lt: before },
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        replyToExternalMessageId: true,
      },
    });
    if (
      !source ||
      source.id !== row.context.sourceMessageId ||
      source.timestamp >= row.sentAt
    )
      return null;
    const job = await this.prisma.aIJob.findFirst({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: source.id,
        type: 'TEXT',
        status: 'COMPLETED',
        completedAt: { lte: row.sentAt },
        promptVersion: { name: ACTIVE_CONVERSATION_QA_PROMPT.name },
      },
      select: { result: true },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
    });
    const candidate = this.validReferentCandidate(job?.result)
      ? normalizeConversationQACandidate(job.result)
      : null;
    const publicText = candidate ? this.boundary.project(candidate) : null;
    if (candidate && (!publicText || !candidate.answer)) return null;
    let delivered = row.content;
    if (
      typeof row.context.partCount === 'number' &&
      row.context.partCount > 1
    ) {
      const parts = await this.prisma.scheduledMessage.findMany({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          context: { path: ['sourceMessageId'], equals: source.id },
          status: 'SENT',
          sentAt: { lt: before },
        },
        select: { content: true, context: true },
        orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      });
      if (
        parts.length !== row.context.partCount ||
        parts.some(
          (part, index) =>
            !this.record(part.context) || part.context.partIndex !== index,
        )
      )
        return null;
      delivered = parts.map((part) => part.content).join(' ');
    }
    if (
      candidate &&
      delivered.replace(/\s+/gu, ' ').trim() !==
        publicText!.replace(/\s+/gu, ' ').trim()
    )
      return null;
    if (!quote) {
      const newerOutbound = await this.prisma.message.findFirst({
        where: {
          conversationId: input.conversationId,
          conversation: { userId: input.userId },
          direction: 'OUTBOUND',
          timestamp: { gt: row.sentAt, lt: before },
        },
        select: { content: true, timestamp: true },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      });
      if (
        newerOutbound &&
        newerOutbound.timestamp > row.sentAt &&
        newerOutbound.content.replace(/\s+/gu, ' ').trim() !==
          (publicText ?? delivered).replace(/\s+/gu, ' ').trim()
      )
        return null;
    }
    if (!candidate) {
      const evidence = currentWorkoutModality(source.content);
      if (
        !evidence.modality ||
        !['PLAN_REQUEST', 'MODALITY_CHANGE'].includes(evidence.action)
      )
        return null;
      const workout = await this.prisma.aIJob.findFirst({
        where: {
          userId: input.userId,
          type: 'WORKOUT',
          status: 'COMPLETED',
          createdAt: { gte: source.timestamp, lte: row.sentAt },
          completedAt: { gte: source.timestamp, lte: row.sentAt },
          promptVersion: {
            name: {
              in: [
                WORKOUT_PLANNING_V2_PROMPT.name,
                WORKOUT_PLANNING_V2_PROMPT_V7.name,
              ],
            },
          },
        },
        select: {
          userId: true,
          result: true,
          createdAt: true,
          completedAt: true,
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      });
      if (
        !workout ||
        workout.userId !== input.userId ||
        !workout.completedAt ||
        workout.createdAt < source.timestamp ||
        workout.createdAt > row.sentAt ||
        workout.completedAt < workout.createdAt ||
        workout.completedAt > row.sentAt ||
        !this.record(workout.result) ||
        typeof workout.result.candidateOutput !== 'string'
      )
        return null;
      try {
        const plan = new WorkoutPlanV2Parser().parse(
          workout.result.candidateOutput,
        );
        if (
          plan.modality !== evidence.modality ||
          !plan.sessions.length ||
          !plan.sessions.every((session) => delivered.includes(session.label))
        )
          return null;
        return Object.freeze({
          source: 'DELIVERED_WORKOUT',
          sourceMessageId: source.id,
          domain: 'WORKOUT',
          workoutModality: plan.modality,
          nutrition: null,
          previousAnswer: delivered,
          followUpQuestion: null,
          deliveredAt: row.sentAt.toISOString(),
        });
      } catch {
        return null;
      }
    }
    if (!candidate.answer) return null;
    let nutrition = nutritionRequest(source.content);
    const followUp = readOnlyFollowUp(source.content);
    if (!nutrition && followUp) {
      const prior = await this.deliveredReferent(
        input,
        source.timestamp,
        source.replyToExternalMessageId ?? null,
        depth + 1,
      );
      nutrition = prior ? effectiveNutritionRequest(followUp, prior) : null;
    }
    return Object.freeze({
      source: 'DELIVERED_QA',
      sourceMessageId: source.id,
      domain: candidate.domain,
      nutrition,
      previousAnswer: candidate.answer,
      followUpQuestion: candidate.followUpQuestion,
      deliveredAt: row.sentAt.toISOString(),
    });
  }

  async findPending(
    input: ConversationQAFollowUpLookupInput,
  ): Promise<ConversationQAFollowUpContext | null> {
    const current = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
      },
      select: { timestamp: true },
    });
    if (!current) return null;

    const tiedInbound = await this.prisma.message.findFirst({
      where: {
        id: { not: input.messageId },
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        timestamp: current.timestamp,
      },
      select: { id: true },
    });
    if (tiedInbound) return null;

    const previous = await this.prisma.message.findFirst({
      where: {
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        timestamp: { lt: current.timestamp },
      },
      select: { id: true, timestamp: true },
      orderBy: [{ timestamp: 'desc' }, { createdAt: 'desc' }],
    });
    if (!previous) return null;
    if (
      current.timestamp.getTime() - previous.timestamp.getTime() >=
      24 * 60 * 60 * 1_000
    )
      return null;

    const job = await this.prisma.aIJob.findFirst({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: previous.id,
        type: AIJobType.TEXT,
        status: AIJobStatus.COMPLETED,
        completedAt: { lt: current.timestamp },
        promptVersion: {
          name: ACTIVE_CONVERSATION_QA_PROMPT.name,
          isActive: true,
        },
      },
      select: { result: true },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const result = this.result(job?.result);
    if (!result) return null;

    const idempotencyKey = `${input.userId}:WHATSAPP_COACH_COMMAND:${previous.id}`;
    const coachMessage = await this.prisma.coachMessage.findUnique({
      where: { idempotencyKey },
      select: { content: true },
    });
    if (!coachMessage) return null;

    const projectedAnswer = this.boundary.projectText(result.answer);
    const previousFollowUpQuestion = this.boundary.projectText(
      result.followUpQuestion,
    );
    if (!projectedAnswer || !previousFollowUpQuestion) return null;
    const previousAnswer = this.materializedAnswer(
      coachMessage.content,
      projectedAnswer,
      previousFollowUpQuestion,
    );
    if (!previousAnswer) return null;

    const sent = await this.prisma.scheduledMessage.findFirst({
      where: {
        userId: input.userId,
        status: ScheduledMessageStatus.SENT,
        conversationId: input.conversationId,
        context: { path: ['sourceMessageId'], equals: previous.id },
        content: coachMessage.content,
        scheduledFor: {
          gte: previous.timestamp,
          lt: current.timestamp,
        },
      },
      select: { id: true },
      orderBy: [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
    });
    return sent
      ? Object.freeze({
          sourceMessageId: previous.id,
          previousAnswer,
          previousFollowUpQuestion,
        })
      : null;
  }

  private result(
    value: unknown,
  ): { readonly answer: string; readonly followUpQuestion: string } | null {
    if (!this.record(value)) return null;
    const answer = value.answer;
    const question = value.followUpQuestion;
    if (
      typeof answer !== 'string' ||
      answer.trim().length > 4_000 ||
      (question !== null && typeof question !== 'string')
    ) {
      return null;
    }
    const normalized = normalizeConversationQACandidate({
      answer,
      followUpQuestion: question,
    });
    return normalized.answer &&
      normalized.followUpQuestion &&
      normalized.followUpQuestion.trim().length <= 500
      ? Object.freeze({
          answer: normalized.answer.trim(),
          followUpQuestion: normalized.followUpQuestion.trim(),
        })
      : null;
  }

  private materializedAnswer(
    content: string,
    publicAnswer: string,
    publicFollowUp: string,
  ): string | null {
    const normalized = content.replace(/\r\n/gu, '\n').trim();
    return normalized === `${publicAnswer}\n\n${publicFollowUp}`
      ? publicAnswer
      : null;
  }

  private record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private validReferentCandidate(
    value: unknown,
  ): value is ConversationAnswerCandidate {
    return (
      this.record(value) &&
      value.disposition === 'ANSWER' &&
      typeof value.domain === 'string' &&
      ['NUTRITION', 'WORKOUT', 'PROGRESS', 'GENERAL'].includes(value.domain) &&
      typeof value.answer === 'string' &&
      value.answer.trim().length > 0 &&
      value.answer.length <= 4000 &&
      (value.followUpQuestion === null ||
        (typeof value.followUpQuestion === 'string' &&
          value.followUpQuestion.length <= 500)) &&
      typeof value.grounding === 'string' &&
      [
        'CURRENT_PLAN',
        'PROFILE',
        'RECENT_CONTEXT',
        'GENERAL_KNOWLEDGE',
        'MIXED',
      ].includes(value.grounding) &&
      typeof value.confidence === 'string' &&
      ['HIGH', 'MEDIUM', 'LOW'].includes(value.confidence)
    );
  }
}
