import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionWebhookService } from './evolution-webhook.service';

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 10;

@Injectable()
export class EvolutionInboundWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EvolutionInboundWorkerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly webhookService: EvolutionWebhookService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.drain();
    }, this.getPollMs());
    this.timer.unref();
    void this.drain();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async drain(at = new Date()): Promise<number> {
    if (this.running) {
      return 0;
    }

    this.running = true;
    let processed = 0;

    try {
      for (let index = 0; index < BATCH_SIZE; index += 1) {
        const event = await this.claimNext(at);

        if (!event) {
          break;
        }

        try {
          await this.webhookService.processQueuedEntry(
            event.instanceName,
            event.payload,
          );
          await this.prisma.evolutionInboundEvent.update({
            where: {
              id: event.id,
            },
            data: {
              status: WebhookStatus.PROCESSED,
              processedAt: new Date(),
              leaseExpiresAt: null,
              lastError: null,
            },
          });
        } catch (error: unknown) {
          await this.prisma.evolutionInboundEvent.update({
            where: {
              id: event.id,
            },
            data: {
              status: WebhookStatus.FAILED,
              leaseExpiresAt: null,
              lastError: this.safeError(error),
            },
          });
        }

        processed += 1;
      }
    } catch (error: unknown) {
      this.logger.error(
        'Falha no worker de inbox Evolution',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }

    return processed;
  }

  private async claimNext(at: Date) {
    const candidate = await this.prisma.evolutionInboundEvent.findFirst({
      where: {
        attempts: {
          lt: MAX_ATTEMPTS,
        },
        updatedAt: {
          lte: at,
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
              lte: at,
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!candidate) {
      return null;
    }

    const claimed = await this.prisma.evolutionInboundEvent.updateMany({
      where: {
        id: candidate.id,
        attempts: {
          lt: MAX_ATTEMPTS,
        },
        updatedAt: {
          lte: at,
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
              lte: at,
            },
          },
        ],
      },
      data: {
        status: WebhookStatus.PROCESSING,
        claimedAt: at,
        leaseExpiresAt: new Date(at.getTime() + this.getLeaseMs()),
        attempts: {
          increment: 1,
        },
        lastError: null,
      },
    });

    if (claimed.count !== 1) {
      return null;
    }

    return {
      ...candidate,
      payload: candidate.payload,
    };
  }

  private getLeaseMs(): number {
    const seconds = Number.parseInt(
      this.configService.get<string>('EVOLUTION_INBOUND_LEASE_SECONDS', '120'),
      10,
    );

    if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) {
      throw new ServiceUnavailableException(
        'EVOLUTION_INBOUND_LEASE_SECONDS possui valor inválido',
      );
    }

    return seconds * 1_000;
  }

  private getPollMs(): number {
    const milliseconds = Number.parseInt(
      this.configService.get<string>('EVOLUTION_INBOUND_POLL_MS', '1000'),
      10,
    );

    if (
      !Number.isInteger(milliseconds) ||
      milliseconds < 250 ||
      milliseconds > 60_000
    ) {
      throw new ServiceUnavailableException(
        'EVOLUTION_INBOUND_POLL_MS possui valor inválido',
      );
    }

    return milliseconds;
  }

  private safeError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim().slice(0, 2_000);
    }

    return 'Falha não identificada no processamento Evolution';
  }
}
