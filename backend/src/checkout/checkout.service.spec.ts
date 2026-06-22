import {
  Currency,
  InvoiceStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PlanType,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService } from './checkout.service';
import { CheckoutStatus } from './dto/checkout-status-response.dto';

describe('CheckoutService', () => {
  const now = new Date('2026-06-17T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now.getTime());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function subject(subscriptions: readonly unknown[]) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-id',
          name: 'Ana Silva',
          email: 'ana@example.com',
          phone: '11999999999',
          phoneE164: '+5511999999999',
        }),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue(subscriptions),
      },
    };
    const service = new CheckoutService(prisma as unknown as PrismaService);

    return { service, prisma };
  }

  function subscription(input: {
    status: SubscriptionStatus;
    invoiceStatus?: InvoiceStatus;
    paymentStatus?: PaymentStatus;
    paymentExpiresAt?: Date | null;
  }) {
    const createdAt = new Date('2026-06-17T10:00:00.000Z');
    const invoice =
      input.invoiceStatus || input.paymentStatus
        ? {
            id: 'invoice-id',
            status: input.invoiceStatus ?? InvoiceStatus.OPEN,
            cycleNumber: 1,
            total: new Prisma.Decimal('29.90'),
            currency: Currency.BRL,
            dueAt: new Date('2026-06-18T10:00:00.000Z'),
            paidAt:
              input.invoiceStatus === InvoiceStatus.PAID
                ? new Date('2026-06-17T11:00:00.000Z')
                : null,
            periodStart: createdAt,
            periodEnd: new Date('2026-07-17T10:00:00.000Z'),
            payments: input.paymentStatus
              ? [
                  {
                    id: 'payment-id',
                    provider: PaymentProvider.PAGBANK,
                    method: PaymentMethod.PIX,
                    status: input.paymentStatus,
                    amount: new Prisma.Decimal('29.90'),
                    currency: Currency.BRL,
                    externalReference: 'pay_reference',
                    providerOrderId: 'ORDE_TEST',
                    providerPaymentId: 'CHAR_TEST',
                    pixQrCode: '000201',
                    pixTicketUrl: 'https://pagbank.test/qrcode',
                    expiresAt: input.paymentExpiresAt ?? null,
                    approvedAt:
                      input.paymentStatus === PaymentStatus.APPROVED
                        ? new Date('2026-06-17T11:00:00.000Z')
                        : null,
                    failedAt:
                      input.paymentStatus === PaymentStatus.REJECTED
                        ? new Date('2026-06-17T11:00:00.000Z')
                        : null,
                    createdAt,
                    updatedAt: createdAt,
                  },
                ]
              : [],
          }
        : null;

    return {
      id: 'subscription-id',
      status: input.status,
      amount: new Prisma.Decimal('29.90'),
      paidAt:
        input.status === SubscriptionStatus.ACTIVE
          ? new Date('2026-06-17T11:00:00.000Z')
          : null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      gracePeriodEnd: null,
      createdAt,
      updatedAt: createdAt,
      plan: {
        id: 'plan-id',
        type: PlanType.BASIC,
        name: 'Basic',
        price: new Prisma.Decimal('29.90'),
        currency: Currency.BRL,
        imageLimit: 30,
      },
      invoices: invoice ? [invoice] : [],
    };
  }

  it('returns no pending checkout when the user has no eligible subscription', async () => {
    const setup = subject([]);

    await expect(setup.service.getStatus('user-id')).resolves.toMatchObject({
      checkoutStatus: CheckoutStatus.NO_PENDING_CHECKOUT,
      subscription: null,
      invoice: null,
      payment: null,
    });
  });

  it.each([
    [SubscriptionStatus.ACTIVE, CheckoutStatus.ACTIVE],
    [SubscriptionStatus.PAST_DUE, CheckoutStatus.PAST_DUE],
    [SubscriptionStatus.EXPIRED, CheckoutStatus.EXPIRED],
  ])('maps subscription status %s to %s', async (status, expected) => {
    const setup = subject([subscription({ status })]);

    await expect(setup.service.getStatus('user-id')).resolves.toMatchObject({
      checkoutStatus: expected,
      subscription: {
        status,
        amount: '29.90',
      },
    });
  });

  it.each([
    [
      'open invoice without payment',
      subscription({
        status: SubscriptionStatus.PENDING_PAYMENT,
        invoiceStatus: InvoiceStatus.OPEN,
      }),
      CheckoutStatus.WAITING_PAYMENT,
    ],
    [
      'pending payment',
      subscription({
        status: SubscriptionStatus.PENDING_PAYMENT,
        paymentStatus: PaymentStatus.PENDING,
        paymentExpiresAt: new Date('2026-06-17T12:30:00.000Z'),
      }),
      CheckoutStatus.WAITING_PAYMENT,
    ],
    [
      'expired payment status',
      subscription({
        status: SubscriptionStatus.PENDING_PAYMENT,
        paymentStatus: PaymentStatus.EXPIRED,
      }),
      CheckoutStatus.PAYMENT_EXPIRED,
    ],
    [
      'expired active charge by expiration date',
      subscription({
        status: SubscriptionStatus.PENDING_PAYMENT,
        paymentStatus: PaymentStatus.PENDING,
        paymentExpiresAt: new Date('2026-06-17T11:59:00.000Z'),
      }),
      CheckoutStatus.PAYMENT_EXPIRED,
    ],
    [
      'rejected payment',
      subscription({
        status: SubscriptionStatus.PENDING_PAYMENT,
        paymentStatus: PaymentStatus.REJECTED,
      }),
      CheckoutStatus.PAYMENT_FAILED,
    ],
    [
      'paid invoice before activation',
      subscription({
        status: SubscriptionStatus.PENDING_PAYMENT,
        invoiceStatus: InvoiceStatus.PAID,
        paymentStatus: PaymentStatus.APPROVED,
      }),
      CheckoutStatus.PAID_ACTIVATING,
    ],
  ])('maps pending checkout with %s', async (_label, record, expected) => {
    const setup = subject([record]);

    await expect(setup.service.getStatus('user-id')).resolves.toMatchObject({
      checkoutStatus: expected,
    });
  });
});
