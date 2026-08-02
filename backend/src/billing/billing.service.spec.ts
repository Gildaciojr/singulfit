import { InvoiceStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { InvoicesService } from './invoices.service';

describe('BillingService subscription cycles', () => {
  it('reuses the current open renewal invoice', async () => {
    const subscription = {
      id: 'subscription-id',
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date('2026-08-31T12:00:00.000Z'),
      plan: { isActive: true, billingIntervalCount: 1 },
      user: { id: 'user-id' },
    };
    const invoice = { id: 'invoice-2', status: InvoiceStatus.OPEN };
    const prisma = {
      subscription: { findFirst: jest.fn().mockResolvedValue(subscription) },
      invoice: { findFirst: jest.fn().mockResolvedValue(invoice) },
    };
    const invoices = { create: jest.fn() };
    const service = new BillingService(
      prisma as unknown as PrismaService,
      invoices as unknown as InvoicesService,
    );

    await expect(
      service.getOrCreatePayableInvoice(
        'user-id',
        new Date('2026-08-24T12:00:00.000Z'),
      ),
    ).resolves.toEqual({ subscription, invoice });
    expect(invoices.create).not.toHaveBeenCalled();
  });

  it('creates the next numbered cycle without replacing the subscription', async () => {
    const subscription = {
      id: 'subscription-id',
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date('2026-08-31T12:00:00.000Z'),
      plan: {
        isActive: true,
        billingIntervalCount: 1,
        currency: 'BRL',
        price: { toFixed: () => '49.90' },
      },
      user: { id: 'user-id' },
    };
    const created = { id: 'invoice-10', cycleNumber: 10 };
    const prisma = {
      subscription: { findFirst: jest.fn().mockResolvedValue(subscription) },
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ cycleNumber: 9 }),
      },
    };
    const invoices = { create: jest.fn().mockResolvedValue(created) };
    const service = new BillingService(
      prisma as unknown as PrismaService,
      invoices as unknown as InvoicesService,
    );

    await expect(
      service.getOrCreatePayableInvoice(
        'user-id',
        new Date('2026-08-24T12:00:00.000Z'),
      ),
    ).resolves.toEqual({ subscription, invoice: created });
    expect(invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: subscription.id,
        cycleNumber: 10,
        periodStart: '2026-08-31T12:00:00.000Z',
      }),
    );
  });
});
