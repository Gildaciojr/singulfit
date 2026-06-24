import { Currency, PaymentProvider, PaymentStatus } from '@prisma/client';

export class CreditCardPaymentResponseDto {
  paymentId!: string;
  invoiceId!: string;
  provider!: PaymentProvider;
  status!: PaymentStatus;
  amount!: string;
  currency!: Currency;
  externalReference!: string;
  providerPaymentId!: string;
  providerOrderId!: string;
  approvedAt!: string | null;
}
