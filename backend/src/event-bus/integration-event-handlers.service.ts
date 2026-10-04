import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
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
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import { CoachProactiveResponseService } from '../automation/coach-proactive-response.service';
import { ConversationContinuationService } from '../conversation/runtime/conversation-continuation.service';

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
    private readonly subscriptionLifecycle: SubscriptionLifecycleService,
    @Optional()
    private readonly proactiveResponse?: CoachProactiveResponseService,
    @Optional()
    private readonly continuations?: ConversationContinuationService,
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
    if (
      !(await this.subscriptionLifecycle.authorizeOrNotify(
        input.userId,
        input.messageId,
        event.createdAt,
      ))
    ) {
      return;
    }
    if (
      typeof this.coachCommandService.processCanonicalContinuation ===
        'function' &&
      (await this.coachCommandService.processCanonicalContinuation(input))
    )
      return;
    if (
      typeof this.coachCommandService.processReadOnlyText === 'function' &&
      (await this.coachCommandService.processReadOnlyText(input))
    )
      return;

    if (this.proactiveResponse && !this.continuations?.enabled(input.userId)) {
      const proactive = await this.proactiveResponse.capture(input);
      if (proactive.handled) return;
      if (proactive.continueInRuntime) {
        await this.coachCommandService.processTextMessage({
          ...input,
          proactiveReply: true,
        });
        return;
      }
    }

    const acquisition =
      await this.profileAcquisitionRollout.captureActiveResponse(input);

    if (acquisition.handled) {
      if (acquisition.continuationMessageId) {
        await this.coachCommandService.processTextMessage({
          userId: input.userId,
          messageId: acquisition.continuationMessageId,
          planningContinuation:
            acquisition.originalRequestMessageId && acquisition.originalIntent
              ? {
                  originalRequestMessageId:
                    acquisition.originalRequestMessageId,
                  intent: acquisition.originalIntent,
                }
              : undefined,
        });
      }
      return;
    }

    // Canonical acquisition capture owns contextual answers before the
    // pending-action and isolated-short-reply fallbacks.
    if (
      typeof this.coachCommandService.shouldHandleBeforeProfileAcquisition ===
        'function' &&
      (await this.coachCommandService.shouldHandleBeforeProfileAcquisition(
        input,
      ))
    ) {
      await this.coachCommandService.processTextMessage(input);
      return;
    }

    if (
      typeof this.coachCommandService.processUncorrelatedShortReply ===
        'function' &&
      (await this.coachCommandService.processUncorrelatedShortReply(input))
    )
      return;

    const result =
      await this.activationOnboardingService.processTextMessage(input);

    if (result.handled) return;
    await this.coachCommandService.processTextMessage(input);
  }

  private async processMedia(event: OutboxEvent): Promise<void> {
    if (this.requiredString(event.payload, 'mediaType') !== MediaType.IMAGE) {
      return;
    }

    const userId = this.requiredString(event.payload, 'userId');
    const messageId = this.requiredString(event.payload, 'messageId');
    if (
      !(await this.subscriptionLifecycle.authorizeOrNotify(
        userId,
        messageId,
        event.createdAt,
      ))
    ) {
      return;
    }

    const meal = await this.nutritionService.createMealFromMedia(
      this.requiredString(event.payload, 'mediaFileId'),
      undefined,
      { userId, messageId },
    );
    if (
      meal.userId !== userId ||
      meal.messageId !== messageId ||
      meal.mediaFileId !== this.requiredString(event.payload, 'mediaFileId')
    )
      throw new Error('Media event ownership mismatch');

    try {
      await this.continuations?.bindMedia(userId, messageId);
      await this.nutritionVisionService.analyzeMeal(meal.id, userId);
    } catch (error: unknown) {
      if (!(error instanceof UsageLimitExceededException)) {
        throw error;
      }
      await this.continuations?.releaseMedia(userId, messageId);

      await this.responseBuilderService.buildUsageLimitResponse(
        meal.id,
        error.friendlyMessage,
      );
    }
  }

  private async processNutritionCompletion(event: OutboxEvent): Promise<void> {
    await this.responseBuilderService.buildNutritionResponse(
      this.requiredString(event.payload, 'mealAnalysisId'),
      this.requiredString(event.payload, 'userId'),
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
    const payload = event.payload;
    const hasBatch =
      typeof payload === 'object' &&
      payload !== null &&
      !Array.isArray(payload) &&
      'scheduledMessageIds' in payload;
    const ids = hasBatch
      ? payload.scheduledMessageIds
      : [this.requiredString(payload, 'scheduledMessageId')];
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(ids).size !== ids.length
    )
      throw new Error('Batch de automação inválido');
    let sent:
      | Awaited<ReturnType<AutomationService['sendScheduledMessage']>>
      | undefined;
    for (const id of ids) {
      if (typeof id !== 'string') throw new Error('ID de automação inválido');
      sent = await this.automationService.sendScheduledMessage(id);
      const context = sent.context;
      const legacyMultipart =
        typeof context === 'object' &&
        context !== null &&
        !Array.isArray(context) &&
        context.source === 'WHATSAPP_COACH_COMMAND' &&
        typeof context.partCount === 'number' &&
        context.partCount > 1;
      if (
        (hasBatch || legacyMultipart) &&
        sent.status !== ScheduledMessageStatus.SENT
      ) {
        if (sent.status === ScheduledMessageStatus.CANCELED) return;
        throw new Error(
          'Resposta multi-part aguardando confirmação da parte anterior',
        );
      }
    }
    if (!sent) throw new Error('Resposta de automação ausente');
    if (
      !hasBatch &&
      typeof sent.context === 'object' &&
      sent.context !== null &&
      !Array.isArray(sent.context) &&
      typeof sent.context.partIndex === 'number' &&
      typeof sent.context.partCount === 'number' &&
      sent.context.partIndex + 1 < sent.context.partCount
    )
      return;
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
        sentAt: sent.sentAt ?? sent.scheduledFor,
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
    await this.subscriptionLifecycle.notifyActivated(
      this.requiredString(event.payload, 'userId'),
      this.optionalNumber(event.payload, 'cycleNumber') ?? 1,
      this.optionalBoolean(event.payload, 'reactivated') ?? false,
      event.createdAt,
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

  private optionalNumber(
    payload: Prisma.JsonValue,
    key: string,
  ): number | undefined {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      typeof payload[key] !== 'number' ||
      !Number.isFinite(payload[key])
    ) {
      return undefined;
    }

    return payload[key];
  }

  private optionalBoolean(
    payload: Prisma.JsonValue,
    key: string,
  ): boolean | undefined {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      typeof payload[key] !== 'boolean'
    ) {
      return undefined;
    }

    return payload[key];
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
