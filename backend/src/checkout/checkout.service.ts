import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CheckoutInvoiceDto,
  CheckoutPaymentDto,
  CheckoutPlanDto,
  CheckoutStatus,
  CheckoutStatusResponseDto,
  CheckoutSubscriptionDto,
  CheckoutUserDto,
} from './dto/checkout-status-response.dto';

const checkoutSubscriptionInclude = {
  plan: true,
  invoices: {
    include: {
      payments: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
    },
    orderBy: {
      cycleNumber: 'desc',
    },
    take: 1,
  },
} satisfies Prisma.SubscriptionInclude;

type CheckoutSubscriptionRecord = Prisma.SubscriptionGetPayload<{
  include: typeof checkoutSubscriptionInclude;
}>;

type CheckoutInvoiceRecord = CheckoutSubscriptionRecord['invoices'][number];
type CheckoutPaymentRecord = CheckoutInvoiceRecord['payments'][number];

const ACTIVE_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.CREATED,
  PaymentStatus.PENDING,
  PaymentStatus.PROCESSING,
]);

const FAILED_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.REJECTED,
  PaymentStatus.CANCELED,
]);

@Injectable()
export class CheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(userId: string): Promise<CheckoutStatusResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        phoneE164: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const subscription = await this.findCheckoutSubscription(userId);
    const invoice = subscription?.invoices[0] ?? null;
    const payment = invoice?.payments[0] ?? null;

    return {
      user: this.toUserDto(user),
      subscription: subscription ? this.toSubscriptionDto(subscription) : null,
      invoice: invoice ? this.toInvoiceDto(invoice) : null,
      payment: payment ? this.toPaymentDto(payment) : null,
      checkoutStatus: this.resolveCheckoutStatus(
        subscription,
        invoice,
        payment,
        new Date(),
      ),
    };
  }

  private async findCheckoutSubscription(
    userId: string,
  ): Promise<CheckoutSubscriptionRecord | null> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        userId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PENDING_PAYMENT,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.EXPIRED,
          ],
        },
      },
      include: checkoutSubscriptionInclude,
      orderBy: {
        updatedAt: 'desc',
      },
      take: 10,
    });

    return (
      subscriptions.sort((left, right) => {
        const priorityDelta =
          this.subscriptionPriority(left.status) -
          this.subscriptionPriority(right.status);

        if (priorityDelta !== 0) {
          return priorityDelta;
        }

        return right.updatedAt.getTime() - left.updatedAt.getTime();
      })[0] ?? null
    );
  }

  private resolveCheckoutStatus(
    subscription: CheckoutSubscriptionRecord | null,
    invoice: CheckoutInvoiceRecord | null,
    payment: CheckoutPaymentRecord | null,
    at: Date,
  ): CheckoutStatus {
    if (!subscription) {
      return CheckoutStatus.NO_PENDING_CHECKOUT;
    }

    switch (subscription.status) {
      case SubscriptionStatus.ACTIVE:
        return CheckoutStatus.ACTIVE;
      case SubscriptionStatus.PAST_DUE:
        return CheckoutStatus.PAST_DUE;
      case SubscriptionStatus.EXPIRED:
        return CheckoutStatus.EXPIRED;
      case SubscriptionStatus.PENDING_PAYMENT:
        return this.resolvePendingPaymentStatus(invoice, payment, at);
      case SubscriptionStatus.CANCELED:
        return CheckoutStatus.NO_PENDING_CHECKOUT;
    }
  }

  private resolvePendingPaymentStatus(
    invoice: CheckoutInvoiceRecord | null,
    payment: CheckoutPaymentRecord | null,
    at: Date,
  ): CheckoutStatus {
    if (
      invoice?.status === InvoiceStatus.PAID ||
      payment?.status === PaymentStatus.APPROVED
    ) {
      return CheckoutStatus.PAID_ACTIVATING;
    }

    if (
      payment?.status === PaymentStatus.EXPIRED ||
      (payment?.expiresAt &&
        payment.expiresAt <= at &&
        ACTIVE_PAYMENT_STATUSES.has(payment.status))
    ) {
      return CheckoutStatus.PAYMENT_EXPIRED;
    }

    if (
      (payment && FAILED_PAYMENT_STATUSES.has(payment.status)) ||
      invoice?.status === InvoiceStatus.VOID ||
      invoice?.status === InvoiceStatus.UNCOLLECTIBLE
    ) {
      return CheckoutStatus.PAYMENT_FAILED;
    }

    return CheckoutStatus.WAITING_PAYMENT;
  }

  private subscriptionPriority(status: SubscriptionStatus): number {
    const priority: Record<SubscriptionStatus, number> = {
      [SubscriptionStatus.ACTIVE]: 0,
      [SubscriptionStatus.PENDING_PAYMENT]: 1,
      [SubscriptionStatus.PAST_DUE]: 2,
      [SubscriptionStatus.EXPIRED]: 3,
      [SubscriptionStatus.CANCELED]: 4,
    };

    return priority[status];
  }

  private toUserDto(user: CheckoutUserDto): CheckoutUserDto {
    return user;
  }

  private toSubscriptionDto(
    subscription: CheckoutSubscriptionRecord,
  ): CheckoutSubscriptionDto {
    return {
      id: subscription.id,
      status: subscription.status,
      amount: subscription.amount.toFixed(2),
      plan: this.toPlanDto(subscription.plan),
      paidAt: this.toIso(subscription.paidAt),
      currentPeriodStart: this.toIso(subscription.currentPeriodStart),
      currentPeriodEnd: this.toIso(subscription.currentPeriodEnd),
      gracePeriodEnd: this.toIso(subscription.gracePeriodEnd),
      createdAt: subscription.createdAt.toISOString(),
      updatedAt: subscription.updatedAt.toISOString(),
    };
  }

  private toPlanDto(plan: CheckoutSubscriptionRecord['plan']): CheckoutPlanDto {
    return {
      id: plan.id,
      type: plan.type,
      name: plan.name,
      price: plan.price.toFixed(2),
      currency: plan.currency,
      imageLimit: plan.imageLimit,
    };
  }

  private toInvoiceDto(invoice: CheckoutInvoiceRecord): CheckoutInvoiceDto {
    return {
      id: invoice.id,
      status: invoice.status,
      cycleNumber: invoice.cycleNumber,
      total: invoice.total.toFixed(2),
      currency: invoice.currency,
      dueAt: invoice.dueAt.toISOString(),
      paidAt: this.toIso(invoice.paidAt),
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
    };
  }

  private toPaymentDto(payment: CheckoutPaymentRecord): CheckoutPaymentDto {
    return {
      id: payment.id,
      provider: payment.provider,
      method: payment.method,
      status: payment.status,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      externalReference: payment.externalReference,
      providerOrderId: payment.providerOrderId,
      providerPaymentId: payment.providerPaymentId,
      qrCode: payment.pixQrCode,
      qrCodeImageUrl: payment.pixTicketUrl,
      expiresAt: this.toIso(payment.expiresAt),
      approvedAt: this.toIso(payment.approvedAt),
      failedAt: this.toIso(payment.failedAt),
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }

  private toIso(value: Date | null): string | null {
    return value ? value.toISOString() : null;
  }
}
