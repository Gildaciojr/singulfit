import { ConfigService } from '@nestjs/config';
import { PrismaClient, ResponseType } from '@prisma/client';
import { ActivationOnboardingService } from './activation-onboarding.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { OutboxService } from '../event-bus/outbox.service';
import { EventService } from '../observability/event.service';
import { AuditService } from '../observability/audit.service';
import { EvolutionSendService } from '../evolution/evolution-send.service';
import { EvolutionGateway } from '../evolution/evolution.gateway';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { DeliveryPendingError } from '../event-bus/delivery-pending.error';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { OutboxDispatcherService } from '../event-bus/outbox-dispatcher.service';
import { EventHandlerRegistry } from '../event-bus/event-handler.registry';
import { ActivationJourneyService } from './activation-journey.service';
import { ActivationService } from './activation.service';
import { ActivationScoreService } from './activation-score.service';
import { ConversationsService } from '../whatsapp/conversations.service';

// This suite never reads DATABASE_URL or a developer's shared test database.
// The Docker harness must attest a disposable, no-network namespace first.
const databaseUrl = process.env.SINGULFIT_P0_INTEGRATION_DATABASE_URL;
const enabled = Boolean(databaseUrl);
if (
  enabled &&
  (process.env.SINGULFIT_P0_ISOLATION !== 'NO_NETWORK_DISPOSABLE' ||
    !/^postgresql:\/\/sf_p0_local:[a-zA-Z0-9_]+@127\.0\.0\.1:5432\/sf_p0_closure\?schema=public$/u.test(
      databaseUrl ?? '',
    ))
)
  throw new Error(
    'P0 integration requires the attested exclusive Docker namespace',
  );

