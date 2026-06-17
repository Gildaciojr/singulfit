import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../prisma/prisma.service';
import { PublishEventInput } from './event-bus.interfaces';

@Injectable()
export class EventBusService {
  constructor(private readonly prisma: PrismaService) {}

  publish(input: PublishEventInput, client?: Prisma.TransactionClient) {
    const eventType = this.requireCode(input.eventType, 'Tipo do evento');
    const aggregateType = this.requireCode(
      input.aggregateType,
      'Tipo do agregado',
    );
    const aggregateId = input.aggregateId.trim();
    const availableAt = input.availableAt ?? new Date();

    if (!aggregateId || aggregateId.length > 255) {
      throw new BadRequestException('Identificador do agregado inválido');
    }

    if (Number.isNaN(availableAt.getTime())) {
      throw new BadRequestException('Disponibilidade do evento inválida');
    }

    const normalized = {
      eventType,
      aggregateType,
      aggregateId,
      payload: input.payload,
      availableAt,
      validateAvailableAt: input.availableAt !== undefined,
    };

    if (client) {
      return this.publishWithClient(client, normalized);
    }

    return this.prisma.$transaction((transaction) =>
      this.publishWithClient(transaction, normalized),
    );
  }

  private async publishWithClient(
    client: Prisma.TransactionClient,
    input: Required<PublishEventInput> & { validateAvailableAt: boolean },
  ) {
    await client.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(
          hashtext(
            ${`${input.eventType}:${input.aggregateType}:${input.aggregateId}`}
          )
        )
      )
      SELECT true AS "locked"
      FROM advisory_lock
    `;
    const existing = await client.outboxEvent.findUnique({
      where: {
        eventType_aggregateType_aggregateId: {
          eventType: input.eventType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
        },
      },
    });

    if (existing) {
      this.assertIdempotent(existing, input);
      return existing;
    }

    return client.outboxEvent.create({
      data: {
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        availableAt: input.availableAt,
      },
    });
  }

  private assertIdempotent(
    event: {
      availableAt: Date;
      payload: Prisma.JsonValue;
    },
    input: Required<PublishEventInput> & { validateAvailableAt: boolean },
  ): void {
    if (
      (input.validateAvailableAt &&
        event.availableAt.getTime() !== input.availableAt.getTime()) ||
      !isDeepStrictEqual(event.payload, input.payload)
    ) {
      throw new ConflictException(
        'Evento idempotente já publicado com outro conteúdo',
      );
    }
  }

  private requireCode(value: string, label: string): string {
    const normalized = value.trim().toUpperCase();

    if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(normalized)) {
      throw new BadRequestException(`${label} inválido`);
    }

    return normalized;
  }
}
