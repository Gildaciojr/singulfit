import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type BillingCycles = 1 | 3 | 6 | 12;
export interface RecurringCustomerInput {
  referenceId: string;
  name: string;
  email: string;
  taxId: string;
  phone: { country: string; area: string; number: string; type: 'MOBILE' };
  encryptedCard: string;
}

export interface PagBankRecurringSubscription {
  id: string;
  status: string;
}

export interface PagBankRecurringInvoice {
  id: string;
  subscriptionId: string;
  cycleNumber: number;
  amountInCents: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
}

export type PagBankRecurringPaymentStatus =
  | 'APPROVED'
  | 'DENIED'
  | 'IN_ANALYSIS'
  | 'PENDING'
  | 'UNPAID'
  | 'REFUNDED';

export interface PagBankRecurringInvoicePayment {
  id: string;
  invoiceId: string;
  subscriptionId: string;
  orderId: string;
  status: PagBankRecurringPaymentStatus;
  amountInCents: number;
  currency: string;
  approvedAt?: Date;
}

@Injectable()
export class PagBankRecurringGateway {
  constructor(private readonly config: ConfigService) {}

  async createPlan(input: {
    referenceId: string;
    name: string;
    description: string;
    amount: number;
    billingCycles: BillingCycles;
  }): Promise<string> {
    const body = {
      reference_id: input.referenceId,
      name: input.name,
      description: input.description,
      amount: { value: input.amount, currency: 'BRL' },
      interval: { length: 1, unit: 'MONTH' },
      billing_cycles: input.billingCycles,
      payment_method: ['CREDIT_CARD'],
      editable: false,
    };
    return this.id(
      await this.request('POST', '/plans', body, input.referenceId),
      'PLAN_',
    );
  }

  async createCustomer(input: RecurringCustomerInput): Promise<string> {
    const body = {
      reference_id: input.referenceId,
      name: input.name,
      email: input.email,
      tax_id: input.taxId,
      phones: [input.phone],
      billing_info: [
        { type: 'CREDIT_CARD', card: { encrypted: input.encryptedCard } },
      ],
    };
    return this.id(
      await this.request('POST', '/customers', body, input.referenceId),
      'CUST_',
    );
  }

  async createSubscription(input: {
    referenceId: string;
    planId: string;
    customerId: string;
    encryptedCard: string;
  }): Promise<string> {
    const body = {
      reference_id: input.referenceId,
      plan: { id: input.planId },
      customer: { id: input.customerId },
      payment_method: [
        { type: 'CREDIT_CARD', card: { encrypted: input.encryptedCard } },
      ],
    };
    return this.id(
      await this.request('POST', '/subscriptions', body, input.referenceId),
      'SUBS_',
    );
  }

  async getSubscription(
    subscriptionId: string,
  ): Promise<PagBankRecurringSubscription> {
    const payload = await this.request(
      'GET',
      `/subscriptions/${subscriptionId}`,
    );
    return {
      id: this.string(payload, 'id'),
      status: this.string(payload, 'status'),
    };
  }

  async listSubscriptionInvoices(
    subscriptionId: string,
  ): Promise<PagBankRecurringInvoice[]> {
    const payload = await this.request(
      'GET',
      `/subscriptions/${subscriptionId}/invoices`,
    );
    return this.items(payload).map((item) => ({
      id: this.string(item, 'id'),
      subscriptionId: this.string(item, 'subscription_id'),
      cycleNumber: this.number(item, 'cycle_number'),
      amountInCents: this.amount(item),
      currency: this.currency(item),
      periodStart: this.date(item, 'period_start'),
      periodEnd: this.date(item, 'period_end'),
      dueAt: this.date(item, 'due_date'),
    }));
  }

