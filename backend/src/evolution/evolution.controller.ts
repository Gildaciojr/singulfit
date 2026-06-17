import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EvolutionWebhookService } from './evolution-webhook.service';

@Controller('api/v1/webhooks/evolution')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class EvolutionController {
  constructor(
    private readonly evolutionWebhookService: EvolutionWebhookService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  handleWebhook(
    @Body() body: unknown,
    @Headers('x-evolution-webhook-secret') webhookSecret?: string,
  ) {
    return this.evolutionWebhookService.handle(body, webhookSecret);
  }
}
