import {
  InvoiceStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PlanType,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { PixPaymentsService } from './pix-payments.service';
import { PixRenewalService } from './pix-renewal.service';

const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;
const prefix = 'pix-renewal-integration-';
let sequence = 0;

describeIntegration('PIX renewal PostgreSQL integration', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('55433');
    expect(url.pathname).toBe('/singulfit_recurring_test');
    await prisma.$connect();
    await cleanFixtures();
  });

  async function cleanFixtures() {
    await prisma.payment.deleteMany({
      where: { invoice: { id: { startsWith: prefix } } },
    });
    await prisma.invoice.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.subscription.deleteMany({
      where: { id: { startsWith: prefix } },
    });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.plan.deleteMany({ where: { id: { startsWith: prefix } } });
  }

  afterEach(cleanFixtures);

  afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  function id(kind: string) {
    sequence += 1;
    return `${prefix}${kind}-${Date.now()}-${sequence}`;
  }

  async function fixture(status = PaymentStatus.CREATED) {
    const planId = id('plan');
    const userId = id('user');
    const subscriptionId = id('subscription');
    const invoiceId = id('invoice');
    await prisma.plan.create({
      data: {
        id: planId,
        type: PlanType.BASIC,
        name: planId,
        price: '29.90',
        imageLimit: 5,
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        name: 'Renewal User',
        email: `${userId}@test.invalid`,
        cpf: '12345678901',
        phone: `+55119${sequence.toString().padStart(8, '0')}`,
      },
    });
    await prisma.subscription.create({
      data: {
        id: subscriptionId,
        userId,
        planId,
        amount: '29.90',
        status: SubscriptionStatus.ACTIVE,
        paymentMethod: PaymentMethod.PIX,
        currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        subscriptionId,
        externalReference: id('invoice-reference'),
        cycleNumber: 2,
        status: InvoiceStatus.OPEN,
        subtotal: '29.90',
        total: '29.90',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-11-01T00:00:00.000Z'),
        dueAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    if (status !== PaymentStatus.CREATED) {
      await prisma.payment.create({
        data: {
          id: id('payment'),
          invoiceId,
          provider: PaymentProvider.PAGBANK,
          method: PaymentMethod.PIX,
          status,
          amount: '29.90',
          idempotencyKey: id('idempotency'),
          externalReference: id('payment-reference'),
          providerPaymentId:
            status === PaymentStatus.PENDING ? id('QRCO') : null,
          providerOrderId: status === PaymentStatus.PENDING ? id('ORDE') : null,
          pixQrCode: status === PaymentStatus.PENDING ? 'pix-existing' : null,
          pixTicketUrl:
            status === PaymentStatus.PENDING
              ? 'https://pix.test/existing'
              : null,
          expiresAt:
            status === PaymentStatus.PENDING
              ? new Date(Date.now() + 60_000)
              : new Date(Date.now() - 60_000),
        },
      });
    }
    return { userId, subscriptionId, invoiceId };
  }

  function service(
    providerCreate = jest.fn().mockResolvedValue({
      providerOrderId: 'ORDE_RENEWAL',
      providerPaymentId: 'QRCO_RENEWAL',
      qrCode: 'pix-renewal',
      qrCodeImageUrl: 'https://pix.test/new',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }),
  ) {
    const payments = new PaymentsService(prisma as unknown as PrismaService);
    const pix = new PixPaymentsService({} as never, payments, {
      provider: PaymentProvider.PAGBANK,
      createPixPayment: providerCreate,
    } as never);
    return {
      renewal: new PixRenewalService(prisma as unknown as PrismaService, pix),
      providerCreate,
    };
  }

  it('converges concurrent same-renewal intent before one provider call', async () => {
    const data = await fixture();
    let release!: () => void;
    const providerCreate = jest.fn(
      () =>
        new Promise<any>((resolve) => {
          release = () =>
            resolve({
              providerOrderId: 'ORDE_RENEWAL',
              providerPaymentId: 'QRCO_RENEWAL',
              qrCode: 'pix-renewal',
              qrCodeImageUrl: 'https://pix.test/new',
              expiresAt: new Date(Date.now() + 60_000),
            });
        }),
    );
    const test = service(providerCreate);
    const first = test.renewal.createOrReuseForUser(data.userId);
    for (let attempt = 0; attempt < 40 && !release; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const second = test.renewal.createOrReuseForUser(data.userId);
    for (let attempt = 0; attempt < 40 && !release; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(release).toBeDefined();
    release();
    const results = await Promise.all([first, second]);
    expect(results[0].paymentId).toBe(results[1].paymentId);
    expect(providerCreate).toHaveBeenCalledTimes(1);
    await expect(
      prisma.payment.count({ where: { invoiceId: data.invoiceId } }),
    ).resolves.toBe(1);
  });

  it('returns the existing valid PIX without a provider call', async () => {
    const data = await fixture(PaymentStatus.PENDING);
    const test = service();
    const [first, second] = await Promise.all([
      test.renewal.createOrReuseForUser(data.userId),
      test.renewal.createOrReuseForUser(data.userId),
    ]);
    expect(first.paymentId).toBe(second.paymentId);
    expect(test.providerCreate).not.toHaveBeenCalled();
  });

  it('creates one new canonical PIX after an expired attempt', async () => {
    const data = await fixture(PaymentStatus.EXPIRED);
    const test = service();
    const [first, second] = await Promise.all([
      test.renewal.createOrReuseForUser(data.userId),
      test.renewal.createOrReuseForUser(data.userId),
    ]);
    expect(first.paymentId).toBe(second.paymentId);
    expect(test.providerCreate).toHaveBeenCalledTimes(1);
    await expect(
      prisma.payment.count({
        where: { invoiceId: data.invoiceId, status: PaymentStatus.PENDING },
      }),
    ).resolves.toBe(1);
  });
});
