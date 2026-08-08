import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../observability/audit.service';
import type {
  NutritionPlanOwnershipTarget,
  NutritionPlanOwnershipTransitionResult,
} from './nutrition-plan-ownership.contract';
import {
  NUTRITION_PLAN_OWNERSHIP_REPOSITORY,
  type NutritionPlanOwnershipRepository,
} from './nutrition-plan-ownership.repository';

const AUDIT_ACTION = 'NUTRITION_PLAN_OWNERSHIP_CHANGED';
const AUDIT_ENTITY = 'NUTRITION_PLAN_OWNERSHIP';

@Injectable()
export class NutritionPlanOwnershipService {
  constructor(
    @Inject(NUTRITION_PLAN_OWNERSHIP_REPOSITORY)
    private readonly repository: NutritionPlanOwnershipRepository,
    private readonly auditService: AuditService,
  ) {}

  acquireCanonicalLockInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    return this.repository.acquireCanonicalLock(transaction, userId);
  }

  async transitionInTransaction(
    transaction: Prisma.TransactionClient,
    target: NutritionPlanOwnershipTarget,
  ): Promise<NutritionPlanOwnershipTransitionResult> {
    await this.assertTarget(transaction, target);
    const previous = await this.repository.findByUserId(
      transaction,
      target.userId,
    );
    if (previous && this.matches(previous, target)) {
      return Object.freeze({ transition: 'REUSED', ownership: previous });
    }

    const ownership = await this.repository.upsert(transaction, target);
    await this.auditService.recordInTransaction(transaction, {
      userId: target.userId,
      action: AUDIT_ACTION,
      entityType: AUDIT_ENTITY,
      entityId: ownership.id,
      metadata: {
        profileId: target.profileId,
        previousImplementation: previous?.implementation ?? null,
        previousPlanId: previous?.planId ?? null,
        implementation: target.implementation,
        planId: target.planId,
        aiJobId: target.aiJobId,
      },
    });
    return Object.freeze({
      transition: previous ? 'CHANGED' : 'CREATED',
      ownership,
    });
  }

  async assertInTransaction(
    transaction: Prisma.TransactionClient,
    target: NutritionPlanOwnershipTarget,
  ): Promise<void> {
    await this.assertTarget(transaction, target);
    const ownership = await this.repository.findByUserId(
      transaction,
      target.userId,
    );
    if (!ownership || !this.matches(ownership, target)) {
      throw new ConflictException(
        'Ownership canônico nutricional divergiu do plano reutilizado',
      );
    }
  }

  private async assertTarget(
    transaction: Prisma.TransactionClient,
    target: NutritionPlanOwnershipTarget,
  ): Promise<void> {
    if (!(await this.repository.targetExists(transaction, target))) {
      throw new ConflictException(
        'Aggregate do ownership canônico nutricional é inválido',
      );
    }
  }

  private matches(
    ownership: {
      readonly userId: string;
      readonly profileId: string;
      readonly implementation: NutritionPlanOwnershipTarget['implementation'];
      readonly planId: string;
    },
    target: NutritionPlanOwnershipTarget,
  ): boolean {
    return (
      ownership.userId === target.userId &&
      ownership.profileId === target.profileId &&
      ownership.implementation === target.implementation &&
      ownership.planId === target.planId
    );
  }
}
