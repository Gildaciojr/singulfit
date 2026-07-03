import { Injectable } from '@nestjs/common';
import type { CanonicalGatewayPayment } from '../payments/gateways/payment-gateway.interface';
import {
  PaymentSettlementOutcome,
  PaymentSettlementService,
} from '../payments/payment-settlement.service';

export type WebhookProcessingOutcome = PaymentSettlementOutcome;

@Injectable()
export class WebhookProcessorService {
  constructor(
    private readonly paymentSettlementService: PaymentSettlementService,
  ) {}

  async processPagBankPayment(
    canonicalPayment: CanonicalGatewayPayment,
  ): Promise<WebhookProcessingOutcome> {
    return this.paymentSettlementService.settlePagBankPayment(canonicalPayment);
  }
}
