import { ConflictException } from '@nestjs/common';
import {
  NutritionShadowRuntimeDecisionType,
  NutritionShadowRuntimeSkipReason,
  PrismaClient,
} from '@prisma/client';
import { PrismaNutritionShadowRuntimeDecisionGateway } from './prisma-nutrition-shadow-runtime-decision.gateway';

const databaseUrl =
  process.env.NUTRITION_SHADOW_RUNTIME_EVIDENCE_INTEGRATION_DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('Nutrition Shadow Runtime decision persistence', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: safeDatabaseUrl } },
  });
  const gateway = new PrismaNutritionShadowRuntimeDecisionGateway(prisma);
  let officialCounts: readonly [number, number, number];

  beforeEach(async () => {
    await prisma.nutritionShadowComparison.deleteMany();
    await prisma.nutritionShadowRuntimeDecision.deleteMany();
    await prisma.nutritionShadowRun.deleteMany();
    officialCounts = await Promise.all([
      prisma.aIJob.count(),
      prisma.nutritionPlanV2.count(),
      prisma.nutritionConversationalArtifact.count(),
    ]);
  });

  afterEach(async () => {
    await expect(
      Promise.all([
        prisma.aIJob.count(),
        prisma.nutritionPlanV2.count(),
        prisma.nutritionConversationalArtifact.count(),
      ]),
    ).resolves.toEqual(officialCounts);
  });

  afterAll(async () => prisma.$disconnect());

  const claimInput = (
    fingerprint = 'fingerprint',
    ownershipToken = 'ownership-token',
  ) => ({
    id: 'runtime-decision-id',
    operationKey: 'runtime-decision-operation',
    inputFingerprint: fingerprint,
    userId: 'shadow-user',
    conversationId: 'conversation-id',
    messageId: 'message-id',
    correlationId: 'correlation-id',
    traceId: null,
    conversationGoal: 'GENERAL_GUIDANCE' as const,
    ownershipToken,
  });

  it('persists SKIPPED without a run and protects terminal evidence', async () => {
    const claimed = await gateway.claim(claimInput());
    expect(claimed.kind).toBe('OWNERSHIP_CREATED');
    expect(claimed.decision.decision).toBe(
      NutritionShadowRuntimeDecisionType.PENDING,
    );
    if (claimed.kind !== 'OWNERSHIP_CREATED') throw new Error('claim inválido');

    const skipped = await gateway.completeSkipped(
      claimed.decision.id,
      claimed.ownership.token,
      NutritionShadowRuntimeSkipReason.DISABLED_BY_POLICY,
    );
    expect(skipped).toMatchObject({
      decision: NutritionShadowRuntimeDecisionType.SKIPPED,
      skipReason: NutritionShadowRuntimeSkipReason.DISABLED_BY_POLICY,
      shadowRunId: null,
      conversationGoal: 'GENERAL_GUIDANCE',
    });
    await expect(gateway.claim(claimInput())).resolves.toMatchObject({
      kind: 'TERMINAL_REUSED',
    });
    await expect(
      prisma.nutritionShadowRuntimeDecision.update({
        where: { id: claimed.decision.id },
        data: { correlationId: 'mutated' },
      }),
    ).rejects.toThrow('Terminal NutritionShadowRuntimeDecision is immutable');
  });

  it('persists STARTED only with the actual run and original goal', async () => {
    const run = await prisma.nutritionShadowRun.create({
      data: {
        operationKey: 'shadow-run-operation',
        inputFingerprint: 'shadow-run-fingerprint',
        correlationId: 'correlation-id',
        userId: 'shadow-user',
        conversationGoal: 'GENERAL_GUIDANCE',
      },
    });
    const claimed = await gateway.claim(claimInput());
    if (claimed.kind !== 'OWNERSHIP_CREATED') throw new Error('claim inválido');

    await expect(
      gateway.completeStarted(
        'runtime-decision-id',
        claimed.ownership.token,
        run.id,
      ),
    ).resolves.toMatchObject({
      decision: NutritionShadowRuntimeDecisionType.STARTED,
      shadowRunId: run.id,
      skipReason: null,
      conversationGoal: 'GENERAL_GUIDANCE',
    });
  });

  it('serializes claims, reuses identity and exposes fingerprint conflicts', async () => {
    const attempts = await Promise.all([
      gateway.claim(claimInput('fingerprint', 'ownership-token-a')),
      gateway.claim(claimInput('fingerprint', 'ownership-token-b')),
    ]);
    expect(
      attempts.filter((attempt) => attempt.kind === 'OWNERSHIP_CREATED'),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.kind === 'OWNERSHIP_ACTIVE'),
    ).toHaveLength(1);
    expect(await prisma.nutritionShadowRuntimeDecision.count()).toBe(1);
    await expect(gateway.claim(claimInput('different'))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recovers an expired ownership atomically and rejects the previous owner', async () => {
    const original = await gateway.claim(
      claimInput('fingerprint', 'ownership-token-original'),
    );
    if (original.kind !== 'OWNERSHIP_CREATED')
      throw new Error('ownership original não criada');
    const expiredClaimedAt = new Date(Date.now() - 120_000);
    const expiredAt = new Date(Date.now() - 60_000);
    await prisma.nutritionShadowRuntimeDecision.update({
      where: { id: original.decision.id },
      data: {
        ownershipClaimedAt: expiredClaimedAt,
        ownershipExpiresAt: expiredAt,
      },
    });

    const attempts = await Promise.all([
      gateway.claim(claimInput('fingerprint', 'ownership-token-reclaimer-a')),
      gateway.claim(claimInput('fingerprint', 'ownership-token-reclaimer-b')),
    ]);
    const recovered = attempts.find(
      (attempt) => attempt.kind === 'OWNERSHIP_RECOVERED',
    );
    expect(recovered?.kind).toBe('OWNERSHIP_RECOVERED');
    expect(
      attempts.filter((attempt) => attempt.kind === 'OWNERSHIP_ACTIVE'),
    ).toHaveLength(1);
    if (!recovered || recovered.kind !== 'OWNERSHIP_RECOVERED')
      throw new Error('ownership expirada não recuperada');

    const run = await prisma.nutritionShadowRun.create({
      data: {
        operationKey: 'shadow-run-recovered-operation',
        inputFingerprint: 'shadow-run-recovered-fingerprint',
        correlationId: 'correlation-id',
        userId: 'shadow-user',
        conversationGoal: 'GENERAL_GUIDANCE',
      },
    });
    await expect(
      gateway.completeStarted(
        original.decision.id,
        original.ownership.token,
        run.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      gateway.completeStarted(
        recovered.decision.id,
        recovered.ownership.token,
        run.id,
      ),
    ).resolves.toMatchObject({
      decision: NutritionShadowRuntimeDecisionType.STARTED,
      shadowRunId: run.id,
      ownershipClaimedAt: expect.any(Date),
      ownershipExpiresAt: expect.any(Date),
    });
  });

  it('does not allow an expired owner to finalize before reclaim', async () => {
    const claimed = await gateway.claim(
      claimInput('fingerprint', 'ownership-token-expired'),
    );
    if (claimed.kind !== 'OWNERSHIP_CREATED') throw new Error('claim inválido');
    await prisma.nutritionShadowRuntimeDecision.update({
      where: { id: claimed.decision.id },
      data: {
        ownershipClaimedAt: new Date(Date.now() - 120_000),
        ownershipExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    const run = await prisma.nutritionShadowRun.create({
      data: {
        operationKey: 'expired-owner-run',
        inputFingerprint: 'expired-owner-run-fingerprint',
        correlationId: 'correlation-id',
        userId: 'shadow-user',
        conversationGoal: 'GENERAL_GUIDANCE',
      },
    });

    await expect(
      gateway.completeStarted(
        claimed.decision.id,
        claimed.ownership.token,
        run.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      prisma.nutritionShadowRuntimeDecision.findUniqueOrThrow({
        where: { id: claimed.decision.id },
      }),
    ).resolves.toMatchObject({
      decision: NutritionShadowRuntimeDecisionType.PENDING,
      shadowRunId: null,
    });
  });

  it.each([
    NutritionShadowRuntimeDecisionType.STARTED,
    NutritionShadowRuntimeDecisionType.SKIPPED,
  ])('never reclaims a terminal %s decision', async (terminalDecision) => {
    const claimed = await gateway.claim(
      claimInput('fingerprint', `ownership-${terminalDecision}`),
    );
    if (claimed.kind !== 'OWNERSHIP_CREATED') throw new Error('claim inválido');
    if (terminalDecision === NutritionShadowRuntimeDecisionType.STARTED) {
      const run = await prisma.nutritionShadowRun.create({
        data: {
          operationKey: `terminal-run-${terminalDecision}`,
          inputFingerprint: 'terminal-run-fingerprint',
          correlationId: 'correlation-id',
          userId: 'shadow-user',
          conversationGoal: 'GENERAL_GUIDANCE',
        },
      });
      await gateway.completeStarted(
        claimed.decision.id,
        claimed.ownership.token,
        run.id,
      );
    } else {
      await gateway.completeSkipped(
        claimed.decision.id,
        claimed.ownership.token,
        NutritionShadowRuntimeSkipReason.DISABLED_BY_POLICY,
      );
    }

    await expect(
      gateway.claim(
        claimInput('fingerprint', `replacement-${terminalDecision}`),
      ),
    ).resolves.toMatchObject({ kind: 'TERMINAL_REUSED' });
  });

  it('rejects invalid state combinations and unknown goals at the database boundary', async () => {
    await expect(
      prisma.nutritionShadowRuntimeDecision.create({
        data: {
          ...claimInput(),
          id: 'invalid-state',
          operationKey: 'invalid-state-operation',
          decision: NutritionShadowRuntimeDecisionType.SKIPPED,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.nutritionShadowRun.create({
        data: {
          operationKey: 'missing-goal-run',
          inputFingerprint: 'fingerprint',
          correlationId: 'correlation',
          userId: 'user',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`
        INSERT INTO "nutrition_shadow_runtime_decisions" (
          "id", "operationKey", "inputFingerprint", "userId",
          "correlationId", "conversationGoal", "decision"
        ) VALUES (
          'invalid-goal', 'invalid-goal-operation', 'fingerprint', 'user',
          'correlation', 'NOT_A_GOAL', 'PENDING'
        )
      `,
    ).rejects.toThrow();
  });
});
