import { NotFoundException } from '@nestjs/common';
import { PaymentMethod, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PixPaymentsService } from './pix-payments.service';
import { PixRenewalService } from './pix-renewal.service';

describe('PixRenewalService', () => {
  function subscription(overrides: Record<string, unknown> = {}) {
    return {
      id: 'subscription-id',
      userId: 'user-id',
      status: SubscriptionStatus.ACTIVE,
      externalSubscriptionId: null,
      paymentMethod: PaymentMethod.PIX,
      plan: { type: 'BASIC', name: 'Basic', price: { toFixed: () => '29.90' } },
      user: {
        name: 'Pix User',
        email: 'pix@example.test',
        cpf: '12345678901',
        phone: '11999999999',
      },
      invoices: [
        {
          id: 'invoice-id',
          subscriptionId: 'subscription-id',
          cycleNumber: 2,
          total: { toFixed: () => '29.90' },
          currency: 'BRL',
        },
      ],
      ...overrides,
    };
  }

  function subject(record = subscription(), attempts = 0) {
    const prisma = {
      subscription: { findFirst: jest.fn().mockResolvedValue(record) },
      payment: { count: jest.fn().mockResolvedValue(attempts) },
    };
    const pixPayments = {
      createForRenewalInvoice: jest.fn().mockResolvedValue({
        paymentId: 'payment-id',
        status: 'PENDING',
      }),
    };
    return {
      service: new PixRenewalService(
        prisma as unknown as PrismaService,
        pixPayments as unknown as PixPaymentsService,
      ),
      prisma,
      pixPayments,
    };
  }

  it('creates a PIX from the canonical active PIX subscription and open invoice', async () => {
    const test = subject();
    await expect(
      test.service.createOrReuseForUser('user-id'),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
    expect(test.pixPayments.createForRenewalInvoice).toHaveBeenCalledTimes(1);
  });

  it('resolves the subscription by the canonical user id', async () => {
    const test = subject();
    await test.service.createOrReuseForUser('user-id');
    expect(test.prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-id' }),
      }),
    );
  });

  it('requires a manual PIX payment mode', async () => {
    const test = subject(null);
    await expect(
      test.service.createOrReuseForUser('user-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a recurring card subscription', async () => {
    const test = subject(null);
    await expect(test.service.createOrReuseForUser('user-id')).rejects.toThrow(
      'Renovação PIX não disponível',
    );
  });

  it('rejects when no open invoice belongs to the subscription', async () => {
    const test = subject(subscription({ invoices: [] }));
    await expect(test.service.createOrReuseForUser('user-id')).rejects.toThrow(
      'Fatura aberta',
    );
  });

  it('passes the canonical plan and invoice amount to the PIX primitive', async () => {
    const test = subject();
    await test.service.createOrReuseForUser('user-id');
    expect(test.pixPayments.createForRenewalInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({
          plan: expect.objectContaining({ name: 'Basic' }),
        }),
        invoice: expect.objectContaining({ id: 'invoice-id' }),
      }),
    );
  });

  it('uses the first deterministic renewal attempt key', async () => {
    const test = subject();
    await test.service.createOrReuseForUser('user-id');
    expect(test.pixPayments.createForRenewalInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'pix-renewal:subscription-id:2:1',
      }),
    );
  });

  it('uses a distinct deterministic key after an expired attempt', async () => {
    const test = subject(subscription(), 1);
    await test.service.createOrReuseForUser('user-id');
    expect(test.pixPayments.createForRenewalInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'pix-renewal:subscription-id:2:2',
      }),
    );
  });

  it('allows an eligible ACTIVE PIX subscription', async () => {
    const test = subject(subscription({ status: SubscriptionStatus.ACTIVE }));
    await expect(
      test.service.createOrReuseForUser('user-id'),
    ).resolves.toBeDefined();
  });

  it('allows an eligible PAST_DUE PIX subscription', async () => {
    const test = subject(subscription({ status: SubscriptionStatus.PAST_DUE }));
    await expect(
      test.service.createOrReuseForUser('user-id'),
    ).resolves.toBeDefined();
  });

  it('does not include CANCELED among eligible statuses', async () => {
    const test = subject();
    await test.service.createOrReuseForUser('user-id');
    expect(test.prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
          },
        }),
      }),
    );
  });

  it('does not mutate the subscription while creating PIX', async () => {
    const test = subject();
    await test.service.createOrReuseForUser('user-id');
    expect(
      (test.prisma.subscription as Record<string, unknown>).update,
    ).toBeUndefined();
  });

  it('does not touch entitlements while creating PIX', async () => {
    const test = subject();
    await test.service.createOrReuseForUser('user-id');
    expect(
      (test.prisma as Record<string, unknown>).usageBucket,
    ).toBeUndefined();
  });

  it('does not settle the payment during PIX creation', async () => {
    const test = subject();
    await test.service.createOrReuseForUser('user-id');
    expect(test.pixPayments.createForRenewalInvoice).toHaveBeenCalledTimes(1);
  });

  it('does not accept a caller-provided subscription or invoice identifier', async () => {
    const test = subject();
    await test.service.createOrReuseForUser('user-id');
    expect(test.prisma.subscription.findFirst).toHaveBeenCalledTimes(1);
  });
});
