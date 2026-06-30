import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider, Prisma, WebhookResourceType } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PAGBANK_PAYMENT_GATEWAY } from '../payments/gateways/payment-gateway.constants';
import type { PaymentGateway } from '../payments/gateways/payment-gateway.interface';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { PrismaService } from '../prisma/prisma.service';
import {
  PagBankWebhookHeaders,
  PagBankWebhookPayload,
} from './dto/pagbank-webhook.dto';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookProcessorService } from './webhook-processor.service';

interface PagBankWebhookAuthDiagnostic {
  condition: string;
  rawBody: Buffer;
  receivedHeaders: PagBankWebhookHeaders['receivedHeaders'];
  secretLoaded: boolean;
  xAuthenticityToken: string | undefined;
  suppliedToken?: string;
  expectedToken?: string;
}

@Injectable()
export class PagBankWebhookService {
  private readonly logger = new Logger(PagBankWebhookService.name);
  constructor(
    private readonly configService: ConfigService,
    private readonly webhookEventsService: WebhookEventsService,
    private readonly webhookProcessorService: WebhookProcessorService,
    @Inject(PAGBANK_PAYMENT_GATEWAY)
    private readonly paymentGateway: PaymentGateway,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async handle(rawBody: Buffer | undefined, headers: PagBankWebhookHeaders) {
    const payload = this.validateAndParse(
      rawBody,
      headers.authenticityToken,
      headers.receivedHeaders,
    );
    const eventKey =
      headers.requestId?.trim() ||
      `${payload.id}:${payload.status ?? 'UNKNOWN'}`;
    const recorded = await this.prisma.$transaction(async (transaction) => {
      const result = await this.webhookEventsService.recordInTransaction(
        transaction,
        {
          provider: PaymentProvider.PAGBANK,
          eventKey,
          providerEventId: headers.requestId,
          resourceType: payload.id.startsWith('ORDE')
            ? WebhookResourceType.ORDER
            : WebhookResourceType.PAYMENT,
          resourceId: payload.id,
          action: payload.status,
          requestId: headers.requestId,
          signatureValid: true,
          payload: payload.payload,
        },
      );

      await this.eventBus.publish(
        {
          eventType: INTERNAL_EVENT.PAGBANK_WEBHOOK_RECEIVED,
          aggregateType: 'WEBHOOK_EVENT',
          aggregateId: result.event.id,
          payload: {
            webhookEventId: result.event.id,
          },
        },
        transaction,
      );

      return result;
    });

    return {
      received: true,
      queued: true,
      duplicated: recorded.duplicated,
    };
  }

  async processQueuedEvent(webhookEventId: string) {
    const event = await this.webhookEventsService.findById(webhookEventId);

    if (!event?.resourceId) {
      throw new BadRequestException('Evento PagBank persistido é inválido');
    }

    const claimed =
      await this.webhookEventsService.claimForProcessing(webhookEventId);

    if (!claimed) {
      if (event.status === 'PROCESSED' || event.status === 'IGNORED') {
        return {
          outcome: 'ALREADY_PROCESSED' as const,
        };
      }

      throw new ServiceUnavailableException(
        'Evento PagBank não está disponível para processamento',
      );
    }

    try {
      const canonicalPayment = await this.paymentGateway.getPayment(
        event.resourceId,
      );
      const outcome =
        await this.webhookProcessorService.processPagBankPayment(
          canonicalPayment,
        );

      if (outcome === 'IGNORED_STATUS' || outcome === 'PAYMENT_NOT_FOUND') {
        await this.webhookEventsService.markIgnored(event.id);
      } else {
        await this.webhookEventsService.markProcessed(event.id);
      }

      return {
        outcome,
      };
    } catch (error: unknown) {
      await this.webhookEventsService.markFailed(
        event.id,
        this.getSafeErrorMessage(error),
      );
      throw error;
    }
  }

  private validateAndParse(
    rawBody: Buffer | undefined,
    authenticityToken: string | undefined,
    receivedHeaders: PagBankWebhookHeaders['receivedHeaders'],
  ): PagBankWebhookPayload {
    if (!rawBody?.length) {
      throw new BadRequestException('Payload bruto do webhook não informado');
    }

    this.validateAuthenticityToken(rawBody, authenticityToken, receivedHeaders);

    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('Payload JSON inválido');
    }

    if (
      !this.isJsonObject(parsedPayload) ||
      typeof parsedPayload.id !== 'string' ||
      !/^[A-Za-z0-9_-]{3,255}$/.test(parsedPayload.id)
    ) {
      throw new BadRequestException('Evento PagBank inválido');
    }

    return {
      id: parsedPayload.id,
      referenceId:
        typeof parsedPayload.reference_id === 'string'
          ? parsedPayload.reference_id
          : undefined,
      status:
        typeof parsedPayload.status === 'string'
          ? parsedPayload.status
          : undefined,
      payload: parsedPayload,
    };
  }

