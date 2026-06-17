import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

export interface RecordAuditInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonObject;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: RecordAuditInput) {
    return this.recordInTransaction(this.prisma, input);
  }

  recordInTransaction(
    transaction: Prisma.TransactionClient | PrismaService,
    input: RecordAuditInput,
  ) {
    const action = this.requireCode(input.action, 'Ação');
    const entityType = this.requireCode(input.entityType, 'Tipo de entidade');
    const entityId = input.entityId.trim();

    if (!entityId || entityId.length > 255) {
      throw new BadRequestException('Identificador da entidade inválido');
    }

    return transaction.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action,
        entityType,
        entityId,
        metadata: input.metadata,
      },
    });
  }

  async list(query: ListAuditLogsDto) {
    const records = await this.prisma.auditLog.findMany({
      where: {
        userId: query.userId,
        action: query.action,
        entityType: query.entityType,
        entityId: query.entityId,
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
      throw new BadRequestException(`${label} inválida`);
    }

    return normalized;
  }
}
