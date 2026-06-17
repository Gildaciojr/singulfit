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
}

export interface PaymentGateway {
  readonly provider: PaymentProvider;

  createPixPayment(input: CreateGatewayPixPayment): Promise<GatewayPixPayment>;

  getPayment(resourceId: string): Promise<CanonicalGatewayPayment>;
}
