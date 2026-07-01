import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboundMessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { EvolutionGateway } from './evolution.gateway';

@Injectable()
export class EvolutionSendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolutionGateway: EvolutionGateway,
    private readonly subscriptionAccessService: SubscriptionAccessService,
    private readonly configService: ConfigService,
  ) {}

  async sendText(outboundMessageId: string) {
    const claimed = await this.claim(outboundMessageId);

    if (!claimed.shouldSend) {
      return claimed.message;
    }

    try {
      const sent = await this.evolutionGateway.sendText({
        number: claimed.message.conversation.phoneNumber,
        text: claimed.message.content,
      });

      await this.prisma.outboundMessage.updateMany({
        where: {
          id: claimed.message.id,
          status: OutboundMessageStatus.SENDING,
        },
        data: {
          externalMessageId: sent.externalMessageId,
          status: OutboundMessageStatus.SENT,
          sentAt: new Date(),
          deliveredAt: null,
          failedAt: null,
          leaseExpiresAt: null,
          errorMessage: null,
        },
      });

      if (sent.remoteJid) {
        await this.prisma.conversation.updateMany({
          where: {
            id: claimed.message.conversationId,
            remoteJid: null,
          },
          data: {
            remoteJid: sent.remoteJid,
          },
        });
      }

      return this.getMessage(claimed.message.id);
    } catch (error: unknown) {
      await this.prisma.outboundMessage.updateMany({
        where: {
          id: claimed.message.id,
          status: OutboundMessageStatus.SENDING,
        },
        data: {
          status: OutboundMessageStatus.FAILED,
          failedAt: new Date(),
          leaseExpiresAt: null,
          errorMessage: this.getSafeError(error),
        },
      });

      if (error instanceof Error) {
        throw error;
      }

      throw new BadGatewayException(
        'Falha não identificada no envio pela Evolution API',
      );
    }
  }

  private claim(outboundMessageId: string) {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          WITH advisory_lock AS (
            SELECT pg_advisory_xact_lock(hashtext(${outboundMessageId}))
          )
          SELECT true AS "locked"
          FROM advisory_lock
        `;

        const current = await transaction.outboundMessage.findUnique({
          where: {
            id: outboundMessageId,
          },
          include: {
            conversation: {
              select: {
                id: true,
                phoneNumber: true,
                remoteJid: true,
              },
            },
          },
        });

        if (!current) {
          throw new NotFoundException('Mensagem de saída não encontrada');
        }

        if (
          current.status === OutboundMessageStatus.SENT ||
          current.status === OutboundMessageStatus.DELIVERED
        ) {
          return {
            shouldSend: false as const,
            message: current,
          };
        }

        const now = new Date();

        if (
          current.status === OutboundMessageStatus.SENDING &&
          current.leaseExpiresAt &&
          current.leaseExpiresAt > now
        ) {
          return {
            shouldSend: false as const,
            message: current,
          };
        }

        try {
          await this.subscriptionAccessService.requireAccessInTransaction(
            transaction,
            current.userId,
            now,
          );
        } catch (error: unknown) {
          if (!(error instanceof ForbiddenException)) {
            throw error;
          }

          const failed = await transaction.outboundMessage.update({
            where: {
              id: current.id,
            },
            data: {
              status: OutboundMessageStatus.FAILED,
              failedAt: now,
              leaseExpiresAt: null,
              errorMessage: 'Assinatura não permite o envio da resposta',
            },
            include: {
              conversation: {
                select: {
                  id: true,
                  phoneNumber: true,
                  remoteJid: true,
                },
              },
            },
          });

          return {
            shouldSend: false as const,
            message: failed,
          };
        }

        const message = await transaction.outboundMessage.update({
          where: {
            id: current.id,
          },
          data: {
            status: OutboundMessageStatus.SENDING,
            attempts: {
              increment: 1,
            },
            leaseExpiresAt: new Date(now.getTime() + this.getLeaseMs()),
            failedAt: null,
            errorMessage: null,
          },
          include: {
            conversation: {
              select: {
                id: true,
                phoneNumber: true,
                remoteJid: true,
              },
            },
          },
        });

        return {
          shouldSend: true as const,
          message,
        };
      },
      {
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  }

  private getMessage(outboundMessageId: string) {
    return this.prisma.outboundMessage.findUniqueOrThrow({
      where: {
        id: outboundMessageId,
      },
      include: {
        conversation: {
          select: {
            id: true,
            phoneNumber: true,
            remoteJid: true,
          },
        },
      },
    });
  }

  private getLeaseMs(): number {
    const seconds = Number.parseInt(
      this.configService.get<string>('EVOLUTION_SEND_LEASE_SECONDS', '60'),
      10,
    );

    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) {
      throw new ServiceUnavailableException(
        'EVOLUTION_SEND_LEASE_SECONDS possui valor inválido',
      );
    }

    return seconds * 1_000;
  }

  private getSafeError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim().slice(0, 2_000);
    }

    return 'Falha não identificada no envio pela Evolution API';
  }
}
