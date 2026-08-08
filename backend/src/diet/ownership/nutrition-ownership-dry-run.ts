import { NutritionPlanImplementation } from '@prisma/client';

export interface NutritionOwnershipActivePlan {
  readonly id: string;
  readonly userId: string;
  readonly profileId: string;
}

export interface NutritionOwnershipDryRunInput {
  readonly legacy: readonly NutritionOwnershipActivePlan[];
  readonly v2: readonly NutritionOwnershipActivePlan[];
  readonly ownedUserIds: ReadonlySet<string>;
}

export interface NutritionOwnershipDryRunCandidate {
  readonly userId: string;
  readonly profileId: string;
  readonly implementation: NutritionPlanImplementation;
  readonly planId: string;
}

export interface NutritionOwnershipDryRunConflict {
  readonly userId: string;
  readonly legacyPlanIds: readonly string[];
  readonly v2PlanIds: readonly string[];
}

export interface NutritionOwnershipDryRunResult {
  readonly mode: 'DRY_RUN';
  readonly wouldBackfill: readonly NutritionOwnershipDryRunCandidate[];
  readonly conflicts: readonly NutritionOwnershipDryRunConflict[];
  readonly alreadyOwnedCount: number;
}

export function assertNutritionOwnershipDryRunArguments(
  args: readonly string[],
): void {
  if (args.length > 0) {
    throw new Error(
      'Este comando é dry-run. Conflitos dual-active exigem remediação manual auditada.',
    );
  }
}

export function analyzeNutritionOwnershipDryRun(
  input: NutritionOwnershipDryRunInput,
): NutritionOwnershipDryRunResult {
  const users = [
    ...new Set([...input.legacy, ...input.v2].map((plan) => plan.userId)),
  ].sort();
  const wouldBackfill: NutritionOwnershipDryRunCandidate[] = [];
  const conflicts: NutritionOwnershipDryRunConflict[] = [];

  for (const userId of users) {
    if (input.ownedUserIds.has(userId)) continue;
    const legacy = input.legacy.filter((plan) => plan.userId === userId);
    const v2 = input.v2.filter((plan) => plan.userId === userId);
    if (legacy.length === 1 && v2.length === 0) {
      wouldBackfill.push({
        userId,
        profileId: legacy[0].profileId,
        implementation: NutritionPlanImplementation.LEGACY,
        planId: legacy[0].id,
      });
    } else if (legacy.length === 0 && v2.length === 1) {
      wouldBackfill.push({
        userId,
        profileId: v2[0].profileId,
        implementation: NutritionPlanImplementation.V2,
        planId: v2[0].id,
      });
    } else {
      conflicts.push({
        userId,
        legacyPlanIds: legacy.map((plan) => plan.id),
        v2PlanIds: v2.map((plan) => plan.id),
      });
    }
  }

  return Object.freeze({
    mode: 'DRY_RUN' as const,
    wouldBackfill: Object.freeze(wouldBackfill),
    conflicts: Object.freeze(conflicts),
    alreadyOwnedCount: input.ownedUserIds.size,
  });
}
