import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from '@prisma/client';
import {
  CanonicalGatewayPayment,
  CreateGatewayCreditCardPayment,
  CreateGatewayPixPayment,
  GatewayCreditCardPayment,
  GatewayPixPayment,
  GatewayPaymentStatus,
  PaymentGateway,
} from '../payments/gateways/payment-gateway.interface';
import {
  PagBankCharge,
  PagBankCreateOrderRequest,
  PagBankCreateOrderResponse,
  PagBankLink,
  PagBankOrderResponse,
  PagBankQrCode,
} from './interfaces/pagbank-api.interface';

@Injectable()
export class PagBankGateway implements PaymentGateway {
  readonly provider = PaymentProvider.PAGBANK;

  constructor(private readonly configService: ConfigService) {}

  async createPixPayment(
    input: CreateGatewayPixPayment,
  ): Promise<GatewayPixPayment> {
    const apiUrl = this.getApiUrl();
    const token = this.getRequiredConfig('PAGBANK_TOKEN');
    const requestBody = this.buildRequest(input);
    let response: Response;

    try {
      response = await fetch(`${apiUrl}/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException('Não foi possível comunicar com o PagBank');
    }

    const payload = await this.readJson(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `PagBank rejeitou a cobrança PIX (${response.status})`,
      );
    }

    const order = this.parseCreateOrderResponse(payload);
    const qrCode = order.qr_codes[0];
    const imageLink = qrCode.links.find(
      (link) => link.rel.toUpperCase() === 'QRCODE.PNG',
    );

    if (!imageLink) {
      throw new BadGatewayException('PagBank não retornou a imagem do QR Code');
    }

    return {
      providerOrderId: order.id,
      providerPaymentId: qrCode.id,
      qrCode: qrCode.text,
      qrCodeImageUrl: imageLink.href,
      expiresAt: new Date(qrCode.expiration_date),
    };
  }

  async createCreditCardPayment(
    input: CreateGatewayCreditCardPayment,
  ): Promise<GatewayCreditCardPayment> {
    const apiUrl = this.getApiUrl();
    const token = this.getRequiredConfig('PAGBANK_TOKEN');
    const requestBody = this.buildCreditCardRequest(input);
    let response: Response;

    try {
      response = await fetch(`${apiUrl}/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException('Não foi possível comunicar com o PagBank');
    }

    const payload = await this.readJson(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `PagBank rejeitou a cobrança no cartão (${response.status})`,
      );
    }

    const order = this.parseOrderResponse(payload);
    const charge = order.charges[0];

    if (!charge) {
      throw new BadGatewayException(
        'PagBank não retornou a cobrança no cartão',
      );
    }

    const status = this.mapPaymentStatus(charge.status);
    const approvedAt = charge.paid_at
      ? this.parseDate(charge.paid_at, 'Data de aprovação inválida no PagBank')
      : undefined;

    if (status === 'APPROVED' && !approvedAt) {
      throw new BadGatewayException(
        'PagBank não retornou a data real de aprovação',
      );
    }

    return {
      providerOrderId: order.id,
      providerPaymentId: charge.id,
      status,
      statusDetail:
        charge.payment_response?.message ?? charge.payment_response?.code,
      approvedAt,
      cardBrand: charge.payment_method?.card?.brand,
      cardLastFour: charge.payment_method?.card?.last_digits,
    };
  }

  async getPayment(resourceId: string): Promise<CanonicalGatewayPayment> {
    if (!/^[A-Za-z0-9_-]{3,255}$/.test(resourceId)) {
      throw new BadGatewayException('Identificador PagBank inválido');
    }

    const apiUrl = this.getApiUrl();
    const token = this.getRequiredConfig('PAGBANK_TOKEN');
    const endpoint = resourceId.startsWith('ORDE')
      ? `${apiUrl}/orders/${encodeURIComponent(resourceId)}`
      : `${apiUrl}/orders?charge_id=${encodeURIComponent(resourceId)}`;
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException('Não foi possível consultar o PagBank');
    }

