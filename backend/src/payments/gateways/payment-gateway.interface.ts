import { PaymentProvider } from '@prisma/client';

export interface PaymentGatewayCustomer {
  name: string;
  email: string;
  taxId: string;
  phone: {
    country: string;
    area: string;
    number: string;
    type: 'MOBILE';
  };
}

export interface CreateGatewayPixPayment {
  idempotencyKey: string;
  externalReference: string;
  amountInCents: number;
  expirationDate: Date;
  customer: PaymentGatewayCustomer;
  item: {
    referenceId: string;
    name: string;
  };
}

export interface GatewayPixPayment {
  providerOrderId: string;
  providerPaymentId: string;
  qrCode: string;
  qrCodeImageUrl: string;
  expiresAt: Date;
}

export interface CreateGatewayCreditCardPayment {
  idempotencyKey: string;
  externalReference: string;
  amountInCents: number;
  customer: PaymentGatewayCustomer;
  item: {
    referenceId: string;
    name: string;
  };
  encryptedCard: string;
  holder: {
    name: string;
    taxId: string;
  };
  installments: number;
}

export interface GatewayCreditCardPayment {
  providerOrderId: string;
  providerPaymentId: string;
  status: GatewayPaymentStatus;
  statusDetail?: string;
  approvedAt?: Date;
  cardBrand?: string;
  cardLastFour?: string;
}

export type GatewayPaymentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'UNKNOWN';

export interface CanonicalGatewayPayment {
  providerOrderId: string;
  providerPaymentId: string;
  externalReference: string;
  status: GatewayPaymentStatus;
  statusDetail?: string;
  amountInCents: number;
  currency: string;
  approvedAt?: Date;
  cardBrand?: string;
  cardLastFour?: string;
}

export interface PaymentGateway {
  readonly provider: PaymentProvider;

  createPixPayment(input: CreateGatewayPixPayment): Promise<GatewayPixPayment>;

  createCreditCardPayment(
    input: CreateGatewayCreditCardPayment,
  ): Promise<GatewayCreditCardPayment>;

  getPayment(resourceId: string): Promise<CanonicalGatewayPayment>;
}
