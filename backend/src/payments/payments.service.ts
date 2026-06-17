import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CanonicalGatewayPayment } from './gateways/payment-gateway.interface';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';

const paymentWithInvoice = {
  invoice: {
    include: {
      subscription: {
        include: {
          plan: true,
        },
      },
    },
  },
} satisfies Prisma.PaymentInclude;

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreatePaymentDto) {
    const existing = await this.prisma.payment.findUnique({
      where: {
        idempotencyKey: data.idempotencyKey,
      },
      include: paymentWithInvoice,
    });

    if (existing) {
      this.assertIdempotentRequest(existing, data);
      return existing;
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: {
        id: data.invoiceId,
      },
      select: {
        id: true,
        total: true,
        currency: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada');
    }

    const amount = new Prisma.Decimal(data.amount);
    const currency = data.currency ?? Currency.BRL;

    if (!invoice.total.equals(amount) || invoice.currency !== currency) {
      throw new BadRequestException(
        'Valor ou moeda do pagamento não corresponde à fatura',
      );
    }

    try {
      return await this.prisma.payment.create({
        data: {
          invoiceId: data.invoiceId,
          provider: data.provider,
          method: data.method,
          amount,
          currency,
          idempotencyKey: data.idempotencyKey,
          externalReference: `pay_${randomUUID()}`,
          installments: data.installments ?? 1,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
          metadata: data.metadata,
        },
        include: paymentWithInvoice,
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrentPayment = await this.prisma.payment.findUnique({
          where: {
            idempotencyKey: data.idempotencyKey,
          },
          include: paymentWithInvoice,
        });

        if (concurrentPayment) {
          this.assertIdempotentRequest(concurrentPayment, data);
          return concurrentPayment;
        }

        const activePayment = await this.findCurrentByInvoiceId(data.invoiceId);

        if (activePayment) {
          throw new ConflictException(
            'Já existe uma cobrança em andamento para esta fatura',
          );
        }
      }

      throw error;
    }
  }

  async findById(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: {
        id: paymentId,
      },
      include: paymentWithInvoice,
    });

    if (!payment) {
      throw new NotFoundException('Pagamento não encontrado');
    }

    return payment;
  }

  findPagBankPayment(canonicalPayment: CanonicalGatewayPayment) {
    return this.prisma.payment.findFirst({
      where: {
        provider: PaymentProvider.PAGBANK,
        OR: [
          {
            externalReference: canonicalPayment.externalReference,
          },
          {
            providerOrderId: canonicalPayment.providerOrderId,
          },
          {
            providerPaymentId: canonicalPayment.providerPaymentId,
          },
        ],
      },
      include: paymentWithInvoice,
    });
  }

  async approveInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
      paymentId: string;
      providerOrderId: string;
      providerPaymentId: string;
      approvedAt: Date;
      statusDetail?: string;
    },
  ) {
    const payment = await transaction.payment.findUnique({
      where: {
        id: input.paymentId,
      },
    });

    if (!payment) {
      throw new NotFoundException('Pagamento não encontrado');
    }

    if (payment.status === PaymentStatus.APPROVED) {
      return {
        payment,
        changed: false,
      };
    }

    this.assertStatusTransition(payment.status, PaymentStatus.APPROVED);

    const approvedPayment = await transaction.payment.update({
      where: {
        id: input.paymentId,
      },
      data: {
        status: PaymentStatus.APPROVED,
        providerOrderId: input.providerOrderId,
        providerPaymentId: input.providerPaymentId,
        statusDetail: input.statusDetail,
        approvedAt: input.approvedAt,
      },
    });

    return {
      payment: approvedPayment,
      changed: true,
    };
  }

  findCurrentByInvoiceId(invoiceId: string) {
    return this.prisma.payment.findFirst({
      where: {
        invoiceId,
        status: {
          in: [
            PaymentStatus.CREATED,
            PaymentStatus.PENDING,
            PaymentStatus.PROCESSING,
          ],
        },
      },
      include: paymentWithInvoice,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updateStatus(paymentId: string, data: UpdatePaymentStatusDto) {
    const payment = await this.findById(paymentId);

    this.assertStatusTransition(payment.status, data.status);

    return this.prisma.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        status: data.status,
        statusDetail: data.statusDetail,
        providerOrderId: data.providerOrderId,
        providerPaymentId: data.providerPaymentId,
        cardBrand: data.cardBrand,
        cardLastFour: data.cardLastFour,
        pixQrCode: data.pixQrCode,
        pixQrCodeBase64: data.pixQrCodeBase64,
        pixTicketUrl: data.pixTicketUrl,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        approvedAt:
          data.status === PaymentStatus.APPROVED
            ? new Date(data.approvedAt ?? Date.now())
            : undefined,
        failedAt: data.failedAt ? new Date(data.failedAt) : undefined,
      },
      include: paymentWithInvoice,
    });
  }

  private assertStatusTransition(
    currentStatus: PaymentStatus,
    nextStatus: PaymentStatus,
  ): void {
    if (currentStatus === nextStatus) {
      return;
    }

    const allowedTransitions: Record<PaymentStatus, PaymentStatus[]> = {
      [PaymentStatus.CREATED]: [
        PaymentStatus.PENDING,
        PaymentStatus.PROCESSING,
        PaymentStatus.APPROVED,
        PaymentStatus.REJECTED,
        PaymentStatus.CANCELED,
        PaymentStatus.EXPIRED,
      ],
      [PaymentStatus.PENDING]: [
        PaymentStatus.PROCESSING,
        PaymentStatus.APPROVED,
        PaymentStatus.REJECTED,
        PaymentStatus.CANCELED,
        PaymentStatus.EXPIRED,
      ],
      [PaymentStatus.PROCESSING]: [
        PaymentStatus.APPROVED,
        PaymentStatus.REJECTED,
        PaymentStatus.CANCELED,
        PaymentStatus.EXPIRED,
      ],
      [PaymentStatus.APPROVED]: [PaymentStatus.REFUNDED],
      [PaymentStatus.REJECTED]: [],
      [PaymentStatus.CANCELED]: [],
      [PaymentStatus.EXPIRED]: [],
      [PaymentStatus.REFUNDED]: [],
    };

    if (!allowedTransitions[currentStatus].includes(nextStatus)) {
      throw new BadRequestException(
        `Transição de pagamento inválida: ${currentStatus} -> ${nextStatus}`,
      );
    }
  }

  private assertIdempotentRequest(
    payment: {
      invoiceId: string;
      provider: CreatePaymentDto['provider'];
      method: CreatePaymentDto['method'];
      amount: Prisma.Decimal;
    },
    data: CreatePaymentDto,
  ): void {
    const amount = new Prisma.Decimal(data.amount);

    if (
      payment.invoiceId !== data.invoiceId ||
      payment.provider !== data.provider ||
      payment.method !== data.method ||
      !payment.amount.equals(amount)
    ) {
      throw new ConflictException(
        'Chave de idempotência já utilizada com outros parâmetros',
      );
    }
  }
}
