import { Injectable, OnModuleInit } from '@nestjs/common';
import { MediaType, OutboxEvent, Prisma } from '@prisma/client';
import { UsageLimitExceededException } from '../entitlements/usage-limit.exception';
import { EvolutionSendService } from '../evolution/evolution-send.service';
import { EvolutionWebhookService } from '../evolution/evolution-webhook.service';
import { NutritionVisionService } from '../nutrition/nutrition-vision.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { ResponseBuilderService } from '../responses/response-builder.service';
import { AutomationService } from '../automation/automation.service';
import { ActivationJourneyService } from '../activation/activation-journey.service';
import { PagBankWebhookService } from '../webhooks/pagbank-webhook.service';
import { INTERNAL_EVENT } from './event-bus.constants';
import { EventHandlerRegistry } from './event-handler.registry';

@Injectable()
export class IntegrationEventHandlersService implements OnModuleInit {
  constructor(
    private readonly registry: EventHandlerRegistry,
    private readonly pagBankWebhookService: PagBankWebhookService,
    private readonly evolutionWebhookService: EvolutionWebhookService,
    private readonly nutritionService: NutritionService,
    private readonly nutritionVisionService: NutritionVisionService,
    private readonly responseBuilderService: ResponseBuilderService,
    private readonly evolutionSendService: EvolutionSendService,
    private readonly automationService: AutomationService,
    private readonly activationJourneyService: ActivationJourneyService,
  ) {}

  onModuleInit(): void {
    this.registry.register(INTERNAL_EVENT.PAGBANK_WEBHOOK_RECEIVED, (event) =>
      this.processPagBankWebhook(event),
    );
    this.registry.register(INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED, (event) =>
      this.processWhatsAppMessage(event),
    );
    this.registry.register(INTERNAL_EVENT.MEDIA_RECEIVED, (event) =>
      this.processMedia(event),
    );
    this.registry.register(
      INTERNAL_EVENT.NUTRITION_ANALYSIS_COMPLETED,
      (event) => this.processNutritionCompletion(event),
    );
    this.registry.register(INTERNAL_EVENT.OUTBOUND_MESSAGE_REQUESTED, (event) =>
      this.processOutboundMessage(event),
    );
    this.registry.register(INTERNAL_EVENT.AUTOMATION_TRIGGERED, (event) =>
      this.processAutomation(event),
    );
    this.registry.register(INTERNAL_EVENT.SUBSCRIPTION_ACTIVATED, (event) =>
      this.processSubscriptionActivated(event),
    );
  }

  private async processPagBankWebhook(event: OutboxEvent): Promise<void> {
    await this.pagBankWebhookService.processQueuedEvent(
      this.requiredString(event.payload, 'webhookEventId'),
    );
  }

  private async processWhatsAppMessage(event: OutboxEvent): Promise<void> {
    await this.evolutionWebhookService.processQueuedEvent(
      this.requiredString(event.payload, 'evolutionInboundEventId'),
    );
  }

  private async processMedia(event: OutboxEvent): Promise<void> {
    if (this.requiredString(event.payload, 'mediaType') !== MediaType.IMAGE) {
      return;
    }

    const meal = await this.nutritionService.createMealFromMedia(
      this.requiredString(event.payload, 'mediaFileId'),
    );

    try {
      await this.nutritionVisionService.analyzeMeal(meal.id);
    } catch (error: unknown) {
      if (!(error instanceof UsageLimitExceededException)) {
        throw error;
      }

      await this.responseBuilderService.buildUsageLimitResponse(
        meal.id,
        error.friendlyMessage,
      );
    }
  }

  private async processNutritionCompletion(event: OutboxEvent): Promise<void> {
    await this.responseBuilderService.buildNutritionResponse(
      this.requiredString(event.payload, 'mealAnalysisId'),
    );
  }

  private async processOutboundMessage(event: OutboxEvent): Promise<void> {
    await this.evolutionSendService.sendText(
      this.requiredString(event.payload, 'outboundMessageId'),
    );
  }

  private async processAutomation(event: OutboxEvent): Promise<void> {
    await this.automationService.sendScheduledMessage(
      this.requiredString(event.payload, 'scheduledMessageId'),
    );
  }

  private async processSubscriptionActivated(
    event: OutboxEvent,
  ): Promise<void> {
    await this.activationJourneyService.processUser(
      this.requiredString(event.payload, 'userId'),
    );
  }

  private requiredString(payload: Prisma.JsonValue, key: string): string {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      typeof payload[key] !== 'string' ||
      !payload[key].trim()
    ) {
      throw new Error(`Payload do evento sem ${key}`);
    }

    return payload[key].trim();
  }
}
