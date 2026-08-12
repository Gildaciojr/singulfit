import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { CurrentGoalCommitService } from './current-goal-commit.service';
import { PendingConversationActionService } from './pending-conversation-action.service';
import { UserGoalEngineService } from './user-goal-engine.service';

const databaseUrl =
  process.env.PENDING_CONVERSATION_ACTION_INTEGRATION_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('Pending conversation action PostgreSQL fencing', () => {
  let first: PrismaClient;
  let second: PrismaClient;
  let firstService: PendingConversationActionService;
  let secondService: PendingConversationActionService;
  const suffix = `pending-action-${Date.now()}`;
  const userId = `${suffix}-user`;
  const conversationId = `${suffix}-conversation`;
  const sourceMessageId = `${suffix}-source`;
  const firstConsumerId = `${suffix}-consumer-a`;
  const secondConsumerId = `${suffix}-consumer-b`;
  const phoneNumber = `+5511${String(Date.now()).slice(-9)}`;
  const sourceAt = new Date('2026-08-12T12:00:00.000Z');
  const consumerAt = new Date('2026-08-12T12:01:00.000Z');
  const routeSelection = Object.freeze({
    nutrition: 'V2' as const,
    workout: null,
    reason: 'NUTRITION_V2_ELIGIBLE' as const,
    nutritionPilotStatus: 'ELIGIBLE' as const,
    suppressNutritionShadow: true,
  });

  function service(client: PrismaClient): PendingConversationActionService {
    const prisma = client as unknown as PrismaService;
    return new PendingConversationActionService(
      prisma,
      new UserGoalEngineService(),
      new CurrentGoalCommitService(prisma),
    );
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('Integration database URL unavailable');
    first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    firstService = service(first);
    secondService = service(second);
    await first.$executeRaw`
      INSERT INTO "users" (
        "id", "phone", "isActive", "onboardingCompleted", "createdAt", "updatedAt"
      ) VALUES (
        ${userId}, ${phoneNumber}, true, true, NOW(), NOW()
      )
    `;
    await first.$executeRaw`
      INSERT INTO "conversations" (
        "id", "userId", "phoneNumber", "status", "startedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${conversationId}, ${userId}, ${phoneNumber},
        'ACTIVE', NOW(), NOW(), NOW()
      )
    `;
    await first.$executeRaw`
      INSERT INTO "messages" (
        "id", "conversationId", "direction", "type", "content",
        "instanceName", "timestamp", "createdAt"
      ) VALUES
        (${sourceMessageId}, ${conversationId}, 'INBOUND', 'TEXT',
         'Monte uma dieta para emagrecer com 4 refeições', 'INTERNAL', ${sourceAt}, NOW()),
        (${firstConsumerId}, ${conversationId}, 'INBOUND', 'TEXT',
         'Quero emagrecer', 'INTERNAL', ${consumerAt}, NOW()),
        (${secondConsumerId}, ${conversationId}, 'INBOUND', 'TEXT',
         'Quero emagrecer', 'INTERNAL', ${consumerAt}, NOW())
    `;
    await firstService.createGoalConfirmation({
      userId,
      conversationId,
      sourceMessageId,
      originalIntent: 'DIET',
      originalMessage: 'Monte uma dieta para emagrecer com 4 refeições',
      referenceDate: sourceAt,
      declaredOutcome: 'emagrecimento',
    });
    await firstService.activateGoalConfirmationForSource({
      userId,
      conversationId,
      sourceMessageId,
      activatedAt: sourceAt,
    });
  });

  afterAll(async () => {
    await first.pendingConversationAction.deleteMany({ where: { userId } });
    await first.userGoalClassification.deleteMany({ where: { userId } });
    await first.message.deleteMany({ where: { conversationId } });
    await first.conversation.deleteMany({ where: { id: conversationId } });
    await first.user.deleteMany({ where: { id: userId } });
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  });

  it('runs real services through concurrent consume, partial unique and lease fencing', async () => {
    const [firstPending, secondPending] = await Promise.all([
      firstService.findPendingForInbound({
        userId,
        conversationId,
        messageId: firstConsumerId,
        text: 'Quero emagrecer',
        receivedAt: consumerAt,
      }),
      secondService.findPendingForInbound({
        userId,
        conversationId,
        messageId: secondConsumerId,
        text: 'Quero emagrecer',
        receivedAt: consumerAt,
      }),
    ]);
    if (
      firstPending.status !== 'ACTIONABLE' ||
      secondPending.status !== 'ACTIONABLE'
    ) {
      throw new Error('Pending action was not actionable');
    }

    const results = await Promise.all([
      firstService.consumeGoalConfirmation({
        userId,
        conversationId,
        consumerMessageId: firstConsumerId,
        referenceDate: consumerAt,
        context: firstPending.context,
        routeSelection,
      }),
      secondService.consumeGoalConfirmation({
        userId,
        conversationId,
        consumerMessageId: secondConsumerId,
        referenceDate: consumerAt,
        context: secondPending.context,
        routeSelection,
      }),
    ]);
    expect(results.sort()).toEqual(['ALREADY_CONSUMED', 'APPLIED']);

    const action = await first.pendingConversationAction.findFirstOrThrow({
      where: { userId, conversationId },
    });
    expect([firstConsumerId, secondConsumerId]).toContain(
      action.consumerMessageId,
    );
    expect(
      await first.userGoalClassification.count({ where: { userId } }),
    ).toBe(1);

    await expect(
      first.$executeRaw`
        INSERT INTO "pending_conversation_actions" (
          "id", "userId", "conversationId", "type", "status",
          "sourceMessageId", "originalIntent", "payload", "operationKey",
          "createdAt", "updatedAt", "expiresAt"
        ) VALUES (
          ${`${suffix}-second-action`}, ${userId}, ${conversationId},
          'GOAL_CONFIRMATION', 'PENDING', ${firstConsumerId}, 'DIET',
          '{}'::jsonb, ${`${suffix}-second-operation`}, NOW(), NOW(),
          NOW() + INTERVAL '1 hour'
        )
      `,
    ).rejects.toBeDefined();

    const losingConsumerId =
      action.consumerMessageId === firstConsumerId
        ? secondConsumerId
        : firstConsumerId;
    await expect(
      first.$executeRaw`
        INSERT INTO "pending_conversation_actions" (
          "id", "userId", "conversationId", "type", "status",
          "sourceMessageId", "consumerMessageId", "originalIntent", "payload",
          "operationKey", "createdAt", "updatedAt", "expiresAt"
        ) VALUES (
          ${`${suffix}-duplicate-consumer`}, ${userId}, ${conversationId},
          'GOAL_CONFIRMATION', 'COMPLETED', ${losingConsumerId},
          ${action.consumerMessageId}, 'DIET', '{}'::jsonb,
          ${`${suffix}-duplicate-consumer-operation`}, NOW(), NOW(),
          NOW() + INTERVAL '1 hour'
        )
      `,
    ).rejects.toBeDefined();

    const firstClaim = await firstService.claimGoalContinuationExecution({
      userId,
      conversationId,
      actionId: action.id,
      consumerMessageId: action.consumerMessageId ?? '',
      claimedAt: consumerAt,
    });
    if (firstClaim.status !== 'CLAIMED') throw new Error('First claim failed');
    const reclaimedAt = new Date(consumerAt.getTime() + 5 * 60 * 1_000 + 1);
    const secondClaim = await secondService.claimGoalContinuationExecution({
      userId,
      conversationId,
      actionId: action.id,
      consumerMessageId: action.consumerMessageId ?? '',
      claimedAt: reclaimedAt,
    });
    if (secondClaim.status !== 'CLAIMED') throw new Error('Reclaim failed');
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);

    await expect(
      firstService.completeGoalConfirmation({
        userId,
        conversationId,
        actionId: action.id,
        consumerMessageId: action.consumerMessageId ?? '',
        content: 'stale content',
        completedAt: reclaimedAt,
        claimToken: firstClaim.claimToken,
      }),
    ).resolves.toEqual({ status: 'FENCED' });
    await expect(
      secondService.completeGoalConfirmation({
        userId,
        conversationId,
        actionId: action.id,
        consumerMessageId: action.consumerMessageId ?? '',
        content: 'canonical content',
        completedAt: reclaimedAt,
        claimToken: secondClaim.claimToken,
      }),
    ).resolves.toEqual({
      status: 'COMPLETED',
      content: 'canonical content',
    });
    await expect(
      first.pendingConversationAction.findUniqueOrThrow({
        where: { id: action.id },
        select: {
          status: true,
          resultContent: true,
          executionLeaseExpiresAt: true,
          executionClaimToken: true,
        },
      }),
    ).resolves.toEqual({
      status: 'COMPLETED',
      resultContent: 'canonical content',
      executionLeaseExpiresAt: null,
      executionClaimToken: null,
    });
  });
});
