import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider, WebhookStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { EventBusService } from '../event-bus/event-bus.service';
import type { PaymentGateway } from '../payments/gateways/payment-gateway.interface';
import { PrismaService } from '../prisma/prisma.service';
import { PagBankWebhookService } from './pagbank-webhook.service';
import { WebhookEventsService } from './webhook-events.service';
import {
  WebhookProcessingOutcome,
  WebhookProcessorService,
} from './webhook-processor.service';

describe('PagBankWebhookService', () => {
  const secret = 'webhook-test-secret';

  function createSubject(options?: {
    duplicated?: boolean;
    claimed?: boolean;
    outcome?: WebhookProcessingOutcome;
  }) {
    const webhookEvent = {
      id: 'webhook-event-id',
      resourceId: 'CHAR_TEST',
      status: WebhookStatus.RECEIVED,
    };
    const webhookEventsService = {
      recordInTransaction: jest.fn().mockResolvedValue({
        event: webhookEvent,
        duplicated: options?.duplicated ?? false,
      }),
      findById: jest.fn().mockResolvedValue(webhookEvent),
      claimForProcessing: jest.fn().mockResolvedValue(options?.claimed ?? true),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markIgnored: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const webhookProcessorService = {
      processPagBankPayment: jest
        .fn()
        .mockResolvedValue(options?.outcome ?? 'APPROVED'),
    };
    const getPayment = jest.fn().mockResolvedValue({
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'CHAR_TEST',
      externalReference: 'pay_reference',
      status: 'APPROVED',
      amountInCents: 1990,
      currency: 'BRL',
      approvedAt: new Date('2026-06-06T18:30:00.000Z'),
    });
    const gateway: PaymentGateway = {
      provider: PaymentProvider.PAGBANK,
      createPixPayment: jest.fn(),
      createCreditCardPayment: jest.fn(),
      getPayment,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
    };
    const service = new PagBankWebhookService(
      {
        get: jest.fn().mockReturnValue(secret),
      } as unknown as ConfigService,
      webhookEventsService as unknown as WebhookEventsService,
      webhookProcessorService as unknown as WebhookProcessorService,
      gateway,
      prisma as unknown as PrismaService,
      eventBus as unknown as EventBusService,
    );

    return {
      service,
      webhookEventsService,
      webhookProcessorService,
      getPayment,
      eventBus,
      transaction,
    };
  }

  function signedPayload(payload: object) {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const authenticityToken = createHash('sha256')
      .update(secret)
      .update(rawBody)
      .digest('hex');

    return {
      rawBody,
      authenticityToken,
    };
  }

  it('validates, persists and queues without consulting PagBank', async () => {
    const subject = createSubject();
    const signed = signedPayload({
      id: 'CHAR_TEST',
      status: 'PAID',
    });

    await expect(
      subject.service.handle(signed.rawBody, {
        authenticityToken: signed.authenticityToken,
        requestId: 'request-approved',
      }),
    ).resolves.toEqual({
      received: true,
      queued: true,
      duplicated: false,
    });
    expect(subject.getPayment).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PAGBANK_WEBHOOK_RECEIVED',
        aggregateId: 'webhook-event-id',
      }),
      subject.transaction,
    );
  });

  it('processes a persisted event outside the HTTP request', async () => {
    const subject = createSubject();

    await expect(
      subject.service.processQueuedEvent('webhook-event-id'),
    ).resolves.toEqual({
      outcome: 'APPROVED',
    });
    expect(subject.getPayment).toHaveBeenCalledWith('CHAR_TEST');
    expect(subject.webhookEventsService.markProcessed).toHaveBeenCalledWith(
      'webhook-event-id',
    );
  });

  it('marks non-actionable canonical outcomes as ignored', async () => {
    const subject = createSubject({
      outcome: 'PAYMENT_NOT_FOUND',
    });

    await subject.service.processQueuedEvent('webhook-event-id');

    expect(subject.webhookEventsService.markIgnored).toHaveBeenCalledWith(
      'webhook-event-id',
    );
  });

  it('rejects an invalid event before persistence', async () => {
    const subject = createSubject();
    const signed = signedPayload({
      status: 'PAID',
    });

    await expect(
      subject.service.handle(signed.rawBody, {
        authenticityToken: signed.authenticityToken,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      subject.webhookEventsService.recordInTransaction,
    ).not.toHaveBeenCalled();
  });

  it('rejects an invalid authenticity token', async () => {
    const subject = createSubject();
    const rawBody = Buffer.from(
      JSON.stringify({
        id: 'CHAR_TEST',
        status: 'PAID',
      }),
    );

    await expect(
      subject.service.handle(rawBody, {
        authenticityToken: '0'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(
      subject.webhookEventsService.recordInTransaction,
    ).not.toHaveBeenCalled();
  });
});
