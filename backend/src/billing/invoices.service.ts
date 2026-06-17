import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';

const invoiceWithPayments = {
  subscription: {
    include: {
      plan: true,
    },
  },
  payments: {
    orderBy: {
      createdAt: 'desc',
    },
  },
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateInvoiceDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: {
        id: data.subscriptionId,
      },
      select: {
        id: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada');
    }

    const subtotal = new Prisma.Decimal(data.subtotal);
    const discount = new Prisma.Decimal(data.discount ?? 0);
    const total = subtotal.minus(discount);
    const periodStart = new Date(data.periodStart);
    const periodEnd = new Date(data.periodEnd);
    const dueAt = new Date(data.dueAt);

    if (subtotal.isNegative() || discount.isNegative() || total.isNegative()) {
      throw new BadRequestException('Valores da fatura são inválidos');
    }

    if (periodEnd <= periodStart) {
      throw new BadRequestException(
        'O fim do período deve ser posterior ao início',
      );
    }

    return this.prisma.invoice.create({
      data: {
        subscriptionId: data.subscriptionId,
        externalReference: `inv_${randomUUID()}`,
        cycleNumber: data.cycleNumber,
        currency: data.currency ?? Currency.BRL,
        subtotal,
        discount,
        total,
        periodStart,
        periodEnd,
        dueAt,
      },
      include: invoiceWithPayments,
    });
  }

  async findById(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        id: invoiceId,
      },
      include: invoiceWithPayments,
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada');
    }

    return invoice;
  }

  async updateStatus(invoiceId: string, data: UpdateInvoiceStatusDto) {
    const invoice = await this.findById(invoiceId);

    this.assertStatusTransition(invoice.status, data.status);

    return this.prisma.invoice.update({
      where: {
        id: invoiceId,
      },
      data: {
        status: data.status,
        paidAt:
          data.status === InvoiceStatus.PAID
            ? new Date(data.paidAt ?? Date.now())
            : invoice.paidAt,
        voidedAt:
          data.status === InvoiceStatus.VOID
            ? new Date(data.voidedAt ?? Date.now())
            : invoice.voidedAt,
      },
      include: invoiceWithPayments,
    });
  }

  async markPaidInTransaction(
    transaction: Prisma.TransactionClient,
    invoiceId: string,
    paidAt: Date,
  ) {
    const invoice = await transaction.invoice.findUnique({
      where: {
        id: invoiceId,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      return {
        invoice,
        changed: false,
      };
    }

    this.assertStatusTransition(invoice.status, InvoiceStatus.PAID);

    const paidInvoice = await transaction.invoice.update({
      where: {
        id: invoiceId,
      },
      data: {
        status: InvoiceStatus.PAID,
        paidAt,
      },
    });

    return {
      invoice: paidInvoice,
      changed: true,
    };
  }

  private assertStatusTransition(
    currentStatus: InvoiceStatus,
    nextStatus: InvoiceStatus,
  ): void {
    if (currentStatus === nextStatus) {
      return;
    }

    const allowedTransitions: Record<InvoiceStatus, InvoiceStatus[]> = {
      [InvoiceStatus.OPEN]: [
        InvoiceStatus.PAID,
        InvoiceStatus.VOID,
        InvoiceStatus.UNCOLLECTIBLE,
      ],
      [InvoiceStatus.PAID]: [],
      [InvoiceStatus.VOID]: [],
      [InvoiceStatus.UNCOLLECTIBLE]: [],
    };

    if (!allowedTransitions[currentStatus].includes(nextStatus)) {
      throw new BadRequestException(
        `Transição de fatura inválida: ${currentStatus} -> ${nextStatus}`,
      );
    }
  }
}
