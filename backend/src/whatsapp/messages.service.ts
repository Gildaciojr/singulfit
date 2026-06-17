import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Message, MessageDirection, MessageType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from './conversations.service';
import { CreateInternalMessageDto } from './dto/create-internal-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';

const INTERNAL_INSTANCE_NAME = 'INTERNAL';

export interface CreateInboundMessageInput {
  userId: string;
  subscriptionId?: string;
  phoneNumber: string;
  instanceName: string;
  externalMessageId: string;
  type: MessageType;
  content: string;
  remoteJid: string;
  timestamp: Date;
  mediaUrl?: string;
  mimeType?: string;
  fileSize?: number;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async createInternal(data: CreateInternalMessageDto) {
    const conversation = await this.conversationsService.getOrCreateActive(
      data.userId,
    );
    const deliveredAt = data.deliveredAt
      ? new Date(data.deliveredAt)
      : undefined;
    const readAt = data.readAt ? new Date(data.readAt) : undefined;

    if (deliveredAt && readAt && readAt < deliveredAt) {
      throw new BadRequestException(
        'A leitura não pode ocorrer antes da entrega',
      );
    }

    if (data.externalMessageId) {
      const existing = await this.prisma.message.findUnique({
        where: {
          instanceName_externalMessageId: {
            instanceName: INTERNAL_INSTANCE_NAME,
            externalMessageId: data.externalMessageId,
          },
        },
      });

      if (existing) {
        this.assertIdempotentMessage(existing, conversation.id, data);
        return existing;
      }
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const message = await transaction.message.create({
          data: {
            conversationId: conversation.id,
            direction: data.direction,
            type: data.type,
            content: data.content.trim(),
            instanceName: INTERNAL_INSTANCE_NAME,
            externalMessageId: data.externalMessageId,
            timestamp: new Date(),
            deliveredAt,
            readAt,
          },
        });

        await transaction.conversation.update({
          where: {
            id: conversation.id,
          },
          data: {
            lastMessageAt: message.createdAt,
          },
        });

        return message;
      });
    } catch (error: unknown) {
      if (
        data.externalMessageId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrentMessage = await this.prisma.message.findUnique({
          where: {
            instanceName_externalMessageId: {
              instanceName: INTERNAL_INSTANCE_NAME,
              externalMessageId: data.externalMessageId,
            },
          },
        });

        if (concurrentMessage) {
          this.assertIdempotentMessage(
            concurrentMessage,
            conversation.id,
            data,
          );
          return concurrentMessage;
        }
      }

      throw error;
    }
  }

  async createInbound(
    data: CreateInboundMessageInput,
  ): Promise<{ message: Message; duplicated: boolean }> {
    const conversation = await this.conversationsService.getOrCreateActive(
      data.userId,
      {
        phoneNumber: data.phoneNumber,
        subscriptionId: data.subscriptionId,
      },
    );
    const existing = await this.findExternalMessage(
      data.instanceName,
      data.externalMessageId,
    );
    const conversationActivityAt =
      conversation.startedAt > data.timestamp
        ? conversation.startedAt
        : data.timestamp;

    if (existing) {
      this.assertIdempotentInbound(existing, conversation.id, data);
      return {
        message: existing,
        duplicated: true,
      };
    }

    try {
      const message = await this.prisma.$transaction(async (transaction) => {
        const createdMessage = await transaction.message.create({
          data: {
            conversationId: conversation.id,
            direction: MessageDirection.INBOUND,
            type: data.type,
            content: data.content.trim(),
            instanceName: data.instanceName,
            externalMessageId: data.externalMessageId,
            remoteJid: data.remoteJid,
            timestamp: data.timestamp,
            mediaUrl: data.mediaUrl,
            mimeType: data.mimeType,
            fileSize: data.fileSize,
          },
        });

        await transaction.conversation.updateMany({
          where: {
            id: conversation.id,
            OR: [
              { lastMessageAt: null },
              { lastMessageAt: { lt: conversationActivityAt } },
            ],
          },
          data: {
            lastMessageAt: conversationActivityAt,
          },
        });

        return createdMessage;
      });

      return {
        message,
        duplicated: false,
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrentMessage = await this.findExternalMessage(
          data.instanceName,
          data.externalMessageId,
        );

        if (concurrentMessage) {
          this.assertIdempotentInbound(
            concurrentMessage,
            conversation.id,
            data,
          );
          return {
            message: concurrentMessage,
            duplicated: true,
          };
        }
      }

      throw error;
    }
  }

  async list(conversationId: string, query: ListMessagesQueryDto) {
    await this.conversationsService.getById(conversationId);
    const limit = query.limit ?? 50;

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      cursor: query.cursor
        ? {
            id: query.cursor,
          }
        : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
    });
    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, limit) : messages;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private assertIdempotentMessage(
    message: {
      conversationId: string;
      direction: CreateInternalMessageDto['direction'];
      type: CreateInternalMessageDto['type'];
      content: string;
    },
    conversationId: string,
    data: CreateInternalMessageDto,
  ): void {
    if (
      message.conversationId !== conversationId ||
      message.direction !== data.direction ||
      message.type !== data.type ||
      message.content !== data.content.trim()
    ) {
      throw new ConflictException('ID externo já utilizado por outra mensagem');
    }
  }

  private findExternalMessage(instanceName: string, externalMessageId: string) {
    return this.prisma.message.findUnique({
      where: {
        instanceName_externalMessageId: {
          instanceName,
          externalMessageId,
        },
      },
    });
  }

  private assertIdempotentInbound(
    message: Message,
    conversationId: string,
    data: CreateInboundMessageInput,
  ): void {
    if (
      message.conversationId !== conversationId ||
      message.direction !== MessageDirection.INBOUND ||
      message.type !== data.type ||
      message.content !== data.content.trim() ||
      message.remoteJid !== data.remoteJid
    ) {
      throw new ConflictException(
        'ID externo da Evolution já utilizado por outra mensagem',
      );
    }
  }
}
