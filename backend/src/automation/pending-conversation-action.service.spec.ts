import {
  FitnessGoal,
  PendingConversationActionStatus,
  PendingConversationActionType,
  UserGoalType,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { CurrentGoalCommitService } from './current-goal-commit.service';
import { GOAL_CONFIRMATION_ALLOWED_GOALS } from './pending-conversation-action.contract';
import { PendingConversationActionService } from './pending-conversation-action.service';
import { UserGoalEngineService } from './user-goal-engine.service';

describe('PendingConversationActionService', () => {
  const sourceAt = new Date('2026-08-12T12:00:00.000Z');
  const consumerAt = new Date('2026-08-12T12:01:00.000Z');
  const originalMessage =
    'Quero perder gordura e ganhar massa muscular. Monte uma dieta para mim com 4 refeições por dia.';

  function payload() {
    return {
      schemaVersion: 1,
      declaredOutcome: 'perder gordura e ganhar massa muscular',
      allowedGoals: [...GOAL_CONFIRMATION_ALLOWED_GOALS],
      originalIntent: 'DIET',
      targetPlan: 'DIET',
      originalMessage,
      originalReferenceDate: sourceAt.toISOString(),
      desiredMealCount: 4,
      resolvedGoal: null,
      selectedRoute: null,
    };
  }

  function setup(options?: {
    expiresAt?: Date;
    status?: PendingConversationActionStatus;
  }) {
    let action = {
      id: 'action-id',
      userId: 'user-id',
      conversationId: 'conversation-id',
      type: PendingConversationActionType.GOAL_CONFIRMATION,
      status: options?.status ?? PendingConversationActionStatus.PENDING,
      sourceMessageId: 'source-message-id',
      consumerMessageId: null as string | null,
      originalIntent: 'DIET' as const,
      payload: payload(),
      operationKey: 'pending-goal-confirmation:source-message-id',
      createdAt: sourceAt,
      updatedAt: sourceAt,
      expiresAt: options?.expiresAt ?? new Date('2026-08-13T12:00:00.000Z'),
      consumedAt: null as Date | null,
      promptActivatedAt: sourceAt,
      completedAt: null as Date | null,
      resultContent: null as string | null,
      executionLeaseExpiresAt: null as Date | null,
      executionClaimToken: null as string | null,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      pendingConversationAction: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            ...action,
            sourceMessage: { timestamp: sourceAt },
          }),
        ),
        findFirst: jest.fn(() =>
          Promise.resolve({
            ...action,
            sourceMessage: { timestamp: sourceAt },
          }),
        ),
        create: jest.fn().mockImplementation(({ data }: { data: object }) => {
          action = {
            ...action,
            payload: Reflect.get(data, 'payload'),
          };
          return Promise.resolve(action);
        }),
        update: jest.fn().mockImplementation(({ data }: { data: object }) => {
          const status = Reflect.get(data, 'status');
          const consumerMessageId = Reflect.get(data, 'consumerMessageId');
          const consumedAt = Reflect.get(data, 'consumedAt');
          const payloadValue = Reflect.get(data, 'payload');
          const resultContent = Reflect.get(data, 'resultContent');
          const completedAt = Reflect.get(data, 'completedAt');
          const executionLeaseExpiresAt = Reflect.get(
            data,
            'executionLeaseExpiresAt',
          );
          const executionClaimToken = Reflect.get(data, 'executionClaimToken');
          action = {
            ...action,
            status:
              typeof status === 'string'
                ? (status as PendingConversationActionStatus)
                : action.status,
            consumerMessageId:
              typeof consumerMessageId === 'string'
                ? consumerMessageId
                : action.consumerMessageId,
            consumedAt:
              consumedAt instanceof Date ? consumedAt : action.consumedAt,
            payload:
              payloadValue && typeof payloadValue === 'object'
                ? payloadValue
                : action.payload,
            resultContent:
              typeof resultContent === 'string'
                ? resultContent
                : action.resultContent,
            completedAt:
              completedAt instanceof Date ? completedAt : action.completedAt,
            executionLeaseExpiresAt:
              executionLeaseExpiresAt instanceof Date
                ? executionLeaseExpiresAt
                : executionLeaseExpiresAt === null
                  ? null
                  : action.executionLeaseExpiresAt,
            executionClaimToken:
              typeof executionClaimToken === 'string'
                ? executionClaimToken
                : executionClaimToken === null
                  ? null
                  : action.executionClaimToken,
          };
          return Promise.resolve(action);
        }),
        updateMany: jest
          .fn()
          .mockImplementation(({ data }: { data: object }) => {
            const status = Reflect.get(data, 'status');
            if (typeof status === 'string') {
              action = {
                ...action,
                status: status as PendingConversationActionStatus,
              };
            }
            return Promise.resolve({ count: 1 });
          }),
      },
      userGoalClassification: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'classification-id' }),
      },
      fitnessProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      nutritionProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    let transactionTail: Promise<void> = Promise.resolve();
    const prisma = {
      $transaction: jest.fn(
        <T>(callback: (client: typeof transaction) => Promise<T>) => {
          const run = transactionTail.then(() => callback(transaction));
          transactionTail = run.then(
            () => undefined,
            () => undefined,
          );
          return run;
        },
      ),
    };
    const goalCommit = new CurrentGoalCommitService(
      prisma as unknown as PrismaService,
    );
    const service = new PendingConversationActionService(
      prisma as unknown as PrismaService,
      new UserGoalEngineService(),
      goalCommit,
    );
    return { service, transaction, action: () => action };
  }

  const routeSelection = Object.freeze({
    nutrition: 'V2' as const,
    workout: null,
    reason: 'NUTRITION_V2_ELIGIBLE' as const,
    nutritionPilotStatus: 'ELIGIBLE' as const,
    suppressNutritionShadow: true,
  });

  it('resolves only authorized goal alternatives and preserves the original request', async () => {
    const test = setup();
    const resolved = await test.service.findPendingForInbound({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      text: 'Quero emagrecer',
      receivedAt: consumerAt,
    });

    expect(resolved).toMatchObject({
      status: 'ACTIONABLE',
      context: {
        originalIntent: 'DIET',
        payload: {
          desiredMealCount: 4,
          originalMessage: expect.stringContaining('4 refeições por dia'),
        },
        resolution: {
          status: 'RESOLVED',
          primaryGoal: FitnessGoal.WEIGHT_LOSS,
        },
      },
    });
  });

  it.each([
    ['Quero emagrecer', FitnessGoal.WEIGHT_LOSS],
    ['Quero ganhar massa', FitnessGoal.MUSCLE_GAIN],
    ['Quero manter', FitnessGoal.MAINTENANCE],
  ] as const)('maps "%s" to %s', async (text, goal) => {
    const test = setup();
    const resolved = await test.service.findPendingForInbound({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      text,
      receivedAt: consumerAt,
    });
    expect(resolved).toMatchObject({
      status: 'ACTIONABLE',
      context: { resolution: { primaryGoal: goal } },
    });
  });

  it('keeps an ambiguous action pending without committing a goal', async () => {
    const test = setup();
    const resolved = await test.service.findPendingForInbound({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      text: 'Não sei, talvez emagrecer ou ganhar massa',
      receivedAt: consumerAt,
    });

    expect(resolved).toMatchObject({
      status: 'ACTIONABLE',
      context: { resolution: { status: 'REQUIRES_CONFIRMATION' } },
    });
    expect(test.action().status).toBe(PendingConversationActionStatus.PENDING);
    expect(
      test.transaction.userGoalClassification.upsert,
    ).not.toHaveBeenCalled();
  });

  it('does not consume an unrelated profile-acquisition answer', async () => {
    const test = setup();
    await expect(
      test.service.findPendingForInbound({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'consumer-message-id',
        text: 'Tenho 1,78 m de altura',
        receivedAt: consumerAt,
      }),
    ).resolves.toEqual({ status: 'UNRELATED' });
    expect(test.action().status).toBe(PendingConversationActionStatus.PENDING);
  });

  it('commits the canonical goal and consumes the action in one transaction', async () => {
    const test = setup();
    const found = await test.service.findPendingForInbound({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      text: 'Quero emagrecer',
      receivedAt: consumerAt,
    });
    if (found.status !== 'ACTIONABLE') throw new Error('Action not found');

    await expect(
      test.service.consumeGoalConfirmation({
        userId: 'user-id',
        conversationId: 'conversation-id',
        consumerMessageId: 'consumer-message-id',
        referenceDate: consumerAt,
        context: found.context,
        routeSelection,
      }),
    ).resolves.toBe('APPLIED');

    expect(test.transaction.fitnessProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      data: { goal: FitnessGoal.WEIGHT_LOSS },
    });
    expect(test.transaction.userGoalClassification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          goal: UserGoalType.WEIGHT_LOSS,
          evidence: expect.objectContaining({
            operationKey: 'consumer-message-id',
          }),
        }),
      }),
    );
    expect(test.action()).toMatchObject({
      status: PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION,
      consumerMessageId: 'consumer-message-id',
      consumedAt: consumerAt,
    });
  });

  it('fences replay and concurrent consumers so only one canonical commit wins', async () => {
    const test = setup();
    const found = await test.service.findPendingForInbound({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'consumer-a',
      text: 'Quero emagrecer',
      receivedAt: consumerAt,
    });
    if (found.status !== 'ACTIONABLE') throw new Error('Action not found');
    const input = {
      userId: 'user-id',
      conversationId: 'conversation-id',
      referenceDate: consumerAt,
      context: found.context,
      routeSelection,
    };

    const [first, second] = await Promise.all([
      test.service.consumeGoalConfirmation({
        ...input,
        consumerMessageId: 'consumer-a',
      }),
      test.service.consumeGoalConfirmation({
        ...input,
        consumerMessageId: 'consumer-b',
      }),
    ]);
    expect([first, second].sort()).toEqual(['ALREADY_CONSUMED', 'APPLIED']);
    expect(
      test.transaction.userGoalClassification.upsert,
    ).toHaveBeenCalledTimes(1);

    await expect(
      test.service.consumeGoalConfirmation({
        ...input,
        consumerMessageId: test.action().consumerMessageId ?? '',
      }),
    ).resolves.toBe('CONTINUE');
    expect(
      test.transaction.userGoalClassification.upsert,
    ).toHaveBeenCalledTimes(1);

    await expect(
      test.service.findPendingForInbound({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'consumer-b-after-completion',
        text: 'Agora quero ganhar massa',
        receivedAt: new Date(consumerAt.getTime() + 1_000),
      }),
    ).resolves.toEqual({ status: 'NONE' });
  });

  it('does not expose an action before its prompt enters the official pipeline', async () => {
    const test = setup({
      status: PendingConversationActionStatus.AWAITING_PROMPT,
    });
    await expect(
      test.service.findPendingForInbound({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'consumer-message-id',
        text: 'Quero emagrecer',
        receivedAt: consumerAt,
      }),
    ).resolves.toEqual({ status: 'NONE' });
    expect(
      test.transaction.userGoalClassification.upsert,
    ).not.toHaveBeenCalled();
  });

  it('promotes an awaiting action only after official pipeline registration', async () => {
    const test = setup({
      status: PendingConversationActionStatus.AWAITING_PROMPT,
    });
    await test.service.activateGoalConfirmationForSource({
      userId: 'user-id',
      conversationId: 'conversation-id',
      sourceMessageId: 'source-message-id',
      activatedAt: sourceAt,
    });
    expect(test.action().status).toBe(PendingConversationActionStatus.PENDING);
  });

  it('recovers a consumed continuation and becomes replay-safe after completion', async () => {
    const test = setup();
    const found = await test.service.findPendingForInbound({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      text: 'Quero emagrecer',
      receivedAt: consumerAt,
    });
    if (found.status !== 'ACTIONABLE') throw new Error('Action not found');
    await test.service.consumeGoalConfirmation({
      userId: 'user-id',
      conversationId: 'conversation-id',
      consumerMessageId: 'consumer-message-id',
      referenceDate: consumerAt,
      context: found.context,
      routeSelection,
    });

    const retry = await test.service.findPendingForInbound({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'consumer-message-id',
      text: 'Quero emagrecer',
      receivedAt: consumerAt,
    });
    expect(retry).toMatchObject({
      status: 'ACTIONABLE',
      context: {
        continuation: true,
        payload: { selectedRoute: routeSelection },
      },
    });

    const claim = await test.service.claimGoalContinuationExecution({
      userId: 'user-id',
      conversationId: 'conversation-id',
      actionId: 'action-id',
      consumerMessageId: 'consumer-message-id',
      claimedAt: new Date('2026-08-12T12:01:30.000Z'),
    });
    if (claim.status !== 'CLAIMED') throw new Error('Execution not claimed');

    await test.service.completeGoalConfirmation({
      userId: 'user-id',
      conversationId: 'conversation-id',
      actionId: 'action-id',
      consumerMessageId: 'consumer-message-id',
      content: 'plano oficial',
      completedAt: new Date('2026-08-12T12:02:00.000Z'),
      claimToken: claim.claimToken,
    });
    await expect(
      test.service.findPendingForInbound({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'consumer-message-id',
        text: 'Quero emagrecer',
        receivedAt: new Date('2026-08-12T12:03:00.000Z'),
      }),
    ).resolves.toEqual({
      status: 'COMPLETED',
      intent: 'DIET',
      content: 'plano oficial',
    });
    expect(
      test.transaction.userGoalClassification.upsert,
    ).toHaveBeenCalledTimes(1);
  });

  it('grants only one continuation execution lease to concurrent retries', async () => {
    const test = setup({
      status: PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION,
    });
    test.action().consumerMessageId = 'consumer-message-id';

    const claims = await Promise.all([
      test.service.claimGoalContinuationExecution({
        userId: 'user-id',
        conversationId: 'conversation-id',
        actionId: 'action-id',
        consumerMessageId: 'consumer-message-id',
        claimedAt: consumerAt,
      }),
      test.service.claimGoalContinuationExecution({
        userId: 'user-id',
        conversationId: 'conversation-id',
        actionId: 'action-id',
        consumerMessageId: 'consumer-message-id',
        claimedAt: consumerAt,
      }),
    ]);

    expect(claims.map((claim) => claim.status).sort()).toEqual([
      'CLAIMED',
      'IN_PROGRESS',
    ]);
  });

  it('fences a stale claimant after lease reclaim and persists only the new result', async () => {
    const test = setup({
      status: PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION,
    });
    test.action().consumerMessageId = 'consumer-message-id';
    const first = await test.service.claimGoalContinuationExecution({
      userId: 'user-id',
      conversationId: 'conversation-id',
      actionId: 'action-id',
      consumerMessageId: 'consumer-message-id',
      claimedAt: consumerAt,
    });
    if (first.status !== 'CLAIMED') throw new Error('First claim failed');

    const second = await test.service.claimGoalContinuationExecution({
      userId: 'user-id',
      conversationId: 'conversation-id',
      actionId: 'action-id',
      consumerMessageId: 'consumer-message-id',
      claimedAt: new Date(consumerAt.getTime() + 5 * 60 * 1_000 + 1),
    });
    if (second.status !== 'CLAIMED') throw new Error('Reclaim failed');
    expect(second.claimToken).not.toBe(first.claimToken);
    const reclaimedAt = new Date(consumerAt.getTime() + 5 * 60 * 1_000 + 1);

    await expect(
      test.service.completeGoalConfirmation({
        userId: 'user-id',
        conversationId: 'conversation-id',
        actionId: 'action-id',
        consumerMessageId: 'consumer-message-id',
        content: 'conteúdo A',
        completedAt: reclaimedAt,
        claimToken: first.claimToken,
      }),
    ).resolves.toEqual({ status: 'FENCED' });
    await expect(
      test.service.completeGoalConfirmation({
        userId: 'user-id',
        conversationId: 'conversation-id',
        actionId: 'action-id',
        consumerMessageId: 'consumer-message-id',
        content: 'conteúdo B',
        completedAt: reclaimedAt,
        claimToken: second.claimToken,
      }),
    ).resolves.toEqual({ status: 'COMPLETED', content: 'conteúdo B' });
    expect(test.action().resultContent).toBe('conteúdo B');
  });

  it('releases only the active claim after a transient execution failure', async () => {
    const test = setup({
      status: PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION,
    });
    test.action().consumerMessageId = 'consumer-message-id';
    const claim = await test.service.claimGoalContinuationExecution({
      userId: 'user-id',
      conversationId: 'conversation-id',
      actionId: 'action-id',
      consumerMessageId: 'consumer-message-id',
      claimedAt: consumerAt,
    });
    if (claim.status !== 'CLAIMED') throw new Error('Claim failed');

    await expect(
      test.service.releaseGoalContinuationExecution({
        userId: 'user-id',
        conversationId: 'conversation-id',
        actionId: 'action-id',
        consumerMessageId: 'consumer-message-id',
        claimToken: claim.claimToken,
      }),
    ).resolves.toBe('RELEASED');
    expect(test.action()).toMatchObject({
      status: PendingConversationActionStatus.CONSUMED_PENDING_EXECUTION,
      executionLeaseExpiresAt: null,
      executionClaimToken: null,
      completedAt: null,
      resultContent: null,
    });

    await expect(
      test.service.releaseGoalContinuationExecution({
        userId: 'user-id',
        conversationId: 'conversation-id',
        actionId: 'action-id',
        consumerMessageId: 'consumer-message-id',
        claimToken: claim.claimToken,
      }),
    ).resolves.toBe('FENCED');
  });

  it('expires an overdue action without consuming or committing it', async () => {
    const test = setup({
      expiresAt: new Date('2026-08-12T11:59:00.000Z'),
    });
    await expect(
      test.service.findPendingForInbound({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'consumer-message-id',
        text: 'Quero emagrecer',
        receivedAt: consumerAt,
      }),
    ).resolves.toEqual({ status: 'EXPIRED' });
    expect(test.action().status).toBe(PendingConversationActionStatus.EXPIRED);
    expect(
      test.transaction.userGoalClassification.upsert,
    ).not.toHaveBeenCalled();
  });

  it('rejects an out-of-order inbound message without consuming the action', async () => {
    const test = setup();
    await expect(
      test.service.findPendingForInbound({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'old-message-id',
        text: 'Quero emagrecer',
        receivedAt: sourceAt,
      }),
    ).resolves.toEqual({ status: 'UNRELATED' });
    expect(test.action().status).toBe(PendingConversationActionStatus.PENDING);
    expect(
      test.transaction.userGoalClassification.upsert,
    ).not.toHaveBeenCalled();
  });

  it('cancels an older pending confirmation before creating a newer one', async () => {
    const oldAction = {
      id: 'old-action-id',
      operationKey: 'pending-goal-confirmation:old-message-id',
      payload: payload(),
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      pendingConversationAction: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(oldAction),
        update: jest.fn().mockResolvedValue({
          ...oldAction,
          status: PendingConversationActionStatus.CANCELLED,
        }),
        create: jest.fn().mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({
            id: 'new-action-id',
            operationKey: Reflect.get(data, 'operationKey'),
          }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const prismaService = prisma as unknown as PrismaService;
    const service = new PendingConversationActionService(
      prismaService,
      new UserGoalEngineService(),
      new CurrentGoalCommitService(prismaService),
    );

    const created = await service.createGoalConfirmation({
      userId: 'user-id',
      conversationId: 'conversation-id',
      sourceMessageId: 'new-message-id',
      originalIntent: 'DIET',
      originalMessage,
      referenceDate: new Date('2026-08-12T13:00:00.000Z'),
      declaredOutcome: 'objetivo composto',
    });

    expect(transaction.pendingConversationAction.update).toHaveBeenCalledWith({
      where: { id: 'old-action-id' },
      data: { status: PendingConversationActionStatus.CANCELLED },
    });
    expect(transaction.pendingConversationAction.create).toHaveBeenCalledTimes(
      1,
    );
    expect(created).toMatchObject({
      actionId: 'new-action-id',
      operationKey: 'pending-goal-confirmation:new-message-id',
      payload: { desiredMealCount: 4 },
    });
  });

  it('replays the same source operation without creating a duplicate action', async () => {
    const test = setup();
    const replay = await test.service.createGoalConfirmation({
      userId: 'user-id',
      conversationId: 'conversation-id',
      sourceMessageId: 'source-message-id',
      originalIntent: 'DIET',
      originalMessage,
      referenceDate: sourceAt,
      declaredOutcome: 'objetivo composto',
    });

    expect(replay.actionId).toBe('action-id');
    expect(
      test.transaction.pendingConversationAction.create,
    ).not.toHaveBeenCalled();
  });
});
