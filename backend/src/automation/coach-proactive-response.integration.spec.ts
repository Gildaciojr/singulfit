import {
  CoachProactiveWorkoutOutcome,
  MessageDirection,
  MessageType,
  PrismaClient,
  ScheduledMessageStatus,
} from '@prisma/client';
import type { EventBusService } from '../event-bus/event-bus.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CoachProactiveResponseService } from './coach-proactive-response.service';

const databaseUrl =
  process.env.COACH_PROACTIVE_RESPONSE_INTEGRATION_DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration(
  'Coach proactive response advisory-lock integration',
  () => {
    const prisma = new PrismaClient({
      datasources: { db: { url: safeDatabaseUrl } },
    });
    const suffix = `proactive-lock-${Date.now()}`;
    const userId = `${suffix}-user`;
    const conversationId = `${suffix}-conversation`;
    const inboundMessageId = `${suffix}-inbound`;
    const proactiveMessageId = `${suffix}-origin`;
    const goodMorningAt = new Date('2026-09-20T11:30:00.000Z');
    const inboundAt = new Date('2026-09-20T18:40:49.000Z');
    const eventBus = {
      publish: jest.fn().mockResolvedValue({ id: `${suffix}-outbox` }),
    };
    const service = new CoachProactiveResponseService(
      prisma as unknown as PrismaService,
      eventBus as unknown as EventBusService,
    );

    beforeAll(async () => {
      await prisma.$connect();
      await prisma.automationRule.upsert({
        where: { code: 'GOOD_MORNING' },
        update: { enabled: true },
        create: { code: 'GOOD_MORNING', name: 'Bom dia', enabled: true },
      });
      await prisma.automationRule.upsert({
        where: { code: 'DAILY_COACH' },
        update: { enabled: true },
        create: { code: 'DAILY_COACH', name: 'Coach diário', enabled: true },
      });
    });

    beforeEach(async () => {
      eventBus.publish.mockClear();
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.user.create({
        data: {
          id: userId,
          phone: `+5511${String(Date.now()).slice(-9)}`,
          name: 'Gildácio',
        },
      });
      await prisma.conversation.create({
        data: {
          id: conversationId,
          userId,
          phoneNumber: `+5511${String(Date.now()).slice(-9)}`,
        },
      });
      await prisma.message.create({
        data: {
          id: inboundMessageId,
          conversationId,
          direction: MessageDirection.INBOUND,
          type: MessageType.TEXT,
          content: 'Sim, já tomei café da manhã.',
          instanceName: 'INTEGRATION',
          timestamp: inboundAt,
        },
      });
      const goodMorningRule = await prisma.automationRule.findUniqueOrThrow({
        where: { code: 'GOOD_MORNING' },
      });
      await prisma.scheduledMessage.create({
        data: {
          id: proactiveMessageId,
          userId,
          conversationId,
          automationRuleId: goodMorningRule.id,
          scheduledFor: goodMorningAt,
          status: ScheduledMessageStatus.SENT,
          content: 'Bom dia! Como você está começando a manhã?',
          externalMessageId: `${suffix}-outbound`,
          sentAt: goodMorningAt,
          responseExpiresAt: new Date('2026-09-21T11:30:00.000Z'),
          context: {
            source: 'COACH_PROACTIVE_V1',
            intent: 'GOOD_MORNING',
          },
        },
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it('executes the transaction-scoped advisory lock and persists one idempotent affirmative capture', async () => {
      await expect(
        service.capture({ userId, messageId: inboundMessageId }),
      ).resolves.toEqual({
        handled: true,
        duplicated: false,
        outcome: CoachProactiveWorkoutOutcome.COMPLETED,
      });

      await expect(
        service.capture({ userId, messageId: inboundMessageId }),
      ).resolves.toEqual({
        handled: true,
        duplicated: true,
        outcome: CoachProactiveWorkoutOutcome.COMPLETED,
      });

      await expect(
        prisma.scheduledMessage.findUniqueOrThrow({
          where: { id: proactiveMessageId },
          select: {
            responseMessageId: true,
            responseOutcome: true,
            respondedAt: true,
          },
        }),
      ).resolves.toEqual({
        responseMessageId: inboundMessageId,
        responseOutcome: CoachProactiveWorkoutOutcome.COMPLETED,
        respondedAt: inboundAt,
      });
      await expect(
        prisma.coachMessage.count({ where: { userId } }),
      ).resolves.toBe(1);
      await expect(
        prisma.scheduledMessage.count({
          where: {
            userId,
            context: {
              path: ['source'],
              equals: 'COACH_PROACTIVE_RESPONSE_V1',
            },
          },
        }),
      ).resolves.toBe(1);
      expect(eventBus.publish).toHaveBeenCalledTimes(1);
    });
  },
);
