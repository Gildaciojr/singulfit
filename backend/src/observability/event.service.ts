import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListEventsDto } from './dto/list-events.dto';

export interface RecordSystemEventInput {
  source: string;
  severity: Severity;
  eventType: string;
  message: string;
  metadata?: Prisma.InputJsonObject;
}

@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: RecordSystemEventInput) {
    return this.recordInTransaction(this.prisma, input);
  }

  recordInTransaction(
    transaction: Prisma.TransactionClient | PrismaService,
    input: RecordSystemEventInput,
  ) {
    const source = this.requireCode(input.source, 'Fonte');
    const eventType = this.requireCode(input.eventType, 'Tipo do evento');
    const message = input.message.trim();

    if (!message || message.length > 2_000) {
      throw new BadRequestException('Mensagem do evento inválida');
    }

    return transaction.systemEvent.create({
      data: {
        source,
        severity: input.severity,
        eventType,
        message,
        metadata: input.metadata,
      },
    });
  }

  async list(query: ListEventsDto) {
    const records = await this.prisma.systemEvent.findMany({
      where: {
        source: query.source,
        severity: query.severity,
        eventType: query.eventType,
        createdAt: this.dateRange(query.from, query.to),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : undefined,
      take: query.limit + 1,
    });
    const hasMore = records.length > query.limit;
    const items = hasMore ? records.slice(0, query.limit) : records;

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private dateRange(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) {
      return undefined;
    }

    return {
      gte: from ? new Date(from) : undefined,
      lte: to ? new Date(to) : undefined,
    };
  }

  private requireCode(value: string, label: string): string {
    const normalized = value.trim().toUpperCase();

    if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(normalized)) {
      throw new BadRequestException(`${label} inválido`);
    }

    return normalized;
  }
}
