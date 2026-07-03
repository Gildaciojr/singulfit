import { Currency } from '@prisma/client';
import { PaymentSettlementService } from '../payments/payment-settlement.service';
import { WebhookProcessorService } from './webhook-processor.service';

describe('WebhookProcessorService', () => {
  it('delegates PagBank payment processing to the official settlement service', async () => {
    const canonicalPayment = {
      providerOrderId: 'ORDE_TEST',
      providerPaymentId: 'CHAR_TEST',
      externalReference: 'pay_reference',
      status: 'APPROVED' as const,
      amountInCents: 1990,
      currency: Currency.BRL,
      approvedAt: new Date('2026-06-06T18:30:00.000Z'),
    };
    const paymentSettlementService = {
      settlePagBankPayment: jest.fn().mockResolvedValue('APPROVED'),
    };
    const service = new WebhookProcessorService(
      paymentSettlementService as unknown as PaymentSettlementService,
    );

    await expect(service.processPagBankPayment(canonicalPayment)).resolves.toBe(
      'APPROVED',
    );
    expect(paymentSettlementService.settlePagBankPayment).toHaveBeenCalledWith(
      canonicalPayment,
    );
  });
});
