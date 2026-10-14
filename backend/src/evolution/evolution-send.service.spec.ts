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
      conversationId: 'conversation-id',
      content: 'Resposta nutricional',
      status: options?.status ?? OutboundMessageStatus.PENDING,
      attempts: 0,
      leaseExpiresAt: null,
      conversation: {
        id: 'conversation-id',
        phoneNumber: '+5511999999999',
        remoteJid: null,
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
            attempts: current.attempts + 1,
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
      conversation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
            remoteJid: '5511999999999@s.whatsapp.net',
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
      current,
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
    expect(subject.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-id',
        remoteJid: null,
      },
      data: {
        remoteJid: '5511999999999@s.whatsapp.net',
      },
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

  it('returns active SENDING without another provider send or claiming completion', async () => {
    const setup = createSubject({ status: OutboundMessageStatus.SENDING });
    Object.assign(setup.current, {
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(setup.service.sendText('outbound-id')).resolves.toMatchObject({
      status: 'SENDING',
    });
    expect(setup.gateway.sendText).not.toHaveBeenCalled();
  });

  it('keeps a failed ACK persistence recoverable instead of returning successful delivery', async () => {
    const setup = createSubject();
    setup.prisma.outboundMessage.updateMany.mockRejectedValueOnce(
      new Error('Persistence failed after ACK'),
    );
    await expect(setup.service.sendText('outbound-id')).rejects.toThrow(
      'Persistence failed after ACK',
    );
    expect(setup.gateway.sendText).toHaveBeenCalledTimes(1);
    expect(setup.prisma.outboundMessage.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          leaseExpiresAt: null,
        }),
        where: expect.objectContaining({
          status: 'SENDING',
          leaseExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(setup.prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'fences a late provider ACK/failure by attempt and lease: failure=%s',
    async (gatewayFailure) => {
      const setup = createSubject({ gatewayFailure });
      setup.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
      if (gatewayFailure)
        await expect(setup.service.sendText('outbound-id')).rejects.toThrow(
          'Evolution indisponível',
        );
      else await setup.service.sendText('outbound-id');
      expect(setup.prisma.outboundMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'outbound-id',
            status: 'SENDING',
            attempts: 1,
            leaseExpiresAt: expect.any(Date),
          }),
        }),
      );
      expect(setup.prisma.conversation.updateMany).not.toHaveBeenCalled();
    },
  );
});
