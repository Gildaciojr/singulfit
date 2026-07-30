import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  MediaType,
  OutboxEvent,
  Prisma,
  ResponseType,
  ScheduledMessageStatus,
} from '@prisma/client';
import { UsageLimitExceededException } from '../entitlements/usage-limit.exception';
import { EvolutionSendService } from '../evolution/evolution-send.service';
import { EvolutionWebhookService } from '../evolution/evolution-webhook.service';
import { NutritionVisionService } from '../nutrition/nutrition-vision.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { ResponseBuilderService } from '../responses/response-builder.service';
import { CoachCommandService } from '../automation/coach-command.service';
import { AutomationService } from '../automation/automation.service';
import { ActivationJourneyService } from '../activation/activation-journey.service';
import { ActivationOnboardingService } from '../activation/activation-onboarding.service';
import { ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY } from '../activation/activation-onboarding.constants';
import { PagBankWebhookService } from '../webhooks/pagbank-webhook.service';
import { INTERNAL_EVENT } from './event-bus.constants';
import { EventHandlerRegistry } from './event-handler.registry';
import { ProfileAcquisitionInternalRolloutService } from '../context/profile-acquisition/profile-acquisition-internal-rollout.service';

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
    private readonly coachCommandService: CoachCommandService,
    private readonly automationService: AutomationService,
    private readonly activationJourneyService: ActivationJourneyService,
    private readonly activationOnboardingService: ActivationOnboardingService,
    private readonly profileAcquisitionRollout: ProfileAcquisitionInternalRolloutService,
  ) {}

  onModuleInit(): void {
    this.registry.register(INTERNAL_EVENT.PAGBANK_WEBHOOK_RECEIVED, (event) =>
      this.processPagBankWebhook(event),
    );
    this.registry.register(INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED, (event) =>
      this.processWhatsAppMessage(event),
    );
    this.registry.register(
      INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
      (event) => this.processCoachOnboardingText(event),
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
    this.registry.register(
      INTERNAL_EVENT.USER_CONTEXT_REFRESH_COMPLETED,
      (event) => this.processContextRefreshCompleted(event),
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

  private async processCoachOnboardingText(event: OutboxEvent): Promise<void> {
    const input = {
      userId: this.requiredString(event.payload, 'userId'),
      messageId: this.requiredString(event.payload, 'messageId'),
    };
    const acquisition =
      await this.profileAcquisitionRollout.captureActiveResponse(input);

    if (acquisition.handled) {
      return;
    }

    const result =
      await this.activationOnboardingService.processTextMessage(input);

    if (!result.handled) {
      await this.coachCommandService.processTextMessage(input);
    }
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
    const outboundMessageId = this.requiredString(
      event.payload,
      'outboundMessageId',
    );
    const responseType = this.requiredString(event.payload, 'responseType');

    if (
      responseType === ResponseType.PROFILE_ACQUISITION &&
      !(await this.profileAcquisitionRollout.authorizeQuestionSend(
        outboundMessageId,
      ))
    ) {
      return;
    }

    await this.evolutionSendService.sendText(outboundMessageId);
    await this.profileAcquisitionRollout.afterOutboundSent(outboundMessageId);
  }

  private async processAutomation(event: OutboxEvent): Promise<void> {
    const sent = await this.automationService.sendScheduledMessage(
      this.requiredString(event.payload, 'scheduledMessageId'),
    );
    const source = this.optionalString(event.payload, 'source');
    const intent = this.coachIntent(
      this.optionalString(event.payload, 'intent'),
    );

    if (
      sent.status === ScheduledMessageStatus.SENT &&
      source === 'WHATSAPP_COACH_COMMAND' &&
      intent
    ) {
      await this.profileAcquisitionRollout.afterCoachResponseSent({
        userId: this.requiredString(event.payload, 'userId'),
        sourceMessageId: this.requiredString(event.payload, 'sourceMessageId'),
        intent,
        sentAt: sent.scheduledFor,
      });
    }
  }

  private async processContextRefreshCompleted(
    event: OutboxEvent,
  ): Promise<void> {
    const refreshKey = this.requiredString(event.payload, 'refreshKey');

    if (
      !refreshKey.startsWith(`${ACTIVATION_ONBOARDING_PROFILE_SOURCE_KEY}:`)
    ) {
      return;
    }

    await this.automationService.scheduleOnboardingKickoff(
      this.requiredString(event.payload, 'userId'),
      event.createdAt,
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

  private optionalString(
    payload: Prisma.JsonValue,
    key: string,
  ): string | undefined {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      typeof payload[key] !== 'string' ||
      !payload[key].trim()
    ) {
      return undefined;
    }

    return payload[key].trim();
  }

  private coachIntent(
    value: string | undefined,
  ): 'DIET' | 'WORKOUT' | 'BOTH' | 'UNKNOWN' | null {
    switch (value) {
      case 'DIET':
      case 'WORKOUT':
      case 'BOTH':
      case 'UNKNOWN':
        return value;
      default:
        return null;
    }
  }
}
