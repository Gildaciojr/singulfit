import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { EvolutionModule } from '../evolution/evolution.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { ResponseModule } from '../responses/response.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { IntegrationEventHandlersService } from './integration-event-handlers.service';

@Module({
  imports: [
    WebhooksModule,
    EvolutionModule,
    NutritionModule,
    ResponseModule,
    AutomationModule,
  ],
  providers: [IntegrationEventHandlersService],
})
export class IntegrationEventsModule {}
