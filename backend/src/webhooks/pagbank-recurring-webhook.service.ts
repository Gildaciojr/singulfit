import { Injectable } from '@nestjs/common';
import { PaymentProvider, SubscriptionStatus } from '@prisma/client';
import { PagBankRecurringGateway } from '../pagbank/pagbank-recurring.gateway';
import { PagBankRecurringReconciliationService } from '../payments/pagbank-recurring-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

const EVENTS = new Set([
  'subscription.initial',
  'subscription.updated',
  'subscription.activated',
  'subscription.recurrence',
  'subscription.suspended',
  'subscription.expired',
  'subscription.canceled',
  'subscription.migrated',
]);

@Injectable()
export class PagBankRecurringWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PagBankRecurringGateway,
    private readonly reconciliation: PagBankRecurringReconciliationService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  supports(action: string | null): boolean {
    return action !== null && EVENTS.has(action);
  }

  async process(externalSubscriptionId: string, action: string) {
    if (!this.supports(action)) return { ignored: true };
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        provider_externalSubscriptionId: {
          provider: PaymentProvider.PAGBANK,
          externalSubscriptionId,
        },
      },
    });
    if (!subscription) return { ignored: true };

    const canonical = await this.gateway.getSubscription(
      externalSubscriptionId,
    );
    if (canonical.status === 'EXPIRED' || canonical.status === 'CANCELED') {
      await this.applyCanonicalStatus(subscription, canonical.status);
      return { ignored: false, reconciliation: null };
    }
    const reconciliation = await this.reconciliation.reconcile(
      externalSubscriptionId,
    );
    await this.applyCanonicalStatus(subscription, canonical.status);
    return { ignored: false, reconciliation };
  }

  private async applyCanonicalStatus(
    subscription: {
      id: string;
      currentPeriodEnd: Date | null;
      gracePeriodEnd: Date | null;
    },
    providerStatus: string,
  ): Promise<void> {
    switch (providerStatus) {
      case 'OVERDUE':
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: SubscriptionStatus.PAST_DUE,
            gracePeriodEnd:
              subscription.gracePeriodEnd ??
              this.subscriptions.calculateGracePeriodEnd(
                subscription.currentPeriodEnd ?? new Date(),
              ),
          },
        });
        return;
      case 'ACTIVE':
        await this.prisma.subscription.updateMany({
          where: { id: subscription.id, status: SubscriptionStatus.ACTIVE },
          data: { gracePeriodEnd: null },
        });
        return;
      case 'EXPIRED':
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: SubscriptionStatus.EXPIRED, endedAt: new Date() },
        });
        return;
      case 'CANCELED':
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: SubscriptionStatus.CANCELED,
            cancelAtPeriodEnd: false,
            canceledAt: new Date(),
            endedAt: new Date(),
          },
        });
        return;
      case 'SUSPENDED':
      case 'PENDING_ACTION':
        return;
    }
  }
}
