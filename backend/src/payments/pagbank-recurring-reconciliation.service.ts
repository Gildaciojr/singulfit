import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import {
  PagBankRecurringGateway,
  PagBankRecurringInvoice,
  PagBankRecurringInvoicePayment,
} from '../pagbank/pagbank-recurring.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentSettlementService } from './payment-settlement.service';

@Injectable()
export class PagBankRecurringReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PagBankRecurringGateway,
    private readonly settlement: PaymentSettlementService,
  ) {}

  async reconcile(externalSubscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        provider_externalSubscriptionId: {
          provider: PaymentProvider.PAGBANK,
          externalSubscriptionId,
        },
      },
    });
    if (!subscription) {
      throw new NotFoundException('Assinatura recorrente local não encontrada');
    }

    const providerSubscription = await this.gateway.getSubscription(
      externalSubscriptionId,
    );
    if (providerSubscription.id !== externalSubscriptionId) {
      throw new ConflictException('Assinatura PagBank incompatível');
    }

    const invoices = await this.gateway.listSubscriptionInvoices(
      externalSubscriptionId,
    );
    if (
      invoices.some(
        (invoice) => invoice.subscriptionId !== externalSubscriptionId,
      )
    ) {
      throw new ConflictException('Fatura PagBank não pertence à assinatura');
    }
    const invoicePayments = await Promise.all(
      invoices.map(async (invoice) => ({
        invoice,
        payments: await this.gateway.listInvoicePayments(invoice.id),
      })),
    );

    const outcomes: string[] = [];
    for (const { invoice, payments } of invoicePayments) {
      const localInvoice = await this.getOrCreateInvoice(
        subscription.id,
        invoice,
      );
      for (const payment of payments) {
        this.assertPaymentOwnership(payment, invoice, externalSubscriptionId);
        const localPayment = await this.getOrCreatePayment(
          localInvoice.id,
          payment,
        );
        if (
          payment.status === 'APPROVED' &&
          localPayment.status !== PaymentStatus.APPROVED
        ) {
          if (!payment.approvedAt) {
            throw new BadGatewayException(
              'Pagamento recorrente aprovado sem data canônica',
            );
          }
          outcomes.push(
            await this.settlement.settlePagBankPayment({
              providerOrderId: payment.orderId,
              providerPaymentId: payment.id,
              externalReference: this.paymentReference(payment.id),
              status: 'APPROVED',
              amountInCents: payment.amountInCents,
              currency: payment.currency,
              approvedAt: payment.approvedAt,
            }),
          );
        }
      }
    }
    return { subscriptionId: subscription.id, outcomes };
  }

  private async getOrCreateInvoice(
    subscriptionId: string,
    invoice: PagBankRecurringInvoice,
  ) {
    const existing = await this.prisma.invoice.findUnique({
      where: { providerInvoiceId: invoice.id },
    });
    if (existing) {
      if (existing.subscriptionId !== subscriptionId) {
        throw new ConflictException(
          'Fatura PagBank já pertence a outra assinatura',
        );
      }
      return existing;
    }
    try {
      return await this.prisma.invoice.create({
        data: {
          subscriptionId,
          providerInvoiceId: invoice.id,
          externalReference: `recurring-invoice-${invoice.id}`,
          cycleNumber: invoice.cycleNumber,
          status: InvoiceStatus.OPEN,
          currency: invoice.currency as 'BRL',
          subtotal: new Prisma.Decimal(invoice.amountInCents).div(100),
          total: new Prisma.Decimal(invoice.amountInCents).div(100),
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          dueAt: invoice.dueAt,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.invoice.findUnique({
          where: { providerInvoiceId: invoice.id },
        });
        if (winner && winner.subscriptionId === subscriptionId) return winner;
      }
      throw error;
    }
  }

  private async getOrCreatePayment(
    invoiceId: string,
    payment: PagBankRecurringInvoicePayment,
  ) {
    const existing = await this.prisma.payment.findUnique({
      where: {
        provider_providerPaymentId: {
          provider: PaymentProvider.PAGBANK,
          providerPaymentId: payment.id,
        },
      },
    });
    if (existing) {
      if (existing.invoiceId !== invoiceId) {
        throw new ConflictException(
          'Pagamento PagBank já pertence a outra fatura',
        );
      }
      return existing;
    }
    try {
      return await this.prisma.payment.create({
        data: {
          invoiceId,
          provider: PaymentProvider.PAGBANK,
          method: PaymentMethod.CREDIT_CARD,
          status: this.localPaymentStatus(payment.status),
          amount: new Prisma.Decimal(payment.amountInCents).div(100),
          currency: payment.currency as 'BRL',
          idempotencyKey: `recurring-payment-${payment.id}`,
          externalReference: this.paymentReference(payment.id),
          providerOrderId: payment.orderId,
          providerPaymentId: payment.id,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.payment.findUnique({
          where: {
            provider_providerPaymentId: {
              provider: PaymentProvider.PAGBANK,
              providerPaymentId: payment.id,
            },
          },
        });
        if (winner && winner.invoiceId === invoiceId) return winner;
      }
      throw error;
    }
  }

  private assertPaymentOwnership(
    payment: PagBankRecurringInvoicePayment,
    invoice: PagBankRecurringInvoice,
    subscriptionId: string,
  ): void {
    if (
      payment.invoiceId !== invoice.id ||
      payment.subscriptionId !== subscriptionId
    ) {
      throw new ConflictException(
        'Pagamento PagBank incompatível com a fatura',
      );
    }
  }

  private localPaymentStatus(
    status: PagBankRecurringInvoicePayment['status'],
  ): PaymentStatus {
    switch (status) {
      case 'APPROVED':
      case 'PENDING':
      case 'UNPAID':
        return PaymentStatus.PENDING;
      case 'IN_ANALYSIS':
        return PaymentStatus.PROCESSING;
      case 'DENIED':
        return PaymentStatus.REJECTED;
      case 'REFUNDED':
        return PaymentStatus.REFUNDED;
    }
  }

  private paymentReference(providerPaymentId: string): string {
    return `recurring-payment-${providerPaymentId}`;
  }
}
