import { ConflictException } from '@nestjs/common';
import { NutritionPlanImplementation, type Prisma } from '@prisma/client';
import type { AuditService } from '../../observability/audit.service';
import type { NutritionPlanOwnershipRepository } from './nutrition-plan-ownership.repository';
import { NutritionPlanOwnershipService } from './nutrition-plan-ownership.service';

describe('NutritionPlanOwnershipService', () => {
  const transaction = {} as Prisma.TransactionClient;
  const target = {
    userId: 'user-id',
    profileId: 'profile-id',
    implementation: NutritionPlanImplementation.V2,
    planId: 'plan-id',
    aiJobId: 'job-id',
  } as const;
  const ownership = {
    id: 'ownership-id',
    userId: target.userId,
    profileId: target.profileId,
    implementation: target.implementation,
    planId: target.planId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function subject(previous: typeof ownership | null = null) {
    const repository = {
      acquireCanonicalLock: jest.fn().mockResolvedValue(undefined),
      targetExists: jest.fn().mockResolvedValue(true),
      findByUserId: jest.fn().mockResolvedValue(previous),
      upsert: jest.fn().mockResolvedValue(ownership),
    };
    const audit = { recordInTransaction: jest.fn().mockResolvedValue({}) };
    return {
      repository,
      audit,
      service: new NutritionPlanOwnershipService(
        repository as unknown as NutritionPlanOwnershipRepository,
        audit as unknown as AuditService,
      ),
    };
  }

  it('creates and audits ownership in the received transaction', async () => {
    const test = subject();
    await expect(
      test.service.transitionInTransaction(transaction, target),
    ).resolves.toMatchObject({ transition: 'CREATED', ownership });
    expect(test.repository.upsert).toHaveBeenCalledWith(transaction, target);
    expect(test.audit.recordInTransaction).toHaveBeenCalledTimes(1);
  });

  it('reuses an exact owner without writing or auditing', async () => {
    const test = subject(ownership);
    await expect(
      test.service.transitionInTransaction(transaction, target),
    ).resolves.toMatchObject({ transition: 'REUSED' });
    expect(test.repository.upsert).not.toHaveBeenCalled();
    expect(test.audit.recordInTransaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid aggregate and a reused plan owned elsewhere', async () => {
    const invalid = subject();
    invalid.repository.targetExists.mockResolvedValue(false);
    await expect(
      invalid.service.transitionInTransaction(transaction, target),
    ).rejects.toBeInstanceOf(ConflictException);

    const mismatch = subject({ ...ownership, planId: 'other-plan' });
    await expect(
      mismatch.service.assertInTransaction(transaction, target),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
