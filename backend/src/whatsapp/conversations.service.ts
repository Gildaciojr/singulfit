import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationStatus, Prisma } from '@prisma/client';
import { normalizeBrazilianPhone } from '../common/phone-number.util';
import { PrismaService } from '../prisma/prisma.service';

const conversationDetails = {
  user: {
    select: {
      id: true,
      name: true,
      phone: true,
      phoneE164: true,
    },
  },
  subscription: {
    select: {
      id: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      gracePeriodEnd: true,
    },
  },
  _count: {
    select: {
      messages: true,
    },
  },
} satisfies Prisma.ConversationInclude;

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveByUserId(userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        userId,
        status: ConversationStatus.ACTIVE,
      },
      include: conversationDetails,
    });

    if (!conversation) {
      throw new NotFoundException('Conversa ativa não encontrada');
    }

    return conversation;
  }

  async getById(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      include: conversationDetails,
    });

    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada');
    }

    return conversation;
  }

  async getByPhone(phoneNumber: string) {
    const normalizedPhone = normalizeBrazilianPhone(phoneNumber);

    if (!normalizedPhone) {
      throw new BadRequestException('Telefone brasileiro inválido');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        phoneNumber: normalizedPhone,
        status: ConversationStatus.ACTIVE,
      },
      include: conversationDetails,
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversa ativa não encontrada');
    }

    return conversation;
  }

  async getOrCreateActive(
    userId: string,
    options?: {
      phoneNumber?: string;
      subscriptionId?: string;
    },
  ) {
    const activeConversation = await this.prisma.conversation.findFirst({
      where: {
        userId,
        status: ConversationStatus.ACTIVE,
      },
      include: conversationDetails,
    });

    if (activeConversation) {
      if (
        options?.subscriptionId &&
        activeConversation.subscriptionId !== options.subscriptionId
      ) {
        return this.prisma.conversation.update({
          where: {
            id: activeConversation.id,
          },
          data: {
            subscriptionId: options.subscriptionId,
          },
          include: conversationDetails,
        });
      }

      return activeConversation;
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        phone: true,
        phoneE164: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const phoneNumber = normalizeBrazilianPhone(
      options?.phoneNumber ?? user.phoneE164 ?? user.phone,
    );

    if (!phoneNumber) {
      throw new BadRequestException(
        'Telefone brasileiro inválido para iniciar conversa',
      );
    }

    try {
      return await this.prisma.conversation.create({
        data: {
          userId: user.id,
          subscriptionId: options?.subscriptionId,
          phoneNumber,
        },
        include: conversationDetails,
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.getActiveByUserId(userId);
      }

      throw error;
    }
  }
}
