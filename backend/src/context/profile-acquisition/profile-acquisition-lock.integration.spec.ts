import { ConfigService } from '@nestjs/config';
import {
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
  CoachProfileValueSource,
  CoachProfileValueStatus,
  PrismaClient,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import { CoachProfileMutationService } from './coach-profile-mutation.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';

const databaseUrl = process.env.PROFILE_ACQUISITION_INTEGRATION_DATABASE_URL;
const safeDatabaseUrl =
  databaseUrl ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled';
const describeIntegration = databaseUrl ? describe : describe.skip;

function deferred(): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}> {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return Object.freeze({ promise, resolve });
}

describeIntegration('Profile acquisition advisory lock integration', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: safeDatabaseUrl } },
  });
  const operationalConfig = new ProfileAcquisitionOperationalConfigService(
    new ConfigService({ PROFILE_ACQUISITION_MODE: 'INTERNAL' }),
  );
  const mutations = new CoachProfileMutationService(
    prisma as unknown as PrismaService,
    new CoachProfileFieldRegistryService(),
    operationalConfig,
  );
  const userId = 'profile-acquisition-lock-integration-user';

  beforeAll(async () => prisma.$connect());
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({
      data: { id: userId, phone: '+5511999990002' },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('keeps the blocking advisory lock scoped to the transaction', async () => {
    const acquired = deferred();
    const release = deferred();
    const lockKey = 'profile-acquisition-lock-scope-test';
    const holder = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        WITH advisory_lock AS (
          SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
        )
        SELECT true AS "locked"
        FROM advisory_lock
      `;
      acquired.resolve();
      await release.promise;
    });

    await acquired.promise;
    const [during] = await prisma.$transaction(
      (transaction) =>
        transaction.$queryRaw<readonly { readonly locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS "locked"
      `,
    );
    expect(during?.locked).toBe(false);

    release.resolve();
    await holder;
    const [after] = await prisma.$transaction(
      (transaction) =>
        transaction.$queryRaw<readonly { readonly locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS "locked"
      `,
    );
    expect(after?.locked).toBe(true);
  });

  it('persists a real value once and serializes an idempotent concurrent retry', async () => {
    const command = Object.freeze({
      action: 'SET' as const,
      userId,
      field: CoachProfileAcquisitionField.ALLERGIES,
      value: Object.freeze([]),
      source: CoachProfileValueSource.USER_CONFIRMED,
      confirmation: CoachProfileConfirmationState.CONFIRMED,
      status: CoachProfileValueStatus.CONFIRMED,
      referenceDate: '2026-08-08T12:00:00.000Z',
      operationKey: 'profile-acquisition-lock-integration-operation',
      reason: 'CONFIRMED_ABSENCE' as const,
      definitionVersion: 1,
    });

    const results = await Promise.all([
      mutations.execute(command),
      mutations.execute(command),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      'CREATED',
      'DUPLICATE',
    ]);
    await expect(
      prisma.coachProfileFieldValue.findMany({
        where: { userId, field: CoachProfileAcquisitionField.ALLERGIES },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        status: CoachProfileValueStatus.CONFIRMED,
        textListValue: [],
        isActive: true,
      }),
    ]);
  });
});