  private validateAuthenticityToken(
    rawBody: Buffer,
    authenticityToken: string | undefined,
    receivedHeaders: PagBankWebhookHeaders['receivedHeaders'],
  ): void {
    const secret = this.configService
      .get<string>('PAGBANK_TOKEN')
      ?.trim();

    if (!secret) {
      this.logAuthenticationDiagnostic({
        condition: 'missing_pagbank_token',
        rawBody,
        receivedHeaders,
        secretLoaded: false,
        xAuthenticityToken: authenticityToken,
      });
      throw new ServiceUnavailableException(
        'PAGBANK_TOKEN não configurado',
      );
    }

    const suppliedToken = authenticityToken?.trim().toLowerCase();

    if (!suppliedToken || !/^[a-f0-9]{64}$/.test(suppliedToken)) {
      this.logAuthenticationDiagnostic({
        condition: 'missing_or_invalid_authenticity_token',
        rawBody,
        receivedHeaders,
        secretLoaded: true,
        suppliedToken,
        xAuthenticityToken: authenticityToken,
      });
      throw new UnauthorizedException('Assinatura PagBank inválida');
    }

    const expectedToken = createHash('sha256')
      .update(secret, 'utf8')
      .update('-', 'utf8')
      .update(rawBody)
      .digest('hex');
    const suppliedBuffer = Buffer.from(suppliedToken, 'hex');
    const expectedBuffer = Buffer.from(expectedToken, 'hex');

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      this.logAuthenticationDiagnostic({
        condition: 'authenticity_token_mismatch',
        expectedToken,
        rawBody,
        receivedHeaders,
        secretLoaded: true,
        suppliedToken,
        xAuthenticityToken: authenticityToken,
      });
      throw new UnauthorizedException('Assinatura PagBank inválida');
    }
  }

  private logAuthenticationDiagnostic(
    diagnostic: PagBankWebhookAuthDiagnostic,
  ): void {
    this.logger.warn(
      JSON.stringify({
        condition: diagnostic.condition,
        expectedToken: diagnostic.expectedToken ?? null,
        receivedHeaders: this.sanitizeHeaders(diagnostic.receivedHeaders),
        rawBodyLength: diagnostic.rawBody.length,
        rawBodyPreview: diagnostic.rawBody.toString('utf8').slice(0, 200),
        secretLoaded: diagnostic.secretLoaded,
        suppliedToken: diagnostic.suppliedToken ?? null,
        xAuthenticityToken: diagnostic.xAuthenticityToken ?? null,
      }),
    );
  }

  private sanitizeHeaders(
    headers: PagBankWebhookHeaders['receivedHeaders'],
  ): Record<string, string | string[]> {
    const sanitizedHeaders: Record<string, string | string[]> = {};

    if (!headers) {
      return sanitizedHeaders;
    }

    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue;
      }

      sanitizedHeaders[name] = this.isSensitiveHeader(name)
        ? this.maskHeaderValue(value)
        : value;
    }

    return sanitizedHeaders;
  }

  private isSensitiveHeader(name: string): boolean {
    const normalizedName = name.toLowerCase();

    return (
      normalizedName === 'authorization' ||
      normalizedName === 'cookie' ||
      normalizedName === 'set-cookie' ||
      normalizedName.includes('secret') ||
      (normalizedName.includes('token') &&
        normalizedName !== 'x-authenticity-token')
    );
  }

  private maskHeaderValue(value: string | string[]): string | string[] {
    if (Array.isArray(value)) {
      return value.map(() => '[masked]');
    }

    return '[masked]';
  }

  private isJsonObject(value: unknown): value is Prisma.InputJsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private getSafeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message.slice(0, 500);
    }

    return 'Falha não identificada no processamento do webhook';
  }
}
