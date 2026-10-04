import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MessageDirection,
  MessageType,
  ScheduledMessageStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COACH_PROACTIVE_SOURCE,
  COACH_PROACTIVE_INTENTS,
} from '../../automation/coach-proactive.contract';
import { ConversationRuntimeOperationalConfigService } from './conversation-runtime-operational-config.service';
import {
  continuation,
  continuationJson,
  parseContinuation,
  record,
  CONTINUATION_WINDOW_MS,
  type PendingContinuation,
  type ContinuationReply,
} from './conversation-continuation.contract';

@Injectable()
export class ConversationContinuationStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConversationRuntimeOperationalConfigService,
  ) {}
  enabled(userId: string): boolean {
    const config = this.config.get();
    return (
      config.valid &&
      !config.killSwitch &&
      this.config.isOfficiallyEligible(userId, config)
    );
  }
  private assertEnabled(userId: string): void {
    if (!this.enabled(userId))
      throw new ConflictException(
        'Continuation runtime disabled during mutation',
      );
  }
  /** Durable at-most-once semantic attempt. No DB transaction spans provider I/O.
   * An abandoned attempt fails closed after its budget; it is never taken over
   * by another provider call. The token fences a late original worker.
   * This non-dispatchable receipt reuses the outbox's unique identity ledger;
   * PROCESSED keeps workers from claiming it. It is not a public CoachMessage
   * and cannot inflate coaching/engagement history.
   * processedAt stays null deliberately: the existing operational cleanup only
   * deletes PROCESSED events older than processedAt. This identity must survive
   * that cleanup to fence old inbound replays. Completion time lives in payload.
   */
  async resolveOnce(
    userId: string,
    messageId: string,
    type: MessageType,
    execute: () => Promise<ContinuationReply | null>,
    fallback: ContinuationReply,
  ): Promise<ContinuationReply | null> {
    if (!this.enabled(userId)) return null;
    const source = await this.source(userId, messageId, type);
    if (!source) return null;
    const idempotencyKey = `${userId}:CONTINUATION_SEMANTICS:${source.conversationId}:${messageId}:${type}`;
    const identity = {
      eventType: 'CONTINUATION_SEMANTIC_RECEIPT',
      aggregateType: 'CONTINUATION_MESSAGE',
      aggregateId: idempotencyKey,
    };
    const token = randomUUID();
    const gate = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;
      if (!this.enabled(userId)) return null;
      const existing = await tx.outboxEvent.findUnique({
        where: { eventType_aggregateType_aggregateId: identity },
      });
      if (existing) {
        if (
          !record(existing.payload) ||
          existing.payload.userId !== userId ||
          existing.payload.conversationId !== source.conversationId ||
          existing.payload.sourceMessageId !== messageId
        )
          throw new ConflictException(
            'Continuation semantic ownership mismatch',
          );
        if (existing.payload.state === 'COMPLETED')
          return { owner: false, row: existing };
        if (existing.createdAt.getTime() + 180_000 > Date.now())
          throw new ConflictException(
            'Continuation semantic attempt in progress',
          );
        // Recovery emits a safe result without repeating an uncertain external call.
        const row = await tx.outboxEvent.update({
          where: { id: existing.id },
          data: {
            processedAt: null,
            payload: {
              ...existing.payload,
              state: 'COMPLETED',
              completedAt: new Date().toISOString(),
              token,
              result: this.json(fallback),
            },
          },
        });
        this.assertEnabled(userId);
        return { owner: false, row };
      }
      const row = await tx.outboxEvent.create({
        data: {
          ...identity,
          status: 'PROCESSED',
          processedAt: null,
          payload: {
            source: 'CONVERSATION_CONTINUATION_GATE',
            userId,
            conversationId: source.conversationId,
            sourceMessageId: messageId,
            state: 'PROCESSING',
            token,
          },
        },
      });
      this.assertEnabled(userId);
      return { owner: true, row };
    });
    if (!gate || !this.enabled(userId)) return null;
    if (!gate.owner) return this.cachedReply(gate.row.payload);
    let result: ContinuationReply | null;
    try {
      result = await execute();
    } catch {
      result = fallback;
    }
    if (!this.enabled(userId)) return null;
    const currentSource = await this.source(userId, messageId, type);
    if (
      !currentSource ||
      currentSource.conversationId !== source.conversationId
    )
      return null;
    const saved = await this.prisma.$transaction(async (tx) => {
      this.assertEnabled(userId);
      const mutation = await tx.outboxEvent.updateMany({
        where: {
          id: gate.row.id,
          ...identity,
          payload: { equals: gate.row.payload as Prisma.InputJsonObject },
        },
        data: {
          processedAt: null,
          payload: {
            ...(gate.row.payload as Prisma.InputJsonObject),
            state: 'COMPLETED',
            completedAt: new Date().toISOString(),
            result: this.json(result),
          },
        },
      });
      this.assertEnabled(userId);
      return mutation;
    });
    if (saved.count !== 1)
      throw new ConflictException('Continuation semantic attempt superseded');
    return result;
  }
  private json(value: ContinuationReply | null): Prisma.InputJsonValue | null {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue | null;
  }
  private cachedReply(context: unknown): ContinuationReply | null {
    if (!record(context) || context.result === null) return null;
    const result = context.result;
    if (
      !record(result) ||
      typeof result.content !== 'string' ||
      !record(result.evidence)
    )
      throw new ConflictException('Invalid continuation semantic replay');
    return result as unknown as ContinuationReply;
  }
  private async lockReceipt(
    tx: Prisma.TransactionClient,
    userId: string,
    conversationId: string,
    id: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "scheduled_messages"
      WHERE "id" = ${id} AND "userId" = ${userId} AND "conversationId" = ${conversationId}
      FOR UPDATE`;
  }
  async source(userId: string, messageId: string, type: MessageType) {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        type,
        direction: MessageDirection.INBOUND,
        conversation: { userId, status: 'ACTIVE' },
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        conversationId: true,
        replyToExternalMessageId: true,
        conversation: {
          select: {
            userId: true,
            user: { select: { preferences: { select: { timezone: true } } } },
          },
        },
      },
    });
    return message?.id === messageId &&
      message.conversation.userId === userId &&
      Number.isFinite(message.timestamp.getTime())
      ? message
      : null;
  }
  async pending(
    userId: string,
    message: {
      conversationId: string;
      timestamp: Date;
      replyToExternalMessageId: string | null;
    },
  ): Promise<PendingContinuation | null> {
    const imageFollowUp = await this.pendingMediaFollowUp(userId, message);
    if (imageFollowUp) return imageFollowUp;
    let candidate = await this.prisma.scheduledMessage.findFirst({
      where: {
        userId,
        conversationId: message.conversationId,
        conversation: { userId, status: 'ACTIVE' },
        status: ScheduledMessageStatus.SENT,
        ...(message.replyToExternalMessageId
          ? { externalMessageId: message.replyToExternalMessageId }
          : { sentAt: { lte: message.timestamp } }),
      },
      orderBy: [{ sentAt: 'desc' }, { scheduledFor: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        conversationId: true,
        content: true,
        context: true,
        sentAt: true,
        scheduledFor: true,
        responseExpiresAt: true,
        responseMessageId: true,
      },
    });
    if (
      candidate &&
      record(candidate.context) &&
      candidate.context.deliveryMode === 'ORDERED_COACH_RESPONSE_BATCH' &&
      typeof candidate.context.sourceMessageId === 'string'
    ) {
      const origin = await this.source(
        userId,
        candidate.context.sourceMessageId,
        MessageType.TEXT,
      );
      if (!origin || origin.conversationId !== message.conversationId)
        return null;
      const root = await this.prisma.scheduledMessage.findFirst({
        where: {
          userId,
          conversationId: message.conversationId,
          conversation: { userId, status: 'ACTIVE' },
          status: 'SENT',
          sentAt: { lte: message.timestamp },
          AND: [
            {
              context: {
                path: ['sourceMessageId'],
                equals: candidate.context.sourceMessageId,
              },
            },
            { context: { path: ['partIndex'], equals: 0 } },
          ],
        },
        select: {
          id: true,
          userId: true,
          conversationId: true,
          content: true,
          context: true,
          sentAt: true,
          scheduledFor: true,
          responseExpiresAt: true,
          responseMessageId: true,
        },
      });
      if (
        !root ||
        !record(root.context) ||
        root.context.deliveryMode !== 'ORDERED_COACH_RESPONSE_BATCH'
      )
        return null;
      candidate = root;
    }
    if (
      !candidate ||
      candidate.userId !== userId ||
      candidate.conversationId !== message.conversationId ||
      !record(candidate.context) ||
      candidate.responseMessageId ||
      candidate.context.continuationConsumedBy
    )
      return null;
    const sent = candidate.sentAt ?? candidate.scheduledFor;
    if (
      sent > message.timestamp ||
      sent.getTime() + CONTINUATION_WINDOW_MS <= message.timestamp.getTime() ||
      (candidate.responseExpiresAt &&
        candidate.responseExpiresAt <= message.timestamp)
    )
      return null;
    if (!message.replyToExternalMessageId) {
      const intervening = await this.prisma.outboundMessage.findFirst({
        where: {
          userId,
          conversationId: message.conversationId,
          sentAt: { gt: sent, lt: message.timestamp },
        },
        select: { id: true },
      });
      if (intervening) return null;
    }
    let parsed = parseContinuation(
      candidate.context.continuation,
      message.timestamp,
    );
    if (
      !Object.hasOwn(candidate.context, 'continuation') &&
      candidate.context.source === COACH_PROACTIVE_SOURCE
    ) {
      const intent = candidate.context.intent;
      const kind =
        intent === COACH_PROACTIVE_INTENTS.WORKOUT_CHECK
          ? 'WORKOUT_COMPLETION_CHECK'
          : intent === COACH_PROACTIVE_INTENTS.HYDRATION_CHECK
            ? 'HYDRATION_CHECK'
            : [
                  COACH_PROACTIVE_INTENTS.LUNCH_CHECK,
                  COACH_PROACTIVE_INTENTS.DINNER_CHECK,
                  COACH_PROACTIVE_INTENTS.MEAL_PLAN_CHECK,
                ].includes(intent as 'LUNCH_CHECK')
              ? 'MEAL_COMPLETION_CHECK'
              : null;
      if (kind)
        parsed = continuation(
          kind,
          sent,
          intent === COACH_PROACTIVE_INTENTS.LUNCH_CHECK
            ? 'LUNCH'
            : intent === COACH_PROACTIVE_INTENTS.DINNER_CHECK
              ? 'DINNER'
              : 'UNKNOWN',
          'AUTOMATION',
        );
    }
    const evidence = candidate.context.continuationEvidence;
    return parsed
      ? {
          scheduledMessageId: candidate.id,
          question: candidate.content,
          continuation: parsed,
          reportedContent:
            record(evidence) && typeof evidence.reportedContent === 'string'
              ? evidence.reportedContent
              : undefined,
          reportedContentEstimated:
            record(evidence) && evidence.estimated === true,
        }
      : null;
  }
  private async pendingMediaFollowUp(
    userId: string,
    message: {
      conversationId: string;
      timestamp: Date;
      replyToExternalMessageId: string | null;
    },
  ): Promise<PendingContinuation | null> {
    const outbound = await this.prisma.outboundMessage.findFirst({
      where: {
        userId,
        conversationId: message.conversationId,
        status: { in: ['SENT', 'DELIVERED'] },
        sentAt: { lte: message.timestamp },
        ...(message.replyToExternalMessageId
          ? { externalMessageId: message.replyToExternalMessageId }
          : {}),
      },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: {
        userId: true,
        conversationId: true,
        sourceMessageId: true,
        content: true,
        sentAt: true,
      },
    });
    if (
      !outbound ||
      outbound.userId !== userId ||
      outbound.conversationId !== message.conversationId ||
      !outbound.sentAt ||
      outbound.sentAt > message.timestamp
    )
      return null;
    const mediaSource = await this.source(
      userId,
      outbound.sourceMessageId,
      MessageType.IMAGE,
    );
    if (!mediaSource || mediaSource.conversationId !== message.conversationId)
      return null;
    if (!message.replyToExternalMessageId) {
      const newer = await this.prisma.scheduledMessage.findFirst({
        where: {
          userId,
          conversationId: message.conversationId,
          status: 'SENT',
          sentAt: { gt: outbound.sentAt, lte: message.timestamp },
        },
        select: { id: true },
      });
      if (newer) return null;
    }
    const receipt = await this.prisma.scheduledMessage.findFirst({
      where: {
        userId,
        conversationId: message.conversationId,
        responseMessageId: outbound.sourceMessageId,
        status: 'SENT',
      },
      select: { id: true, userId: true, conversationId: true, context: true },
    });
    if (
      !receipt ||
      receipt.userId !== userId ||
      receipt.conversationId !== message.conversationId ||
      !record(receipt.context) ||
      receipt.context.mediaFollowUpConsumedBy ||
      receipt.context.mediaReceiptState !== 'COMPLETE' ||
      receipt.context.mediaReceiptMessageId !== outbound.sourceMessageId
    )
      return null;
    const parsed = parseContinuation(
      receipt.context.mediaFollowUp,
      message.timestamp,
    );
    return parsed
      ? {
          scheduledMessageId: receipt.id,
          question: outbound.content,
          continuation: parsed,
          receiptMessageId: outbound.sourceMessageId,
          reportedContent:
            typeof receipt.context.mediaReportedContent === 'string'
              ? receipt.context.mediaReportedContent
              : undefined,
          reportedContentEstimated: true,
        }
      : null;
  }
  async claim(
    transaction: Prisma.TransactionClient,
    userId: string,
    conversationId: string,
    messageId: string,
    reply: ContinuationReply,
    at: Date,
  ): Promise<boolean> {
    if (!this.enabled(userId)) return false;
    const consumer = await transaction.message.findFirst({
      where: {
        id: messageId,
        conversationId,
        type: 'TEXT',
        direction: 'INBOUND',
        conversation: { userId, status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!consumer || consumer.id !== messageId) return false;
    if (!reply.pending) return true;
    await this.lockReceipt(
      transaction,
      userId,
      conversationId,
      reply.pending.scheduledMessageId,
    );
    if (!this.enabled(userId)) return false;
    if (reply.pending.receiptMessageId) {
      const mediaSource = await transaction.message.findFirst({
        where: {
          id: reply.pending.receiptMessageId,
          conversationId,
          type: 'IMAGE',
          direction: 'INBOUND',
          conversation: { userId, status: 'ACTIVE' },
        },
        select: { id: true },
      });
      if (!mediaSource || mediaSource.id !== reply.pending.receiptMessageId)
        return false;
      const receipt = await transaction.scheduledMessage.findFirst({
        where: {
          id: reply.pending.scheduledMessageId,
          userId,
          conversationId,
          responseMessageId: reply.pending.receiptMessageId,
          status: 'SENT',
        },
        select: { context: true },
      });
      if (
        !receipt ||
        !record(receipt.context) ||
        receipt.context.mediaFollowUpConsumedBy ||
        receipt.context.mediaReceiptState !== 'COMPLETE' ||
        receipt.context.mediaReceiptMessageId !== reply.pending.receiptMessageId
      )
        return false;
      const result = await transaction.scheduledMessage.updateMany({
        where: {
          id: reply.pending.scheduledMessageId,
          userId,
          conversationId,
          responseMessageId: reply.pending.receiptMessageId,
          context: { equals: receipt.context as Prisma.InputJsonObject },
        },
        data: {
          context: {
            ...receipt.context,
            mediaFollowUpConsumedBy: messageId,
          } as Prisma.InputJsonObject,
        },
      });
      return result.count === 1;
    }
    const claimed = await transaction.scheduledMessage.updateMany({
      where: {
        id: reply.pending.scheduledMessageId,
        userId,
        conversationId,
        responseMessageId: null,
        status: ScheduledMessageStatus.SENT,
      },
      data: {
        responseMessageId: messageId,
        respondedAt: at,
        responseOutcome: reply.outcome,
      },
    });
    return claimed.count === 1;
  }
  async bindMedia(userId: string, messageId: string): Promise<void> {
    if (!this.enabled(userId)) return;
    const message = await this.source(userId, messageId, MessageType.IMAGE);
    if (!message) return;
    const pending = await this.pending(userId, message);
    if (!pending || pending.continuation.domain !== 'NUTRITION') return;
    // The source row is the durable receipt. Retries locate it by responseMessageId.
    await this.prisma.$transaction(async (tx) => {
      await this.lockReceipt(
        tx,
        userId,
        message.conversationId,
        pending.scheduledMessageId,
      );
      if (!this.enabled(userId)) return;
      const candidate = await tx.scheduledMessage.findFirst({
        where: {
          id: pending.scheduledMessageId,
          userId,
          conversationId: message.conversationId,
          status: 'SENT',
          responseMessageId: null,
        },
        select: { userId: true, conversationId: true, context: true },
      });
      if (
        !candidate ||
        candidate.userId !== userId ||
        candidate.conversationId !== message.conversationId ||
        !record(candidate.context)
      )
        return;
      await tx.scheduledMessage.updateMany({
        where: {
          id: pending.scheduledMessageId,
          userId,
          conversationId: message.conversationId,
          responseMessageId: null,
          status: 'SENT',
        },
        data: {
          responseMessageId: messageId,
          respondedAt: message.timestamp,
          responseOutcome: 'UNKNOWN',
          context: {
            ...candidate.context,
            mediaContinuation: continuationJson(pending.continuation),
            mediaReceiptState: 'BOUND',
            mediaReceiptMessageId: messageId,
          } as Prisma.InputJsonObject,
        },
      });
      this.assertEnabled(userId);
    });
  }
  async releaseMedia(userId: string, messageId: string): Promise<void> {
    if (!this.enabled(userId)) return;
    const message = await this.source(userId, messageId, MessageType.IMAGE);
    if (!message) return;
    await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.scheduledMessage.findFirst({
        where: {
          userId,
          conversationId: message.conversationId,
          responseMessageId: messageId,
          status: 'SENT',
        },
        select: { id: true, context: true },
      });
      if (!candidate) return;
      await this.lockReceipt(tx, userId, message.conversationId, candidate.id);
      if (!this.enabled(userId)) return;
      const receipt = await tx.scheduledMessage.findFirst({
        where: {
          id: candidate.id,
          userId,
          conversationId: message.conversationId,
          responseMessageId: messageId,
          status: 'SENT',
        },
        select: { id: true, context: true },
      });
      if (
        !receipt ||
        !record(receipt.context) ||
        receipt.context.mediaReply ||
        receipt.context.mediaFollowUpConsumedBy ||
        receipt.context.mediaReceiptState !== 'BOUND' ||
        receipt.context.mediaReceiptMessageId !== messageId ||
        !parseContinuation(receipt.context.mediaContinuation, message.timestamp)
      )
        return;
      await tx.scheduledMessage.updateMany({
        where: {
          id: receipt.id,
          userId,
          conversationId: message.conversationId,
          responseMessageId: messageId,
          context: { equals: receipt.context as Prisma.InputJsonObject },
        },
        data: {
          responseMessageId: null,
          respondedAt: null,
          responseOutcome: null,
          context: {
            ...receipt.context,
            mediaReceiptState: 'RELEASED',
            mediaContinuation: null,
          } as Prisma.InputJsonObject,
        },
      });
      this.assertEnabled(userId);
    });
  }
  async completeMedia(
    transaction: Prisma.TransactionClient,
    userId: string,
    conversationId: string,
    messageId: string,
    reply: ContinuationReply,
  ): Promise<boolean> {
    if (!this.enabled(userId) || !reply.pending) return false;
    const source = await transaction.message.findFirst({
      where: {
        id: messageId,
        conversationId,
        type: 'IMAGE',
        direction: 'INBOUND',
        conversation: { userId, status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!source || source.id !== messageId)
      throw new ConflictException(
        'Meal continuation source ownership mismatch',
      );
    await this.lockReceipt(
      transaction,
      userId,
      conversationId,
      reply.pending.scheduledMessageId,
    );
    if (!this.enabled(userId)) return false;
    const receipt = await transaction.scheduledMessage.findFirst({
      where: {
        id: reply.pending.scheduledMessageId,
        userId,
        conversationId,
        responseMessageId: messageId,
        status: 'SENT',
      },
      select: { context: true },
    });
    if (!receipt || !record(receipt.context))
      throw new Error('Meal continuation receipt ownership mismatch');
    if (receipt.context.mediaReceiptMessageId !== messageId)
      throw new ConflictException(
        'Meal continuation source relationship mismatch',
      );
    if (
      receipt.context.mediaReceiptState === 'COMPLETE' &&
      receipt.context.mediaReply
    )
      return true;
    if (
      receipt.context.mediaReceiptState !== 'BOUND' ||
      receipt.context.mediaReceiptMessageId !== messageId
    )
      throw new ConflictException('Meal continuation receipt state mismatch');
    const completed = await transaction.scheduledMessage.updateMany({
      where: {
        id: reply.pending.scheduledMessageId,
        userId,
        conversationId,
        responseMessageId: messageId,
        context: { equals: receipt.context as Prisma.InputJsonObject },
      },
      data: {
        context: {
          ...receipt.context,
          mediaReceiptState: 'COMPLETE',
          mediaReply: {
            content: reply.content,
            evidence: reply.evidence,
            next: continuationJson(reply.next),
          },
          mediaFollowUp: continuationJson(reply.next),
          mediaReportedContent: reply.evidence.reportedContent ?? null,
        } as Prisma.InputJsonObject,
      },
    });
    if (completed.count !== 1)
      throw new ConflictException('Meal continuation receipt changed');
    this.assertEnabled(userId);
    return true;
  }
}
