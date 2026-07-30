import { Logger } from '@nestjs/common';
import { MemoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { NutritionConversationEpisodeCaptureCommand } from './nutrition-conversation-episodic-memory-capture.contract';
import type { NutritionConversationEpisodeEvidence } from './nutrition-conversation-episodic-memory.contract';
import { NutritionConversationEpisodicMemoryPersistenceService } from './nutrition-conversation-episodic-memory-persistence.service';

interface StoredMemory {
  id: string;
  userId: string;
  memoryType: MemoryType;
  sourceKey: string;
  content: Prisma.JsonValue;
  summary: string;
  relevanceScore: Prisma.Decimal;
  generatedAt: Date;
}

function evidence(
  continuityKey: string,
  overrides: Partial<NutritionConversationEpisodeEvidence> = {},
): NutritionConversationEpisodeEvidence {
  return {
    category: 'COMMITMENT',
    nature: 'FACT',
    confidence: 'HIGH',
    createdAtLogical: 1_000,
    expiresAtLogical: 10_000,
    importance: 'HIGH',
    source: 'COACH',
    eligibleForConversation: true,
    resumePolicy: 'WHEN_RELEVANT',
    recallPolicy: 'FREE',
    recallReason: 'FOLLOW_UP_DUE',
    continuityKey,
    originEvidence: [
      { code: `EVIDENCE:${continuityKey}`, source: 'COACH', value: true },
    ],
    sensitivity: 'STANDARD',
    confirmation: 'NOT_REQUIRED',
    fact: { commitment: continuityKey },
    relationToContext: 'acompanhamento estruturado',
    ...overrides,
  };
}

function createCommand(
  sourceKey: string,
  item: NutritionConversationEpisodeEvidence,
  operation: NutritionConversationEpisodeCaptureCommand['operation'] = 'CREATE',
): NutritionConversationEpisodeCaptureCommand {
  return {
    operation,
    sourceKey,
    continuityKey: item.continuityKey,
    evidence: item,
    reason: 'STRUCTURED_TEST_EVIDENCE',
  };
}

function createSubject() {
  const rows = new Map<string, StoredMemory>();
  let sequence = 0;
  const key = (identity: {
    userId: string;
    memoryType: MemoryType;
    sourceKey: string;
  }) => `${identity.userId}|${identity.memoryType}|${identity.sourceKey}`;
  const findUnique = jest.fn(
    async (input: {
      where: {
        userId_memoryType_sourceKey: {
          userId: string;
          memoryType: MemoryType;
          sourceKey: string;
        };
      };
    }) => rows.get(key(input.where.userId_memoryType_sourceKey)) ?? null,
  );
  const findMany = jest.fn(
    async (input: {
      where: {
        userId: string;
        memoryType: MemoryType;
        sourceKey: { startsWith: string };
      };
      take: number;
    }) =>
      [...rows.values()]
        .filter(
          (row) =>
            row.userId === input.where.userId &&
            row.memoryType === input.where.memoryType &&
            row.sourceKey.startsWith(input.where.sourceKey.startsWith),
        )
        .sort(
          (left, right) =>
            right.relevanceScore.comparedTo(left.relevanceScore) ||
            right.generatedAt.getTime() - left.generatedAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .slice(0, input.take),
  );
  const upsert = jest.fn(
    async (input: {
      where: {
        userId_memoryType_sourceKey: {
          userId: string;
          memoryType: MemoryType;
          sourceKey: string;
        };
      };
      update: Omit<StoredMemory, 'id' | 'userId' | 'memoryType' | 'sourceKey'>;
      create: Omit<StoredMemory, 'id'>;
    }) => {
      const identity = input.where.userId_memoryType_sourceKey;
      const storageKey = key(identity);
      const current = rows.get(storageKey);
      const row: StoredMemory = current
        ? { ...current, ...input.update }
        : { id: `memory-${++sequence}`, ...input.create };
      rows.set(storageKey, row);
      return row;
    },
  );
  const update = jest.fn(
    async (input: {
      where: {
        userId_memoryType_sourceKey: {
          userId: string;
          memoryType: MemoryType;
          sourceKey: string;
        };
      };
      data: Partial<StoredMemory>;
    }) => {
      const storageKey = key(input.where.userId_memoryType_sourceKey);
      const current = rows.get(storageKey);
      if (!current) throw new Error('Registro não encontrado');
      const row = { ...current, ...input.data };
      rows.set(storageKey, row);
      return row;
    },
  );
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    conversationMemory: { findUnique, findMany, upsert, update },
  };
  const prisma = {
    conversationMemory: { findMany },
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };

  return {
    service: new NutritionConversationEpisodicMemoryPersistenceService(
      prisma as unknown as PrismaService,
    ),
    rows,
    transaction,
    prisma,
    insertRaw(row: StoredMemory) {
      rows.set(
        key({
          userId: row.userId,
          memoryType: row.memoryType,
          sourceKey: row.sourceKey,
        }),
        row,
      );
    },
  };
}

function history(row: StoredMemory): Array<Record<string, unknown>> {
  const content = row.content as Record<string, unknown>;
  return content.history as Array<Record<string, unknown>>;
}

describe('NutritionConversationEpisodicMemoryPersistenceService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates and retries idempotently without duplicate rows or versions', async () => {
    const subject = createSubject();
    const command = createCommand(
      'episodic:v1:commitment',
      evidence('weekly-commitment'),
    );

    await subject.service.applyCaptureCommands(
      'user-1',
      [command],
      new Date(1_000),
    );
    await subject.service.applyCaptureCommands(
      'user-1',
      [command],
      new Date(1_000),
    );

    expect(subject.rows.size).toBe(1);
    expect(history([...subject.rows.values()][0])).toHaveLength(1);
    expect(subject.transaction.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent retries by user and keeps a single episode', async () => {
    const subject = createSubject();
    const command = createCommand(
      'episodic:v1:concurrent',
      evidence('concurrent-commitment'),
    );

    await Promise.all([
      subject.service.applyCaptureCommands(
        'user-1',
        [command],
        new Date(1_000),
      ),
      subject.service.applyCaptureCommands(
        'user-1',
        [command],
        new Date(1_000),
      ),
    ]);

    expect(subject.rows.size).toBe(1);
    expect(history([...subject.rows.values()][0])).toHaveLength(1);
    expect(subject.transaction.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('consolidates repeated structured preferences without row proliferation', async () => {
    const subject = createSubject();
    const sourceKey = 'episodic:v1:preference';
    const preference = evidence('profile:preference:breakfast', {
      category: 'PREFERENCE',
      source: 'USER_CONTEXT',
      expiresAtLogical: undefined,
      fact: { meal: 'BREAKFAST', preference: 'SAVORY' },
      originEvidence: [
        { code: 'PREFERENCE:1', source: 'USER_CONTEXT', value: true },
      ],
    });
    const recurrence = evidence('profile:preference:breakfast', {
      ...preference,
      createdAtLogical: 2_000,
      originEvidence: [
        { code: 'PREFERENCE:2', source: 'USER_CONTEXT', value: true },
      ],
    });

    await subject.service.applyCaptureCommands(
      'user-1',
      [createCommand(sourceKey, preference)],
      new Date(1_000),
    );
    await subject.service.applyCaptureCommands(
      'user-1',
      [createCommand(sourceKey, recurrence, 'UPDATE')],
      new Date(2_000),
    );

    const storedHistory = history([...subject.rows.values()][0]);
    expect(subject.rows.size).toBe(1);
    expect(storedHistory).toEqual([
      expect.objectContaining({ status: 'SUPERSEDED' }),
      expect.objectContaining({
        status: 'ACTIVE',
        lifecycle: expect.objectContaining({ state: 'CONSOLIDATED' }),
      }),
    ]);
    await expect(
      subject.service.selectForContext(
        'user-1',
        {
          relevantCategories: ['PREFERENCE'],
          fatigueScore: 0,
          dialogueProfile: 'CONTINUITY_CHECK',
          limit: 3,
        },
        new Date(3_000),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        category: 'PREFERENCE',
        fact: { meal: 'BREAKFAST', preference: 'SAVORY' },
      }),
    ]);
  });

  it('isolates identical source keys between users and scopes every write by ownership', async () => {
    const subject = createSubject();
    const command = createCommand(
      'episodic:v1:shared-looking-key',
      evidence('shared-continuity'),
    );
    await subject.service.applyCaptureCommands(
      'user-1',
      [command],
      new Date(1_000),
    );
    await subject.service.applyCaptureCommands(
      'user-2',
      [command],
      new Date(1_000),
    );

    expect(subject.rows.size).toBe(2);
    expect(await subject.service.loadCaptureState('user-1')).toHaveLength(1);
    expect(await subject.service.loadCaptureState('user-2')).toHaveLength(1);
    expect(
      subject.transaction.conversationMemory.upsert.mock.calls.every(
        ([input]) =>
          Boolean(
            input.where.userId_memoryType_sourceKey.userId &&
            input.where.userId_memoryType_sourceKey.sourceKey,
          ),
      ),
    ).toBe(true);
  });

  it('supersedes changed facts, completes them and never reactivates terminal history', async () => {
    const subject = createSubject();
    const sourceKey = 'episodic:v1:goal';
    await subject.service.applyCaptureCommands(
      'user-1',
      [
        createCommand(
          sourceKey,
          evidence('profile:goal', {
            category: 'GOAL',
            source: 'USER_CONTEXT',
            fact: { goal: 'WEIGHT_LOSS' },
            originEvidence: [
              { code: 'GOAL:WEIGHT_LOSS', source: 'USER_CONTEXT', value: true },
            ],
          }),
        ),
      ],
      new Date(1_000),
    );
    await subject.service.applyCaptureCommands(
      'user-1',
      [
        createCommand(
          sourceKey,
          evidence('profile:goal', {
            category: 'GOAL',
            source: 'USER_CONTEXT',
            createdAtLogical: 2_000,
            fact: { goal: 'MUSCLE_GAIN' },
            originEvidence: [
              { code: 'GOAL:MUSCLE_GAIN', source: 'USER_CONTEXT', value: true },
            ],
          }),
          'SUPERSEDE',
        ),
      ],
      new Date(2_000),
    );
    await subject.service.applyCaptureCommands(
      'user-1',
      [
        {
          operation: 'COMPLETE',
          sourceKey,
          continuityKey: 'profile:goal',
          lifecycleAction: 'COMPLETE',
          reason: 'GOAL_COMPLETED',
        },
      ],
      new Date(3_000),
    );
    const stored = [...subject.rows.values()][0];

    expect(history(stored).map((item) => item.status)).toEqual([
      'SUPERSEDED',
      'COMPLETED',
    ]);

    await subject.service.applyCaptureCommands(
      'user-1',
      [
        {
          operation: 'COMPLETE',
          sourceKey,
          continuityKey: 'profile:goal',
          lifecycleAction: 'COMPLETE',
          reason: 'RETRY_COMPLETION',
        },
      ],
      new Date(4_000),
    );
    expect(history([...subject.rows.values()][0])[0].status).toBe('SUPERSEDED');
  });

  it.each([
    ['INVALIDATE', 'INVALIDATE', 'INVALIDATED'],
    ['EXPIRE', 'EXPIRE', 'EXPIRED'],
  ] as const)(
    'applies %s lifecycle transitions without deleting history',
    async (operation, lifecycleAction, expectedStatus) => {
      const subject = createSubject();
      const sourceKey = `episodic:v1:${operation.toLowerCase()}`;
      await subject.service.applyCaptureCommands(
        'user-1',
        [createCommand(sourceKey, evidence(operation.toLowerCase()))],
        new Date(1_000),
      );
      await subject.service.applyCaptureCommands(
        'user-1',
        [
          {
            operation,
            sourceKey,
            continuityKey: operation.toLowerCase(),
            lifecycleAction,
            reason: 'STRUCTURED_LIFECYCLE',
          },
        ],
        new Date(2_000),
      );
      expect(history([...subject.rows.values()][0])).toEqual([
        expect.objectContaining({ status: expectedStatus }),
      ]);
    },
  );

  it('expires temporary episodes operationally and excludes them from recall', async () => {
    const subject = createSubject();
    await subject.service.applyCaptureCommands(
      'user-1',
      [
        createCommand(
          'episodic:v1:temporary',
          evidence('temporary', { expiresAtLogical: 1_500 }),
        ),
      ],
      new Date(1_000),
    );
    const selected = await subject.service.selectForContext(
      'user-1',
      {
        relevantCategories: ['COMMITMENT'],
        fatigueScore: 0,
        dialogueProfile: 'CONTINUITY_CHECK',
        limit: 3,
      },
      new Date(2_000),
    );

    expect(selected).toEqual([]);
    expect(history([...subject.rows.values()][0])[0].status).toBe('EXPIRED');
  });

  it('limits reads, ignores legacy and invalid JSON, and tolerates them safely', async () => {
    const subject = createSubject();
    const now = new Date(1_000);
    for (let index = 0; index < 25; index += 1) {
      await subject.service.applyCaptureCommands(
        'user-1',
        [
          createCommand(
            `episodic:v1:item-${index}`,
            evidence(`item-${index}`, {
              category: index % 2 === 0 ? 'HABIT' : 'SUCCESS',
            }),
          ),
        ],
        now,
      );
    }
    subject.insertRaw({
      id: 'legacy',
      userId: 'user-1',
      memoryType: MemoryType.SHORT_TERM,
      sourceKey: 'episodic:v1:legacy',
      content: { oldShape: true },
      summary: 'legacy',
      relevanceScore: new Prisma.Decimal('1.0000'),
      generatedAt: now,
    });
    subject.insertRaw({
      id: 'invalid',
      userId: 'user-1',
      memoryType: MemoryType.SHORT_TERM,
      sourceKey: 'episodic:v1:invalid',
      content: { schema: 'NUTRITION_EPISODIC_MEMORY', schemaVersion: 1 },
      summary: 'invalid',
      relevanceScore: new Prisma.Decimal('1.0000'),
      generatedAt: now,
    });

    const selected = await subject.service.selectForContext(
      'user-1',
      {
        relevantCategories: ['HABIT', 'SUCCESS'],
        fatigueScore: 0,
        dialogueProfile: 'ACKNOWLEDGE_ONLY',
        limit: 3,
      },
      now,
    );

    expect(selected.length).toBeLessThanOrEqual(3);
    expect(
      subject.transaction.conversationMemory.findMany.mock.calls.at(-1)?.[0]
        .take,
    ).toBe(20);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('uses recall metadata to avoid immediate reuse when another relevant episode exists', async () => {
    const subject = createSubject();
    await subject.service.applyCaptureCommands(
      'user-1',
      [
        createCommand(
          'episodic:v1:success',
          evidence('success', { category: 'SUCCESS', fact: 'vitória' }),
        ),
        createCommand(
          'episodic:v1:difficulty',
          evidence('difficulty', {
            category: 'DIFFICULTY',
            fact: 'dificuldade',
          }),
        ),
      ],
      new Date(1_000),
    );
    const selection = {
      relevantCategories: ['SUCCESS', 'DIFFICULTY'] as const,
      fatigueScore: 0,
      dialogueProfile: 'CONTINUITY_CHECK' as const,
      limit: 1,
    };
    const first = await subject.service.selectForContext(
      'user-1',
      selection,
      new Date(2_000),
    );
    const second = await subject.service.selectForContext(
      'user-1',
      selection,
      new Date(3_000),
    );

    expect(second[0].continuityKey).not.toBe(first[0].continuityKey);
  });

  it('performs no write for NO_OP commands', async () => {
    const subject = createSubject();
    await subject.service.applyCaptureCommands(
      'user-1',
      [
        {
          operation: 'NO_OP',
          sourceKey: 'episodic:v1:no-op',
          continuityKey: 'no-op',
          reason: 'ALREADY_CAPTURED',
        },
      ],
      new Date(1_000),
    );
    expect(subject.prisma.$transaction).not.toHaveBeenCalled();
    expect(subject.rows.size).toBe(0);
  });
});
