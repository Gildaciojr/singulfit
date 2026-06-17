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

type PlanEntity = Prisma.PlanGetPayload<{}>;

type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
  include: { plan: true };
}>;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly subscriptionAccessService: SubscriptionAccessService,
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

    if (subscription.activationInvoiceId === input.invoiceId) {
      return {
        subscription,
        changed: false,
      };
    }

    if (subscription.activationInvoiceId) {
      throw new ConflictException(
        'A assinatura já foi ativada por outra fatura',
      );
    }

    if (subscription.status === SubscriptionStatus.ACTIVE) {
      return {
        subscription,
        changed: false,
      };
    }

    if (subscription.status !== SubscriptionStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        'A assinatura não está disponível para ativação',
      );
    }

    const periodStart = dayjs(input.approvedAt);
    const periodEnd = periodStart.add(
      subscription.plan.billingIntervalCount,
      'month',
    );
    const gracePeriodEnd = periodEnd.add(this.getGracePeriodDays(), 'day');
    const activatedSubscription = await transaction.subscription.update({
      where: {
        id: input.subscriptionId,
      },
      data: {
        activationInvoiceId: input.invoiceId,
        status: SubscriptionStatus.ACTIVE,
        provider: input.provider,
        externalPaymentId: input.providerPaymentId,
        paymentMethod: PaymentMethod.PIX,
        paidAt: input.approvedAt,
        startedAt: input.approvedAt,
        billingPeriodStart: periodStart.toDate(),
        billingPeriodEnd: periodEnd.toDate(),
        currentPeriodStart: periodStart.toDate(),
        currentPeriodEnd: periodEnd.toDate(),
        gracePeriodEnd: gracePeriodEnd.toDate(),
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
    };
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
