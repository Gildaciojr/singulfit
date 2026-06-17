import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboundMessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { EvolutionGateway } from './evolution.gateway';
import { EvolutionSendService } from './evolution-send.service';

describe('EvolutionSendService', () => {
  function createSubject(options?: {
    status?: OutboundMessageStatus;
    accessDenied?: boolean;
    gatewayFailure?: boolean;
  }) {
    const current = {
      id: 'outbound-id',
      userId: 'user-id',
      content: 'Resposta nutricional',
      status: options?.status ?? OutboundMessageStatus.PENDING,
      leaseExpiresAt: null,
      conversation: {
        phoneNumber: '+5511999999999',
      },
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      outboundMessage: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...current,
            ...data,
          }),
        ),
      },
    };
    const finalMessage = {
      ...current,
      status: OutboundMessageStatus.SENT,
      externalMessageId: 'external-id',
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
      outboundMessage: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(finalMessage),
      },
    };
    const gateway = {
      sendText: options?.gatewayFailure
        ? jest
            .fn()
            .mockRejectedValue(
              new BadGatewayException('Evolution indisponível'),
            )
        : jest.fn().mockResolvedValue({
            externalMessageId: 'external-id',
          }),
    };
    const accessService = {
      requireAccessInTransaction: options?.accessDenied
        ? jest
            .fn()
            .mockRejectedValue(new ForbiddenException('Assinatura expirada'))
        : jest.fn().mockResolvedValue({ id: 'subscription-id' }),
    };
    const service = new EvolutionSendService(
      prisma as unknown as PrismaService,
      gateway as unknown as EvolutionGateway,
      accessService as unknown as SubscriptionAccessService,
      {
        get: jest.fn().mockReturnValue('60'),
      } as unknown as ConfigService,
    );

    return {
      service,
      prisma,
      transaction,
      gateway,
      accessService,
    };
  }

  it('claims in a short transaction and sends outside it', async () => {
    const subject = createSubject();

    await expect(subject.service.sendText('outbound-id')).resolves.toEqual(
      expect.objectContaining({
        status: OutboundMessageStatus.SENT,
        externalMessageId: 'external-id',
      }),
    );
    expect(subject.transaction.outboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OutboundMessageStatus.SENDING,
          leaseExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(subject.gateway.sendText).toHaveBeenCalledWith({
      number: '+5511999999999',
      text: 'Resposta nutricional',
    });
  });

  it('blocks the send when centralized subscription access denies it', async () => {
    const subject = createSubject({ accessDenied: true });

    await expect(subject.service.sendText('outbound-id')).resolves.toEqual(
      expect.objectContaining({
        status: OutboundMessageStatus.FAILED,
        errorMessage: 'Assinatura não permite o envio da resposta',
      }),
    );
    expect(subject.gateway.sendText).not.toHaveBeenCalled();
  });

  it('persists failure after a provider error', async () => {
    const subject = createSubject({ gatewayFailure: true });

    await expect(subject.service.sendText('outbound-id')).rejects.toThrow(
      'Evolution indisponível',
    );
    expect(subject.prisma.outboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OutboundMessageStatus.FAILED,
          leaseExpiresAt: null,
        }),
      }),
    );
  });

  it('does not send an already sent response again', async () => {
    const subject = createSubject({ status: OutboundMessageStatus.SENT });

    await subject.service.sendText('outbound-id');

    expect(subject.gateway.sendText).not.toHaveBeenCalled();
    expect(subject.transaction.outboundMessage.update).not.toHaveBeenCalled();
  });
});
