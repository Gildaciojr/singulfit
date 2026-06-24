import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { CreateCreditCardPaymentDto } from './dto/create-credit-card-payment.dto';
import { CreditCardPaymentResponseDto } from './dto/credit-card-payment-response.dto';
import { PAGBANK_PAYMENT_GATEWAY } from './gateways/payment-gateway.constants';
import type {
  GatewayPaymentStatus,
  PaymentGateway,
  PaymentGatewayCustomer,
} from './gateways/payment-gateway.interface';
import { PaymentsService } from './payments.service';

@Injectable()
export class CreditCardPaymentsService {
  private static readonly ACTIVE_PAYMENT_STATUSES = new Set<PaymentStatus>([
    PaymentStatus.CREATED,
    PaymentStatus.PENDING,
    PaymentStatus.PROCESSING,
  ]);

  constructor(
    private readonly billingService: BillingService,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
    @Inject(PAGBANK_PAYMENT_GATEWAY)
    private readonly paymentGateway: PaymentGateway,
  ) {}

  getPublicKey(): string {
    const publicKey = this.configService
      .get<string>('PAGBANK_PUBLIC_KEY')
      ?.trim();

    if (!publicKey) {
      throw new ServiceUnavailableException(
        'Chave pública PagBank não configurada',
      );
    }

    return publicKey;
  }

  async create(
    userId: string,
    data: CreateCreditCardPaymentDto,
  ): Promise<CreditCardPaymentResponseDto> {
    const { subscription, invoice } =
      await this.billingService.getOrCreateInitialInvoice(userId);
    const customer = this.buildCustomer(subscription.user);
    const holderCpf = data.holderCpf.replace(/\D/g, '');
    const currentPayment = await this.paymentsService.findCurrentByInvoiceId(
      invoice.id,
    );

    if (
      currentPayment &&
      currentPayment.idempotencyKey !== data.idempotencyKey
    ) {
      this.assertNoActivePayment(currentPayment);
    }

    const payment = await this.paymentsService.create({
      invoiceId: invoice.id,
      provider: PaymentProvider.PAGBANK,
      method: PaymentMethod.CREDIT_CARD,
      amount: invoice.total.toFixed(2),
      currency: invoice.currency,
      idempotencyKey: data.idempotencyKey,
      installments: data.installments,
    });

    if (payment.providerOrderId && payment.providerPaymentId) {
      return this.toResponse(payment);
    }

    if (payment.status !== PaymentStatus.CREATED) {
      throw new ConflictException(
        'O pagamento não está disponível para cobrança no cartão',
      );
    }

    const gatewayPayment = await this.paymentGateway.createCreditCardPayment({
      idempotencyKey: payment.idempotencyKey,
      externalReference: payment.externalReference,
      amountInCents: this.toCents(payment.amount),
      customer,
      item: {
        referenceId: subscription.plan.type,
        name: `Assinatura SingulFit ${subscription.plan.name}`,
      },
      encryptedCard: data.encryptedCard,
      holder: {
        name: data.holderName.trim(),
        taxId: holderCpf,
      },
      installments: data.installments,
    });

    const updatedPayment = await this.paymentsService.updateStatus(payment.id, {
      status: this.toPaymentStatus(gatewayPayment.status),
      providerOrderId: gatewayPayment.providerOrderId,
      providerPaymentId: gatewayPayment.providerPaymentId,
      statusDetail: gatewayPayment.statusDetail,
      approvedAt: gatewayPayment.approvedAt?.toISOString(),
      cardBrand: gatewayPayment.cardBrand,
      cardLastFour: gatewayPayment.cardLastFour,
    });

    return this.toResponse(updatedPayment);
  }

  private buildCustomer(user: {
    name: string | null;
    email: string | null;
    cpf: string | null;
    phone: string;
  }): PaymentGatewayCustomer {
    if (!user.name || !user.email) {
      throw new BadRequestException(
        'Nome e e-mail são obrigatórios para pagar com cartão',
      );
    }

    const taxId = user.cpf?.replace(/\D/g, '');

    if (!taxId || taxId.length !== 11) {
      throw new BadRequestException(
        'CPF válido é obrigatório para pagar com cartão',
      );
    }

    let phone = user.phone.replace(/\D/g, '');

    if (phone.startsWith('55') && phone.length >= 12) {
      phone = phone.slice(2);
    }

    if (phone.length !== 10 && phone.length !== 11) {
      throw new BadRequestException(
        'Telefone brasileiro válido é obrigatório para pagar com cartão',
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
      throw new BadRequestException('Valor de cobrança no cartão inválido');
    }

    return cents.toNumber();
  }

  private assertNoActivePayment(payment: { status: PaymentStatus }): void {
    if (CreditCardPaymentsService.ACTIVE_PAYMENT_STATUSES.has(payment.status)) {
      throw new ConflictException(
        'Já existe uma cobrança em andamento para esta fatura',
      );
    }
  }

  private toPaymentStatus(status: GatewayPaymentStatus): PaymentStatus {
    switch (status) {
      case 'APPROVED':
        return PaymentStatus.APPROVED;
      case 'PENDING':
        return PaymentStatus.PENDING;
      case 'REJECTED':
        return PaymentStatus.REJECTED;
      case 'CANCELED':
        return PaymentStatus.CANCELED;
      case 'UNKNOWN':
        return PaymentStatus.PROCESSING;
      default: {
        const exhaustive: never = status;
        void exhaustive;
        throw new BadGatewayException('Status de cartão PagBank não suportado');
      }
    }
  }

  private toResponse(payment: {
    id: string;
    invoiceId: string;
    provider: PaymentProvider;
    status: PaymentStatus;
    amount: Prisma.Decimal;
    currency: CreditCardPaymentResponseDto['currency'];
    externalReference: string;
    providerOrderId: string | null;
    providerPaymentId: string | null;
    approvedAt: Date | null;
  }): CreditCardPaymentResponseDto {
    if (!payment.providerOrderId || !payment.providerPaymentId) {
      throw new ConflictException(
        'Dados do cartão ainda não estão disponíveis',
      );
    }

    return {
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      provider: payment.provider,
      status: payment.status,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      externalReference: payment.externalReference,
      providerOrderId: payment.providerOrderId,
      providerPaymentId: payment.providerPaymentId,
      approvedAt: payment.approvedAt?.toISOString() ?? null,
    };
  }
}
