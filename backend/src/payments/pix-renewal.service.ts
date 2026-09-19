import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentMethod,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PixPaymentResponseDto } from './dto/pix-payment-response.dto';
import { PixPaymentsService } from './pix-payments.service';

@Injectable()
export class PixRenewalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pixPayments: PixPaymentsService,
  ) {}

  async createOrReuseForUser(userId: string): Promise<PixPaymentResponseDto> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
        externalSubscriptionId: null,
        paymentMethod: PaymentMethod.PIX,
      },
      include: {
        plan: true,
        user: {
          select: { name: true, email: true, cpf: true, phone: true },
        },
        invoices: {
          where: { status: InvoiceStatus.OPEN },
          orderBy: { cycleNumber: 'desc' },
          take: 1,
        },
      },
      orderBy: { currentPeriodEnd: 'asc' },
    });

    if (!subscription) {
      throw new NotFoundException(
        'Renovação PIX não disponível para o usuário',
      );
    }

    if (subscription.externalSubscriptionId !== null) {
      throw new BadRequestException(
        'Assinatura recorrente não aceita renovação PIX',
      );
    }

    const invoice = subscription.invoices[0];
    if (!invoice || invoice.subscriptionId !== subscription.id) {
      throw new NotFoundException('Fatura aberta de renovação não encontrada');
    }

    const attempts = await this.prisma.payment.count({
      where: { invoiceId: invoice.id, method: PaymentMethod.PIX },
    });

    return this.pixPayments.createForRenewalInvoice({
      subscription,
      invoice,
      idempotencyKey: `pix-renewal:${subscription.id}:${invoice.cycleNumber}:${attempts + 1}`,
    });
  }
}
