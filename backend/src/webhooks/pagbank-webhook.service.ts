import {
  BadRequestException,
  Inject,
  Injectable,
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

@Injectable()
export class PagBankWebhookService {
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
    const payload = this.validateAndParse(rawBody, headers.authenticityToken);
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
  ): PagBankWebhookPayload {
    if (!rawBody?.length) {
      throw new BadRequestException('Payload bruto do webhook não informado');
    }

    this.validateAuthenticityToken(rawBody, authenticityToken);

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
  ): void {
    const secret = this.configService
      .get<string>('PAGBANK_WEBHOOK_SECRET')
      ?.trim();

    if (!secret) {
      throw new ServiceUnavailableException(
        'PAGBANK_WEBHOOK_SECRET não configurado',
      );
    }

    const suppliedToken = authenticityToken?.trim().toLowerCase();

    if (!suppliedToken || !/^[a-f0-9]{64}$/.test(suppliedToken)) {
      throw new UnauthorizedException('Assinatura PagBank inválida');
    }

    const expectedToken = createHash('sha256')
      .update(secret, 'utf8')
      .update(rawBody)
      .digest('hex');
    const suppliedBuffer = Buffer.from(suppliedToken, 'hex');
    const expectedBuffer = Buffer.from(expectedToken, 'hex');

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Assinatura PagBank inválida');
    }
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