  async listInvoicePayments(
    invoiceId: string,
  ): Promise<PagBankRecurringInvoicePayment[]> {
    const payload = await this.request(
      'GET',
      `/invoices/${invoiceId}/payments`,
    );
    return this.items(payload).map((item) => {
      const status = this.string(item, 'status');
      if (!this.isPaymentStatus(status)) {
        throw new BadGatewayException(
          'Status de pagamento recorrente inválido',
        );
      }
      const approvedAt = item.approved_at;
      return {
        id: this.string(item, 'id'),
        invoiceId: this.string(item, 'invoice_id'),
        subscriptionId: this.string(item, 'subscription_id'),
        orderId: this.string(item, 'order_id'),
        status,
        amountInCents: this.amount(item),
        currency: this.currency(item),
        approvedAt:
          typeof approvedAt === 'string' ? this.toDate(approvedAt) : undefined,
      };
    });
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    key?: string,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.url()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.required('PAGBANK_RECURRING_TOKEN')}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(key
          ? {
              'x-idempotency-key': key
                .replace(/[^A-Za-z0-9]/g, '')
                .slice(0, 200),
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new BadGatewayException(
        'Não foi possível comunicar com o PagBank Recorrente',
      );
    });
    const payload: unknown = await response.json().catch(() => {
      throw new BadGatewayException('Resposta inválida do PagBank Recorrente');
    });
    if (
      !response.ok ||
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    )
      throw new BadGatewayException(
        `PagBank Recorrente rejeitou a requisição (${response.status})`,
      );
    return payload as Record<string, unknown>;
  }
  private id(payload: Record<string, unknown>, prefix: string): string {
    const id = payload.id;
    if (typeof id !== 'string' || !id.startsWith(prefix))
      throw new BadGatewayException(
        'Identificador PagBank Recorrente inválido',
      );
    return id;
  }
  private items(payload: Record<string, unknown>): Record<string, unknown>[] {
    const items = payload.items;
    if (!Array.isArray(items) || !items.every((item) => this.isRecord(item))) {
      throw new BadGatewayException('Lista PagBank Recorrente inválida');
    }
    return items;
  }
  private string(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    if (typeof value !== 'string' || !value) {
      throw new BadGatewayException('Resposta PagBank Recorrente inválida');
    }
    return value;
  }
  private number(payload: Record<string, unknown>, key: string): number {
    const value = payload[key];
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw new BadGatewayException('Resposta PagBank Recorrente inválida');
    }
    return value as number;
  }
  private amount(payload: Record<string, unknown>): number {
    const amount = payload.amount;
    if (!this.isRecord(amount) || !Number.isInteger(amount.value)) {
      throw new BadGatewayException('Valor PagBank Recorrente inválido');
    }
    return amount.value as number;
  }
  private currency(payload: Record<string, unknown>): string {
    const amount = payload.amount;
    if (!this.isRecord(amount)) {
      throw new BadGatewayException('Moeda PagBank Recorrente inválida');
    }
    return this.string(amount, 'currency');
  }
  private date(payload: Record<string, unknown>, key: string): Date {
    return this.toDate(this.string(payload, key));
  }
  private toDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      throw new BadGatewayException('Data PagBank Recorrente inválida');
    }
    return date;
  }
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  private isPaymentStatus(
    value: string,
  ): value is PagBankRecurringPaymentStatus {
    return [
      'APPROVED',
      'DENIED',
      'IN_ANALYSIS',
      'PENDING',
      'UNPAID',
      'REFUNDED',
    ].includes(value);
  }
  private url(): string {
    const raw = this.required('PAGBANK_RECURRING_API_URL');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ServiceUnavailableException(
        'PAGBANK_RECURRING_API_URL inválida',
      );
    }
    if (url.protocol !== 'https:' || !url.hostname.startsWith('sandbox.'))
      throw new ServiceUnavailableException(
        'PAGBANK_RECURRING_API_URL deve apontar para sandbox HTTPS',
      );
    return url.toString().replace(/\/$/, '');
  }
  private required(key: string): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value)
      throw new ServiceUnavailableException(
        `Configuração obrigatória ausente: ${key}`,
      );
    return value;
  }
}
