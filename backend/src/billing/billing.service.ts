import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { PrismaService } from '../prisma/prisma.service';
import type { CanonicalGatewayPayment } from '../payments/gateways/payment-gateway.interface';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoicesService } from './invoices.service';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
  ) {}

  createInvoice(data: CreateInvoiceDto) {
    return this.invoicesService.create(data);
  }

  assertCanonicalSettlement(
    payment: {
      amount: Prisma.Decimal;
      currency: string;
      externalReference: string;
    },
    canonicalPayment: CanonicalGatewayPayment,
  ): void {
    const localAmountInCents = payment.amount.mul(100);

    if (
      !localAmountInCents.isInteger() ||
      localAmountInCents.toNumber() !== canonicalPayment.amountInCents ||
      payment.currency !== canonicalPayment.currency ||
      payment.externalReference !== canonicalPayment.externalReference
    ) {
      throw new BadRequestException(
        'Pagamento canônico não corresponde ao pagamento local',
      );
    }
  }

  async getOrCreateInitialInvoice(userId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.PENDING_PAYMENT,
      },
      include: {
        plan: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            cpf: true,
            phone: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!subscription) {
      throw new NotFoundException('Assinatura pendente não encontrada');
    }

    if (!subscription.plan.isActive) {
      throw new BadRequestException('O plano selecionado não está ativo');
    }

    const existingInvoice = await this.prisma.invoice.findUnique({
      where: {
        subscriptionId_cycleNumber: {
          subscriptionId: subscription.id,
          cycleNumber: 1,
        },
      },
    });

    if (existingInvoice) {
      if (existingInvoice.status !== InvoiceStatus.OPEN) {
        throw new ConflictException(
          'A fatura inicial desta assinatura não está disponível para cobrança',
        );
      }

      return {
        subscription,
        invoice: existingInvoice,
      };
    }

    const periodStart = dayjs();
    const periodEnd = periodStart.add(
      subscription.plan.billingIntervalCount,
      'month',
    );

    try {
      const invoice = await this.invoicesService.create({
        subscriptionId: subscription.id,
        cycleNumber: 1,
        currency: subscription.plan.currency,
        subtotal: subscription.plan.price.toFixed(2),
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        dueAt: periodStart.add(1, 'day').toISOString(),
      });

      return {
        subscription,
        invoice,
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrentInvoice = await this.prisma.invoice.findUnique({
          where: {
            subscriptionId_cycleNumber: {
              subscriptionId: subscription.id,
              cycleNumber: 1,
            },
          },
        });

        if (
          concurrentInvoice &&
          concurrentInvoice.status === InvoiceStatus.OPEN
        ) {
          return {
            subscription,
            invoice: concurrentInvoice,
          };
        }
      }

      throw error;
    }
  }

  async getSubscriptionBilling(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        id: subscriptionId,
      },
      include: {
        plan: true,
        invoices: {
          include: {
            payments: {
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
          orderBy: {
            cycleNumber: 'desc',
          },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada');
    }

    return subscription;
  }
}
