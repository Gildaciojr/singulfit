import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { OutboxEvent, OutboxStatus } from '@prisma/client';
import { ActivationJourneyService } from '../activation/activation-journey.service';
import { ActivationOnboardingService } from '../activation/activation-onboarding.service';
import { AutomationService } from '../automation/automation.service';
import { CoachCommandService } from '../automation/coach-command.service';
import { ProfileAcquisitionInternalRolloutService } from '../context/profile-acquisition/profile-acquisition-internal-rollout.service';
import { EvolutionSendService } from '../evolution/evolution-send.service';
import { EvolutionWebhookService } from '../evolution/evolution-webhook.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { NutritionVisionService } from '../nutrition/nutrition-vision.service';
import { PixRenewalIntentService } from '../payments/pix-renewal-intent.service';
import { PixRenewalService } from '../payments/pix-renewal.service';
import { ResponseBuilderService } from '../responses/response-builder.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import { PagBankWebhookService } from '../webhooks/pagbank-webhook.service';
import { INTERNAL_EVENT } from './event-bus.constants';
import { EventHandlerRegistry } from './event-handler.registry';
import { IntegrationEventHandlersService } from './integration-event-handlers.service';

describe('PIX renewal WhatsApp intent integration', () => {
  function subject(matched = true) {
    const registry = new EventHandlerRegistry();
    const coach = { processTextMessage: jest.fn().mockResolvedValue({}) };
    const automation = {
      scheduleSubscriptionNotice: jest.fn().mockResolvedValue({}),
    };
    const intent = {
      match: jest
        .fn()
        .mockResolvedValue(
          matched
            ? { matched: true, userId: 'user-id', messageId: 'message-id' }
            : { matched: false },
        ),
    };
    const renewal = {
      createOrReuseForUser: jest.fn().mockResolvedValue({
        amount: '29.90',
        expiresAt: '2026-09-20T12:00:00.000Z',
        qrCode: 'pix-copy-paste',
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
      coach as unknown as CoachCommandService,
      automation as unknown as AutomationService,
      {} as ActivationJourneyService,
      {
        processTextMessage: jest.fn().mockResolvedValue({ handled: false }),
      } as unknown as ActivationOnboardingService,
      {
        captureActiveResponse: jest.fn().mockResolvedValue({ handled: false }),
      } as unknown as ProfileAcquisitionInternalRolloutService,
      {
        authorizeOrNotify: jest.fn().mockResolvedValue(true),
      } as unknown as SubscriptionLifecycleService,
      undefined,
      intent as unknown as PixRenewalIntentService,
      renewal as unknown as PixRenewalService,
    );
    handlers.onModuleInit();
    const handler = registry.get(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED);
    if (!handler) throw new Error('handler not registered');
    return { handler, coach, automation, intent, renewal };
  }

  function event(): OutboxEvent {
    const now = new Date('2026-09-19T12:00:00.000Z');
    return {
      id: 'event-id',
      eventType: INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
      aggregateType: 'MESSAGE',
      aggregateId: 'message-id',
      payload: { userId: 'user-id', messageId: 'message-id' },
      status: OutboxStatus.PROCESSING,
      attempts: 1,
      availableAt: now,
      claimedAt: now,
      processedAt: null,
      failedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  it('routes an explicit valid inbound intent once to canonical renewal and safe outbound', async () => {
    const test = subject();
    await test.handler(event());
    expect(test.renewal.createOrReuseForUser).toHaveBeenCalledTimes(1);
    expect(test.renewal.createOrReuseForUser).toHaveBeenCalledWith('user-id');
    expect(test.automation.scheduleSubscriptionNotice).toHaveBeenCalledTimes(1);
    expect(test.automation.scheduleSubscriptionNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        noticeKey: 'pix-renewal-response:message-id',
        content: expect.stringContaining('pix-copy-paste'),
      }),
    );
    expect(test.coach.processTextMessage).not.toHaveBeenCalled();
  });

  it('preserves the normal conversation flow for ambiguous short confirmation', async () => {
    const test = subject(false);
    await test.handler(event());
    expect(test.renewal.createOrReuseForUser).not.toHaveBeenCalled();
    expect(test.automation.scheduleSubscriptionNotice).not.toHaveBeenCalled();
    expect(test.coach.processTextMessage).toHaveBeenCalledWith({
      userId: 'user-id',
      messageId: 'message-id',
    });
  });

  it.each([
    'recurring card',
    'canceled subscription',
    'missing renewal invoice',
  ])('does not send a PIX success response for %s', async () => {
    const test = subject();
    test.renewal.createOrReuseForUser.mockRejectedValue(
      new NotFoundException('not eligible'),
    );
    await test.handler(event());
    expect(test.automation.scheduleSubscriptionNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        noticeKey: 'pix-renewal-unavailable:message-id',
        content: expect.not.stringContaining('pix-copy-paste'),
      }),
    );
    expect(test.coach.processTextMessage).not.toHaveBeenCalled();
  });

  it('does not send a false success message when the provider path fails', async () => {
    const test = subject();
    test.renewal.createOrReuseForUser.mockRejectedValue(
      new BadGatewayException('provider unavailable'),
    );
    await expect(test.handler(event())).rejects.toThrow('provider unavailable');
    expect(test.automation.scheduleSubscriptionNotice).not.toHaveBeenCalled();
  });

  it('uses the same outbound idempotency notice key when the inbound event is replayed', async () => {
    const test = subject();
    await test.handler(event());
    await test.handler(event());
    expect(test.automation.scheduleSubscriptionNotice).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ noticeKey: 'pix-renewal-response:message-id' }),
    );
    expect(test.automation.scheduleSubscriptionNotice).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ noticeKey: 'pix-renewal-response:message-id' }),
    );
  });
});
