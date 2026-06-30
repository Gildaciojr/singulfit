import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PagBankWebhookService } from './pagbank-webhook.service';

@Controller('api/v1/webhooks')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class WebhooksController {
  constructor(private readonly pagBankWebhookService: PagBankWebhookService) {}

  @Post('pagbank')
  @HttpCode(HttpStatus.OK)
  handlePagBank(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-authenticity-token') authenticityToken?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.pagBankWebhookService.handle(request.rawBody, {
      authenticityToken,
      requestId,
      receivedHeaders: request.headers,
    });
  }
}
