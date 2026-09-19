import { PaymentProvider, SubscriptionStatus } from '@prisma/client';

export class RecurringCreditCardSubscriptionResponseDto {
  subscriptionId!: string;
  status!: SubscriptionStatus;
  provider!: PaymentProvider | null;
  externalSubscriptionId!: string | null;
  billingCycles!: number | null;
}