const isolated = enabled ? describe : describe.skip;
isolated(
  'Activation onboarding PostgreSQL atomicity and delivery recovery',
  () => {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url:
            databaseUrl ??
            'postgresql://disabled:disabled@127.0.0.1:1/disabled',
        },
      },
    });
    const db = prisma as unknown as PrismaService;
    const bus = new EventBusService(db);
    const onboarding = new ActivationOnboardingService(db, bus);
    const config = new ConfigService({ OUTBOX_MAX_ATTEMPTS: '2' });
    const outbox = new OutboxService(
      db,
      config,
      new EventService(db),
      new AuditService(db),
    );
    const gateway = {
      sendText: jest.fn(() =>
        Promise.resolve({
          externalMessageId: `closure-ack-${++ack}`,
        }),
      ),
    };
    const sender = new EvolutionSendService(
      db,
      gateway as unknown as EvolutionGateway,
      new SubscriptionAccessService(db),
      config,
    );
    const userId = 'closure-user';
    const conversationId = 'closure-conversation';
    let serial = 0;
    let ack = 0;
    const time = new Date('2026-10-13T12:00:00.000Z');

    beforeAll(async () => {
      await prisma.$connect();
      const version = await prisma.$queryRaw<
        readonly { version: string }[]
      >`SELECT version()`;
      expect(version[0]?.version).toContain('PostgreSQL 16.');
      // Both supported test session zones must preserve UTC DateTime semantics.
      const timezone = await prisma.$queryRaw<
        readonly { timezone: string }[]
      >`SELECT current_setting('TimeZone') AS timezone`;
      expect(['UTC', 'America/Sao_Paulo']).toContain(timezone[0]?.timezone);
    });
    beforeEach(async () => {
      jest.restoreAllMocks();
      gateway.sendText.mockReset().mockImplementation(() =>
        Promise.resolve({
          externalMessageId: `closure-ack-${++ack}`,
        }),
      );
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { startsWith: 'closure-' } },
      });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.user.create({
        data: { id: userId, phone: '+12025550123' },
      });
      const plan = await prisma.plan.upsert({
        where: {
          type_contractVersion: {
            type: 'BASIC',
            contractVersion: 'isolated-p0',
          },
        },
        update: {},
        create: {
          type: 'BASIC',
          contractVersion: 'isolated-p0',
          name: 'Isolated fixture',
          price: 0,
          imageLimit: 0,
        },
      });
      await prisma.subscription.create({
        data: {
          id: 'closure-subscription',
          userId,
          planId: plan.id,
          amount: 0,
          status: 'ACTIVE',
          currentPeriodEnd: new Date('2099-01-01'),
        },
      });
      await prisma.conversation.create({
        data: {
          id: conversationId,
          userId,
          phoneNumber: '+12025550123',
        },
      });
      await onboarding.start({
        userId,
        activationId: 'closure-activation',
        startedAt: time,
      });
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function message(content: string, timestamp = time) {
      return prisma.message.create({
        data: {
          id: `closure-message-${++serial}`,
          conversationId,
          direction: 'INBOUND',
          type: 'TEXT',
          content,
          timestamp,
        },
      });
    }
    async function turn(content: string, timestamp = time) {
      const input = await message(content, timestamp);
      await onboarding.processTextMessage({ userId, messageId: input.id });
      return prisma.outboundMessage.findUniqueOrThrow({
        where: {
          sourceMessageId_responseType: {
            sourceMessageId: input.id,
            responseType: ResponseType.PROFILE_ACQUISITION,
          },
        },
      });
    }
    async function dispatchEvent(sourceMessageId: string) {
      return prisma.outboxEvent.findUniqueOrThrow({
        where: {
          eventType_aggregateType_aggregateId: {
            eventType: INTERNAL_EVENT.ACTIVATION_ONBOARDING_RESPONSE_REQUESTED,
            aggregateType: 'ACTIVATION_ONBOARDING_MESSAGE',
            aggregateId: sourceMessageId,
          },
        },
      });
    }

    it('keeps one initial session under concurrent starts without overwriting an answer', async () => {
      await prisma.conversationMemory.deleteMany({ where: { userId } });
      const [first, second] = await Promise.all([
        onboarding.start({
          userId,
          activationId: 'closure-activation',
          startedAt: time,
        }),
        onboarding.start({
          userId,
          activationId: 'closure-activation',
          startedAt: time,
        }),
      ]);
      expect(first.id).toBe(second.id);
      const input = await message('28');
      await Promise.all([
        onboarding.processTextMessage({ userId, messageId: input.id }),
        onboarding.start({
          userId,
          activationId: 'closure-activation',
          startedAt: time,
        }),
      ]);
      expect((await onboarding.get(userId))?.content.answers.age).toBe(28);
    });

    it('preserves an advanced session on activation replay', async () => {
      await turn('28');
      const before = await onboarding.get(userId);
      const replay = await onboarding.start({
        userId,
        activationId: 'closure-activation',
        startedAt: new Date(),
      });
      expect(replay.content).toEqual(before?.content);
    });

    it('uses session-independent raw Date parameters and UTC event insertion', async () => {
      const types = await prisma.$queryRaw<readonly { type: string }[]>`
        SELECT pg_typeof(${time})::text AS type
      `;
      expect(types[0]?.type).toBe('timestamp with time zone');
      const before = Date.now();
      const event = await bus.publish({
        eventType: 'CLOSURE_TIMEZONE',
        aggregateType: 'TEST',
        aggregateId: 'closure-timezone',
        payload: {},
        availableAt: time,
      });
      expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(event.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(
        await outbox.claimBatch(new Date(time.getTime() - 1), [
          'CLOSURE_TIMEZONE',
        ]),
      ).toHaveLength(0);
      const claimed = await outbox.claimBatch(time, ['CLOSURE_TIMEZONE']);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].claimedAt).toEqual(time);
      expect(
        await outbox.claimBatch(new Date(time.getTime() + 119999), [
          'CLOSURE_TIMEZONE',
        ]),
      ).toHaveLength(0);
      const reclaimed = await outbox.claimBatch(
        new Date(time.getTime() + 120001),
        ['CLOSURE_TIMEZONE'],
      );
      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0].attempts).toBe(2);
      const expiredAt = new Date(time.getTime() + 240002);
      expect(
        await outbox.claimBatch(expiredAt, ['CLOSURE_TIMEZONE']),
      ).toHaveLength(0);
      const exhausted = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      expect(exhausted.status).toBe('DEAD_LETTER');
      expect(exhausted.failedAt).toEqual(expiredAt);
      expect(exhausted.updatedAt).toEqual(expiredAt);
    });

    it.each([86399999, 86400000])(
      'preserves the recovery boundary at %s milliseconds in either session zone',
      async (age) => {
        const eventType = 'CLOSURE_WAIT_BOUNDARY';
        const now = Date.now();
        await prisma.outboxEvent.create({
          data: {
            eventType,
            aggregateType: 'TEST',
            aggregateId: 'closure-wait',
            payload: {},
            createdAt: new Date(now - age),
            availableAt: new Date(now - 1),
          },
        });
        const registry = new EventHandlerRegistry();
        registry.register(eventType, () =>
          Promise.reject(new DeliveryPendingError('closure-pending')),
        );
        jest.spyOn(Date, 'now').mockReturnValue(now);
        try {
          await new OutboxDispatcherService(outbox, registry).drain(
            [eventType],
            new Date(now),
          );
        } finally {
          jest.restoreAllMocks();
        }
        const event = await prisma.outboxEvent.findFirstOrThrow({
          where: { eventType, aggregateId: 'closure-wait' },
        });
        expect(event.status).toBe(age < 86400000 ? 'PENDING' : 'FAILED');
        expect(event.attempts).toBe(age < 86400000 ? 0 : 1);
      },
    );

    async function journeySubject() {
      const activation = await prisma.userActivation.create({
        data: {
          userId,
          registeredAt: time,
          lastProgressAt: time,
          paidAt: time,
          currentStage: 'PAID',
        },
      });
      const scores = new ActivationScoreService();
      const events = new EventService(db);
      const journey = new ActivationJourneyService(
        db,
        new ActivationService(db, scores, events),
        scores,
        new ConversationsService(db),
        gateway as unknown as EvolutionGateway,
        events,
        onboarding,
      );
      const delivery = journey as unknown as {
        sendMessage(
          activationId: string,
          userId: string,
          kind: 'FLOW_MESSAGE',
          code: string,
          key: string,
          scheduled: Date,
          now: Date,
        ): Promise<void>;
      };
      await prisma.conversationMemory.deleteMany({ where: { userId } });
      const key = `${activation.id}:flow:D0`;
      return {
        journey,
        key,
        activation,
        send: (now = time) =>
          delivery.sendMessage(
            activation.id,
            userId,
            'FLOW_MESSAGE',
            'D0',
            key,
            time,
            now,
          ),
      };
    }

    it('does not send D0 before a failed session transaction and allows recovery', async () => {
      const setup = await journeySubject();
      jest
        .spyOn(onboarding, 'start')
        .mockRejectedValueOnce(new Error('closure-session-failure'));
      await expect(setup.send()).rejects.toThrow('closure-session-failure');
      expect(gateway.sendText).not.toHaveBeenCalled();
      expect(await onboarding.get(userId)).toBeNull();
      const failure = await prisma.activationEvent.findUniqueOrThrow({
        where: { idempotencyKey: setup.key },
      });
      if (!failure.failedAt)
        throw new Error('Missing isolated failure timestamp');
      await setup.send(new Date(failure.failedAt.getTime() + 120000));
      expect(await onboarding.get(userId)).not.toBeNull();
      expect(gateway.sendText).toHaveBeenCalledTimes(1);
    });

    it('accepts a real immediate reply during D0 transport and keeps it on activation replay', async () => {
      const setup = await journeySubject();
      gateway.sendText.mockImplementationOnce(async () => {
        expect(await onboarding.get(userId)).not.toBeNull();
        const input = await message('28');
        expect(
          (await onboarding.processTextMessage({ userId, messageId: input.id }))
            .handled,
        ).toBe(true);
        return { externalMessageId: 'closure-immediate-ack' };
      });
      await setup.send();
      await setup.send();
      expect((await onboarding.get(userId))?.content.answers.age).toBe(28);
      expect(gateway.sendText).toHaveBeenCalledTimes(1);
      expect(
        (
          await prisma.activationEvent.findUniqueOrThrow({
            where: { idempotencyKey: setup.key },
          })
        ).deliveryStatus,
      ).toBe('SENT');
    });

    it('repairs historical SENT D0 without another physical contact', async () => {
      const setup = await journeySubject();
      await setup.send();
      await prisma.conversationMemory.deleteMany({ where: { userId } });
      await setup.journey.processUser(userId, time);
      expect(await onboarding.get(userId)).not.toBeNull();
      expect(gateway.sendText).toHaveBeenCalledTimes(1);
    });

    it('preserves the existing session if persistence fails after the provider ACK', async () => {
      const setup = await journeySubject();
      jest
        .spyOn(prisma.activationEvent, 'updateMany')
        .mockRejectedValueOnce(new Error('closure-persist-failure'));
      await expect(setup.send()).rejects.toThrow('closure-persist-failure');
      expect(await onboarding.get(userId)).not.toBeNull();
      expect(
        (
          await prisma.activationEvent.findUniqueOrThrow({
            where: { idempotencyKey: setup.key },
          })
        ).deliveryStatus,
      ).toBe('FAILED');
    });

    it('fences the old D0 ACK while a newer delivery attempt is still SENDING', async () => {
      const setup = await journeySubject();
      let releaseOld!: () => void;
      let oldStarted!: () => void;
      const oldGate = new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      const started = new Promise<void>((resolve) => {
        oldStarted = resolve;
      });
      gateway.sendText.mockImplementationOnce(async () => {
        oldStarted();
        await oldGate;
        return { externalMessageId: 'closure-old-d0-ack' };
      });
      const old = setup.send();
      await started;
      await prisma.activationEvent.update({
        where: { idempotencyKey: setup.key },
        data: {
          attempts: 2,
          leaseExpiresAt: new Date(time.getTime() + 120000),
        },
      });
      releaseOld();
      await old;
      const event = await prisma.activationEvent.findUniqueOrThrow({
        where: { idempotencyKey: setup.key },
      });
      expect(event.deliveryStatus).toBe('SENDING');
      expect(event.attempts).toBe(2);
      expect(event.externalMessageId).toBeNull();
    });

    it('preserves a completed session on start replay', async () => {
      const existing = await onboarding.get(userId);
      expect(existing).not.toBeNull();
      if (!existing) throw new Error('Missing isolated session');
      const completed = await onboarding.persist({
        userId,
        content: {
          ...existing.content,
          status: 'COMPLETED',
          currentState: 'PROFILE_COMPLETED',
          completedAt: time.toISOString(),
        },
      });
      expect(
        (await onboarding.start({ userId, activationId: 'closure-activation' }))
          .content,
      ).toEqual(completed.content);
    });

    it.each(['PENDING', 'DEAD_LETTER'] as const)(
      'preserves safety priority with a %s predecessor without advancing the onboarding field',
      async (status) => {
        const previous = await message('28');
        await onboarding.processTextMessage({ userId, messageId: previous.id });
        const dependency = await dispatchEvent(previous.id);
        await prisma.outboxEvent.update({
          where: { id: dependency.id },
          data: { status },
        });
        const before = (await onboarding.get(userId))?.content;
        const input = await message('Estou com dor no peito');
        const result = await onboarding.processTextMessage({
          userId,
          messageId: input.id,
        });
        expect(result.handled).toBe(true);
        const after = (await onboarding.get(userId))?.content;
        expect(after?.currentState).toBe(before?.currentState);
        expect(after?.answers).toEqual(before?.answers);
        const response = await prisma.outboundMessage.findFirstOrThrow({
          where: { sourceMessageId: input.id },
        });
        expect(response.content).toContain('serviço de urgência');
      },
    );

    it('commits state, outbound and event atomically; concurrent replay is idempotent', async () => {
      const input = await message('28');
      const results = await Promise.all([
        onboarding.processTextMessage({ userId, messageId: input.id }),
        onboarding.processTextMessage({ userId, messageId: input.id }),
      ]);
      expect(results.filter((result) => result.duplicated)).toHaveLength(1);
      expect((await onboarding.get(userId))?.content.answers.age).toBe(28);
      expect(
        await prisma.outboundMessage.count({
          where: { sourceMessageId: input.id },
        }),
      ).toBe(1);
      expect((await dispatchEvent(input.id)).status).toBe('PENDING');
    });

    it('rolls back state, outbound and event after failure following event insertion', async () => {
      const before = (await onboarding.get(userId))?.content;
      const input = await message('28');
      const realBus = new EventBusService(db);
      jest
        .spyOn(bus, 'publish')
        .mockImplementation(async (event, transaction) => {
          await realBus.publish(event, transaction);
          throw new Error('Injected failure after insertion');
        });
      await expect(
        onboarding.processTextMessage({ userId, messageId: input.id }),
      ).rejects.toThrow('Injected failure');
      expect((await onboarding.get(userId))?.content).toEqual(before);
      expect(
        await prisma.outboundMessage.count({
          where: { sourceMessageId: input.id },
        }),
      ).toBe(0);
      expect(
        await prisma.outboxEvent.count({ where: { aggregateId: input.id } }),
      ).toBe(0);
    });

    it('holds a transaction-scoped user lock and releases it on rollback', async () => {
      let release = (): void => undefined;
      let signal = (): void => undefined;
      const acquired = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const key = `activation-onboarding:${userId}`;
      const holder = prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          WITH advisory_lock AS (
            SELECT pg_advisory_xact_lock(hashtext(${key}))
          )
          SELECT true AS "locked" FROM advisory_lock
        `;
        signal();
        await gate;
        throw new Error('rollback lock');
      });
      const rejected = expect(holder).rejects.toThrow('rollback lock');
      await acquired;
      const [during] = await prisma.$queryRaw<
        readonly { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
      expect(during.locked).toBe(false);
      release();
      await rejected;
      const [after] = await prisma.$queryRaw<
        readonly { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
      expect(after.locked).toBe(true);
    });

    it('enforces existing outbound and event uniqueness', async () => {
      const outbound = await turn('28');
      await expect(
        prisma.outboundMessage.create({
          data: {
            userId,
            conversationId,
            sourceMessageId: outbound.sourceMessageId,
            responseType: outbound.responseType,
            content: 'duplicate',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      const event = await dispatchEvent(outbound.sourceMessageId);
      await expect(
        prisma.outboxEvent.create({
          data: {
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: {},
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('waits for an active send lease, reclaims an expired lease and fences a late ACK', async () => {
      const outbound = await turn('28');
      let release = (): void => undefined;
      let signal = (): void => undefined;
      const acquired = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      gateway.sendText.mockImplementationOnce(async () => {
        signal();
        await gate;
        return { externalMessageId: 'closure-stale-ack' };
      });
      const first = sender.sendText(outbound.id);
      await acquired;
      expect((await sender.sendText(outbound.id)).status).toBe('SENDING');
      expect(gateway.sendText).toHaveBeenCalledTimes(1);
      await prisma.outboundMessage.update({
        where: { id: outbound.id },
        data: { leaseExpiresAt: new Date(0) },
      });
      const reclaimed = await sender.sendText(outbound.id);
      expect(reclaimed.status).toBe('SENT');
      release();
      await first;
      const persisted = await prisma.outboundMessage.findUniqueOrThrow({
        where: { id: outbound.id },
      });
      expect(persisted.externalMessageId).toBe(reclaimed.externalMessageId);
      expect(persisted.attempts).toBe(2);
    });

    it('retains waiting input across dead letter and audited retry of the dependency', async () => {
      const outbound = await turn('28');
      const dependency = await dispatchEvent(outbound.sourceMessageId);
      const waiting = await message('178');
      const [claimed] = await outbox.claimBatch(new Date(), [
        dependency.eventType,
      ]);
      await outbox.markFailed(
        { ...claimed, attempts: 2 },
        new Error('transport exhausted'),
      );
      await expect(
        onboarding.processTextMessage({ userId, messageId: waiting.id }),
      ).rejects.toThrow(`recuperação operacional: ${dependency.id}`);
      expect(
        (await onboarding.get(userId))?.content.answers.heightCm,
      ).toBeNull();
      expect(
        await prisma.systemEvent.count({ where: { severity: 'CRITICAL' } }),
      ).toBeGreaterThan(0);
      await outbox.retry(dependency.id, userId);
      await sender.sendText(outbound.id);
      await onboarding.processTextMessage({ userId, messageId: waiting.id });
      expect((await onboarding.get(userId))?.content.answers.heightCm).toBe(
        178,
      );
      expect(
        await prisma.auditLog.count({
          where: { action: 'OUTBOX_RETRIED', entityId: dependency.id },
        }),
      ).toBe(1);
    });

    it('commits repair of false completion and keeps input available for replay', async () => {
      const outbound = await turn('28');
      const dependency = await dispatchEvent(outbound.sourceMessageId);
      await prisma.outboxEvent.update({
        where: { id: dependency.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      const waiting = await message('178');
      await expect(
        onboarding.processTextMessage({ userId, messageId: waiting.id }),
      ).rejects.toBeInstanceOf(DeliveryPendingError);
      expect((await dispatchEvent(outbound.sourceMessageId)).status).toBe(
        'PENDING',
      );
      await sender.sendText(outbound.id);
      await onboarding.processTextMessage({ userId, messageId: waiting.id });
      expect((await onboarding.get(userId))?.content.answers.heightCm).toBe(
        178,
      );
    });

    it('recovers false completion automatically without another inbound message', async () => {
      const outbound = await turn('28');
      const dependency = await dispatchEvent(outbound.sourceMessageId);
      await prisma.outboxEvent.update({
        where: { id: dependency.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      const claimed = await outbox.claimBatch(new Date(), [
        dependency.eventType,
      ]);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].id).toBe(dependency.id);
      await sender.sendText(outbound.id);
      await outbox.markProcessed(claimed[0]);
      expect((await dispatchEvent(outbound.sourceMessageId)).status).toBe(
        'PROCESSED',
      );
      expect(
        (
          await prisma.outboundMessage.findUniqueOrThrow({
            where: { id: outbound.id },
          })
        ).status,
      ).toBe('SENT');
    });

    it.each(['CANCELED', 'EXPIRED'] as const)(
      'does not deliver a pending response after subscription %s',
      async (status) => {
        const outbound = await turn('28');
        await prisma.subscription.update({
          where: { id: 'closure-subscription' },
          data: { status },
        });
        expect((await sender.sendText(outbound.id)).status).toBe('FAILED');
        expect(gateway.sendText).not.toHaveBeenCalled();
      },
    );

    it('recovers a lost ACK and does not resend once SENT is durable', async () => {
      const outbound = await turn('28');
      gateway.sendText.mockRejectedValueOnce(
        new Error('ACK lost after provider acceptance'),
      );
      await expect(sender.sendText(outbound.id)).rejects.toThrow('ACK lost');
      expect(
        (
          await prisma.outboundMessage.findUniqueOrThrow({
            where: { id: outbound.id },
          })
        ).status,
      ).toBe('FAILED');
      await sender.sendText(outbound.id);
      await sender.sendText(outbound.id);
      expect(gateway.sendText).toHaveBeenCalledTimes(2);
    });

    it('recovers failure after ACK but before durable confirmation', async () => {
      const outbound = await turn('28');
      jest
        .spyOn(prisma.outboundMessage, 'updateMany')
        .mockRejectedValueOnce(
          new Error('Injected persistence failure after ACK'),
        );
      await expect(sender.sendText(outbound.id)).rejects.toThrow(
        'persistence failure',
      );
      expect(
        (
          await prisma.outboundMessage.findUniqueOrThrow({
            where: { id: outbound.id },
          })
        ).status,
      ).toBe('FAILED');
      await sender.sendText(outbound.id);
      expect(
        (
          await prisma.outboundMessage.findUniqueOrThrow({
            where: { id: outbound.id },
          })
        ).status,
      ).toBe('SENT');
      expect(gateway.sendText).toHaveBeenCalledTimes(2);
    });

    it('does not reinterpret a late older input as the next profile field', async () => {
      const outbound = await turn('28', new Date(time.getTime() + 60_000));
      await sender.sendText(outbound.id);
      const late = await turn('32', time);
      expect(late.content).toContain('mensagem anterior');
      const profile = (await onboarding.get(userId))?.content;
      expect(profile?.answers.age).toBe(28);
      expect(profile?.answers.heightCm).toBeNull();
      expect(profile?.lastProcessedMessageId).toBe(outbound.sourceMessageId);
    });
  },
);
