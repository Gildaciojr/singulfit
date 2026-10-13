import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { AutomationService } from './automation.service';
import { CoachWeeklySnapshotService } from './coach-weekly-snapshot.service';
import { CoachProactiveSchedulePolicy } from './coach-proactive-schedule.policy';
import type { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { NutritionConsumptionSummaryService } from '../nutrition/nutrition-consumption-summary.service';
import { NutritionIntakeLedgerService } from '../nutrition/nutrition-intake-ledger.service';
import type { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { CoachService } from './coach.service';
import type { CoachIntelligenceService } from './coach-intelligence.service';
import type { BehavioralIntelligenceService } from '../behavior/behavioral-intelligence.service';
import type { EvolutionGateway } from '../evolution/evolution.gateway';

const url = process.env.NUTRITION_INTAKE_INTEGRATION_DATABASE_URL;
(url ? describe : describe.skip)(
  'Premium weekly delivery: isolated PostgreSQL',
  () => {
    const db = new PrismaClient({ datasources: { db: { url } } });
    const prisma = db as unknown as PrismaService;
    const at = new Date('2026-08-16T23:01:00Z');
    let userId: string;
    let planId: string;
    const send = jest
      .fn<Promise<{ externalMessageId: string }>, [{ text: string }]>()
      .mockResolvedValue({ externalMessageId: 'synthetic-weekly-send' });
    const snapshots = new CoachWeeklySnapshotService(
      prisma,
      new NutritionConsumptionSummaryService(prisma),
      {
        getApplicableAt: () => Promise.resolve(null),
      } as unknown as CurrentNutritionPlanReaderService,
    );
    const instance = (
      mode: string = 'CANARY',
      ids: string = userId,
      global: string = 'false',
      intelligence: CoachIntelligenceService = {} as CoachIntelligenceService,
    ) =>
      new AutomationService(
        prisma,
        {} as SubscriptionsService,
        {} as CoachService,
        { sendText: send } as unknown as EvolutionGateway,
        new SubscriptionAccessService(prisma),
        new EventBusService(prisma),
        intelligence,
        {} as BehavioralIntelligenceService,
        new CoachProactiveSchedulePolicy(),
        snapshots,
        new ConfigService({
          COACH_WEEKLY_REPORT_MODE: mode,
          COACH_WEEKLY_REPORT_CANARY_USER_IDS: ids,
          COACH_WEEKLY_REPORT_GLOBAL_AUTHORIZED: global,
        }),
        new NutritionIntakeLedgerService(prisma),
      );
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        !target.pathname.includes('macro_consolidated')
      )
        throw new Error('Isolated local PostgreSQL required');
      await db.$connect();
      planId = (
        await db.plan.upsert({
          where: {
            type_contractVersion: {
              type: 'PREMIUM',
              contractVersion: 'legacy-v1',
            },
          },
          update: {},
          create: {
            type: 'PREMIUM',
            name: 'Synthetic Premium',
            price: 69.9,
            imageLimit: 150,
          },
        })
      ).id;
      await db.automationRule.upsert({
        where: { code: 'WEEKLY_SUMMARY' },
        update: { enabled: true },
        create: {
          code: 'WEEKLY_SUMMARY',
          name: 'Synthetic weekly',
          enabled: true,
        },
      });
    });
    beforeEach(async () => {
      jest.spyOn(Date, 'now').mockReturnValue(at.getTime());
      userId = (
        await db.user.create({
          data: {
            phone:
              '+999' +
              BigInt('0x' + randomUUID().replace(/-/gu, '').slice(0, 12))
                .toString()
                .slice(0, 10),
            preferences: {
              create: {
                timezone: 'America/Sao_Paulo',
                preferredWakeUpTime: '08:00',
                preferredSleepTime: '23:00',
              },
            },
            automationPreference: { create: {} },
          },
        })
      ).id;
      await db.conversation.create({
        data: {
          userId,
          phoneNumber: (
            await db.user.findUniqueOrThrow({ where: { id: userId } })
          ).phone,
        },
      });
      await db.subscription.create({
        data: {
          userId,
          planId,
          status: 'ACTIVE',
          amount: 69.9,
          startedAt: new Date('2026-08-01T00:00:00Z'),
          billingPeriodStart: new Date('2026-08-01T00:00:00Z'),
          billingPeriodEnd: new Date('2026-09-01T00:00:00Z'),
          currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
          currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
        },
      });
      send.mockClear();
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await db.outboxEvent.deleteMany({
        where: { payload: { path: ['userId'], equals: userId } },
      });
      await db.user.delete({ where: { id: userId } });
    });
    afterAll(async () => {
      await db.$disconnect();
    });
    it.each([
      ['OFF', ''],
      ['CANARY', ''],
      ['CANARY', '*'],
      ['CANARY', 'not-a-user-id'],
      ['GLOBAL', ''],
      ['INVALID', ''],
    ])(
      'blocks materialization and pending dispatch for %s with %s',
      async (mode, ids) => {
        const scheduled = await instance().scheduleMessage(
          userId,
          'WEEKLY_SUMMARY',
          at,
        );
        await expect(
          instance(mode, ids).scheduleMessage(userId, 'WEEKLY_REVIEW', at),
        ).rejects.toThrow();
        await instance(mode, ids).sendScheduledMessage(scheduled.id, at);
        expect(send).not.toHaveBeenCalled();
        expect(
          await db.scheduledMessage.findUnique({ where: { id: scheduled.id } }),
        ).toMatchObject({ status: 'PENDING' });
        await instance().sendScheduledMessage(scheduled.id, at);
        await instance().sendScheduledMessage(scheduled.id, at);
        expect(send).toHaveBeenCalledTimes(1);
        expect(await db.scheduledMessage.count({ where: { userId } })).toBe(1);
      },
    );

    it('keeps non-weekly retention rules running while the factual weekly engine is OFF', async () => {
      const existing = await instance().scheduleMessage(
        userId,
        'WEEKLY_SUMMARY',
        at,
      );
      const service = instance('OFF', '', 'false', {
        recalculateUser: jest.fn().mockResolvedValue({}),
        getExperienceSignals: jest.fn().mockResolvedValue({
          whatsapp: { preferredHourUtc: 9 },
          canSendCoachMessage: true,
        }),
      } as unknown as CoachIntelligenceService);
      const schedule = jest
        .spyOn(service, 'scheduleMessage')
        .mockResolvedValue(existing);
      await (
        service as unknown as {
          materializeRetentionMessages(at: Date): Promise<void>;
        }
      ).materializeRetentionMessages(at);
      expect(schedule).toHaveBeenCalledWith(
        userId,
        'DAILY_COACH',
        expect.any(Date),
      );
      expect(schedule).toHaveBeenCalledWith(
        userId,
        'MONTHLY_REVIEW',
        expect.any(Date),
      );
      expect(
        schedule.mock.calls.some(
          ([id, code]) =>
            id === userId &&
            (code === 'WEEKLY_SUMMARY' || code === 'WEEKLY_REVIEW'),
        ),
      ).toBe(false);
    });

    it('recovers an eligible Sunday report on Monday without changing its cut or creating another week', async () => {
      const monday = new Date('2026-08-17T12:00:00Z');
      jest.spyOn(Date, 'now').mockReturnValue(monday.getTime());
      const result = await instance().scheduleMessage(
        userId,
        'WEEKLY_SUMMARY',
        monday,
      );
      expect(result.context).toMatchObject({
        cutoff: '2026-08-16T23:00:00.000Z',
      });
      expect(result.content).toContain('16/08/2026');
      await instance().sendScheduledMessage(result.id, monday);
      expect(
        (await instance().scheduleMessage(userId, 'WEEKLY_REVIEW', monday)).id,
      ).toBe(result.id);
      expect(send).toHaveBeenCalledTimes(1);
    });
    it('delivers a factual Basic Sunday summary with the same public idempotency fence', async () => {
      const basic = await db.plan.upsert({
        where: {
          type_contractVersion: { type: 'BASIC', contractVersion: 'legacy-v1' },
        },
        update: {},
        create: {
          type: 'BASIC',
          name: 'Synthetic Basic',
          price: 29.9,
          imageLimit: 30,
        },
      });
      await db.subscription.updateMany({
        where: { userId },
        data: { planId: basic.id },
      });
      const [one, two] = await Promise.all([
        instance().scheduleMessage(userId, 'WEEKLY_SUMMARY', at),
        instance().scheduleMessage(userId, 'WEEKLY_REVIEW', at),
      ]);
      expect(one.id).toBe(two.id);
      expect(one.content).toContain('semana');
      expect(one.content).not.toContain('Proteínas:');
      await instance().sendScheduledMessage(one.id, at);
      await instance().sendScheduledMessage(one.id, at);
      expect(send).toHaveBeenCalledTimes(1);
      expect(await db.aIJob.count({ where: { userId } })).toBe(0);
    });
    it('coordinates SUMMARY and REVIEW across workers and restart into one factual scheduled result', async () => {
      const [summary, review] = await Promise.all([
        instance().scheduleMessage(userId, 'WEEKLY_SUMMARY', at),
        instance().scheduleMessage(userId, 'WEEKLY_REVIEW', at),
      ]);
      expect(summary.id).toBe(review.id);
      expect(summary.content).toContain('Ainda não há refeições registradas');
      expect(await db.scheduledMessage.count({ where: { userId } })).toBe(1);
      expect(await db.coachMessage.count({ where: { userId } })).toBe(1);
      expect(
        await db.outboxEvent.count({ where: { aggregateId: summary.id } }),
      ).toBe(1);
      expect(
        (await instance().scheduleMessage(userId, 'WEEKLY_SUMMARY', at)).id,
      ).toBe(summary.id);
      expect(await db.aIJob.count({ where: { userId } })).toBe(0);
      await instance().sendScheduledMessage(summary.id, at);
      await instance().sendScheduledMessage(summary.id, at);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        await db.scheduledMessage.findUnique({ where: { id: summary.id } }),
      ).toMatchObject({ status: 'SENT' });
    });
    it('does not schedule when opted out or subscription is ineligible', async () => {
      await db.userAutomationPreference.update({
        where: { userId },
        data: { progressReminderEnabled: false },
      });
      await expect(
        instance().scheduleMessage(userId, 'WEEKLY_SUMMARY', at),
      ).rejects.toThrow();
      await db.userAutomationPreference.update({
        where: { userId },
        data: { progressReminderEnabled: true },
      });
      await db.subscription.updateMany({
        where: { userId },
        data: { status: 'PAST_DUE' },
      });
      await expect(
        instance().scheduleMessage(userId, 'WEEKLY_SUMMARY', at),
      ).rejects.toThrow();
      expect(await db.scheduledMessage.count({ where: { userId } })).toBe(0);
      expect(send).not.toHaveBeenCalled();
    });
    it('rechecks Premium eligibility before delivery instead of sending a stale scheduled benefit', async () => {
      const scheduled = await instance().scheduleMessage(
        userId,
        'WEEKLY_SUMMARY',
        at,
      );
      await db.subscription.updateMany({
        where: { userId },
        data: { status: 'PAST_DUE' },
      });
      await instance().sendScheduledMessage(scheduled.id, at);
      expect(send).not.toHaveBeenCalled();
      expect(
        await db.scheduledMessage.findUnique({ where: { id: scheduled.id } }),
      ).toMatchObject({ status: 'CANCELED' });
    });
    it('does not deliver an already queued lunch question after the meal was recorded', async () => {
      const conversation = await db.conversation.findFirstOrThrow({
        where: { userId },
      });
      const rule = await db.automationRule.upsert({
        where: { code: 'MEAL_REMINDER' },
        update: { enabled: true },
        create: {
          code: 'MEAL_REMINDER',
          name: 'Synthetic lunch',
          enabled: true,
        },
      });
      const queued = await db.scheduledMessage.create({
        data: {
          userId,
          conversationId: conversation.id,
          automationRuleId: rule.id,
          scheduledFor: at,
          content: 'Já almoçou?',
          context: { source: 'COACH_PROACTIVE_V1', intent: 'LUNCH_CHECK' },
        },
      });
      const report = await db.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'INBOUND',
          type: 'TEXT',
          content: 'Almocei arroz e frango',
          timestamp: new Date(at.getTime() - 1000),
        },
      });
      await db.$transaction((tx) =>
        new NutritionIntakeLedgerService(prisma).record(tx, userId, report.id, {
          kind: 'MEAL',
          day: 'TODAY',
          quote: 'arroz e frango',
          meal: 'LUNCH',
        }),
      );
      await instance().sendScheduledMessage(queued.id, at);
      await instance().sendScheduledMessage(queued.id, at);
      expect(send).not.toHaveBeenCalled();
      expect(
        await db.scheduledMessage.findUnique({ where: { id: queued.id } }),
      ).toMatchObject({ status: 'CANCELED' });
      expect(await db.nutritionIntakeRecord.count({ where: { userId } })).toBe(
        1,
      );
    });
    it('rolls back the weekly receipt if the factual builder fails', async () => {
      jest
        .spyOn(snapshots, 'build')
        .mockRejectedValueOnce(new Error('FACT_SOURCE_UNAVAILABLE'));
      await expect(
        instance().scheduleMessage(userId, 'WEEKLY_SUMMARY', at),
      ).rejects.toThrow('FACT_SOURCE_UNAVAILABLE');
      expect(await db.coachMessage.count({ where: { userId } })).toBe(0);
      expect(await db.scheduledMessage.count({ where: { userId } })).toBe(0);
      expect(send).not.toHaveBeenCalled();
    });
    it('reprojects an owned Premium snapshot to Basic after a plan change without duplicate delivery', async () => {
      const scheduled = await instance().scheduleMessage(
        userId,
        'WEEKLY_SUMMARY',
        at,
      );
      const basic = await db.plan.upsert({
        where: {
          type_contractVersion: { type: 'BASIC', contractVersion: 'legacy-v1' },
        },
        update: {},
        create: {
          type: 'BASIC',
          name: 'Synthetic Basic',
          price: 29.9,
          imageLimit: 30,
        },
      });
      await db.subscription.updateMany({
        where: { userId },
        data: { planId: basic.id },
      });
      await instance().sendScheduledMessage(scheduled.id, at);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].text).not.toContain('Proteínas:');
      await instance().sendScheduledMessage(scheduled.id, at);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        await db.scheduledMessage.findUnique({ where: { id: scheduled.id } }),
      ).toMatchObject({ status: 'SENT' });
    });
  },
);
