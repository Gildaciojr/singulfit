import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ConversationPlanReferenceInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly referenceDate: Date;
  readonly afterDate?: Date;
}

/** Resolves the actual preceding assistant turn; never searches past an intervening turn. */
@Injectable()
export class ConversationPlanReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async recentAssistant(
    input: ConversationPlanReferenceInput,
  ): Promise<string | null> {
    const inbound = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
        direction: 'INBOUND',
      },
      select: {
        id: true,
        timestamp: true,
        replyToExternalMessageId: true,
        conversation: { select: { id: true, userId: true } },
      },
    });
    if (
      !inbound ||
      inbound.id !== input.messageId ||
      inbound.conversation.userId !== input.userId ||
      inbound.conversation.id !== input.conversationId ||
      inbound.timestamp > input.referenceDate
    )
      return null;
    const quote = inbound.replyToExternalMessageId;
    const [scheduled, outbound, message] = await Promise.all([
      this.prisma.scheduledMessage.findFirst({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          status: 'SENT',
          sentAt: {
            lt: input.referenceDate,
            ...(input.afterDate ? { gte: input.afterDate } : {}),
          },
          ...(quote ? { externalMessageId: quote } : {}),
        },
        select: {
          userId: true,
          conversationId: true,
          content: true,
          sentAt: true,
          externalMessageId: true,
        },
        orderBy: { sentAt: 'desc' },
      }),
      this.prisma.outboundMessage.findFirst({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          status: { in: ['SENT', 'DELIVERED'] },
          sentAt: {
            lt: input.referenceDate,
            ...(input.afterDate ? { gte: input.afterDate } : {}),
          },
          ...(quote ? { externalMessageId: quote } : {}),
        },
        select: {
          userId: true,
          conversationId: true,
          content: true,
          sentAt: true,
          externalMessageId: true,
        },
        orderBy: { sentAt: 'desc' },
      }),
      this.prisma.message.findFirst({
        where: {
          conversationId: input.conversationId,
          conversation: { userId: input.userId },
          direction: 'OUTBOUND',
          timestamp: {
            lt: input.referenceDate,
            ...(input.afterDate ? { gte: input.afterDate } : {}),
          },
          ...(quote ? { externalMessageId: quote } : {}),
        },
        select: {
          content: true,
          timestamp: true,
          externalMessageId: true,
          conversation: { select: { userId: true, id: true } },
        },
        orderBy: { timestamp: 'desc' },
      }),
    ]);
    const candidates = [scheduled, outbound]
      .filter(
        (row) =>
          row &&
          row.userId === input.userId &&
          row.conversationId === input.conversationId &&
          row.sentAt &&
          row.sentAt < input.referenceDate &&
          (!input.afterDate || row.sentAt >= input.afterDate) &&
          (!quote || row.externalMessageId === quote),
      )
      .map((row) => ({ text: row!.content, at: row!.sentAt! }));
    if (
      message &&
      message.conversation.userId === input.userId &&
      message.conversation.id === input.conversationId &&
      message.timestamp < input.referenceDate &&
      (!input.afterDate || message.timestamp >= input.afterDate) &&
      (!quote || message.externalMessageId === quote)
    )
      candidates.push({ text: message.content, at: message.timestamp });
    candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
    if (
      !candidates.length ||
      input.referenceDate.getTime() - candidates[0].at.getTime() > 24 * 3600000
    )
      return null;
    const tied = candidates.filter(
      (row) => row.at.getTime() === candidates[0].at.getTime(),
    );
    return new Set(tied.map((row) => row.text)).size === 1
      ? candidates[0].text
      : null;
  }
}
