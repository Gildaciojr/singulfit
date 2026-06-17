import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WebhookResourceType, WebhookStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWebhookEventDto } from './dto/create-webhook-event.dto';

@Injectable()
export class WebhookEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async record(data: CreateWebhookEventDto) {
    return this.prisma.$transaction((transaction) =>
      this.recordWithClient(transaction, data),
    );
  }

  async recordInTransaction(
    transaction: Prisma.TransactionClient,
    data: CreateWebhookEventDto,
  ) {
    return this.recordWithClient(transaction, data);
  }

  findById(eventId: string) {
    return this.prisma.webhookEvent.findUnique({
      where: {
        id: eventId,
      },
    });
  }

  private async recordWithClient(
    client: Prisma.TransactionClient,
    data: CreateWebhookEventDto,
  ) {
    await client.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(
          hashtext(${`${data.provider}:${data.eventKey}`})
        )
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
    const existing = await client.webhookEvent.findUnique({
      where: {
        provider_eventKey: {
          provider: data.provider,
          eventKey: data.eventKey,
        },
      },
    });

    if (existing) {
      return {
        event: existing,
        duplicated: true,
      };
    }

    const event = await client.webhookEvent.create({
      data: {
        provider: data.provider,
        eventKey: data.eventKey,
        providerEventId: data.providerEventId,
        resourceType: data.resourceType ?? WebhookResourceType.UNKNOWN,
        resourceId: data.resourceId,
        action: data.action,
        requestId: data.requestId,
        liveMode: data.liveMode ?? false,
        signatureValid: data.signatureValid ?? false,
        payload: data.payload,
      },
    });

    return {
      event,
      duplicated: false,
    };
  }

  async markProcessing(eventId: string) {
    await this.assertExists(eventId);
    const now = new Date();

    return this.prisma.webhookEvent.update({
      where: {
        id: eventId,
      },
      data: {
        status: WebhookStatus.PROCESSING,
        attempts: {
          increment: 1,
        },
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + this.getLeaseMs()),
        lastError: null,
      },
    });
  }

  async claimForProcessing(eventId: string): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.webhookEvent.updateMany({
      where: {
        id: eventId,
        attempts: {
          lt: this.getMaxAttempts(),
        },
        OR: [
          {
            status: {
              in: [WebhookStatus.RECEIVED, WebhookStatus.FAILED],
            },
          },
          {
            status: WebhookStatus.PROCESSING,
            leaseExpiresAt: {
              lte: now,
            },
          },
        ],
      },
      data: {
        status: WebhookStatus.PROCESSING,
        attempts: {
          increment: 1,
        },
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + this.getLeaseMs()),
        lastError: null,
      },
    });

    return result.count === 1;
  }

  async markProcessed(eventId: string) {
    return this.finish(eventId, WebhookStatus.PROCESSED);
  }

  async markIgnored(eventId: string) {
    return this.finish(eventId, WebhookStatus.IGNORED);
  }

  async markFailed(eventId: string, errorMessage: string) {
    await this.assertExists(eventId);

    return this.prisma.webhookEvent.update({
      where: {
        id: eventId,
      },
      data: {
        status: WebhookStatus.FAILED,
        leaseExpiresAt: null,
        lastError: errorMessage,
      },
    });
  }

  private async finish(eventId: string, status: WebhookStatus) {
    await this.assertExists(eventId);

    return this.prisma.webhookEvent.update({
      where: {
        id: eventId,
      },
      data: {
        status,
        processedAt: new Date(),
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  }

  private async assertExists(eventId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: {
        id: eventId,
      },
      select: {
        id: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Evento de webhook não encontrado');
    }
  }

  private getLeaseMs(): number {
    const seconds = Number.parseInt(
      this.configService.get<string>('WEBHOOK_LEASE_SECONDS', '60'),
      10,
    );

    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) {
      throw new ServiceUnavailableException(
        'WEBHOOK_LEASE_SECONDS possui valor inválido',
      );
    }

    return seconds * 1_000;
  }

  private getMaxAttempts(): number {
    const attempts = Number.parseInt(
      this.configService.get<string>('WEBHOOK_MAX_ATTEMPTS', '10'),
      10,
    );

    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) {
      throw new ServiceUnavailableException(
        'WEBHOOK_MAX_ATTEMPTS possui valor inválido',
      );
    }

    return attempts;
  }
}
