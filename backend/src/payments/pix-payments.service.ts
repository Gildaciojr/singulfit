import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { PAGBANK_PAYMENT_GATEWAY } from './gateways/payment-gateway.constants';
import type {
  PaymentGateway,
  PaymentGatewayCustomer,
} from './gateways/payment-gateway.interface';
import { PaymentsService } from './payments.service';
import { CreatePixPaymentDto } from './dto/create-pix-payment.dto';
import { PixPaymentResponseDto } from './dto/pix-payment-response.dto';

@Injectable()
export class PixPaymentsService {
  private static readonly PIX_EXPIRATION_MINUTES = 30;

  constructor(
    private readonly billingService: BillingService,
    private readonly paymentsService: PaymentsService,
    @Inject(PAGBANK_PAYMENT_GATEWAY)
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async create(
    userId: string,
    data: CreatePixPaymentDto,
  ): Promise<PixPaymentResponseDto> {
    const { subscription, invoice } =
      await this.billingService.getOrCreateInitialInvoice(userId);
    const customer = this.buildCustomer(subscription.user);
    const currentPayment = await this.paymentsService.findCurrentByInvoiceId(
      invoice.id,
    );

    if (
      currentPayment &&
      currentPayment.idempotencyKey !== data.idempotencyKey
    ) {
      throw new ConflictException(
        'Já existe uma cobrança em andamento para esta fatura',
      );
    }

    const requestedExpiration =
      currentPayment?.expiresAt ??
      new Date(
        Date.now() + PixPaymentsService.PIX_EXPIRATION_MINUTES * 60 * 1000,
      );
    const payment = await this.paymentsService.create({
      invoiceId: invoice.id,
      provider: PaymentProvider.PAGBANK,
      method: PaymentMethod.PIX,
      amount: invoice.total.toFixed(2),
      currency: invoice.currency,
      idempotencyKey: data.idempotencyKey,
      expiresAt: requestedExpiration.toISOString(),
    });

    if (
      payment.status === PaymentStatus.PENDING &&
      payment.providerPaymentId &&
      payment.pixQrCode &&
      payment.pixTicketUrl &&
      payment.expiresAt
    ) {
      return this.toResponse(payment);
    }

    if (payment.status !== PaymentStatus.CREATED || !payment.expiresAt) {
      throw new ConflictException(
        'O pagamento não está disponível para geração do PIX',
      );
    }

    const gatewayPayment = await this.paymentGateway.createPixPayment({
      idempotencyKey: payment.idempotencyKey,
      externalReference: payment.externalReference,
      amountInCents: this.toCents(payment.amount),
      expirationDate: payment.expiresAt,
      customer,
      item: {
        referenceId: subscription.plan.type,
        name: `Assinatura LucyFit ${subscription.plan.name}`,
      },
    });
    const pendingPayment = await this.paymentsService.updateStatus(payment.id, {
      status: PaymentStatus.PENDING,
      providerOrderId: gatewayPayment.providerOrderId,
      providerPaymentId: gatewayPayment.providerPaymentId,
      pixQrCode: gatewayPayment.qrCode,
      pixTicketUrl: gatewayPayment.qrCodeImageUrl,
      expiresAt: gatewayPayment.expiresAt.toISOString(),
    });

    return this.toResponse(pendingPayment);
  }

  private buildCustomer(user: {
    name: string | null;
    email: string | null;
    cpf: string | null;
    phone: string;
  }): PaymentGatewayCustomer {
    if (!user.name || !user.email) {
      throw new BadRequestException(
        'Nome e e-mail são obrigatórios para gerar o PIX',
      );
    }

    const taxId = user.cpf?.replace(/\D/g, '');

    if (!taxId || taxId.length !== 11) {
      throw new BadRequestException(
        'CPF válido é obrigatório para gerar o PIX',
      );
    }

    let phone = user.phone.replace(/\D/g, '');

    if (phone.startsWith('55') && phone.length >= 12) {
      phone = phone.slice(2);
    }

    if (phone.length !== 10 && phone.length !== 11) {
      throw new BadRequestException(
        'Telefone brasileiro válido é obrigatório para gerar o PIX',
      );
    }

    return {
      name: user.name,
      email: user.email,
      taxId,
      phone: {
        country: '55',
        area: phone.slice(0, 2),
        number: phone.slice(2),
        type: 'MOBILE',
      },
    };
  }

  private toCents(amount: Prisma.Decimal): number {
    const cents = amount.mul(100);

    if (!cents.isInteger() || cents.isNegative()) {
      throw new BadRequestException('Valor de cobrança PIX inválido');
    }

    return cents.toNumber();
  }

  private toResponse(payment: {
    id: string;
    invoiceId: string;
    provider: PaymentProvider;
    status: PaymentStatus;
    amount: Prisma.Decimal;
    currency: PixPaymentResponseDto['currency'];
    externalReference: string;
    providerPaymentId: string | null;
    pixQrCode: string | null;
    pixTicketUrl: string | null;
    expiresAt: Date | null;
  }): PixPaymentResponseDto {
    if (
      !payment.providerPaymentId ||
      !payment.pixQrCode ||
      !payment.pixTicketUrl ||
      !payment.expiresAt
    ) {
      throw new ConflictException('Dados PIX ainda não estão disponíveis');
    }

    return {
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      provider: payment.provider,
      status: payment.status,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      externalReference: payment.externalReference,
      providerPaymentId: payment.providerPaymentId,
      qrCode: payment.pixQrCode,
      qrCodeImageUrl: payment.pixTicketUrl,
      expiresAt: payment.expiresAt.toISOString(),
    };
  }
}
