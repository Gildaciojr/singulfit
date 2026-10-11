import { Module } from '@nestjs/common';
import { AudioModule } from '../audio/audio.module';
import { AutomationModule } from '../automation/automation.module';
import { EvolutionModule } from '../evolution/evolution.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { ResponseModule } from '../responses/response.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ActivationModule } from '../activation/activation.module';
import { ContextModule } from '../context/context.module';
import { SubscriptionLifecycleModule } from '../subscriptions/subscription-lifecycle.module';
import { IntegrationEventHandlersService } from './integration-event-handlers.service';

@Module({
  imports: [
    AudioModule,
    WebhooksModule,
    EvolutionModule,
    NutritionModule,
    ResponseModule,
    AutomationModule,
    ActivationModule,
    ContextModule,
    SubscriptionLifecycleModule,
  ],
  providers: [IntegrationEventHandlersService],
})
export class IntegrationEventsModule {}
