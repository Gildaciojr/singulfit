import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { EvolutionModule } from '../evolution/evolution.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { ResponseModule } from '../responses/response.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ActivationModule } from '../activation/activation.module';
import { ContextModule } from '../context/context.module';
import { SubscriptionLifecycleModule } from '../subscriptions/subscription-lifecycle.module';
import { PaymentsModule } from '../payments/payments.module';
import { IntegrationEventHandlersService } from './integration-event-handlers.service';

@Module({
  imports: [
    WebhooksModule,
    EvolutionModule,
    NutritionModule,
    ResponseModule,
    AutomationModule,
    ActivationModule,
    ContextModule,
    SubscriptionLifecycleModule,
    PaymentsModule,
  ],
  providers: [IntegrationEventHandlersService],
})
export class IntegrationEventsModule {}
