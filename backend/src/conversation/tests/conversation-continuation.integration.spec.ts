import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient, MessageType } from '@prisma/client';
import { ConversationContinuationStore } from '../runtime/conversation-continuation.store';
import { ConversationRuntimeOperationalConfigService } from '../runtime/conversation-runtime-operational-config.service';
import {
  continuation,
  type ContinuationReply,
  record,
} from '../runtime/conversation-continuation.contract';
import type { PrismaService } from '../../prisma/prisma.service';
import { ConversationQAFollowUpContextService } from '../runtime/conversation-qa-follow-up-context.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { ACTIVE_CONVERSATION_QA_PROMPT } from '../runtime/conversation-qa-capability';

const url = process.env.CONVERSATION_CONTINUATION_INTEGRATION_DATABASE_URL;
const integration = url ? describe : describe.skip;
function barrier() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

integration(
  'Continuation PostgreSQL concurrency (existing migrated local DB, isolated fixtures)',
  () => {
    const db = new PrismaClient({
      datasources: {
        db: {
          url: url ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled',
        },
      },
    });
    const peer = new PrismaClient({
      datasources: {
        db: {
          url: url ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled',
        },
      },
    });
    const run = randomUUID();
    const at = new Date('2026-10-04T15:00:00Z');
    let userId: string;
    let foreignUserId: string;
    let conversationId: string;
    let otherConversationId: string;
    let textId: string;
    let secondTextId: string;
    let imageId: string;
    let ruleId: string;
    let receiptId: string;
    let fixturePromptId: string | undefined;
    let mode = 'PRIMARY';
    let killed = 'false';
    const config = new ConversationRuntimeOperationalConfigService({
      get: (key: string) =>
        (
          ({
            CONVERSATION_RUNTIME_MODE: mode,
            CONVERSATION_RUNTIME_KILL_SWITCH: killed,
            CONVERSATION_RUNTIME_TIMEOUT_MS: '25000',
            CONVERSATION_RUNTIME_CANARY_PERCENTAGE: '0',
          }) as Record<string, string>
        )[key],
    } as unknown as ConfigService);
    const store = new ConversationContinuationStore(
      db as unknown as PrismaService,
      config,
    );
    const other = new ConversationContinuationStore(
      peer as unknown as PrismaService,
      config,
    );
    const base = continuation('MEAL_CONTENT_REQUEST', at, 'LUNCH');
    const reply = (): ContinuationReply => ({
      content: 'Quais quantidades teve na refeição?',
      domain: 'NUTRITION',
      pending: {
        scheduledMessageId: receiptId,
        question: 'O que você comeu?',
        continuation: base,
      },
      next: base,
      outcome: 'UNKNOWN',
      evidence: {
        estimated: true,
        consumption: 'UNKNOWN',
        reportedContent: 'frango',
      },
    });
    const receiptContext = (): Prisma.InputJsonObject => ({
      continuation: { ...base },
      mediaContinuation: { ...base },
      mediaReceiptState: 'BOUND',
      mediaReceiptMessageId: imageId,
    });
    beforeAll(async () => {
      const target = new URL(url!);
      if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.port)
        throw new Error(
          'Concurrency fixtures require the explicitly configured local PostgreSQL',
        );
      // Verify the already migrated schema before creating any fixture. Never
      // migrate or adapt an obsolete database just to make this gate green.
      await Promise.all([
        db.conversation.findFirst({ where: { id: run } }),
        db.message.findFirst({ where: { id: run } }),
        db.scheduledMessage.findFirst({ where: { id: run } }),
        db.outboxEvent.findFirst({ where: { id: run } }),
      ]);
      userId = (
        await db.user.create({
          data: { phone: `continuation-test-${run}` },
          select: { id: true },
        })
      ).id;
      foreignUserId = (
        await db.user.create({
          data: { phone: `continuation-foreign-${run}` },
          select: { id: true },
        })
      ).id;
      conversationId = (
        await db.conversation.create({
          data: { userId, phoneNumber: `test-${run}` },
        })
      ).id;
      otherConversationId = (
        await db.conversation.create({
          data: { userId, phoneNumber: `other-${run}` },
        })
      ).id;
      const message = (type: MessageType, content: string) =>
        db.message.create({
          data: {
            conversationId,
            direction: 'INBOUND',
            type,
            content,
            timestamp: at,
          },
        });
      textId = (await message('TEXT', 'arroz e frango')).id;
      secondTextId = (await message('TEXT', 'sim')).id;
      imageId = (await message('IMAGE', 'foto')).id;
      ruleId = (
        await db.automationRule.create({
          data: {
            code: `CONTINUATION_TEST_${run}`,
            name: 'Isolated integration fixture',
          },
        })
      ).id;
    });
    beforeEach(async () => {
      mode = 'PRIMARY';
      killed = 'false';
      await db.scheduledMessage.deleteMany({
        where: { userId, automationRuleId: ruleId },
      });
      await db.outboxEvent.deleteMany({
        where: {
          eventType: 'CONTINUATION_SEMANTIC_RECEIPT',
          aggregateId: { startsWith: `${userId}:CONTINUATION_SEMANTICS:` },
        },
      });
      receiptId = (
        await db.scheduledMessage.create({
          data: {
            userId,
            conversationId,
            automationRuleId: ruleId,
            status: 'SENT',
            content: 'O que você comeu?',
            scheduledFor: new Date(at.getTime() - 1000),
            sentAt: new Date(at.getTime() - 1000),
            responseMessageId: imageId,
            context: receiptContext(),
          },
        })
      ).id;
    });
    afterAll(async () => {
      if (userId)
        await db.outboxEvent.deleteMany({
          where: {
            eventType: 'CONTINUATION_SEMANTIC_RECEIPT',
            aggregateId: { startsWith: `${userId}:CONTINUATION_SEMANTICS:` },
          },
        });
      if (userId) await db.user.delete({ where: { id: userId } });
      if (foreignUserId) await db.user.delete({ where: { id: foreignUserId } });
      if (ruleId) await db.automationRule.delete({ where: { id: ruleId } });
      if (fixturePromptId)
        await db.promptVersion.delete({ where: { id: fixturePromptId } });
      await Promise.all([db.$disconnect(), peer.$disconnect()]);
    });
    async function context() {
      const row = await db.scheduledMessage.findUniqueOrThrow({
        where: { id: receiptId },
      });
      if (!record(row.context)) throw new Error('Invalid test receipt');
      return row;
    }
    async function pauseComplete() {
      const read = barrier();
      const resume = barrier();
      const finished = db.$transaction(
        async (tx) => {
          const original = tx.scheduledMessage.findFirst.bind(
            tx.scheduledMessage,
          ) as typeof tx.scheduledMessage.findFirst;
          jest
            .spyOn(tx.scheduledMessage, 'findFirst')
            .mockImplementation(async (args) => {
              const result = await original(args);
              read.open();
              await resume.promise;
              return result;
            });
          return store.completeMedia(
            tx,
            userId,
            conversationId,
            imageId,
            reply(),
          );
        },
        { timeout: 15000 },
      );
      await read.promise;
      return { resume, finished };
    }
    it('serializes complete vs complete without overwriting the first cached result', async () => {
      const first = await pauseComplete();
      const started = barrier();
      const second = peer.$transaction((tx) => {
        started.open();
        return other.completeMedia(tx, userId, conversationId, imageId, {
          ...reply(),
          content: 'Uma resposta atrasada.',
        });
      });
      await started.promise;
      first.resume.open();
      expect(await Promise.all([first.finished, second])).toEqual([true, true]);
      const row = await context();
      expect(row.context).toMatchObject({
        mediaReceiptState: 'COMPLETE',
        mediaReply: { content: reply().content },
      });
    });
    it('cannot release a receipt completed by a concurrent worker', async () => {
      const first = await pauseComplete();
      const release = other.releaseMedia(userId, imageId);
      first.resume.open();
      await Promise.all([first.finished, release]);
      expect((await context()).responseMessageId).toBe(imageId);
      expect((await context()).context).toMatchObject({
        mediaReceiptState: 'COMPLETE',
      });
    });
    it('preserves consumption marker when completion races a text consumer', async () => {
      await db.scheduledMessage.update({
        where: { id: receiptId },
        data: { context: { ...receiptContext(), mediaFollowUp: { ...base } } },
      });
      const first = await pauseComplete();
      const started = barrier();
      const textReply = {
        ...reply(),
        pending: { ...reply().pending!, receiptMessageId: imageId },
      };
      const claim = peer.$transaction((tx) => {
        started.open();
        return other.claim(tx, userId, conversationId, textId, textReply, at);
      });
      await started.promise;
      first.resume.open();
      expect(await claim).toBe(true);
      await first.finished;
      expect((await context()).context).toMatchObject({
        mediaFollowUpConsumedBy: textId,
      });
      await db.$transaction((tx) =>
        store.completeMedia(tx, userId, conversationId, imageId, reply()),
      );
      expect((await context()).context).toMatchObject({
        mediaFollowUpConsumedBy: textId,
      });
      expect(
        await peer.$transaction((tx) =>
          other.claim(tx, userId, conversationId, secondTextId, textReply, at),
        ),
      ).toBe(false);
    });
    it('does not complete after release changed the observed receipt state', async () => {
      await store.releaseMedia(userId, imageId);
      await expect(
        db.$transaction((tx) =>
          store.completeMedia(tx, userId, conversationId, imageId, reply()),
        ),
      ).rejects.toThrow();
      expect((await context()).context).toMatchObject({
        mediaReceiptState: 'RELEASED',
      });
    });
    it.each(['TEXT', 'IMAGE'] as const)(
      'gates duplicate %s semantics across clients and reuses committed cache',
      async (type) => {
        const entered = barrier();
        const resume = barrier();
        const id = type === 'TEXT' ? textId : imageId;
        const execute = jest.fn(async () => {
          entered.open();
          await resume.promise;
          return reply();
        });
        const first = store.resolveOnce(userId, id, type, execute, reply());
        await entered.promise;
        await expect(
          other.resolveOnce(userId, id, type, execute, reply()),
        ).rejects.toThrow('in progress');
        resume.open();
        const saved = await first;
        // Exercise the real operational-retention predicate on this fixture
        // only. Cleanup must not erase the durable at-most-once identity.
        const aggregateId = `${userId}:CONTINUATION_SEMANTICS:${conversationId}:${id}:${type}`;
        const deleted = await db.$executeRaw`DELETE FROM "outbox_events"
          WHERE "aggregateId" = ${aggregateId}
            AND "status" = 'PROCESSED'::"OutboxStatus"
            AND "processedAt" < ${new Date(Date.now() + 86400000)}`;
        expect(deleted).toBe(0);
        expect(
          await other.resolveOnce(userId, id, type, execute, reply()),
        ).toEqual(saved);
        expect(execute).toHaveBeenCalledTimes(1);
      },
    );
    it('recovers an abandoned gate with a fenced safe answer, without another provider attempt', async () => {
      const entered = barrier();
      const resume = barrier();
      const execute = jest.fn(async () => {
        entered.open();
        await resume.promise;
        return reply();
      });
      const first = store.resolveOnce(userId, textId, 'TEXT', execute, {
        ...reply(),
        content: 'Pode esclarecer?',
        pending: null,
      });
      await entered.promise;
      await db.outboxEvent.updateMany({
        where: {
          eventType: 'CONTINUATION_SEMANTIC_RECEIPT',
          aggregateId: { startsWith: `${userId}:CONTINUATION_SEMANTICS:` },
        },
        data: { createdAt: new Date(Date.now() - 181000) },
      });
      const fallback = {
        ...reply(),
        content: 'Pode esclarecer?',
        pending: null,
      };
      expect(
        await other.resolveOnce(userId, textId, 'TEXT', execute, fallback),
      ).toEqual(fallback);
      resume.open();
      await expect(first).rejects.toThrow('superseded');
      expect(execute).toHaveBeenCalledTimes(1);
    });
    it.each(['OFF', 'SHADOW', 'INTERNAL', 'KILL'])(
      'does not mutate an ON receipt after policy becomes %s',
      async (policy) => {
        const before = await context();
        if (policy === 'KILL') killed = 'true';
        else mode = policy;
        await store.releaseMedia(userId, imageId);
        expect(
          await db.$transaction((tx) =>
            store.completeMedia(tx, userId, conversationId, imageId, reply()),
          ),
        ).toBe(false);
        expect(
          await db.$transaction((tx) =>
            store.claim(tx, userId, conversationId, textId, reply(), at),
          ),
        ).toBe(false);
        expect(await context()).toEqual(before);
      },
    );
    it('fences a kill switch changed during the provider call', async () => {
      const entered = barrier();
      const resume = barrier();
      const first = store.resolveOnce(
        userId,
        textId,
        'TEXT',
        async () => {
          entered.open();
          await resume.promise;
          return reply();
        },
        reply(),
      );
      await entered.promise;
      const before = await db.outboxEvent.findMany({
        where: {
          aggregateId: { startsWith: `${userId}:CONTINUATION_SEMANTICS:` },
        },
      });
      killed = 'true';
      resume.open();
      expect(await first).toBeNull();
      expect(
        await db.outboxEvent.findMany({
          where: {
            aggregateId: { startsWith: `${userId}:CONTINUATION_SEMANTICS:` },
          },
        }),
      ).toEqual(before);
    });
    it('serializes two textual consumers of one source row', async () => {
      await db.scheduledMessage.update({
        where: { id: receiptId },
        data: {
          responseMessageId: null,
          context: { continuation: { ...base } },
        },
      });
      const results = await Promise.all([
        db.$transaction((tx) =>
          store.claim(tx, userId, conversationId, textId, reply(), at),
        ),
        peer.$transaction((tx) =>
          other.claim(tx, userId, conversationId, secondTextId, reply(), at),
        ),
      ]);
      expect(results.sort()).toEqual([false, true]);
    });
    it('rolls back a completed media write when the policy changes before commit', async () => {
      const before = await context();
      await expect(
        db.$transaction(async (tx) => {
          const update = tx.scheduledMessage.updateMany.bind(
            tx.scheduledMessage,
          ) as typeof tx.scheduledMessage.updateMany;
          jest
            .spyOn(tx.scheduledMessage, 'updateMany')
            .mockImplementation(async (args) => {
              const result = await update(args);
              killed = 'true';
              return result;
            });
          return store.completeMedia(
            tx,
            userId,
            conversationId,
            imageId,
            reply(),
          );
        }),
      ).rejects.toThrow('disabled during mutation');
      expect(await context()).toEqual(before);
    });
    it('binds duplicate image inbounds to one owned receipt across clients', async () => {
      await db.scheduledMessage.update({
        where: { id: receiptId },
        data: {
          responseMessageId: null,
          context: { continuation: { ...base } },
        },
      });
      await Promise.all([
        store.bindMedia(userId, imageId),
        other.bindMedia(userId, imageId),
      ]);
      const row = await context();
      expect(row.responseMessageId).toBe(imageId);
      expect(row.context).toMatchObject({
        mediaReceiptState: 'BOUND',
        mediaReceiptMessageId: imageId,
      });
      await db.$transaction((tx) =>
        store.completeMedia(tx, userId, conversationId, imageId, reply()),
      );
      const completed = await context();
      await other.bindMedia(userId, imageId);
      expect(await context()).toEqual(completed);
    });
    it.each([0, 2])(
      'uses one multipart consumption identity when part %i is quoted first',
      async (part) => {
        await db.scheduledMessage.delete({ where: { id: receiptId } });
        for (let index = 0; index < 3; index++) {
          const row = await db.scheduledMessage.create({
            data: {
              userId,
              conversationId,
              automationRuleId: ruleId,
              status: 'SENT',
              content: `parte ${index}`,
              externalMessageId: `${run}-${part}-${index}`,
              scheduledFor: new Date(at.getTime() - 1000 + index),
              sentAt: new Date(at.getTime() - 1000 + index),
              context: {
                continuation: { ...base },
                deliveryMode: 'ORDERED_COACH_RESPONSE_BATCH',
                sourceMessageId: textId,
                partIndex: index,
                partCount: 3,
              },
            },
          });
          if (index === 0) receiptId = row.id;
        }
        const pending = await store.pending(userId, {
          conversationId,
          timestamp: at,
          replyToExternalMessageId: `${run}-${part}-${part}`,
        });
        expect(pending?.scheduledMessageId).toBe(receiptId);
        const logicalReply = { ...reply(), pending };
        expect(
          await db.$transaction((tx) =>
            store.claim(tx, userId, conversationId, textId, logicalReply, at),
          ),
        ).toBe(true);
        for (let index = 0; index < 3; index++)
          expect(
            await other.pending(userId, {
              conversationId,
              timestamp: at,
              replyToExternalMessageId: `${run}-${part}-${index}`,
            }),
          ).toBeNull();
      },
    );
    it('selects the newer lunch over hydration, but permits an explicit older reply', async () => {
      await db.scheduledMessage.update({
        where: { id: receiptId },
        data: {
          responseMessageId: null,
          externalMessageId: `${run}-older`,
          context: { continuation: { ...continuation('HYDRATION_CHECK', at) } },
        },
      });
      const lunch = await db.scheduledMessage.create({
        data: {
          userId,
          conversationId,
          automationRuleId: ruleId,
          status: 'SENT',
          content: 'Já almoçou?',
          scheduledFor: new Date(at.getTime() - 500),
          sentAt: new Date(at.getTime() - 500),
          context: { continuation: { ...base } },
        },
      });
      expect(
        (
          await store.pending(userId, {
            conversationId,
            timestamp: at,
            replyToExternalMessageId: null,
          })
        )?.scheduledMessageId,
      ).toBe(lunch.id);
      expect(
        (
          await store.pending(userId, {
            conversationId,
            timestamp: at,
            replyToExternalMessageId: `${run}-older`,
          })
        )?.scheduledMessageId,
      ).toBe(receiptId);
    });
    it('rejects cross-user, cross-conversation and manipulated receipt/source IDs', async () => {
      expect(await other.source(foreignUserId, textId, 'TEXT')).toBeNull();
      expect(
        await other.pending(userId, {
          conversationId: otherConversationId,
          timestamp: at,
          replyToExternalMessageId: null,
        }),
      ).toBeNull();
      await expect(
        peer.$transaction((tx) =>
          other.completeMedia(
            tx,
            foreignUserId,
            conversationId,
            imageId,
            reply(),
          ),
        ),
      ).rejects.toThrow();
      await expect(
        peer.$transaction((tx) =>
          other.completeMedia(
            tx,
            userId,
            otherConversationId,
            imageId,
            reply(),
          ),
        ),
      ).rejects.toThrow();
      await expect(
        peer.$transaction((tx) =>
          other.completeMedia(tx, userId, conversationId, imageId, {
            ...reply(),
            pending: { ...reply().pending!, scheduledMessageId: randomUUID() },
          }),
        ),
      ).rejects.toThrow();
    });
    it('cannot use a same-content delivery in another conversation as Q&A proof', async () => {
      // The media receipt's response ID must also identify an owned inbound in
      // this conversation, not merely match the JSON and scheduled row.
      const foreignImage = await db.message.create({
        data: {
          conversationId: otherConversationId,
          direction: 'INBOUND',
          type: 'IMAGE',
          content: 'outra foto',
          timestamp: at,
        },
      });
      await db.scheduledMessage.update({
        where: { id: receiptId },
        data: {
          responseMessageId: foreignImage.id,
          context: {
            ...receiptContext(),
            mediaReceiptState: 'COMPLETE',
            mediaReceiptMessageId: foreignImage.id,
            mediaFollowUp: { ...base },
          },
        },
      });
      const before = await context();
      expect(
        await peer.$transaction((tx) =>
          other.claim(
            tx,
            userId,
            conversationId,
            textId,
            {
              ...reply(),
              pending: {
                ...reply().pending!,
                receiptMessageId: foreignImage.id,
              },
            },
            at,
          ),
        ),
      ).toBe(false);
      expect(await context()).toEqual(before);
      const previousAt = new Date(at.getTime() - 10000);
      const previous = await db.message.create({
        data: {
          conversationId,
          direction: 'INBOUND',
          type: 'TEXT',
          content: 'Pergunta',
          timestamp: previousAt,
        },
      });
      let prompt = await db.promptVersion.findFirst({
        where: { name: ACTIVE_CONVERSATION_QA_PROMPT.name, isActive: true },
      });
      if (!prompt) {
        prompt = await db.promptVersion.create({
          data: {
            name: ACTIVE_CONVERSATION_QA_PROMPT.name,
            version: 2000000000,
            prompt: 'Isolated Q&A delivery fixture; never executed.',
            isActive: true,
          },
        });
        fixturePromptId = prompt.id;
      }
      const answer = 'Resposta segura.';
      const question = 'Quer continuar?';
      const content = `${answer}\n\n${question}`;
      await db.aIJob.create({
        data: {
          userId,
          conversationId,
          messageId: previous.id,
          type: 'TEXT',
          promptVersionId: prompt.id,
          status: 'COMPLETED',
          completedAt: new Date(at.getTime() - 5000),
          result: { answer, followUpQuestion: question },
        },
      });
      await db.coachMessage.create({
        data: {
          userId,
          type: 'FOLLOW_UP',
          idempotencyKey: `${userId}:WHATSAPP_COACH_COMMAND:${previous.id}`,
          content,
          context: {},
        },
      });
      await db.scheduledMessage.create({
        data: {
          userId,
          conversationId: otherConversationId,
          automationRuleId: ruleId,
          status: 'SENT',
          scheduledFor: new Date(at.getTime() - 3000),
          sentAt: new Date(at.getTime() - 3000),
          content,
          context: { sourceMessageId: previous.id },
        },
      });
      await db.message.update({
        where: { id: secondTextId },
        data: { timestamp: new Date(at.getTime() + 1000) },
      });
      await db.message.update({
        where: { id: textId },
        data: { timestamp: new Date(at.getTime() - 20000) },
      });
      const lookup = new ConversationQAFollowUpContextService(
        db as unknown as PrismaService,
        new ConversationPublicAnswerBoundaryService(),
      );
      expect(
        await lookup.findPending({
          userId,
          conversationId,
          messageId: secondTextId,
        }),
      ).toBeNull();
    });
    it('depends on the existing partial unique active-prompt index', async () => {
      const indexes = await db.$queryRaw<
        { indexdef: string }[]
      >`SELECT indexdef FROM pg_indexes WHERE indexname = 'prompt_versions_one_active_name_key'`;
      expect(indexes).toHaveLength(1);
      expect(indexes[0].indexdef).toMatch(/UNIQUE.*\(name\).*WHERE.*isActive/u);
    });
  },
);
