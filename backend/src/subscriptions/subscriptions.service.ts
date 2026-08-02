import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentMethod,
  PaymentProvider,
  SubscriptionStatus,
  PlanType,
  Prisma,
} from '@prisma/client';
import dayjs from 'dayjs';
import { SubscriptionAccessService } from './subscription-access.service';
import { AuditService } from '../observability/audit.service';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
} from '../observability/observability.constants';

type PlanEntity = Prisma.PlanGetPayload<{}>;

type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
  include: { plan: true };
}>;

export type SubscriptionCancellationMode = 'IMMEDIATE' | 'AT_PERIOD_END';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly subscriptionAccessService: SubscriptionAccessService,
    private readonly auditService: AuditService,
  ) {}

  async createPendingSubscription(userId: string, planType: PlanType) {
    const plan: PlanEntity | null = await this.prisma.plan.findUnique({
      where: { type: planType },
    });

    if (!plan) {
      throw new NotFoundException('Plano não encontrado');
    }

    return this.prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: SubscriptionStatus.PENDING_PAYMENT,
        amount: plan.price,
      },
    });
  }

  async activateSubscription(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription não encontrada');
    }

    if (subscription.status === SubscriptionStatus.ACTIVE) {
      return subscription;
    }

    const now = dayjs();
    const nowDate = now.toDate();
    const periodEnd = now.add(1, 'month');

    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        paidAt: nowDate,
        startedAt: nowDate,
        billingPeriodStart: nowDate,
        billingPeriodEnd: periodEnd.toDate(),
        currentPeriodStart: nowDate,
        currentPeriodEnd: periodEnd.toDate(),
        gracePeriodEnd: periodEnd
          .add(this.getGracePeriodDays(), 'day')
          .toDate(),
        version: {
          increment: 1,
        },
      },
    });
  }

  async activateForInvoiceInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
      subscriptionId: string;
      invoiceId: string;
      approvedAt: Date;
      provider: PaymentProvider;
      providerPaymentId: string;
      paymentMethod: PaymentMethod;
    },
  ) {
    const subscription = await transaction.subscription.findUnique({
      where: {
        id: input.subscriptionId,
      },
      include: {
        plan: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada');
    }

    const invoice = await transaction.invoice.findUnique({
      where: { id: input.invoiceId },
    });

    if (!invoice || invoice.subscriptionId !== subscription.id) {
      throw new ConflictException('A fatura não pertence à assinatura');
    }

    const alreadyApplied =
      subscription.status === SubscriptionStatus.ACTIVE &&
      subscription.currentPeriodEnd !== null &&
      subscription.currentPeriodEnd >= invoice.periodEnd;

    if (alreadyApplied) {
      return {
        subscription,
        changed: false,
        reactivated: false,
        cycleNumber: invoice.cycleNumber,
      };
    }

    const activatableStatuses: SubscriptionStatus[] = [
      SubscriptionStatus.PENDING_PAYMENT,
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.EXPIRED,
      SubscriptionStatus.CANCELED,
    ];
    if (!activatableStatuses.includes(subscription.status)) {
      throw new ConflictException(
        'A assinatura não está disponível para ativação',
      );
    }

    const reactivated =
      subscription.status === SubscriptionStatus.EXPIRED ||
      subscription.status === SubscriptionStatus.CANCELED;
    const invoicePeriodIsCurrent = invoice.periodEnd > input.approvedAt;
    const periodStart = invoicePeriodIsCurrent
      ? dayjs(invoice.periodStart)
      : dayjs(input.approvedAt);
    const periodEnd = invoicePeriodIsCurrent
      ? dayjs(invoice.periodEnd)
      : periodStart.add(subscription.plan.billingIntervalCount, 'month');
    const gracePeriodEnd = periodEnd.add(this.getGracePeriodDays(), 'day');
    const activatedSubscription = await transaction.subscription.update({
      where: {
        id: input.subscriptionId,
      },
      data: {
        activationInvoiceId:
          subscription.activationInvoiceId ?? input.invoiceId,
        status: SubscriptionStatus.ACTIVE,
        provider: input.provider,
        externalPaymentId: input.providerPaymentId,
        paymentMethod: input.paymentMethod,
        paidAt: input.approvedAt,
        startedAt: subscription.startedAt ?? input.approvedAt,
        billingPeriodStart: periodStart.toDate(),
        billingPeriodEnd: periodEnd.toDate(),
        currentPeriodStart: periodStart.toDate(),
        currentPeriodEnd: periodEnd.toDate(),
        gracePeriodEnd: gracePeriodEnd.toDate(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        endedAt: null,
        version: {
          increment: 1,
        },
      },
      include: {
        plan: true,
      },
    });

    return {
      subscription: activatedSubscription,
      changed: true,
      reactivated,
      cycleNumber: invoice.cycleNumber,
    };
  }

  async cancelForUser(
    userId: string,
    mode: SubscriptionCancellationMode,
    at = new Date(),
  ) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!subscription) {
      throw new NotFoundException('Assinatura ativa não encontrada');
    }

    return this.cancelSubscription(subscription.id, mode, at);
  }

  async cancelSubscription(
    subscriptionId: string,
    mode: SubscriptionCancellationMode,
    at = new Date(),
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(hashtext(${`subscription-cancel:${subscriptionId}`}))
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;
      const subscription = await transaction.subscription.findUnique({
        where: { id: subscriptionId },
      });

      if (!subscription) {
        throw new NotFoundException('Assinatura não encontrada');
      }

      if (
        subscription.status === SubscriptionStatus.CANCELED ||
        subscription.status === SubscriptionStatus.EXPIRED ||
        (mode === 'AT_PERIOD_END' && subscription.cancelAtPeriodEnd)
      ) {
        return subscription;
      }

      const updated = await transaction.subscription.update({
        where: { id: subscription.id },
        data:
          mode === 'AT_PERIOD_END'
            ? {
                cancelAtPeriodEnd: true,
                canceledAt: at,
                version: { increment: 1 },
              }
            : {
                status: SubscriptionStatus.CANCELED,
                cancelAtPeriodEnd: false,
                canceledAt: at,
                endedAt: at,
                version: { increment: 1 },
              },
      });
      await this.auditService.recordInTransaction(transaction, {
        userId: subscription.userId,
        action:
          mode === 'AT_PERIOD_END'
            ? AUDIT_ACTION.SUBSCRIPTION_CANCELLATION_SCHEDULED
            : AUDIT_ACTION.SUBSCRIPTION_CANCELED,
        entityType: AUDIT_ENTITY.SUBSCRIPTION,
        entityId: subscription.id,
        metadata: { mode, effectiveAt: at.toISOString() },
      });

      return updated;
    });
  }

  async getActiveSubscription(
    userId: string,
  ): Promise<SubscriptionWithPlan | null> {
    return this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
      },
      include: {
        plan: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getMessagingSubscription(userId: string) {
    const trackableStatuses = [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.EXPIRED,
    ];

    for (const status of trackableStatuses) {
      const subscription = await this.prisma.subscription.findFirst({
        where: {
          userId,
          status,
        },
        include: {
          plan: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (subscription) {
        return subscription;
      }
    }

    return null;
  }

  async getProfileSubscription(userId: string) {
    return this.subscriptionAccessService.requireAccess(userId);
  }

  async checkUserAccess(userId: string) {
    try {
      const subscription =
        await this.subscriptionAccessService.requireAccess(userId);

      return {
        hasAccess: true,
        plan: subscription.plan,
      };
    } catch (error: unknown) {
      if (!(error instanceof ForbiddenException)) {
        throw error;
      }

      return {
        hasAccess: false,
        reason: 'NO_ACTIVE_SUBSCRIPTION' as const,
      };
    }
  }

  private getGracePeriodDays(): number {
    const configuredValue = this.configService.get<string>(
      'SUBSCRIPTION_GRACE_PERIOD_DAYS',
      '3',
    );
    const days = Number.parseInt(configuredValue, 10);

    if (!Number.isInteger(days) || days < 0 || days > 30) {
      throw new ServiceUnavailableException(
        'SUBSCRIPTION_GRACE_PERIOD_DAYS possui valor inválido',
      );
    }

    return days;
  }
}
