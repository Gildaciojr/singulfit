import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PagBankModule } from '../pagbank/pagbank.module';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PagBankWebhookService } from './pagbank-webhook.service';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookProcessorService } from './webhook-processor.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [BillingModule, PagBankModule, PaymentsModule, SubscriptionsModule],
  providers: [
    WebhookEventsService,
    PagBankWebhookService,
    WebhookProcessorService,
  ],
  controllers: [WebhooksController],
  exports: [
    WebhookEventsService,
    PagBankWebhookService,
    WebhookProcessorService,
  ],
})
export class WebhooksModule {}
