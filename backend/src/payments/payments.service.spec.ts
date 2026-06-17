import {
  Currency,
  PaymentMethod,
  PaymentProvider,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { ConflictException } from '@nestjs/common';

describe('PaymentsService', () => {
  it('returns the existing payment for an idempotent retry', async () => {
    const existingPayment = {
      id: 'payment-id',
      invoiceId: '70315d98-8433-43e6-82b6-47b9c6725906',
      provider: PaymentProvider.MANUAL,
      method: PaymentMethod.MANUAL,
      amount: new Prisma.Decimal('49.90'),
    };
    const prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(existingPayment),
        create: jest.fn(),
      },
      invoice: {
        findUnique: jest.fn(),
      },
    };
    const service = new PaymentsService(prisma as unknown as PrismaService);

    const payment = await service.create({
      invoiceId: existingPayment.invoiceId,
      provider: PaymentProvider.MANUAL,
      method: PaymentMethod.MANUAL,
      amount: '49.90',
      currency: Currency.BRL,
      idempotencyKey: 'billing-test-idempotency-key',
    });

    expect(payment).toBe(existingPayment);
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('blocks a concurrent active charge with another idempotency key', async () => {
    const prisma = {
      payment: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('unique conflict', {
            code: 'P2002',
            clientVersion: '5.22.0',
          }),
        ),
        findFirst: jest.fn().mockResolvedValue({
          id: 'active-payment-id',
          idempotencyKey: 'existing-key',
        }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invoice-id',
          total: new Prisma.Decimal('19.90'),
          currency: Currency.BRL,
        }),
      },
    };
    const service = new PaymentsService(prisma as unknown as PrismaService);

    await expect(
      service.create({
        invoiceId: 'invoice-id',
        provider: PaymentProvider.PAGBANK,
        method: PaymentMethod.PIX,
        amount: '19.90',
        currency: Currency.BRL,
        idempotencyKey: 'new-key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
