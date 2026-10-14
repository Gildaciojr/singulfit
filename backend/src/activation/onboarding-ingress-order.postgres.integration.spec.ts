import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { OutboxService } from '../event-bus/outbox.service';
import { OutboxDispatcherService } from '../event-bus/outbox-dispatcher.service';
import { EventHandlerRegistry } from '../event-bus/event-handler.registry';
import { DeliveryPendingError } from '../event-bus/delivery-pending.error';
import { EventService } from '../observability/event.service';
import { AuditService } from '../observability/audit.service';
import { EvolutionWebhookService } from '../evolution/evolution-webhook.service';
import { EvolutionGateway } from '../evolution/evolution.gateway';
import { EvolutionSendService } from '../evolution/evolution-send.service';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { ConversationsService } from '../whatsapp/conversations.service';
import { MessagesService } from '../whatsapp/messages.service';
import { MediaService } from '../storage/media.service';
import { ActivationOnboardingService } from './activation-onboarding.service';
import { admitOrderedText } from './onboarding-ingress-order';

const url = process.env.SINGULFIT_P0_INTEGRATION_DATABASE_URL;
if (
  url &&
  (process.env.SINGULFIT_P0_ISOLATION !== 'NO_NETWORK_DISPOSABLE' ||
    !/^postgresql:\/\/sf_p0_local:[a-zA-Z0-9_]+@127\.0\.0\.1:5432\/sf_p0_closure\?schema=public$/u.test(
      url,
    ))
)
  throw new Error(
    'Ordering tests require the attested exclusive disposable PostgreSQL',
  );

