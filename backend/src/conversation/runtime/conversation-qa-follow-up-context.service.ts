import { Injectable } from '@nestjs/common';
import {
  AIJobStatus,
  AIJobType,
  MessageDirection,
  MessageType,
  ScheduledMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COACH_CONVERSATIONAL_QA_V2_PROMPT } from './coach-conversational-qa.prompt.definition';
import { ConversationPublicAnswerBoundaryService } from './conversation-public-answer-boundary.service';
import { normalizeConversationQACandidate } from './conversation-qa-candidate-normalizer';

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

    const job = await this.prisma.aIJob.findFirst({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: previous.id,
        type: AIJobType.TEXT,
        status: AIJobStatus.COMPLETED,
        completedAt: { lt: current.timestamp },
        promptVersion: {
          name: COACH_CONVERSATIONAL_QA_V2_PROMPT.name,
          version: COACH_CONVERSATIONAL_QA_V2_PROMPT.version,
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
}
