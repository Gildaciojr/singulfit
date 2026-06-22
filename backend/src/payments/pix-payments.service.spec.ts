import { ConflictException } from '@nestjs/common';
import {
  Currency,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PlanType,
  Prisma,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import type { PaymentGateway } from './gateways/payment-gateway.interface';
import { PaymentsService } from './payments.service';
import { PixPaymentsService } from './pix-payments.service';

describe('PixPaymentsService', () => {
  it('creates the PagBank PIX and persists it as pending', async () => {
    const expiration = new Date(Date.now() + 30 * 60 * 1000);
    const billingService = {
      getOrCreateInitialInvoice: jest.fn().mockResolvedValue({
        subscription: {
          plan: {
            type: PlanType.BASIC,
            name: 'Basic',
          },
          user: {
            name: 'Usuário de Teste',
            email: 'user@singulfit.test',
            cpf: '12345678901',
            phone: '11999999999',
          },
        },
        invoice: {
          id: 'invoice-id',
          total: new Prisma.Decimal('19.90'),
          currency: Currency.BRL,
        },
      }),
    };
    const createdPayment = {
      id: 'payment-id',
      invoiceId: 'invoice-id',
      provider: PaymentProvider.PAGBANK,
      method: PaymentMethod.PIX,
      status: PaymentStatus.CREATED,
      amount: new Prisma.Decimal('19.90'),
      currency: Currency.BRL,
      idempotencyKey: 'pix-idempotency-key',
      externalReference: 'pay_reference',
      providerPaymentId: null,
      pixQrCode: null,
      pixTicketUrl: null,
      expiresAt: expiration,
    };
    const paymentsService = {
      findCurrentByInvoiceId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(createdPayment),
      updateStatus: jest.fn().mockResolvedValue({
        ...createdPayment,
        status: PaymentStatus.PENDING,
        providerPaymentId: 'QRCO_TEST',
        pixQrCode: '00020101021226860014br.gov.bcb.pix',
        pixTicketUrl: 'https://api.pagseguro.com/qrcode.png',
      }),
    };
    const createPixPayment = jest.fn().mockResolvedValue({
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'QRCO_TEST',
      qrCode: '00020101021226860014br.gov.bcb.pix',
      qrCodeImageUrl: 'https://api.pagseguro.com/qrcode.png',
      expiresAt: expiration,
    });
    const gateway: PaymentGateway = {
      provider: PaymentProvider.PAGBANK,
      createPixPayment,
      getPayment: jest.fn(),
    };
    const service = new PixPaymentsService(
      billingService as unknown as BillingService,
      paymentsService as unknown as PaymentsService,
      gateway,
    );

    const result = await service.create('user-id', {
      idempotencyKey: 'pix-idempotency-key',
    });

    expect(result.status).toBe(PaymentStatus.PENDING);
    expect(result.providerPaymentId).toBe('QRCO_TEST');
    expect(result.qrCode).toContain('br.gov.bcb.pix');
    expect(createPixPayment).toHaveBeenCalledTimes(1);
    expect(paymentsService.updateStatus).toHaveBeenCalledWith(
      'payment-id',
      expect.objectContaining({
        status: PaymentStatus.PENDING,
        providerOrderId: 'ORDE_TEST',
        providerPaymentId: 'QRCO_TEST',
      }),
    );
  });

  it('blocks a new PIX while another pending PIX is still valid', async () => {
    const expiration = new Date(Date.now() + 30 * 60 * 1000);
    const billingService = {
      getOrCreateInitialInvoice: jest.fn().mockResolvedValue({
        subscription: {
          plan: {
            type: PlanType.BASIC,
            name: 'Basic',
          },
          user: {
            name: 'Usuário de Teste',
            email: 'user@singulfit.test',
            cpf: '12345678901',
            phone: '11999999999',
          },
        },
        invoice: {
          id: 'invoice-id',
          total: new Prisma.Decimal('19.90'),
          currency: Currency.BRL,
        },
      }),
    };
    const currentPayment = {
      id: 'payment-id',
      invoiceId: 'invoice-id',
      provider: PaymentProvider.PAGBANK,
      method: PaymentMethod.PIX,
      status: PaymentStatus.PENDING,
      amount: new Prisma.Decimal('19.90'),
      currency: Currency.BRL,
      idempotencyKey: 'existing-idempotency-key',
      externalReference: 'pay_reference',
      providerPaymentId: 'QRCO_TEST',
      pixQrCode: '00020101021226860014br.gov.bcb.pix',
      pixTicketUrl: 'https://api.pagseguro.com/qrcode.png',
      expiresAt: expiration,
    };
    const paymentsService = {
      findCurrentByInvoiceId: jest.fn().mockResolvedValue(currentPayment),
      create: jest.fn(),
      updateStatus: jest.fn(),
    };
    const createPixPayment = jest.fn();
    const gateway: PaymentGateway = {
      provider: PaymentProvider.PAGBANK,
      createPixPayment,
      getPayment: jest.fn(),
    };
    const service = new PixPaymentsService(
      billingService as unknown as BillingService,
      paymentsService as unknown as PaymentsService,
      gateway,
    );

    await expect(
      service.create('user-id', {
        idempotencyKey: 'new-idempotency-key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(paymentsService.create).not.toHaveBeenCalled();
    expect(paymentsService.updateStatus).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it('expires a stale pending PIX before creating a new charge', async () => {
    const expiredAt = new Date(Date.now() - 60 * 1000);
    const nextExpiration = new Date(Date.now() + 30 * 60 * 1000);
    const billingService = {
      getOrCreateInitialInvoice: jest.fn().mockResolvedValue({
        subscription: {
          plan: {
            type: PlanType.BASIC,
            name: 'Basic',
          },
          user: {
            name: 'Usuário de Teste',
            email: 'user@singulfit.test',
            cpf: '12345678901',
            phone: '11999999999',
          },
        },
        invoice: {
          id: 'invoice-id',
          total: new Prisma.Decimal('19.90'),
          currency: Currency.BRL,
        },
      }),
    };
    const stalePayment = {
      id: 'stale-payment-id',
      invoiceId: 'invoice-id',
      provider: PaymentProvider.PAGBANK,
      method: PaymentMethod.PIX,
      status: PaymentStatus.PENDING,
      amount: new Prisma.Decimal('19.90'),
      currency: Currency.BRL,
      idempotencyKey: 'stale-idempotency-key',
      externalReference: 'pay_stale',
      providerPaymentId: 'QRCO_STALE',
      pixQrCode: '00020101021226860014br.gov.bcb.pix',
      pixTicketUrl: 'https://api.pagseguro.com/old-qrcode.png',
      expiresAt: expiredAt,
    };
    const createdPayment = {
      id: 'new-payment-id',
      invoiceId: 'invoice-id',
      provider: PaymentProvider.PAGBANK,
      method: PaymentMethod.PIX,
      status: PaymentStatus.CREATED,
      amount: new Prisma.Decimal('19.90'),
      currency: Currency.BRL,
      idempotencyKey: 'new-idempotency-key',
      externalReference: 'pay_new',
      providerPaymentId: null,
      pixQrCode: null,
      pixTicketUrl: null,
      expiresAt: nextExpiration,
    };
    const pendingPayment = {
      ...createdPayment,
      status: PaymentStatus.PENDING,
      providerPaymentId: 'QRCO_NEW',
      pixQrCode: '00020101021226860014br.gov.bcb.pix.new',
      pixTicketUrl: 'https://api.pagseguro.com/new-qrcode.png',
    };
    const paymentsService = {
      findCurrentByInvoiceId: jest.fn().mockResolvedValue(stalePayment),
      create: jest.fn().mockResolvedValue(createdPayment),
      updateStatus: jest
        .fn()
        .mockResolvedValueOnce({
          ...stalePayment,
          status: PaymentStatus.EXPIRED,
        })
        .mockResolvedValueOnce(pendingPayment),
    };
    const createPixPayment = jest.fn().mockResolvedValue({
      providerOrderId: 'ORDE_NEW',
      providerPaymentId: 'QRCO_NEW',
      qrCode: '00020101021226860014br.gov.bcb.pix.new',
      qrCodeImageUrl: 'https://api.pagseguro.com/new-qrcode.png',
      expiresAt: nextExpiration,
    });
    const gateway: PaymentGateway = {
      provider: PaymentProvider.PAGBANK,
      createPixPayment,
      getPayment: jest.fn(),
    };
    const service = new PixPaymentsService(
      billingService as unknown as BillingService,
      paymentsService as unknown as PaymentsService,
      gateway,
    );

    const result = await service.create('user-id', {
      idempotencyKey: 'new-idempotency-key',
    });

    expect(result.paymentId).toBe('new-payment-id');
    expect(result.providerPaymentId).toBe('QRCO_NEW');
    expect(paymentsService.updateStatus).toHaveBeenNthCalledWith(
      1,
      'stale-payment-id',
      expect.objectContaining({
        status: PaymentStatus.EXPIRED,
        statusDetail: 'PIX expirado antes de nova cobrança',
      }),
    );
    expect(paymentsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'new-idempotency-key',
      }),
    );
    expect(createPixPayment).toHaveBeenCalledTimes(1);
  });
});
