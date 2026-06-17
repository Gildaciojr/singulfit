import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboundMessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionSendService } from './evolution-send.service';

@Injectable()
export class EvolutionOutboundRecoveryService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EvolutionOutboundRecoveryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sendService: EvolutionSendService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const intervalMs = this.readPositiveInteger(
      'EVOLUTION_RECOVERY_INTERVAL_MS',
      30_000,
    );

    this.timer = setInterval(() => void this.recover(), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async recover(now = new Date()) {
    if (this.running) {
      return 0;
    }

    this.running = true;

    try {
      const candidates = await this.prisma.outboundMessage.findMany({
        where: {
          OR: [
            { status: OutboundMessageStatus.PENDING },
            {
              status: OutboundMessageStatus.FAILED,
              attempts: { lt: 10 },
            },
            {
              status: OutboundMessageStatus.SENDING,
              leaseExpiresAt: { lte: now },
              attempts: { lt: 10 },
            },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 25,
      });

      const results = await Promise.allSettled(
        candidates.map(({ id }) => this.sendService.sendText(id)),
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          this.logger.warn(
            `Outbound Evolution recovery failed: ${this.errorMessage(result.reason)}`,
          );
        }
      }

      return candidates.length;
    } finally {
      this.running = false;
    }
  }

  private readPositiveInteger(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key) ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
