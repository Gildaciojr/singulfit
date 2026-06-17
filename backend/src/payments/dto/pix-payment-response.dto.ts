import { Currency, PaymentProvider, PaymentStatus } from '@prisma/client';

export class PixPaymentResponseDto {
  paymentId!: string;
  invoiceId!: string;
  provider!: PaymentProvider;
  status!: PaymentStatus;
  amount!: string;
  currency!: Currency;
  externalReference!: string;
  providerPaymentId!: string;
  qrCode!: string;
  qrCodeImageUrl!: string;
  expiresAt!: string;
}
