import { MediaType, OutboxEvent, OutboxStatus } from '@prisma/client';
import { ActivationJourneyService } from '../activation/activation-journey.service';
import { ActivationOnboardingService } from '../activation/activation-onboarding.service';
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

describe('IntegrationEventHandlersService', () => {
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
