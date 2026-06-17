import { BadGatewayException, Injectable } from '@nestjs/common';
import { PaymentProvider, Prisma } from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { InvoicesService } from '../billing/invoices.service';
import type { CanonicalGatewayPayment } from '../payments/gateways/payment-gateway.interface';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AuditService } from '../observability/audit.service';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
} from '../observability/observability.constants';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';

export type WebhookProcessingOutcome =
  | 'APPROVED'
  | 'ALREADY_PROCESSED'
  | 'PAYMENT_NOT_FOUND'
  | 'IGNORED_STATUS';

@Injectable()
export class WebhookProcessorService {
  private static readonly MAX_TRANSACTION_RETRIES = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly paymentsService: PaymentsService,
    private readonly invoicesService: InvoicesService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async processPagBankPayment(
    canonicalPayment: CanonicalGatewayPayment,
  ): Promise<WebhookProcessingOutcome> {
    if (canonicalPayment.status !== 'APPROVED') {
      return 'IGNORED_STATUS';
    }

    if (!canonicalPayment.approvedAt) {
      throw new BadGatewayException(
        'Pagamento aprovado sem data canônica de aprovação',
      );
    }

    const payment =
      await this.paymentsService.findPagBankPayment(canonicalPayment);

    if (!payment) {
      return 'PAYMENT_NOT_FOUND';
    }

    this.billingService.assertCanonicalSettlement(payment, canonicalPayment);

    return this.runSettlementTransaction(async (transaction) => {
      const approval = await this.paymentsService.approveInTransaction(
        transaction,
        {
          paymentId: payment.id,
          providerOrderId: canonicalPayment.providerOrderId,
          providerPaymentId: canonicalPayment.providerPaymentId,
          approvedAt: canonicalPayment.approvedAt as Date,
          statusDetail: canonicalPayment.statusDetail,
        },
      );
      const invoicePayment = await this.invoicesService.markPaidInTransaction(
        transaction,
        payment.invoiceId,
        canonicalPayment.approvedAt as Date,
      );
      const activation =
        await this.subscriptionsService.activateForInvoiceInTransaction(
          transaction,
          {
            subscriptionId: payment.invoice.subscriptionId,
            invoiceId: payment.invoiceId,
            approvedAt: canonicalPayment.approvedAt as Date,
            provider: PaymentProvider.PAGBANK,
            providerPaymentId: canonicalPayment.providerPaymentId,
          },
        );

      if (approval.changed) {
        await this.auditService.recordInTransaction(transaction, {
          userId: payment.invoice.subscription.userId,
          action: AUDIT_ACTION.PAYMENT_APPROVED,
          entityType: AUDIT_ENTITY.PAYMENT,
          entityId: payment.id,
          metadata: {
            invoiceId: payment.invoiceId,
            provider: PaymentProvider.PAGBANK,
            providerPaymentId: canonicalPayment.providerPaymentId,
            amount: payment.amount.toString(),
            currency: payment.currency,
          },
        });
        await this.eventBus.publish(
          {
            eventType: INTERNAL_EVENT.PAYMENT_APPROVED,
            aggregateType: 'PAYMENT',
            aggregateId: payment.id,
            payload: {
              paymentId: payment.id,
              invoiceId: payment.invoiceId,
              userId: payment.invoice.subscription.userId,
              provider: PaymentProvider.PAGBANK,
              providerPaymentId: canonicalPayment.providerPaymentId,
            },
          },
          transaction,
        );
      }

      if (activation.changed) {
        await this.auditService.recordInTransaction(transaction, {
          userId: activation.subscription.userId,
          action: AUDIT_ACTION.SUBSCRIPTION_ACTIVATED,
          entityType: AUDIT_ENTITY.SUBSCRIPTION,
          entityId: activation.subscription.id,
          metadata: {
            invoiceId: payment.invoiceId,
            paymentId: payment.id,
            planId: activation.subscription.planId,
            provider: PaymentProvider.PAGBANK,
          },
        });
        await this.eventBus.publish(
          {
            eventType: INTERNAL_EVENT.SUBSCRIPTION_ACTIVATED,
            aggregateType: 'SUBSCRIPTION',
            aggregateId: activation.subscription.id,
            payload: {
              subscriptionId: activation.subscription.id,
              invoiceId: payment.invoiceId,
              paymentId: payment.id,
              userId: activation.subscription.userId,
              planId: activation.subscription.planId,
            },
          },
          transaction,
        );
      }

      return approval.changed || invoicePayment.changed || activation.changed
        ? 'APPROVED'
        : 'ALREADY_PROCESSED';
    });
  }

  private async runSettlementTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (
      let attempt = 1;
      attempt <= WebhookProcessorService.MAX_TRANSACTION_RETRIES;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error: unknown) {
        const shouldRetry =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < WebhookProcessorService.MAX_TRANSACTION_RETRIES;

        if (!shouldRetry) {
          throw error;
        }
      }
    }

    throw new Error('Falha inesperada ao liquidar o pagamento');
  }
}
