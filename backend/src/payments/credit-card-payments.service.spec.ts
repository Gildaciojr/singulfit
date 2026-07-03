import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Currency,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PlanType,
  Prisma,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { CreditCardPaymentsService } from './credit-card-payments.service';
import type { PaymentGateway } from './gateways/payment-gateway.interface';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentsService } from './payments.service';

describe('CreditCardPaymentsService', () => {
  const encryptedCard = 'encrypted-card-payload-'.repeat(8);

  it('creates a PagBank credit card charge and settles the approved payment through the official flow', async () => {
    const approvedAt = new Date('2026-06-06T18:30:00.000Z');
    const billingService = {
      getOrCreateInitialInvoice: jest.fn().mockResolvedValue({
        subscription: {
          plan: {
            type: PlanType.PREMIUM,
            name: 'Premium',
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
          total: new Prisma.Decimal('49.90'),
          currency: Currency.BRL,
        },
      }),
    };
    const createdPayment = {
      id: 'payment-id',
      invoiceId: 'invoice-id',
      provider: PaymentProvider.PAGBANK,
      method: PaymentMethod.CREDIT_CARD,
      status: PaymentStatus.CREATED,
      amount: new Prisma.Decimal('49.90'),
      currency: Currency.BRL,
      idempotencyKey: 'card-idempotency-key',
      externalReference: 'pay_reference',
      providerOrderId: null,
      providerPaymentId: null,
      approvedAt: null,
    };
    const approvedPayment = {
      ...createdPayment,
      status: PaymentStatus.APPROVED,
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'CHAR_TEST',
      approvedAt,
    };
    const paymentsService = {
      findCurrentByInvoiceId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(createdPayment),
      findById: jest.fn().mockResolvedValue(approvedPayment),
      updateStatus: jest.fn(),
    };
    const paymentSettlementService = {
      settlePagBankPayment: jest.fn().mockResolvedValue('APPROVED'),
    };
    const createCreditCardPayment = jest.fn().mockResolvedValue({
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'CHAR_TEST',
      status: 'APPROVED',
      statusDetail: 'SUCESSO',
      approvedAt,
      cardBrand: 'visa',
      cardLastFour: '1111',
    });
    const gateway: PaymentGateway = {
      provider: PaymentProvider.PAGBANK,
      createPixPayment: jest.fn(),
      createCreditCardPayment,
      getPayment: jest.fn(),
    };
    const service = new CreditCardPaymentsService(
      billingService as unknown as BillingService,
      paymentsService as unknown as PaymentsService,
      {
        get: jest.fn(),
      } as unknown as ConfigService,
      gateway,
      paymentSettlementService as unknown as PaymentSettlementService,
    );

    const result = await service.create('user-id', {
      encryptedCard,
      holderName: 'Usuário de Teste',
      holderCpf: '123.456.789-01',
      installments: 1,
      idempotencyKey: 'card-idempotency-key',
    });

    expect(result.status).toBe(PaymentStatus.APPROVED);
    expect(result.providerOrderId).toBe('ORDE_TEST');
    expect(result.providerPaymentId).toBe('CHAR_TEST');
    expect(paymentsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        method: PaymentMethod.CREDIT_CARD,
        provider: PaymentProvider.PAGBANK,
        installments: 1,
      }),
    );
    expect(createCreditCardPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInCents: 4990,
        encryptedCard,
        holder: {
          name: 'Usuário de Teste',
          taxId: '12345678901',
        },
        installments: 1,
      }),
    );
    expect(paymentSettlementService.settlePagBankPayment).toHaveBeenCalledWith({
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'CHAR_TEST',
      externalReference: 'pay_reference',
      status: 'APPROVED',
      statusDetail: 'SUCESSO',
      amountInCents: 4990,
      currency: Currency.BRL,
      approvedAt,
      cardBrand: 'visa',
      cardLastFour: '1111',
    });
    expect(paymentsService.updateStatus).not.toHaveBeenCalled();
    expect(paymentsService.findById).toHaveBeenCalledWith('payment-id');
  });

  it('blocks a new credit card charge while another payment is active', async () => {
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
    const paymentsService = {
      findCurrentByInvoiceId: jest.fn().mockResolvedValue({
        id: 'current-payment-id',
        idempotencyKey: 'another-idempotency-key',
        status: PaymentStatus.PENDING,
      }),
      create: jest.fn(),
      updateStatus: jest.fn(),
    };
    const createCreditCardPayment = jest.fn();
    const paymentSettlementService = {
      settlePagBankPayment: jest.fn(),
    };
    const gateway: PaymentGateway = {
      provider: PaymentProvider.PAGBANK,
      createPixPayment: jest.fn(),
      createCreditCardPayment,
      getPayment: jest.fn(),
    };
    const service = new CreditCardPaymentsService(
      billingService as unknown as BillingService,
      paymentsService as unknown as PaymentsService,
      {
        get: jest.fn(),
      } as unknown as ConfigService,
      gateway,
      paymentSettlementService as unknown as PaymentSettlementService,
    );

    await expect(
      service.create('user-id', {
        encryptedCard,
        holderName: 'Usuário de Teste',
        holderCpf: '12345678901',
        installments: 1,
        idempotencyKey: 'card-idempotency-key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(paymentsService.create).not.toHaveBeenCalled();
    expect(createCreditCardPayment).not.toHaveBeenCalled();
    expect(
      paymentSettlementService.settlePagBankPayment,
    ).not.toHaveBeenCalled();
  });

  it('returns the configured PagBank public key', () => {
    const service = new CreditCardPaymentsService(
      {} as BillingService,
      {} as PaymentsService,
      {
        get: jest.fn().mockReturnValue('public-key-value'),
      } as unknown as ConfigService,
      {
        provider: PaymentProvider.PAGBANK,
        createPixPayment: jest.fn(),
        createCreditCardPayment: jest.fn(),
        getPayment: jest.fn(),
      },
      {
        settlePagBankPayment: jest.fn(),
      } as unknown as PaymentSettlementService,
    );

    expect(service.getPublicKey()).toBe('public-key-value');
  });
});