    const payload = await this.readJson(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `PagBank rejeitou a consulta do pagamento (${response.status})`,
      );
    }

    const order = this.parseOrderResponse(payload);
    const charge =
      order.charges.find((item) => item.id === resourceId) ?? order.charges[0];

    if (!charge) {
      throw new BadGatewayException(
        'PagBank não retornou a cobrança consultada',
      );
    }

    const status = this.mapPaymentStatus(charge.status);
    const approvedAt = charge.paid_at
      ? this.parseDate(charge.paid_at, 'Data de aprovação inválida no PagBank')
      : undefined;

    if (status === 'APPROVED' && !approvedAt) {
      throw new BadGatewayException(
        'PagBank não retornou a data real de aprovação',
      );
    }

    return {
      providerOrderId: order.id,
      providerPaymentId: charge.id,
      externalReference: order.reference_id,
      status,
      statusDetail:
        charge.payment_response?.message ?? charge.payment_response?.code,
      amountInCents: charge.amount.value,
      currency: charge.amount.currency,
      approvedAt,
    };
  }

  private buildRequest(
    input: CreateGatewayPixPayment,
  ): PagBankCreateOrderRequest {
    return {
      reference_id: input.externalReference,
      customer: {
        name: input.customer.name,
        email: input.customer.email,
        tax_id: input.customer.taxId,
        phones: [input.customer.phone],
      },
      items: [
        {
          reference_id: input.item.referenceId,
          name: input.item.name,
          quantity: 1,
          unit_amount: input.amountInCents,
        },
      ],
      qr_codes: [
        {
          amount: {
            value: input.amountInCents,
          },
          expiration_date: input.expirationDate.toISOString(),
        },
      ],
    };
  }

  private buildCreditCardRequest(
    input: CreateGatewayCreditCardPayment,
  ): PagBankCreateOrderRequest {
    return {
      reference_id: input.externalReference,
      customer: {
        name: input.customer.name,
        email: input.customer.email,
        tax_id: input.customer.taxId,
        phones: [input.customer.phone],
      },
      items: [
        {
          reference_id: input.item.referenceId,
          name: input.item.name,
          quantity: 1,
          unit_amount: input.amountInCents,
        },
      ],
      charges: [
        {
          reference_id: input.externalReference,
          description: input.item.name,
          amount: {
            value: input.amountInCents,
            currency: 'BRL',
          },
          payment_method: {
            type: 'CREDIT_CARD',
            installments: input.installments,
            capture: true,
            card: {
              encrypted: input.encryptedCard,
              store: false,
            },
            holder: {
              name: input.holder.name,
              tax_id: input.holder.taxId,
            },
          },
        },
      ],
    };
  }

  private getApiUrl(): string {
    const value = this.getRequiredConfig('PAGBANK_API_URL');
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      throw new ServiceUnavailableException(
        'PAGBANK_API_URL possui formato inválido',
      );
    }

    if (url.protocol !== 'https:') {
      throw new ServiceUnavailableException(
        'PAGBANK_API_URL deve utilizar HTTPS',
      );
    }

    return url.toString().replace(/\/$/, '');
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      throw new ServiceUnavailableException(
        `Configuração obrigatória ausente: ${key}`,
      );
    }

    return value;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new BadGatewayException('PagBank retornou uma resposta inválida');
    }
  }

  private parseCreateOrderResponse(
    payload: unknown,
  ): PagBankCreateOrderResponse {
    if (!this.isRecord(payload)) {
      throw new BadGatewayException('Resposta inválida do PagBank');
    }

    const qrCodes = payload.qr_codes;

    if (
      typeof payload.id !== 'string' ||
      typeof payload.reference_id !== 'string' ||
      !Array.isArray(qrCodes) ||
      qrCodes.length === 0
    ) {
      throw new BadGatewayException('Resposta PIX incompleta do PagBank');
    }

    const parsedQrCodes = qrCodes.map((qrCode) => this.parseQrCode(qrCode));

    return {
      id: payload.id,
      reference_id: payload.reference_id,
      qr_codes: parsedQrCodes,
    };
  }

  private parseOrderResponse(payload: unknown): PagBankOrderResponse {
    if (
      !this.isRecord(payload) ||
      typeof payload.id !== 'string' ||
      typeof payload.reference_id !== 'string' ||
      !Array.isArray(payload.charges)
    ) {
      throw new BadGatewayException('Resposta de consulta PagBank inválida');
    }

    return {
      id: payload.id,
      reference_id: payload.reference_id,
      charges: payload.charges.map((charge) => this.parseCharge(charge)),
    };
  }

  private parseCharge(payload: unknown): PagBankCharge {
    if (
      !this.isRecord(payload) ||
      typeof payload.id !== 'string' ||
      typeof payload.reference_id !== 'string' ||
      typeof payload.status !== 'string' ||
      !this.isRecord(payload.amount) ||
      typeof payload.amount.value !== 'number' ||
      !Number.isInteger(payload.amount.value) ||
      typeof payload.amount.currency !== 'string'
    ) {
      throw new BadGatewayException('Cobrança inválida retornada pelo PagBank');
    }

    const paymentResponse = this.isRecord(payload.payment_response)
      ? {
          code:
            typeof payload.payment_response.code === 'string'
              ? payload.payment_response.code
              : undefined,
          message:
            typeof payload.payment_response.message === 'string'
              ? payload.payment_response.message
              : undefined,
        }
      : undefined;
    const paymentMethod = this.isRecord(payload.payment_method)
      ? this.parsePaymentMethod(payload.payment_method)
      : undefined;

    return {
      id: payload.id,
      reference_id: payload.reference_id,
      status: payload.status,
      paid_at:
        typeof payload.paid_at === 'string' ? payload.paid_at : undefined,
      amount: {
        value: payload.amount.value,
        currency: payload.amount.currency,
      },
      payment_response: paymentResponse,
      payment_method: paymentMethod,
    };
  }

  private parsePaymentMethod(
    payload: Record<string, unknown>,
  ): PagBankCharge['payment_method'] | undefined {
    if (!this.isRecord(payload.card)) {
      return undefined;
    }

    return {
      card: {
        brand:
          typeof payload.card.brand === 'string'
            ? payload.card.brand
            : undefined,
        last_digits:
          typeof payload.card.last_digits === 'string'
            ? payload.card.last_digits
            : undefined,
      },
    };
  }

  private parseQrCode(payload: unknown): PagBankQrCode {
    if (!this.isRecord(payload) || !Array.isArray(payload.links)) {
      throw new BadGatewayException('QR Code inválido retornado pelo PagBank');
    }

    if (
      typeof payload.id !== 'string' ||
      typeof payload.expiration_date !== 'string' ||
      typeof payload.text !== 'string'
    ) {
      throw new BadGatewayException('Dados do QR Code incompletos no PagBank');
    }

    const expirationDate = new Date(payload.expiration_date);

    if (Number.isNaN(expirationDate.getTime())) {
      throw new BadGatewayException(
        'Data de expiração inválida retornada pelo PagBank',
      );
    }

    return {
      id: payload.id,
      expiration_date: payload.expiration_date,
      text: payload.text,
      links: payload.links.map((link) => this.parseLink(link)),
    };
  }

  private parseLink(payload: unknown): PagBankLink {
    if (
      !this.isRecord(payload) ||
      typeof payload.rel !== 'string' ||
      typeof payload.href !== 'string'
    ) {
      throw new BadGatewayException('Link PIX inválido retornado pelo PagBank');
    }

    return {
      rel: payload.rel,
      href: payload.href,
    };
  }

  private mapPaymentStatus(status: string): GatewayPaymentStatus {
    const normalizedStatus = status.toUpperCase();

    if (normalizedStatus === 'PAID') {
      return 'APPROVED';
    }

    if (
      normalizedStatus === 'WAITING' ||
      normalizedStatus === 'IN_ANALYSIS' ||
      normalizedStatus === 'AUTHORIZED'
    ) {
      return 'PENDING';
    }

    if (normalizedStatus === 'DECLINED') {
      return 'REJECTED';
    }

    if (normalizedStatus === 'CANCELED') {
      return 'CANCELED';
    }

    return 'UNKNOWN';
  }

  private parseDate(value: string, errorMessage: string): Date {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadGatewayException(errorMessage);
    }

    return date;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