(url ? describe : describe.skip)(
  'Durable onboarding admission order — real PostgreSQL',
  () => {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: url ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled',
        },
      },
    });
    const db = prisma as unknown as PrismaService;
    const bus = new EventBusService(db);
    const onboarding = new ActivationOnboardingService(db, bus);
    const secondWorker = new ActivationOnboardingService(db, bus);
    const conversations = new ConversationsService(db);
    const transport = {
      validateWebhookSecret: jest.fn(),
      getInstanceName: () => 'ordering-instance',
      sendText: jest.fn(() =>
        Promise.resolve({
          externalMessageId: `ordering-synthetic-ack-${++ackSerial}`,
        }),
      ),
    };
    const users = new UsersService(db);
    const webhook = new EvolutionWebhookService(
      transport as unknown as EvolutionGateway,
      users,
      {
        getMessagingSubscription: (userId: string) =>
          prisma.subscription.findFirst({
            where: { userId, status: 'ACTIVE' },
          }),
      } as unknown as SubscriptionsService,
      conversations,
      new MessagesService(db, conversations),
      {
        storeRemoteMedia: jest
          .fn()
          .mockRejectedValue(new Error('External media forbidden')),
      } as unknown as MediaService,
      db,
      bus,
    );
    const config = new ConfigService({ OUTBOX_MAX_ATTEMPTS: '2' });
    const outbox = new OutboxService(
      db,
      config,
      new EventService(db),
      new AuditService(db),
    );
    const access = new SubscriptionAccessService(db);
    const sender = new EvolutionSendService(
      db,
      transport as unknown as EvolutionGateway,
      access,
      config,
    );
    const time = new Date('2026-10-13T12:00:00Z');
    let serial = 0;
    let ackSerial = 0;
    const originalMode = process.env.ONBOARDING_INGRESS_ORDERING_MODE;

    beforeAll(async () => {
      Logger.overrideLogger(false);
      await prisma.$connect();
      const [identity] = await prisma.$queryRaw<
        readonly { version: string; database: string; address: string }[]
      >`
      SELECT version(), current_database() AS database, inet_server_addr()::text AS address
    `;
      expect(identity.version).toContain('PostgreSQL 16.');
      expect(identity.database).toBe('sf_p0_closure');
      expect(identity.address).toBe('127.0.0.1/32');
    });
    beforeEach(async () => {
      jest.restoreAllMocks();
      process.env.ONBOARDING_INGRESS_ORDERING_MODE = 'REQUIRED';
      const receipts = await prisma.evolutionInboundEvent.findMany({
        where: {
          orderingUserId: { in: ['ordering-user-1', 'ordering-user-2'] },
        },
        select: { id: true },
      });
      await prisma.outboxEvent.deleteMany({
        where: {
          OR: [
            { aggregateId: { startsWith: 'ordering-' } },
            { aggregateId: { in: receipts.map((r) => r.id) } },
            {
              payload: {
                path: ['userId'],
                string_starts_with: 'ordering-user-',
              },
            },
          ],
        },
      });
      await prisma.user.deleteMany({
        where: { id: { in: ['ordering-user-1', 'ordering-user-2'] } },
      });
      const plan = await prisma.plan.upsert({
        where: {
          type_contractVersion: {
            type: 'BASIC',
            contractVersion: 'isolated-ordering',
          },
        },
        update: {},
        create: {
          type: 'BASIC',
          contractVersion: 'isolated-ordering',
          name: 'Disposable order fixture',
          price: 0,
          imageLimit: 0,
        },
      });
      for (const number of [1, 2]) {
        const userId = `ordering-user-${number}`;
        const phone = `+551199999000${number}`;
        await prisma.user.create({
          data: { id: userId, phone, phoneE164: phone },
        });
        await prisma.subscription.create({
          data: {
            userId,
            planId: plan.id,
            amount: 0,
            status: 'ACTIVE',
            currentPeriodEnd: new Date('2099-01-01'),
          },
        });
        await prisma.conversation.create({
          data: {
            id: `ordering-conversation-${number}`,
            userId,
            phoneNumber: phone,
          },
        });
        await onboarding.start({
          userId,
          activationId: `ordering-activation-${number}`,
          startedAt: time,
        });
      }
    });
    afterAll(async () => {
      if (originalMode === undefined)
        delete process.env.ONBOARDING_INGRESS_ORDERING_MODE;
      else process.env.ONBOARDING_INGRESS_ORDERING_MODE = originalMode;
      await prisma.$disconnect();
    });

    function entry(
      text: string,
      number = 1,
      externalId = `ordering-external-${++serial}`,
    ) {
      return {
        key: {
          id: externalId,
          remoteJid: `551199999000${number}@s.whatsapp.net`,
          fromMe: false,
        },
        message: { conversation: text },
        messageTimestamp: time.getTime() / 1000,
      };
    }
    async function admit(text: string, number = 1) {
      const input = entry(text, number);
      await webhook.handle(
        {
          event: 'messages.upsert',
          instance: 'ordering-instance',
          data: input,
        },
        'synthetic-secret',
      );
      return prisma.evolutionInboundEvent.findUniqueOrThrow({
        where: {
          instanceName_externalMessageId: {
            instanceName: 'ordering-instance',
            externalMessageId: input.key.id,
          },
        },
      });
    }
    async function materialize(receipt: Awaited<ReturnType<typeof admit>>) {
      await webhook.processQueuedEvent(receipt.id);
      return prisma.message.findUniqueOrThrow({
        where: {
          instanceName_externalMessageId: {
            instanceName: receipt.instanceName,
            externalMessageId: receipt.externalMessageId,
          },
        },
      });
    }
    async function consume(
      message: Awaited<ReturnType<typeof materialize>>,
      worker = onboarding,
    ) {
      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: message.conversationId },
      });
      return worker.processTextMessage({
        userId: conversation.userId,
        messageId: message.id,
      });
    }
    async function deliver(message: Awaited<ReturnType<typeof materialize>>) {
      const outbound = await prisma.outboundMessage.findUniqueOrThrow({
        where: {
          sourceMessageId_responseType: {
            sourceMessageId: message.id,
            responseType: 'PROFILE_ACQUISITION',
          },
        },
      });
      await sender.sendText(outbound.id);
    }
    async function orderedTurn(text: string) {
      const message = await materialize(await admit(text));
      await consume(message);
      await deliver(message);
      return message;
    }

    it('admits before inbox fan-out and rejects reverse consumption even before A is materialized', async () => {
      const a = await admit('28');
      const b = await admit('178');
      expect([a.admissionSequence, b.admissionSequence]).toEqual([1, 2]);
      const mb = await materialize(b);
      await expect(consume(mb)).rejects.toBeInstanceOf(DeliveryPendingError);
      const ma = await materialize(a);
      await consume(ma);
      await deliver(ma);
      await consume(mb);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers,
      ).toMatchObject({ age: 28, heightCm: 178 });
    });

    it.each(['sim', 'não', 'ok', 'confirmado'])(
      'keeps distinct equal-timestamp dietary and desired-result acknowledgements safe: %s',
      async (invalid) => {
        for (const text of [
          '28',
          '178',
          '80',
          'masculino',
          'emagrecer',
          'moderado',
          'tenho alergia a camarão',
        ])
          await orderedTurn(text);
        const confirmation = await materialize(await admit('sim'));
        await consume(confirmation);
        await deliver(confirmation);
        const before = (await onboarding.get('ordering-user-1'))?.content;
        const invalidResult = await materialize(await admit(invalid));
        expect(invalidResult.timestamp).toEqual(confirmation.timestamp);
        expect(invalidResult.id).not.toBe(confirmation.id);
        await consume(invalidResult, secondWorker);
        expect(
          (await onboarding.get('ordering-user-1'))?.content,
        ).toMatchObject({
          currentState: 'ASK_DESIRED_RESULT',
          status: 'IN_PROGRESS',
          answers: before?.answers,
          dietary: before?.dietary,
        });
        expect(
          (
            await prisma.user.findUniqueOrThrow({
              where: { id: 'ordering-user-1' },
            })
          ).onboardingCompleted,
        ).toBe(false);
        await Promise.all([
          consume(invalidResult),
          consume(invalidResult, secondWorker),
        ]);
        expect(
          await prisma.outboundMessage.count({
            where: {
              sourceMessageId: invalidResult.id,
              responseType: 'PROFILE_ACQUISITION',
            },
          }),
        ).toBe(1);
        await deliver(invalidResult);
        await orderedTurn('quero melhorar meu condicionamento');
        expect(
          (await onboarding.get('ordering-user-1'))?.content.currentState,
        ).toBe('PROFILE_COMPLETED');
      },
    );

    it('fails an unavailable admitted identity and recovers the same position before either successor', async () => {
      const a = await admit('28');
      const b = await admit('178');
      const c = await admit('80');
      const lookup = jest
        .spyOn(users, 'findByWhatsAppPhone')
        .mockResolvedValueOnce(null);
      await expect(webhook.processQueuedEvent(a.id)).rejects.toThrow(
        'ORDERED_INGRESS_IDENTITY_UNAVAILABLE',
      );
      expect(
        await prisma.evolutionInboundEvent.findUniqueOrThrow({
          where: { id: a.id },
        }),
      ).toMatchObject({
        status: 'FAILED',
        admissionSequence: 1,
        orderingUserId: 'ordering-user-1',
        turnProcessedAt: null,
      });
      lookup.mockRestore();
      const successors = await Promise.all([materialize(b), materialize(c)]);
      for (const m of successors)
        await expect(consume(m, secondWorker)).rejects.toBeInstanceOf(
          DeliveryPendingError,
        );
      const first = await materialize(a);
      for (const m of [first, ...successors]) {
        await consume(m);
        await deliver(m);
      }
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers,
      ).toMatchObject({ age: 28, heightCm: 178, currentWeightKg: '80.00' });
    });

    it('does not silently ignore a sequenced LID after its exact conversation link becomes unavailable', async () => {
      await prisma.conversation.update({
        where: { id: 'ordering-conversation-1' },
        data: { remoteJid: 'ordering-local@lid' },
      });
      const input = entry('28');
      input.key.remoteJid = 'ordering-local@lid';
      await webhook.handle(
        {
          event: 'messages.upsert',
          instance: 'ordering-instance',
          data: input,
        },
        'synthetic-secret',
      );
      const receipt = await prisma.evolutionInboundEvent.findUniqueOrThrow({
        where: {
          instanceName_externalMessageId: {
            instanceName: 'ordering-instance',
            externalMessageId: input.key.id,
          },
        },
      });
      expect(receipt.admissionSequence).toBe(1);
      await prisma.conversation.update({
        where: { id: 'ordering-conversation-1' },
        data: { remoteJid: null },
      });
      await expect(
        webhook.processQueuedEntry(receipt.instanceName, receipt.payload),
      ).rejects.toThrow('ORDERED_INGRESS_IDENTITY_UNAVAILABLE');
      expect(
        await prisma.message.count({
          where: { externalMessageId: receipt.externalMessageId },
        }),
      ).toBe(0);
    });

    it('reconciles falsely processed inbox and parent without resetting retries, including webhook replay', async () => {
      const a = await admit('28');
      await prisma.evolutionInboundEvent.update({
        where: { id: a.id },
        data: { status: 'PROCESSED', processedAt: time },
      });
      await prisma.outboxEvent.updateMany({
        where: {
          aggregateId: a.id,
          eventType: INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED,
        },
        data: { status: 'PROCESSED', attempts: 1, processedAt: time },
      });
      await webhook.handle(
        { event: 'messages.upsert', instance: a.instanceName, data: a.payload },
        'synthetic-secret',
      );
      const claimed = await outbox.claimBatch(new Date(), [
        INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED,
      ]);
      const parent = claimed.find((event) => event.aggregateId === a.id);
      if (!parent) throw new Error('Original orphan parent not recovered');
      expect(parent.attempts).toBe(2);
      await webhook.processQueuedEvent(a.id);
      expect(await outbox.markProcessed(parent)).toBe(true);
      const message = await prisma.message.findUniqueOrThrow({
        where: {
          instanceName_externalMessageId: {
            instanceName: a.instanceName,
            externalMessageId: a.externalMessageId,
          },
        },
      });
      expect(
        await prisma.outboxEvent.count({
          where: {
            aggregateId: message.id,
            eventType: INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
          },
        }),
      ).toBe(1);
      await consume(message);
      await expect(webhook.processQueuedEvent(a.id)).resolves.toMatchObject({
        duplicated: true,
      });
      expect(
        (
          await prisma.evolutionInboundEvent.findUniqueOrThrow({
            where: { id: a.id },
          })
        ).turnProcessedAt,
      ).not.toBeNull();
      expect(
        await prisma.systemEvent.count({
          where: {
            eventType: 'EVENT_RECOVERED',
            metadata: {
              path: ['reason'],
              equals: 'ORDERED_INGRESS_MISSING_CONSUMER',
            },
          },
        }),
      ).toBeGreaterThan(0);
    });

    it('bounds orphan retries, exposes a dead letter and uses audited administrative recovery', async () => {
      const a = await admit('28');
      const b = await materialize(await admit('178'));
      await prisma.evolutionInboundEvent.update({
        where: { id: a.id },
        data: { status: 'PROCESSED' },
      });
      await prisma.outboxEvent.updateMany({
        where: { aggregateId: a.id },
        data: { status: 'PROCESSED', attempts: 2 },
      });
      const claimed = await outbox.claimBatch(new Date(), [
        INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED,
      ]);
      expect(claimed.some((event) => event.aggregateId === a.id)).toBe(false);
      const parent = await prisma.outboxEvent.findFirstOrThrow({
        where: {
          aggregateId: a.id,
          eventType: INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED,
        },
      });
      expect(parent.status).toBe('DEAD_LETTER');
      await expect(consume(b)).rejects.toThrow('ORDERING_DEAD_LETTER');
      await outbox.retry(parent.id, 'ordering-user-2');
      expect(
        await prisma.auditLog.count({
          where: { entityId: parent.id, action: 'OUTBOX_RETRIED' },
        }),
      ).toBe(1);
      await consume(await materialize(a));
    });

    it('rolls back reconciliation when operational recording fails', async () => {
      const a = await admit('28');
      await prisma.outboxEvent.updateMany({
        where: { aggregateId: a.id },
        data: { status: 'PROCESSED', attempts: 1 },
      });
      const events = new EventService(db);
      jest
        .spyOn(events, 'recordInTransaction')
        .mockRejectedValueOnce(new Error('Audit rollback fixture'));
      const failing = new OutboxService(
        db,
        config,
        events,
        new AuditService(db),
      );
      await expect(
        failing.claimBatch(new Date(), [
          INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED,
        ]),
      ).rejects.toThrow('Audit rollback fixture');
      expect(
        await prisma.outboxEvent.findFirstOrThrow({
          where: { aggregateId: a.id },
        }),
      ).toMatchObject({ status: 'PROCESSED', attempts: 1 });
      expect(
        await prisma.evolutionInboundEvent.findUniqueOrThrow({
          where: { id: a.id },
        }),
      ).toMatchObject({ admissionSequence: 1, turnProcessedAt: null });
    });

    it('uses bounded outbox retries for transient identity absence and recovers through the audited retry route', async () => {
      const a = await admit('28');
      const registry = new EventHandlerRegistry();
      registry.register(INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED, (event) =>
        webhook.processQueuedEvent(event.aggregateId).then(() => undefined),
      );
      const dispatcher = new OutboxDispatcherService(outbox, registry);
      const lookup = jest
        .spyOn(users, 'findByWhatsAppPhone')
        .mockResolvedValue(null);
      await dispatcher.drain([INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED]);
      let parent = await prisma.outboxEvent.findFirstOrThrow({
        where: { aggregateId: a.id },
      });
      expect(parent).toMatchObject({ status: 'FAILED', attempts: 1 });
      await prisma.outboxEvent.update({
        where: { id: parent.id },
        data: { availableAt: new Date(0) },
      });
      await dispatcher.drain([INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED]);
      parent = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: parent.id },
      });
      expect(parent).toMatchObject({ status: 'DEAD_LETTER', attempts: 2 });
      expect(
        await prisma.message.count({
          where: { externalMessageId: a.externalMessageId },
        }),
      ).toBe(0);
      lookup.mockRestore();
      await outbox.retry(parent.id, 'ordering-user-2');
      await dispatcher.drain([INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED]);
      expect(
        await prisma.outboxEvent.findUniqueOrThrow({
          where: { id: parent.id },
        }),
      ).toMatchObject({ status: 'PROCESSED', attempts: 1 });
      expect(
        await prisma.auditLog.count({
          where: { entityId: parent.id, action: 'OUTBOX_RETRIED' },
        }),
      ).toBe(1);
      expect(
        await prisma.evolutionInboundEvent.findUniqueOrThrow({
          where: { id: a.id },
        }),
      ).toMatchObject({
        orderingUserId: 'ordering-user-1',
        admissionSequence: 1,
        turnProcessedAt: null,
      });
    });

    it('repairs partial materialization but never rebinds a falsely processed admission to a different owner', async () => {
      const a = await admit('28');
      const publish = jest
        .spyOn(bus, 'publish')
        .mockRejectedValueOnce(new Error('Materialization crash fixture'));
      await expect(webhook.processQueuedEvent(a.id)).rejects.toThrow(
        'Materialization crash fixture',
      );
      publish.mockRestore();
      expect(
        await prisma.message.count({
          where: { externalMessageId: a.externalMessageId },
        }),
      ).toBe(1);
      await prisma.evolutionInboundEvent.update({
        where: { id: a.id },
        data: { status: 'PROCESSED' },
      });
      const foreign = await prisma.user.findUniqueOrThrow({
        where: { id: 'ordering-user-2' },
      });
      const lookup = jest
        .spyOn(users, 'findByWhatsAppPhone')
        .mockResolvedValueOnce(foreign);
      jest
        .spyOn(conversations, 'findActiveByRemoteJid')
        .mockResolvedValueOnce(null);
      await expect(webhook.processQueuedEvent(a.id)).rejects.toThrow(
        'Ingress owner changed',
      );
      lookup.mockRestore();
      const message = await materialize(a);
      expect(message.conversationId).toBe('ordering-conversation-1');
      expect(
        await prisma.outboxEvent.count({
          where: {
            aggregateId: message.id,
            eventType: INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
          },
        }),
      ).toBe(1);
      await consume(message);
      const snapshot = await prisma.evolutionInboundEvent.findUniqueOrThrow({
        where: { id: a.id },
      });
      await outbox.claimBatch(new Date(), [
        INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED,
      ]);
      await webhook.processQueuedEvent(a.id);
      expect(
        await prisma.evolutionInboundEvent.findUniqueOrThrow({
          where: { id: a.id },
        }),
      ).toEqual(snapshot);
    });

    it('keeps three equal provider timestamps in persisted admission order', async () => {
      const receipts = [
        await admit('28'),
        await admit('178'),
        await admit('80'),
      ];
      const messages = await Promise.all(receipts.map(materialize));
      expect(new Set(messages.map((m) => m.timestamp.getTime())).size).toBe(1);
      await expect(consume(messages[2])).rejects.toBeInstanceOf(
        DeliveryPendingError,
      );
      await expect(consume(messages[1])).rejects.toBeInstanceOf(
        DeliveryPendingError,
      );
      for (const message of messages) {
        await consume(message);
        await deliver(message);
      }
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers,
      ).toMatchObject({ age: 28, heightCm: 178, currentWeightKg: '80.00' });
    });

    it('coordinates two workers through database locks and predecessor receipts', async () => {
      const a = await materialize(await admit('28'));
      const b = await materialize(await admit('178'));
      const results = await Promise.allSettled([
        consume(b, secondWorker),
        consume(a),
      ]);
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('fulfilled');
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers.age,
      ).toBe(28);
      await deliver(a);
      await consume(b, secondWorker);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers.heightCm,
      ).toBe(178);
    });

    it('does not let eligible B overtake A while A is waiting for retry', async () => {
      const a = await materialize(await admit('28'));
      const b = await materialize(await admit('178'));
      await prisma.outboxEvent.updateMany({
        where: {
          eventType: INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
          aggregateId: a.id,
        },
        data: { status: 'FAILED', availableAt: new Date(Date.now() + 60000) },
      });
      const registry = new EventHandlerRegistry();
      registry.register(
        INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
        async (event) => {
          const message = await prisma.message.findUniqueOrThrow({
            where: { id: event.aggregateId },
          });
          await access.requireAccess('ordering-user-1');
          await consume(message);
        },
      );
      await new OutboxDispatcherService(outbox, registry).drain([
        INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
      ]);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers.age,
      ).toBeNull();
      expect(
        (
          await prisma.outboxEvent.findFirstOrThrow({
            where: {
              eventType: INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
              aggregateId: b.id,
            },
          })
        ).status,
      ).toBe('PENDING');
      await consume(a);
      await deliver(a);
      await consume(b);
    });

    it.each(['INBOX', 'TURN'] as const)(
      'makes a %s dead-letter predecessor operationally explicit',
      async (domain) => {
        const a = await admit('28');
        const b = await materialize(await admit('178'));
        const ma = domain === 'TURN' ? await materialize(a) : null;
        await prisma.outboxEvent.updateMany({
          where: {
            eventType:
              domain === 'INBOX'
                ? INTERNAL_EVENT.WHATSAPP_MESSAGE_RECEIVED
                : INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
            aggregateId: ma?.id ?? a.id,
          },
          data: { status: 'DEAD_LETTER' },
        });
        await expect(consume(b)).rejects.toThrow('ORDERING_DEAD_LETTER:');
        expect(
          (await onboarding.get('ordering-user-1'))?.content.answers.age,
        ).toBeNull();
        expect(
          (
            await prisma.evolutionInboundEvent.findUniqueOrThrow({
              where: { id: a.id },
            })
          ).turnProcessedAt,
        ).toBeNull();
      },
    );

    it('reuses the original Evolution position on concurrent duplicates', async () => {
      const input = entry('28');
      const payload = {
        event: 'messages.upsert',
        instance: 'ordering-instance',
        data: input,
      };
      const results = await Promise.all([
        webhook.handle(payload, 'test'),
        webhook.handle(payload, 'test'),
      ]);
      expect(
        results
          .flatMap((result) => (Array.isArray(result) ? result : [result]))
          .filter((result) => result.duplicated),
      ).toHaveLength(1);
      expect(
        await prisma.evolutionInboundEvent.count({
          where: { externalMessageId: input.key.id },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: 'ordering-user-1' },
          })
        ).onboardingIngressCounter,
      ).toBe(1);
    });

    it('rolls back the counter, inbox and outbox together without consuming a number', async () => {
      const publish = jest.spyOn(bus, 'publish');
      publish.mockRejectedValueOnce(new Error('ordering-admission-rollback'));
      await expect(admit('28')).rejects.toThrow('ordering-admission-rollback');
      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: 'ordering-user-1' },
          })
        ).onboardingIngressCounter,
      ).toBe(0);
      expect(
        await prisma.evolutionInboundEvent.count({
          where: { orderingUserId: 'ordering-user-1' },
        }),
      ).toBe(0);
      publish.mockRestore();
      expect((await admit('28')).admissionSequence).toBe(1);
    });

    it('does not apply allergy confirmation ahead of the correction it belongs to', async () => {
      for (const text of [
        '28',
        '178',
        '80',
        'masculino',
        'emagrecer',
        'moderado',
        'Tenho alergia a camarão',
      ])
        await orderedTurn(text);
      const correction = await materialize(
        await admit('corrigindo tenho alergia a ovo'),
      );
      const confirmation = await materialize(await admit('sim'));
      await expect(consume(confirmation)).rejects.toBeInstanceOf(
        DeliveryPendingError,
      );
      await consume(correction);
      await deliver(correction);
      await consume(confirmation);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.dietary,
      ).toMatchObject({ allergies: ['ovo'], status: 'CONFIRMED' });
    });

    it('refuses confirmation quoted from the draft superseded by an allergy correction', async () => {
      for (const text of [
        '28',
        '178',
        '80',
        'masculino',
        'emagrecer',
        'moderado',
      ])
        await orderedTurn(text);
      const original = await orderedTurn('Tenho alergia a camarão');
      const oldPrompt = await prisma.outboundMessage.findFirstOrThrow({
        where: { sourceMessageId: original.id },
      });
      await orderedTurn('corrigindo tenho alergia a ovo');
      const stale = await materialize(await admit('sim'));
      await prisma.message.update({
        where: { id: stale.id },
        data: { replyToExternalMessageId: oldPrompt.externalMessageId },
      });
      await consume(stale);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.dietary,
      ).toMatchObject({ allergies: ['ovo'], status: 'CONFIRMATION_PENDING' });
      expect(
        (
          await prisma.outboundMessage.findFirstOrThrow({
            where: { sourceMessageId: stale.id },
          })
        ).content,
      ).toContain('pergunta anterior');
      await orderedTurn('sim');
      expect(
        (await onboarding.get('ordering-user-1'))?.content.dietary,
      ).toMatchObject({ allergies: ['ovo'], status: 'CONFIRMED' });
    });

    it('retains the existing stale-input safety check for an unquoted late dietary confirmation', async () => {
      for (const text of [
        '28',
        '178',
        '80',
        'masculino',
        'emagrecer',
        'moderado',
        'Tenho alergia a camarão',
      ])
        await orderedTurn(text);
      const correction = await materialize(
        await admit('corrigindo tenho alergia a ovo'),
      );
      await prisma.message.update({
        where: { id: correction.id },
        data: { timestamp: new Date(time.getTime() + 10000) },
      });
      await consume(correction);
      await deliver(correction);
      const late = await materialize(await admit('sim'));
      await consume(late);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.dietary,
      ).toMatchObject({ allergies: ['ovo'], status: 'CONFIRMATION_PENDING' });
      expect(
        (
          await prisma.outboundMessage.findFirstOrThrow({
            where: { sourceMessageId: late.id },
          })
        ).content,
      ).toContain('mensagem anterior');
      const current = await materialize(await admit('sim'));
      await prisma.message.update({
        where: { id: current.id },
        data: { timestamp: new Date(time.getTime() + 20000) },
      });
      await consume(current);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.dietary,
      ).toMatchObject({ allergies: ['ovo'], status: 'CONFIRMED' });
    });

    it('rolls back profile, outbound, outbox and consumption receipt on a failed turn transaction', async () => {
      const receipt = await admit('28');
      const message = await materialize(receipt);
      const originalBus = new EventBusService(db);
      const spy = jest
        .spyOn(bus, 'publish')
        .mockImplementationOnce(async (input, transaction) => {
          await originalBus.publish(input, transaction);
          throw new Error('ordering-turn-rollback');
        });
      await expect(consume(message)).rejects.toThrow('ordering-turn-rollback');
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers.age,
      ).toBeNull();
      expect(
        (
          await prisma.evolutionInboundEvent.findUniqueOrThrow({
            where: { id: receipt.id },
          })
        ).turnProcessedAt,
      ).toBeNull();
      expect(
        await prisma.outboundMessage.count({
          where: { sourceMessageId: message.id },
        }),
      ).toBe(0);
      spy.mockRestore();
      await consume(message);
      expect(
        (
          await prisma.evolutionInboundEvent.findUniqueOrThrow({
            where: { id: receipt.id },
          })
        ).turnProcessedAt,
      ).not.toBeNull();
    });

    it('allows another user to advance while the first user is blocked', async () => {
      await admit('28');
      const blocked = await materialize(await admit('178'));
      const other = await materialize(await admit('35', 2));
      const results = await Promise.allSettled([
        consume(blocked),
        consume(other, secondWorker),
      ]);
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('fulfilled');
      expect(
        (await onboarding.get('ordering-user-2'))?.content.answers.age,
      ).toBe(35);
    });

    it('keeps a different user parallel while the first user database lock is held', async () => {
      const first = await materialize(await admit('28'));
      const other = await materialize(await admit('35', 2));
      let unlock!: () => void;
      let locked!: () => void;
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`WITH locked AS (SELECT pg_advisory_xact_lock(hashtext(${'activation-onboarding:ordering-user-1'}))) SELECT true FROM locked`;
          locked();
          await release;
        },
        { timeout: 10000 },
      );
      await ready;
      const waiting = consume(first);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          consume(other, secondWorker),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Cross-user serialization detected')),
              3000,
            );
          }),
        ]);
        expect(
          (await onboarding.get('ordering-user-2'))?.content.answers.age,
        ).toBe(35);
      } finally {
        if (timer) clearTimeout(timer);
        unlock();
        await holder;
        await waiting;
      }
    });

    it('keeps a historical session and drains an unsequenced turn before new positions', async () => {
      process.env.ONBOARDING_INGRESS_ORDERING_MODE = 'DRAIN';
      const old = await prisma.message.create({
        data: {
          id: `ordering-legacy-${++serial}`,
          conversationId: 'ordering-conversation-1',
          direction: 'INBOUND',
          type: 'TEXT',
          content: '28',
          timestamp: time,
        },
      });
      const legacyEvent = await bus.publish({
        eventType: INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
        aggregateType: 'MESSAGE',
        aggregateId: old.id,
        payload: { userId: 'ordering-user-1', messageId: old.id },
      });
      const next = await materialize(await admit('178'));
      await expect(consume(next)).rejects.toThrow('ORDERING_DRAIN_BARRIER:');
      await consume(old);
      await deliver(old);
      const claimed = await prisma.outboxEvent.update({
        where: { id: legacyEvent.id },
        data: { status: 'PROCESSING', attempts: 1, claimedAt: new Date() },
      });
      expect(await outbox.markProcessed(claimed)).toBe(true);
      process.env.ONBOARDING_INGRESS_ORDERING_MODE = 'REQUIRED';
      await consume(next);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers,
      ).toMatchObject({ age: 28, heightCm: 178 });
    });

    it('rejects an unsequenced active turn under REQUIRED instead of inventing a position', async () => {
      const old = await prisma.message.create({
        data: {
          id: `ordering-old-${++serial}`,
          conversationId: 'ordering-conversation-1',
          direction: 'INBOUND',
          type: 'TEXT',
          content: '28',
        },
      });
      await expect(consume(old)).rejects.toThrow('UNSEQUENCED_ONBOARDING_TURN');
    });

    it('answers urgent safety through a blocked stream without consuming the earlier profile turn', async () => {
      const pending = await admit('28');
      const urgent = await materialize(await admit('Estou com dor no peito'));
      await consume(urgent);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers.age,
      ).toBeNull();
      expect(
        (
          await prisma.evolutionInboundEvent.findUniqueOrThrow({
            where: { id: pending.id },
          })
        ).turnProcessedAt,
      ).toBeNull();
      expect(
        (
          await prisma.outboundMessage.findFirstOrThrow({
            where: { sourceMessageId: urgent.id },
          })
        ).content,
      ).toContain('serviço de urgência');
      await consume(await materialize(pending));
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers.age,
      ).toBe(28);
    });

    it('recovers after a crash between admission and materialization with the same position', async () => {
      const a = await admit('28');
      const b = await admit('178');
      await expect(consume(await materialize(b))).rejects.toBeInstanceOf(
        DeliveryPendingError,
      );
      const recovered = await materialize(a);
      await consume(recovered);
      await deliver(recovered);
      await consume(await materialize(b));
      expect(
        (
          await prisma.evolutionInboundEvent.findUniqueOrThrow({
            where: { id: a.id },
          })
        ).admissionSequence,
      ).toBe(1);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers.heightCm,
      ).toBe(178);
    });

    it('atomically releases a non-onboarding turn only when the outbox lease matches', async () => {
      const receipt = await admit('Como funciona?');
      const message = await materialize(receipt);
      const event = await prisma.outboxEvent.findFirstOrThrow({
        where: {
          eventType: INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
          aggregateId: message.id,
        },
      });
      const claimed = await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSING', attempts: 1, claimedAt: new Date() },
      });
      expect(
        await outbox.markProcessed({ ...claimed, claimedAt: new Date(0) }),
      ).toBe(false);
      expect(
        (
          await prisma.evolutionInboundEvent.findUniqueOrThrow({
            where: { id: receipt.id },
          })
        ).turnProcessedAt,
      ).toBeNull();
      expect(await outbox.markProcessed(claimed)).toBe(true);
      expect(
        (
          await prisma.evolutionInboundEvent.findUniqueOrThrow({
            where: { id: receipt.id },
          })
        ).turnProcessedAt,
      ).not.toBeNull();
    });

    it('enforces positive, unique positions and foreign ownership in PostgreSQL', async () => {
      const a = await admit('28');
      await expect(
        prisma.evolutionInboundEvent.create({
          data: {
            instanceName: 'ordering-instance',
            externalMessageId: `ordering-bad-${++serial}`,
            payload: {},
            orderingUserId: 'ordering-user-1',
            admissionSequence: a.admissionSequence,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.evolutionInboundEvent.create({
          data: {
            instanceName: 'ordering-instance',
            externalMessageId: `ordering-bad-${++serial}`,
            payload: {},
            orderingUserId: 'ordering-user-1',
            admissionSequence: 0,
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.evolutionInboundEvent.create({
          data: {
            instanceName: 'ordering-instance',
            externalMessageId: `ordering-bad-${++serial}`,
            payload: {},
            orderingUserId: 'ordering-user-1',
          },
        }),
      ).rejects.toThrow();
    });

    it('preserves listed order within a provider batch at the admission boundary', async () => {
      const entries = [entry('28'), entry('178'), entry('80')];
      await webhook.handle(
        {
          event: 'messages.upsert',
          instance: 'ordering-instance',
          data: entries,
        },
        'test',
      );
      const rows = await prisma.evolutionInboundEvent.findMany({
        where: { orderingUserId: 'ordering-user-1' },
        orderBy: { admissionSequence: 'asc' },
      });
      expect(rows.map((r) => r.externalMessageId)).toEqual(
        entries.map((e) => e.key.id),
      );
    });

    it('does not treat another event family as an onboarding predecessor', async () => {
      await bus.publish({
        eventType: INTERNAL_EVENT.USER_CONTEXT_REFRESH_REQUESTED,
        aggregateType: 'MESSAGE',
        aggregateId: `ordering-context-${++serial}`,
        payload: { userId: 'ordering-user-1' },
      });
      const message = await materialize(await admit('28'));
      await consume(message);
      expect(
        (await onboarding.get('ordering-user-1'))?.content.answers.age,
      ).toBe(28);
    });

    it('keeps sequencing enforced for persisted positions when admissions are switched OFF', async () => {
      await admit('28');
      const b = await materialize(await admit('178'));
      process.env.ONBOARDING_INGRESS_ORDERING_MODE = 'OFF';
      await expect(consume(b)).rejects.toBeInstanceOf(DeliveryPendingError);
    });

    it('refuses to materialize a previously admitted turn under another phone owner', async () => {
      const receipt = await admit('28');
      await prisma.user.update({
        where: { id: 'ordering-user-1' },
        data: { phoneE164: null },
      });
      await prisma.user.update({
        where: { id: 'ordering-user-2' },
        data: { phoneE164: '+5511999990001' },
      });
      await expect(materialize(receipt)).rejects.toThrow(
        'Ingress owner changed',
      );
      expect(
        await prisma.message.count({
          where: {
            instanceName: receipt.instanceName,
            externalMessageId: receipt.externalMessageId,
          },
        }),
      ).toBe(0);
    });

    it('allocates only on successful transaction commit', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await admitOrderedText(tx, 'ordering-user-1', {
            instanceName: 'ordering-instance',
            externalMessageId: `ordering-rollback-${++serial}`,
            payload: {},
          });
          throw new Error('Rollback before event publication');
        }),
      ).rejects.toThrow('Rollback before event publication');
      expect((await admit('28')).admissionSequence).toBe(1);
    });
  },
);
