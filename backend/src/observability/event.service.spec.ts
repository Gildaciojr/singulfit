import { BadRequestException } from '@nestjs/common';
import { Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventService } from './event.service';

describe('EventService', () => {
  it('records a structured system event in a transaction', async () => {
    const systemEvent = {
      create: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const service = new EventService({} as PrismaService);

    await service.recordInTransaction(
      { systemEvent } as unknown as Prisma.TransactionClient,
      {
        source: 'openai',
        severity: Severity.ERROR,
        eventType: 'provider_unavailable',
        message: 'Falha temporária na OpenAI',
        metadata: {
          statusCode: 503,
        },
      },
    );

    expect(systemEvent.create).toHaveBeenCalledWith({
      data: {
        source: 'OPENAI',
        severity: Severity.ERROR,
        eventType: 'PROVIDER_UNAVAILABLE',
        message: 'Falha temporária na OpenAI',
        metadata: {
          statusCode: 503,
        },
      },
    });
  });

  it('rejects empty messages', () => {
    const service = new EventService({} as PrismaService);

    expect(() =>
      service.recordInTransaction({} as Prisma.TransactionClient, {
        source: 'OPENAI',
        severity: Severity.ERROR,
        eventType: 'PROVIDER_UNAVAILABLE',
        message: ' ',
      }),
    ).toThrow(BadRequestException);
  });
});
