import { AIRecoveryService } from '../ai/ai-recovery.service';
import type { EventService } from '../observability/event.service';
import { ResponseBuilderService } from '../responses/response-builder.service';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AIJobType, PlanType, PrismaClient } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import type { AIUsageService } from '../ai/ai-usage.service';
import type { OpenAIGateway } from '../ai/openai.gateway';
import type { PromptService } from '../ai/prompt.service';
import { EventBusService } from '../event-bus/event-bus.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';
import { UsageService } from '../usage/usage.service';
import { EntitlementsService } from './entitlements.service';
import { ReservationService } from './reservation.service';
import { UsageLimitExceededException } from './usage-limit.exception';
import type { CommercialUsageEntitlementCode } from './entitlement.constants';

const url = process.env.CONVERSATION_CONTINUATION_INTEGRATION_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration(
  'Commercial quotas: isolated PostgreSQL and controlled provider',
  () => {
    const db = new PrismaClient({ datasources: { db: { url } } });
    const prisma = db as unknown as PrismaService;
    const entitlements = new EntitlementsService(
      prisma,
      new SubscriptionAccessService(prisma),
    );
    const reservations = new ReservationService(prisma, entitlements);
    const usage = new UsageService(prisma, entitlements);
    const provider = { createTextResponse: jest.fn() };
    let userId: string;
    let conversationId: string;
    let promptId: string;
    let ai: AIService;
    let planId: string;
    let periodStart: Date;
    let periodEnd: Date;
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        !target.port ||
        !target.pathname.includes('consolidated')
      )
        throw new Error('Explicit isolated local PostgreSQL required');
      await db.$connect();
      promptId = (
        await db.promptVersion.create({
          data: {
            name: `isolated-quota-${randomUUID()}`,
            version: 1,
            model: 'TEXT',
            prompt: 'Controlled provider',
            isActive: true,
          },
        })
      ).id;
      ai = new AIService(
        prisma,
        {
          getActive: () =>
            db.promptVersion.findUniqueOrThrow({ where: { id: promptId } }),
        } as unknown as PromptService,
        provider as unknown as OpenAIGateway,
        { recordInTransaction: jest.fn() } as unknown as AIUsageService,
        reservations,
        usage,
        new ConfigService(),
        new EventBusService(prisma),
      );
    });
    beforeEach(async () => {
      provider.createTextResponse.mockReset().mockResolvedValue({
        responseId: randomUUID(),
        model: 'controlled',
        outputText: 'controlled candidate',
        promptTokens: 10,
        completionTokens: 2,
        totalTokens: 12,
      });
      userId = (
        await db.user.create({
          data: { phone: `quota-synthetic-${randomUUID()}` },
        })
      ).id;
      conversationId = (
        await db.conversation.create({
          data: {
            userId,
            phoneNumber:
              '+999' +
              BigInt('0x' + randomUUID().replace(/-/gu, '').slice(0, 12))
                .toString()
                .slice(0, 10),
          },
        })
      ).id;
      periodStart = new Date(Date.now() - 86400000);
      periodEnd = new Date(Date.now() + 86400000 * 30);
    });
    afterEach(async () => {
      await db.outboxEvent.deleteMany({
        where: { payload: { path: ['userId'], equals: userId } },
      });
      await db.user.delete({ where: { id: userId } });
    });
    afterAll(async () => {
      await db.promptVersion.delete({ where: { id: promptId } });
      await db.$disconnect();
    });
    async function grant(
      code: CommercialUsageEntitlementCode,
      limit: number,
      premium = false,
    ) {
      const type = premium ? PlanType.PREMIUM : PlanType.BASIC;
      const plan = await db.plan.upsert({
        where: {
          type_contractVersion: { type: type, contractVersion: 'legacy-v1' },
        },
        update: {},
        create: {
          type,
          name: 'Isolated quota fixture',
          price: 1,
          imageLimit: 1,
        },
      });
      planId = plan.id;
      const definition = await db.entitlementDefinition.upsert({
        where: { code },
        update: {},
        create: { code, name: 'Isolated commercial quota' },
      });
      await db.planEntitlement.upsert({
        where: {
          planId_entitlementId: { planId, entitlementId: definition.id },
        },
        update: { value: limit, unlimited: false },
        create: {
          planId,
          entitlementId: definition.id,
          value: limit,
          unlimited: false,
        },
      });
      const subscription = await db.subscription.findFirst({
        where: { userId },
      });
      if (subscription)
        await db.subscription.update({
          where: { id: subscription.id },
          data: {
            planId,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          },
        });
      else
        await db.subscription.create({
          data: {
            userId,
            planId,
            status: 'ACTIVE',
            amount: 1,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          },
        });
    }
    async function job(
      code: CommercialUsageEntitlementCode,
      operationKey = randomUUID(),
    ) {
      if (code === 'IMAGE_ANALYSIS') {
        const message = await db.message.create({
          data: {
            conversationId,
            direction: 'INBOUND',
            type: 'IMAGE',
            content: 'synthetic-image',
            externalMessageId: operationKey,
          },
        });
        return ai.createJob({
          userId,
          conversationId,
          messageId: message.id,
          type: AIJobType.IMAGE,
          promptName: 'controlled',
        });
      }
      // Intentionally omit usageEntitlementCode to reproduce alternative-route bypass.
      return ai.createStandaloneJob({
        userId,
        type:
          code === 'NUTRITION_PLAN_GENERATION'
            ? AIJobType.DIET
            : AIJobType.WORKOUT,
        promptName: 'controlled',
        operationKey,
      });
    }
    it.each([
      ['NUTRITION_PLAN_GENERATION', 2, false],
      ['WORKOUT_PLAN_GENERATION', 2, false],
      ['NUTRITION_PLAN_GENERATION', 6, true],
      ['WORKOUT_PLAN_GENERATION', 6, true],
      ['IMAGE_ANALYSIS', 30, false],
      ['IMAGE_ANALYSIS', 150, true],
    ] as const)(
      '%s limit %i: only one concurrent last unit and correct cycle/message',
      async (code, limit, premium) => {
        await grant(code, limit, premium);
        await db.usageBucket.create({
          data: {
            userId,
            entitlementCode: code,
            periodStart,
            periodEnd,
            used: limit - 1,
          },
        });
        const outcomes = await Promise.allSettled([job(code), job(code)]);
        expect(
          outcomes.filter((value) => value.status === 'fulfilled'),
        ).toHaveLength(1);
        const rejected = outcomes.find((value) => value.status === 'rejected');
        if (rejected?.status !== 'rejected')
          throw new Error('Expected commercial quota rejection');
        // Plan generators also serialize in-flight operations. That guard can win
        // before the quota guard; neither may allocate a second last unit.
        expect(rejected.reason).toBeInstanceOf(
          code === 'IMAGE_ANALYSIS'
            ? UsageLimitExceededException
            : ConflictException,
        );
        expect(provider.createTextResponse).not.toHaveBeenCalled();
        expect(await usage.commercialBalance(userId, code)).toMatchObject({
          remaining: 0,
          reserved: 1,
          used: limit - 1,
          renewsAt: periodEnd,
        });
        const succeeded = outcomes.find(
          (value) => value.status === 'fulfilled',
        );
        if (succeeded?.status !== 'fulfilled')
          throw new Error('Expected one reserved job');
        await db.aIJob.update({
          where: { id: succeeded.value.id },
          data: { status: 'PROCESSING', startedAt: new Date() },
        });
        await ai.failJob(
          succeeded.value.id,
          new Error('controlled provider failure'),
        );
        expect(await usage.commercialBalance(userId, code)).toMatchObject({
          remaining: 1,
          reserved: 0,
        });
        expect(
          await db.usageEvent.count({
            where: { aiJobId: succeeded.value.id, status: 'REVERSED' },
          }),
        ).toBe(1);
        const replacement = await job(code);
        await db.$transaction(async (tx) => {
          await tx.aIJob.update({
            where: { id: replacement.id },
            data: {
              status: 'COMPLETED',
              startedAt: new Date(),
              completedAt: new Date(),
            },
          });
          await usage.confirmInTransaction(tx, replacement.id);
        });
        let limitError: unknown;
        try {
          await job(code);
        } catch (error) {
          limitError = error;
        }
        expect(limitError).toBeInstanceOf(UsageLimitExceededException);
        if (!(limitError instanceof UsageLimitExceededException))
          throw new Error('Expected settled quota rejection');
        expect(limitError.friendlyMessage).not.toContain('ilimitado');
        if (premium) {
          expect(limitError.friendlyMessage).toContain('renovação');
          expect(limitError.friendlyMessage).toContain(`as ${limit} `);
          expect(limitError.friendlyMessage).not.toContain('Premium');
        } else
          expect(limitError.friendlyMessage).toContain(
            code === 'IMAGE_ANALYSIS' ? '📸' : '💚',
          );
        expect(await usage.commercialBalance(userId, code)).toMatchObject({
          remaining: 0,
          reserved: 0,
          used: limit,
        });
      },
    );
    it.each(['NUTRITION_PLAN_GENERATION', 'WORKOUT_PLAN_GENERATION'] as const)(
      '%s operation replay reserves and confirms one unit',
      async (code) => {
        await grant(code, 2);
        const key = randomUUID();
        const first = await job(code, key);
        const replay = await job(code, key);
        expect(replay.id).toBe(first.id);
        const response = await ai.runTextJob(first.id, {
          input: 'synthetic controlled input',
        });
        await db.$transaction((tx) =>
          ai.completeJobInTransaction(tx, {
            userId,
            aiJobId: first.id,
            jobType: first.type,
            response,
            result: { synthetic: true },
          }),
        );
        expect((await job(code, key)).id).toBe(first.id);
        expect(provider.createTextResponse).toHaveBeenCalledTimes(1);
        expect(await usage.commercialBalance(userId, code)).toMatchObject({
          used: 1,
          reserved: 0,
          remaining: 1,
        });
        expect(
          await db.usageEvent.count({ where: { aiJobId: first.id } }),
        ).toBe(1);
        expect(await db.dietPlan.count({ where: { userId } })).toBe(0);
        expect(await db.workoutPlan.count({ where: { userId } })).toBe(0);
      },
    );
    it('zero quota blocks full reconstruction but scoped preservation and non-plan guidance remain free', async () => {
      await grant('NUTRITION_PLAN_GENERATION', 0);
      await expect(job('NUTRITION_PLAN_GENERATION')).rejects.toBeInstanceOf(
        UsageLimitExceededException,
      );
      const profile = await db.fitnessProfile.create({
        data: {
          userId,
          gender: 'MALE',
          birthDate: new Date('1990-01-01'),
          heightCm: 180,
          currentWeightKg: 80,
          targetWeightKg: 75,
          activityLevel: 'MODERATE',
          goal: 'WEIGHT_LOSS',
        },
      });
      const sourceJob = await db.aIJob.create({
        data: {
          userId,
          type: 'DIET',
          promptVersionId: promptId,
          status: 'COMPLETED',
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      const source = await db.dietPlan.create({
        data: {
          userId,
          profileId: profile.id,
          aiJobId: sourceJob.id,
          title: 'Synthetic owned source',
          objective: 'WEIGHT_LOSS',
          dailyCaloriesTarget: 2000,
          proteinTarget: 100,
          carbsTarget: 250,
          fatTarget: 60,
        },
      });
      await expect(
        ai.createStandaloneJob({
          userId,
          type: AIJobType.DIET,
          promptName: 'controlled',
          operationKey: randomUUID(),
          generationScope: {
            kind: 'TARGETED',
            sourcePlanId: randomUUID(),
            sourceAIJobId: sourceJob.id,
            targetKey: 'LUNCH',
          },
        }),
      ).rejects.toThrow('Plano de origem');
      await expect(
        ai.createStandaloneJob({
          userId,
          type: AIJobType.DIET,
          promptName: 'controlled',
          operationKey: randomUUID(),
          generationScope: {
            kind: 'TARGETED',
            sourcePlanId: source.id,
            sourceAIJobId: randomUUID(),
            targetKey: '1:LUNCH:chicken',
          },
        }),
      ).rejects.toThrow('Plano de origem');
      const targeted = await ai.createStandaloneJob({
        userId,
        type: AIJobType.DIET,
        promptName: 'controlled',
        operationKey: randomUUID(),
        generationScope: {
          kind: 'TARGETED',
          sourcePlanId: source.id,
          sourceAIJobId: sourceJob.id,
          targetKey: '1:LUNCH:chicken',
        },
      });
      await db.aIJob.update({
        where: { id: targeted.id },
        data: { status: 'PROCESSING', startedAt: new Date() },
      });
      await ai.failJob(
        targeted.id,
        new Error('controlled targeted validation failure'),
      );
      const guidance = await ai.createStandaloneJob({
        userId,
        type: AIJobType.DIET,
        promptName: 'controlled',
        operationKey: randomUUID(),
        generationScope: { kind: 'NON_PLAN' },
      });
      expect(
        await db.usageEvent.count({
          where: { aiJobId: { in: [targeted.id, guidance.id] } },
        }),
      ).toBe(0);
      expect(provider.createTextResponse).not.toHaveBeenCalled();
    });
    it('cycle renewal isolates consumption, and a missing entitlement creates no job', async () => {
      await grant('WORKOUT_PLAN_GENERATION', 2);
      await db.usageBucket.create({
        data: {
          userId,
          entitlementCode: 'WORKOUT_PLAN_GENERATION',
          periodStart: new Date(periodStart.getTime() - 86400000 * 30),
          periodEnd: periodStart,
          used: 2,
        },
      });
      await job('WORKOUT_PLAN_GENERATION');
      expect(
        await usage.commercialBalance(userId, 'WORKOUT_PLAN_GENERATION'),
      ).toMatchObject({ remaining: 1 });
      await db.planEntitlement.deleteMany({
        where: { planId, entitlement: { code: 'NUTRITION_PLAN_GENERATION' } },
      });
      await expect(job('NUTRITION_PLAN_GENERATION')).rejects.toThrow();
      expect(await db.aIJob.count({ where: { userId, type: 'DIET' } })).toBe(0);
    });
    it('photo limit publishes one authorized outbound and one outbox event on replay', async () => {
      await grant('IMAGE_ANALYSIS', 0);
      let rejected: unknown;
      try {
        await job('IMAGE_ANALYSIS');
      } catch (error) {
        rejected = error;
      }
      if (!(rejected instanceof UsageLimitExceededException))
        throw new Error('Expected photo quota veto');
      const source = await db.message.findFirstOrThrow({
        where: { conversationId, type: 'IMAGE' },
      });
      const media = await db.mediaFile.create({
        data: {
          userId,
          conversationId,
          messageId: source.id,
          mediaType: 'IMAGE',
          originalFileName: 'synthetic.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1,
          checksum: 'a'.repeat(64),
          storagePath: `synthetic-${randomUUID()}`,
        },
      });
      const meal = await db.meal.create({
        data: {
          userId,
          conversationId,
          messageId: source.id,
          mediaFileId: media.id,
          source: 'WHATSAPP',
        },
      });
      const builder = new ResponseBuilderService(
        prisma,
        {} as never,
        new EventBusService(prisma),
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const first = await builder.buildUsageLimitResponse(
        meal.id,
        rejected.friendlyMessage,
      );
      const replay = await builder.buildUsageLimitResponse(
        meal.id,
        rejected.friendlyMessage,
      );
      expect(replay.id).toBe(first.id);
      expect(first.content).toBe(
        '📸 Suas análises por foto deste ciclo chegaram ao limite!\n\nEnquanto ele não renova, você pode me contar por texto o que está comendo, e eu continuo te ajudando com sua alimentação.\n\nCom o Premium, você consegue analisar muito mais refeições por foto. 💚',
      );
      expect(
        await db.outboundMessage.count({
          where: { sourceMessageId: source.id },
        }),
      ).toBe(1);
      expect(
        await db.outboxEvent.count({
          where: {
            aggregateId: first.id,
            eventType: 'OUTBOUND_MESSAGE_REQUESTED',
          },
        }),
      ).toBe(1);
      expect(await db.aIJob.count({ where: { userId } })).toBe(0);
      expect(provider.createTextResponse).not.toHaveBeenCalled();
    });

    it.each([
      'NUTRITION_PLAN_GENERATION',
      'WORKOUT_PLAN_GENERATION',
      'IMAGE_ANALYSIS',
    ] as const)(
      'expired quota PENDING %s recovers with valid lifecycle and one refund',
      async (code) => {
        await grant(code, 2);
        const pending = await job(code);
        const now = new Date();
        await db.usageEvent.updateMany({
          where: { aiJobId: pending.id },
          data: {
            createdAt: new Date(now.getTime() - 600000),
            expiresAt: new Date(now.getTime() - 1),
          },
        });
        const recovery = new AIRecoveryService(
          prisma,
          usage,
          { recordInTransaction: jest.fn() } as unknown as EventService,
          ai,
        );
        await recovery.recover(now);
        expect(
          await db.aIJob.findUniqueOrThrow({ where: { id: pending.id } }),
        ).toMatchObject({
          status: 'FAILED',
          startedAt: expect.any(Date),
          leaseExpiresAt: null,
        });
        expect(await usage.commercialBalance(userId, code)).toMatchObject({
          reserved: 0,
          remaining: 2,
        });
        expect(
          await db.usageEvent.count({
            where: { aiJobId: pending.id, status: 'REVERSED' },
          }),
        ).toBe(1);
        await recovery.recover(now);
        expect(
          await db.usageEvent.count({ where: { aiJobId: pending.id } }),
        ).toBe(1);
        expect(provider.createTextResponse).not.toHaveBeenCalled();
      },
    );
  },
);
