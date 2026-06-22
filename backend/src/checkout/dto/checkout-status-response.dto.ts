import {
  Currency,
  InvoiceStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PlanType,
  SubscriptionStatus,
} from '@prisma/client';

export enum CheckoutStatus {
  NO_PENDING_CHECKOUT = 'NO_PENDING_CHECKOUT',
  WAITING_PAYMENT = 'WAITING_PAYMENT',
  PAYMENT_EXPIRED = 'PAYMENT_EXPIRED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAID_ACTIVATING = 'PAID_ACTIVATING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  EXPIRED = 'EXPIRED',
}

export class CheckoutUserDto {
  id!: string;
  name!: string | null;
  email!: string | null;
  phone!: string;
  phoneE164!: string | null;
}

export class CheckoutPlanDto {
  id!: string;
  type!: PlanType;
  name!: string;
  price!: string;
  currency!: Currency;
  imageLimit!: number;
}

export class CheckoutSubscriptionDto {
  id!: string;
  status!: SubscriptionStatus;
  amount!: string;
  plan!: CheckoutPlanDto;
  paidAt!: string | null;
  currentPeriodStart!: string | null;
  currentPeriodEnd!: string | null;
  gracePeriodEnd!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class CheckoutInvoiceDto {
  id!: string;
  status!: InvoiceStatus;
  cycleNumber!: number;
  total!: string;
  currency!: Currency;
  dueAt!: string;
  paidAt!: string | null;
  periodStart!: string;
  periodEnd!: string;
}

export class CheckoutPaymentDto {
  id!: string;
  provider!: PaymentProvider;
  method!: PaymentMethod;
  status!: PaymentStatus;
  amount!: string;
  currency!: Currency;
  externalReference!: string;
  providerOrderId!: string | null;
  providerPaymentId!: string | null;
  qrCode!: string | null;
  qrCodeImageUrl!: string | null;
  expiresAt!: string | null;
  approvedAt!: string | null;
  failedAt!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class CheckoutStatusResponseDto {
  user!: CheckoutUserDto;
  subscription!: CheckoutSubscriptionDto | null;
  invoice!: CheckoutInvoiceDto | null;
  payment!: CheckoutPaymentDto | null;
  checkoutStatus!: CheckoutStatus;
}
