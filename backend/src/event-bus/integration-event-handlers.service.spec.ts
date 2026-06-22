import { MediaType, OutboxEvent, OutboxStatus } from '@prisma/client';
import { ActivationJourneyService } from '../activation/activation-journey.service';
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
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      {} as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      {} as AutomationService,
      activationJourney as unknown as ActivationJourneyService,
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
    const handlers = new IntegrationEventHandlersService(
      registry,
      {} as PagBankWebhookService,
      {} as EvolutionWebhookService,
      nutritionService as unknown as NutritionService,
      {} as NutritionVisionService,
      {} as ResponseBuilderService,
      {} as EvolutionSendService,
      {} as AutomationService,
      {} as ActivationJourneyService,
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
});
