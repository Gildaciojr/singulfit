import {
  MediaType,
  OutboxEvent,
  OutboxStatus,
  ResponseType,
} from '@prisma/client';
import { ActivationJourneyService } from '../activation/activation-journey.service';
import { ActivationOnboardingService } from '../activation/activation-onboarding.service';
import { ProfileAcquisitionInternalRolloutService } from '../context/profile-acquisition/profile-acquisition-internal-rollout.service';
import { CoachCommandService } from '../automation/coach-command.service';
import { AutomationService } from '../automation/automation.service';
import { EvolutionSendService } from '../evolution/evolution-send.service';
import { EvolutionWebhookService } from '../evolution/evolution-webhook.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { NutritionVisionService } from '../nutrition/nutrition-vision.service';
import { ResponseBuilderService } from '../responses/response-builder.service';
import { PagBankWebhookService } from '../webhooks/pagbank-webhook.service';
import { INTERNAL_EVENT } from './event-bus.constants';
import { EventHandlerRegistry } from './event-handler.registry';
import { IntegrationEventHandlersService } from './integration-event-handlers.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';

describe('IntegrationEventHandlersService', () => {
  function acquisitionRollout() {
    return {
      captureActiveResponse: jest.fn().mockResolvedValue({
        handled: false,
        duplicated: false,
        persisted: false,
        reason: 'NO_ACTIVE_QUESTION',
        cycleId: null,
        field: null,
      }),
      authorizeQuestionSend: jest.fn().mockResolvedValue(true),
      afterOutboundSent: jest.fn().mockResolvedValue(undefined),
      afterCoachResponseSent: jest.fn().mockResolvedValue(undefined),
    };
  }

  function subscriptionLifecycle() {
    return {
      authorizeOrNotify: jest.fn().mockResolvedValue(true),
      notifyActivated: jest.fn().mockResolvedValue(undefined),
    };
  }

  function outboxEvent(eventType: string, payload: OutboxEvent['payload']) {
    const at = new Date('2026-06-17T12:00:00.000Z');

    return {
      id: 'outbox-id',
      eventType,
      aggregateType: 'SUBSCRIPTION',
      aggregateId: 'subscription-id',
      payload,
      status: OutboxStatus.PROCESSING,
      attempts: 1,
      availableAt: at,
      claimedAt: at,
      processedAt: null,
      failedAt: null,
      lastError: null,
      createdAt: at,
      updatedAt: at,
    } satisfies OutboxEvent;
  }

  it('triggers activation journey when a subscription is activated', async () => {
    const registry = new EventHandlerRegistry();
    const activationJourney = {
      processUser: jest.fn().mockResolvedValue({ id: 'activation-id' }),
    };
    const activationOnboarding = {
      processTextMessage: jest.fn(),
    };
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      {} as CoachCommandService,
      {} as AutomationService,
      activationJourney as unknown as ActivationJourneyService,
      activationOnboarding as unknown as ActivationOnboardingService,
      acquisitionRollout() as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );

    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.SUBSCRIPTION_ACTIVATED);

    expect(handler).toBeDefined();

    if (!handler) {
      throw new Error('Handler SUBSCRIPTION_ACTIVATED não registrado');
    }

    await handler(
      outboxEvent(INTERNAL_EVENT.SUBSCRIPTION_ACTIVATED, {
        userId: 'user-id',
        subscriptionId: 'subscription-id',
      }),
    );

    expect(activationJourney.processUser).toHaveBeenCalledWith('user-id');
  });

  it('keeps media handling unchanged for non-image events', async () => {
    const registry = new EventHandlerRegistry();
    const nutritionService = {
      createMealFromMedia: jest.fn(),
    };
    const activationOnboarding = {
      processTextMessage: jest.fn(),
    };
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      nutritionService as unknown as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      {} as CoachCommandService,
      {} as AutomationService,
      {} as ActivationJourneyService,
      activationOnboarding as unknown as ActivationOnboardingService,
      acquisitionRollout() as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );

    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.MEDIA_RECEIVED);

    if (!handler) {
      throw new Error('Handler MEDIA_RECEIVED não registrado');
    }

    await handler(
      outboxEvent(INTERNAL_EVENT.MEDIA_RECEIVED, {
        mediaType: MediaType.AUDIO,
        mediaFileId: 'media-id',
      }),
    );

    expect(nutritionService.createMealFromMedia).not.toHaveBeenCalled();
  });

  it('routes WhatsApp text messages to coach onboarding', async () => {
    const registry = new EventHandlerRegistry();
    const activationOnboarding = {
      processTextMessage: jest.fn().mockResolvedValue({
        handled: true,
        duplicated: false,
        state: 'ASK_HEIGHT',
      }),
    };
    const coachCommand = {
      processTextMessage: jest.fn(),
    };
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      coachCommand as unknown as CoachCommandService,
      {} as AutomationService,
      {} as ActivationJourneyService,
      activationOnboarding as unknown as ActivationOnboardingService,
      acquisitionRollout() as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );

    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED);

    if (!handler) {
      throw new Error('Handler COACH_ONBOARDING_TEXT_RECEIVED não registrado');
    }

    await handler(
      outboxEvent(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED, {
        userId: 'user-id',
        messageId: 'message-id',
      }),
    );

    expect(activationOnboarding.processTextMessage).toHaveBeenCalledWith({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(coachCommand.processTextMessage).not.toHaveBeenCalled();
  });

  it('routes completed onboarding text messages to coach commands', async () => {
    const registry = new EventHandlerRegistry();
    const activationOnboarding = {
      processTextMessage: jest.fn().mockResolvedValue({
        handled: false,
        duplicated: false,
        state: 'PROFILE_COMPLETED',
        reason: 'ONBOARDING_COMPLETED',
      }),
    };
    const coachCommand = {
      processTextMessage: jest.fn().mockResolvedValue({
        handled: true,
        duplicated: false,
        intent: 'DIET',
      }),
    };
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      coachCommand as unknown as CoachCommandService,
      {} as AutomationService,
      {} as ActivationJourneyService,
      activationOnboarding as unknown as ActivationOnboardingService,
      acquisitionRollout() as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );

    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED);

    if (!handler) {
      throw new Error('Handler COACH_ONBOARDING_TEXT_RECEIVED não registrado');
    }

    await handler(
      outboxEvent(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED, {
        userId: 'user-id',
        messageId: 'message-id',
      }),
    );

    expect(coachCommand.processTextMessage).toHaveBeenCalledWith({
      userId: 'user-id',
      messageId: 'message-id',
    });
  });

  it('blocks expired users before acquisition, onboarding and coach runtime', async () => {
    const registry = new EventHandlerRegistry();
    const acquisition = acquisitionRollout();
    const onboarding = { processTextMessage: jest.fn() };
    const coach = { processTextMessage: jest.fn() };
    const lifecycle = subscriptionLifecycle();
    lifecycle.authorizeOrNotify.mockResolvedValue(false);
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      coach as unknown as CoachCommandService,
      {} as AutomationService,
      {} as ActivationJourneyService,
      onboarding as unknown as ActivationOnboardingService,
      acquisition as unknown as ProfileAcquisitionInternalRolloutService,
      lifecycle as unknown as SubscriptionLifecycleService,
    );
    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED);
    if (!handler) throw new Error('Handler de texto não registrado');

    await handler(
      outboxEvent(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED, {
        userId: 'user-id',
        messageId: 'expired-message-id',
      }),
    );

    expect(acquisition.captureActiveResponse).not.toHaveBeenCalled();
    expect(onboarding.processTextMessage).not.toHaveBeenCalled();
    expect(coach.processTextMessage).not.toHaveBeenCalled();
  });

  it('lets an active internal acquisition cycle consume the expected next message', async () => {
    const registry = new EventHandlerRegistry();
    const activationOnboarding = {
      processTextMessage: jest.fn(),
    };
    const coachCommand = {
      processTextMessage: jest.fn(),
    };
    const acquisition = acquisitionRollout();
    acquisition.captureActiveResponse.mockResolvedValue({
      handled: true,
      duplicated: false,
      persisted: true,
      reason: 'ANSWER_PERSISTED',
      cycleId: 'cycle-id',
      field: 'DESIRED_MEAL_COUNT',
    });
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      coachCommand as unknown as CoachCommandService,
      {} as AutomationService,
      {} as ActivationJourneyService,
      activationOnboarding as unknown as ActivationOnboardingService,
      acquisition as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );
    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED);
    if (!handler) throw new Error('Handler de texto não registrado');

    await handler(
      outboxEvent(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED, {
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    );

    expect(activationOnboarding.processTextMessage).not.toHaveBeenCalled();
    expect(coachCommand.processTextMessage).not.toHaveBeenCalled();
  });

  it('gives an actionable goal confirmation precedence over profile acquisition', async () => {
    const registry = new EventHandlerRegistry();
    const acquisition = acquisitionRollout();
    const activationOnboarding = { processTextMessage: jest.fn() };
    const coachCommand = {
      shouldHandleBeforeProfileAcquisition: jest.fn().mockResolvedValue(true),
      processTextMessage: jest.fn().mockResolvedValue({
        handled: true,
        duplicated: false,
        intent: 'DIET',
      }),
    };
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      coachCommand as unknown as CoachCommandService,
      {} as AutomationService,
      {} as ActivationJourneyService,
      activationOnboarding as unknown as ActivationOnboardingService,
      acquisition as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );
    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED);
    if (!handler) throw new Error('Handler de texto não registrado');

    await handler(
      outboxEvent(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED, {
        userId: 'user-id',
        messageId: 'goal-answer-message-id',
      }),
    );

    expect(coachCommand.processTextMessage).toHaveBeenCalledTimes(1);
    expect(acquisition.captureActiveResponse).not.toHaveBeenCalled();
    expect(activationOnboarding.processTextMessage).not.toHaveBeenCalled();
  });

  it('runs acquisition only after the official outbound completes sending', async () => {
    const registry = new EventHandlerRegistry();
    const evolutionSend = {
      sendText: jest.fn().mockResolvedValue({ id: 'outbound-id' }),
    };
    const acquisition = acquisitionRollout();
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      evolutionSend as unknown as EvolutionSendService,
      {} as CoachCommandService,
      {} as AutomationService,
      {} as ActivationJourneyService,
      {} as ActivationOnboardingService,
      acquisition as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );
    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.OUTBOUND_MESSAGE_REQUESTED);
    if (!handler) throw new Error('Handler outbound não registrado');

    await handler(
      outboxEvent(INTERNAL_EVENT.OUTBOUND_MESSAGE_REQUESTED, {
        outboundMessageId: 'outbound-id',
        responseType: ResponseType.NUTRITION_ANALYSIS,
      }),
    );

    expect(evolutionSend.sendText).toHaveBeenCalledWith('outbound-id');
    expect(acquisition.afterOutboundSent).toHaveBeenCalledWith('outbound-id');
    expect(evolutionSend.sendText.mock.invocationCallOrder[0]).toBeLessThan(
      acquisition.afterOutboundSent.mock.invocationCallOrder[0],
    );
  });

  it('blocks a queued acquisition question before Evolution when rollback is OFF', async () => {
    const registry = new EventHandlerRegistry();
    const evolutionSend = {
      sendText: jest.fn(),
    };
    const acquisition = acquisitionRollout();
    acquisition.authorizeQuestionSend.mockResolvedValue(false);
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      evolutionSend as unknown as EvolutionSendService,
      {} as CoachCommandService,
      {} as AutomationService,
      {} as ActivationJourneyService,
      {} as ActivationOnboardingService,
      acquisition as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );
    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.OUTBOUND_MESSAGE_REQUESTED);
    if (!handler) throw new Error('Handler outbound não registrado');

    await handler(
      outboxEvent(INTERNAL_EVENT.OUTBOUND_MESSAGE_REQUESTED, {
        outboundMessageId: 'question-outbound-id',
        responseType: ResponseType.PROFILE_ACQUISITION,
      }),
    );

    expect(acquisition.authorizeQuestionSend).toHaveBeenCalledWith(
      'question-outbound-id',
    );
    expect(evolutionSend.sendText).not.toHaveBeenCalled();
    expect(acquisition.afterOutboundSent).not.toHaveBeenCalled();
  });

  it('starts contextual workout acquisition only after the legacy coach message was sent', async () => {
    const registry = new EventHandlerRegistry();
    const scheduledFor = new Date('2026-06-17T12:00:01.000Z');
    const automation = {
      sendScheduledMessage: jest.fn().mockResolvedValue({
        id: 'scheduled-id',
        status: 'SENT',
        scheduledFor,
      }),
    };
    const acquisition = acquisitionRollout();
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      {} as CoachCommandService,
      automation as unknown as AutomationService,
      {} as ActivationJourneyService,
      {} as ActivationOnboardingService,
      acquisition as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );
    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.AUTOMATION_TRIGGERED);
    if (!handler) throw new Error('Handler de automação não registrado');

    await handler(
      outboxEvent(INTERNAL_EVENT.AUTOMATION_TRIGGERED, {
        scheduledMessageId: 'scheduled-id',
        userId: 'admin-id',
        source: 'WHATSAPP_COACH_COMMAND',
        sourceMessageId: 'workout-request-id',
        intent: 'WORKOUT',
      }),
    );

    expect(acquisition.afterCoachResponseSent).toHaveBeenCalledWith({
      userId: 'admin-id',
      sourceMessageId: 'workout-request-id',
      intent: 'WORKOUT',
      sentAt: scheduledFor,
    });
  });

  it('schedules premium kickoff only for onboarding context refresh completion', async () => {
    const registry = new EventHandlerRegistry();
    const automation = {
      scheduleOnboardingKickoff: jest.fn().mockResolvedValue({
        id: 'scheduled-id',
      }),
    };
    const activationOnboarding = {
      processTextMessage: jest.fn(),
    };
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      {} as CoachCommandService,
      automation as unknown as AutomationService,
      {} as ActivationJourneyService,
      activationOnboarding as unknown as ActivationOnboardingService,
      acquisitionRollout() as unknown as ProfileAcquisitionInternalRolloutService,
      subscriptionLifecycle() as unknown as SubscriptionLifecycleService,
    );

    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.USER_CONTEXT_REFRESH_COMPLETED);

    if (!handler) {
      throw new Error('Handler USER_CONTEXT_REFRESH_COMPLETED não registrado');
    }

    await handler(
      outboxEvent(INTERNAL_EVENT.USER_CONTEXT_REFRESH_COMPLETED, {
        userId: 'user-id',
        refreshKey: 'coach_onboarding:v1:profile:user-id',
        snapshotId: 'snapshot-id',
      }),
    );
    await handler(
      outboxEvent(INTERNAL_EVENT.USER_CONTEXT_REFRESH_COMPLETED, {
        userId: 'user-id',
        refreshKey: 'message-id',
        snapshotId: 'snapshot-id',
      }),
    );

    expect(automation.scheduleOnboardingKickoff).toHaveBeenCalledTimes(1);
    expect(automation.scheduleOnboardingKickoff).toHaveBeenCalledWith(
      'user-id',
      new Date('2026-06-17T12:00:00.000Z'),
    );
  });
});
